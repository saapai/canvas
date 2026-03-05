/**
 * Slack Integration
 * API client, fact extraction with recency bias, sync orchestration, notification scheduling.
 */

import { WebClient } from '@slack/web-api';
import OpenAI from 'openai';
import * as slackDb from './slack-db.js';
import { sendSms } from './sms.js';
import { toE164 } from './sms-db.js';

let _slackClient = null;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============================================
// SLACK API CLIENT
// ============================================

export function getSlackClient() {
  if (!_slackClient) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return null;
    _slackClient = new WebClient(token);
  }
  return _slackClient;
}

export async function listAccessibleChannels() {
  const client = getSlackClient();
  if (!client) throw new Error('Slack not configured');

  const channels = [];
  let cursor;
  do {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      cursor
    });
    channels.push(...(result.channels || []));
    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  return channels.map(ch => ({
    id: ch.id,
    name: ch.name,
    topic: ch.topic?.value || '',
    purpose: ch.purpose?.value || '',
    memberCount: ch.num_members || 0,
    isPrivate: ch.is_private || false
  }));
}

export async function fetchChannelMessages(channelId, oldestTs = null) {
  const client = getSlackClient();
  if (!client) throw new Error('Slack not configured');

  const messages = [];
  let cursor;
  const params = { channel: channelId, limit: 100 };
  if (oldestTs) params.oldest = oldestTs;

  do {
    const result = await client.conversations.history({ ...params, cursor });
    const filtered = (result.messages || []).filter(m => m.type === 'message' && !m.subtype);
    messages.push(...filtered);
    cursor = result.response_metadata?.next_cursor;
    // Cap at 500 messages per sync to avoid runaway costs
    if (messages.length >= 500) break;
  } while (cursor);

  return messages;
}

// ============================================
// LLM FACT EXTRACTION
// ============================================

export async function extractFacts(messages, channelName) {
  if (!messages.length) return [];

  // Batch messages into chunks of 20 for LLM processing
  const chunks = [];
  for (let i = 0; i < messages.length; i += 20) {
    chunks.push(messages.slice(i, i + 20));
  }

  const allFacts = [];

  for (const chunk of chunks) {
    const formatted = chunk.map(m => ({
      ts: m.ts,
      text: m.text?.substring(0, 500) || '',
      user: m.user || 'unknown',
      date: new Date(parseFloat(m.ts) * 1000).toISOString()
    }));

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `You extract key facts from Slack #${channelName} messages. For each message that contains actionable or notable information, extract a concise fact. Focus on:
- Announcements, deadlines, events, schedule changes
- Important decisions or policy updates
- Action items or assignments
- Meeting times and locations

Skip casual chat, reactions, and trivial messages.

For each fact, determine:
- factType: "info" (general), "deadline" (has a due date), "event" (has a date/time), "announcement" (broadcast)
- deadlineDate: ISO 8601 date string if applicable, null otherwise. Resolve relative dates ("next Tuesday") based on the message date.

Return JSON array:
[{"messageTs": "...", "extractedFact": "...", "factType": "...", "deadlineDate": "..." or null}]

Return [] if no facts worth extracting.`
          },
          {
            role: 'user',
            content: JSON.stringify(formatted)
          }
        ]
      });

      const content = response.choices[0]?.message?.content || '[]';
      // Strip markdown code fence if present
      const cleaned = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      const facts = JSON.parse(cleaned);
      if (Array.isArray(facts)) allFacts.push(...facts);
    } catch (error) {
      console.error('Fact extraction error for chunk:', error.message);
    }
  }

  return allFacts;
}

// ============================================
// RECENCY BIAS — supersede outdated facts
// ============================================

export async function handleRecencyBias(entryId, newFacts) {
  if (!newFacts.length) return;

  const existingFacts = await slackDb.getFactsByEntry(entryId, { currentOnly: true, limit: 100 });
  if (!existingFacts.length) return;

  const existingText = existingFacts.map(f => ({ id: f.id, fact: f.extracted_fact, date: f.message_date }));
  const newText = newFacts.map(f => ({ id: f.id, fact: f.extracted_fact, date: f.message_date }));

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 1000,
      messages: [
        {
          role: 'system',
          content: `Compare existing facts with new facts. Identify which existing facts are now outdated or superseded by newer information. For example, if an old fact says "Meeting on Friday at 3pm" and a new fact says "Meeting rescheduled to Monday at 2pm", the old fact is superseded.

Return JSON array of superseded pairs:
[{"oldFactId": "...", "newFactId": "..."}]

Return [] if nothing is superseded.`
        },
        {
          role: 'user',
          content: JSON.stringify({ existing: existingText, new: newText })
        }
      ]
    });

    const content = response.choices[0]?.message?.content || '[]';
    const cleaned = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const pairs = JSON.parse(cleaned);

    if (Array.isArray(pairs)) {
      for (const { oldFactId, newFactId } of pairs) {
        if (oldFactId && newFactId) {
          await slackDb.supersedeFact(oldFactId, newFactId);
          await slackDb.cancelNotificationsForFact(oldFactId);
        }
      }
    }
  } catch (error) {
    console.error('Recency bias error:', error.message);
  }
}

// ============================================
// NOTIFICATION SCHEDULING
// ============================================

export function scheduleDeadlineNotifications(userId, entryId, fact) {
  if (!fact.deadline_date) {
    console.log(`[Notification:schedule] Fact ${fact.id} has no deadline_date, skipping`);
    return [];
  }

  const eventDate = new Date(fact.deadline_date);
  const now = new Date();
  const notifications = [];

  const isToday = eventDate.toDateString() === now.toDateString();
  const isFuture = eventDate > now;

  console.log(`[Notification:schedule] Fact ${fact.id}: "${fact.extracted_fact?.substring(0, 60)}" | eventDate=${eventDate.toISOString()} | now=${now.toISOString()} | isToday=${isToday} | isFuture=${isFuture}`);

  // Morning of: 10:00 AM PST on event day
  const morningOf = new Date(eventDate);
  morningOf.setUTCHours(18, 0, 0, 0); // 10am PST = 18:00 UTC
  if (morningOf > now) {
    console.log(`[Notification:schedule] → Scheduling morning_of for ${morningOf.toISOString()}`);
    notifications.push({
      userId,
      entryId,
      factId: fact.id,
      notificationType: 'morning_of',
      scheduledFor: morningOf,
      eventDate,
      message: `Reminder: ${fact.extracted_fact}`
    });
  } else {
    console.log(`[Notification:schedule] → morning_of already passed (was ${morningOf.toISOString()})`);
  }

  // 2 hours before event
  const twoHoursBefore = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000);
  if (twoHoursBefore > now) {
    console.log(`[Notification:schedule] → Scheduling two_hours_before for ${twoHoursBefore.toISOString()}`);
    notifications.push({
      userId,
      entryId,
      factId: fact.id,
      notificationType: 'two_hours_before',
      scheduledFor: twoHoursBefore,
      eventDate,
      message: `Starting soon (2 hours): ${fact.extracted_fact}`
    });
  } else {
    console.log(`[Notification:schedule] → two_hours_before already passed (was ${twoHoursBefore.toISOString()})`);
  }

  // CATCH-UP: If event is today but morning_of already passed and we have no
  // scheduled notifications yet, send a catch-up notification immediately.
  if (isToday && morningOf <= now && notifications.length === 0) {
    const catchUpTime = new Date(now.getTime() + 60 * 1000);
    console.log(`[Notification:schedule] → Event is today, all windows passed — scheduling CATCH-UP for ${catchUpTime.toISOString()}`);
    notifications.push({
      userId,
      entryId,
      factId: fact.id,
      notificationType: 'catch_up',
      scheduledFor: catchUpTime,
      eventDate,
      message: `Heads up — happening today: ${fact.extracted_fact}`
    });
  }

  if (notifications.length === 0) {
    console.log(`[Notification:schedule] → No notifications scheduled (event ${isToday ? 'is today but event time passed' : 'is in the past'})`);
  } else {
    console.log(`[Notification:schedule] → Total scheduled: ${notifications.length} notifications`);
  }

  return notifications;
}

// ============================================
// SYNC ORCHESTRATOR
// ============================================

export async function syncChannel(syncRecord) {
  const { id: syncId, user_id: userId, entry_id: entryId, channel_id: channelId, channel_name: channelName, last_sync_ts: lastSyncTs } = syncRecord;

  console.log(`[Slack:sync] Starting sync for #${channelName} (${channelId}), lastTs: ${lastSyncTs || 'none'}`);

  // 1. Fetch new messages since last sync
  let messages;
  try {
    messages = await fetchChannelMessages(channelId, lastSyncTs);
  } catch (err) {
    if (err.message?.includes('not_in_channel')) {
      console.log(`[Slack:sync] Bot not in #${channelName}, disabling sync`);
      await slackDb.disableSync(syncId);
      return { newFacts: 0, skipped: 'not_in_channel' };
    }
    throw err;
  }
  console.log(`[Slack:sync] #${channelName}: fetched ${messages.length} new messages`);
  if (!messages.length) {
    await slackDb.updateSyncTimestamp(syncId, lastSyncTs || '0');
    return { newFacts: 0 };
  }

  // 2. Extract facts via LLM
  const extractedFacts = await extractFacts(messages, channelName);
  console.log(`[Slack:sync] #${channelName}: extracted ${extractedFacts.length} facts from ${messages.length} messages`);

  // 3. Save facts to DB
  const savedFacts = [];
  for (const fact of extractedFacts) {
    const msg = messages.find(m => m.ts === fact.messageTs);
    const saved = await slackDb.saveFact({
      syncId,
      entryId,
      channelId,
      messageTs: fact.messageTs,
      messageDate: msg ? new Date(parseFloat(msg.ts) * 1000) : null,
      author: msg?.user || null,
      rawText: msg?.text || null,
      extractedFact: fact.extractedFact,
      factType: fact.factType || 'info',
      deadlineDate: fact.deadlineDate || null
    });
    savedFacts.push(saved);
  }

  // 4. Handle recency bias — supersede outdated facts
  await handleRecencyBias(entryId, savedFacts);

  // 5. Schedule notifications for deadline/event facts
  console.log(`[Slack:sync] #${channelName}: checking ${savedFacts.length} facts for notifications (deadline/event types)`);
  const deadlineEventFacts = savedFacts.filter(f => f.fact_type === 'deadline' || f.fact_type === 'event');
  console.log(`[Slack:sync] #${channelName}: ${deadlineEventFacts.length} deadline/event facts found`);
  for (const fact of deadlineEventFacts) {
    console.log(`[Slack:sync] #${channelName}: scheduling for fact ${fact.id} (type=${fact.fact_type}, deadline=${fact.deadline_date}): "${fact.extracted_fact?.substring(0, 80)}"`);
    const notifs = scheduleDeadlineNotifications(userId, entryId, fact);
    for (const n of notifs) {
      const saved = await slackDb.createNotification(n);
      console.log(`[Slack:sync] #${channelName}: created notification ${saved.id} type=${n.notificationType} scheduled=${n.scheduledFor.toISOString()}`);
    }
  }

  // 6. Update sync timestamp to latest message
  const latestTs = messages.reduce((max, m) => m.ts > max ? m.ts : max, lastSyncTs || '0');
  await slackDb.updateSyncTimestamp(syncId, latestTs);

  return { newFacts: savedFacts.length };
}

// ============================================
// CRON: SYNC ALL ENABLED CHANNELS
// ============================================

export async function syncAllChannels() {
  const syncs = await slackDb.getAllEnabledSyncs();
  const results = [];

  for (const sync of syncs) {
    try {
      const result = await syncChannel(sync);
      results.push({ syncId: sync.id, channelName: sync.channel_name, ...result });
    } catch (error) {
      console.error(`Sync failed for channel ${sync.channel_name}:`, error.message);
      results.push({ syncId: sync.id, channelName: sync.channel_name, error: error.message });
    }
  }

  return results;
}

// ============================================
// CRON: SEND PENDING NOTIFICATIONS
// ============================================

export async function checkAndSendNotifications() {
  const now = new Date();
  console.log(`[Notification:cron] Checking for pending notifications at ${now.toISOString()}`);

  // First: backfill catch-up notifications for today's events that have none
  try {
    const unnotified = await slackDb.getTodayUnnotifiedEventFacts();
    console.log(`[Notification:cron] Today's unnotified event facts: ${unnotified.length}`);
    for (const fact of unnotified) {
      console.log(`[Notification:cron] Backfilling catch-up for fact ${fact.id}: "${fact.extracted_fact?.substring(0, 80)}" (deadline=${fact.deadline_date})`);
      const notifs = scheduleDeadlineNotifications(fact.user_id, fact.entry_id, fact);
      for (const n of notifs) {
        const saved = await slackDb.createNotification(n);
        console.log(`[Notification:cron] Backfilled notification ${saved.id} type=${n.notificationType} scheduled=${n.scheduledFor.toISOString()}`);
      }
    }
  } catch (backfillErr) {
    console.error(`[Notification:cron] Backfill error:`, backfillErr.message);
  }

  const pending = await slackDb.getPendingNotifications(now);
  console.log(`[Notification:cron] Found ${pending.length} pending notifications`);

  if (pending.length > 0) {
    for (const n of pending) {
      console.log(`[Notification:cron] Pending: id=${n.id} type=${n.notification_type} fact=${n.fact_id} scheduled=${n.scheduled_for} phone=${n.phone ? 'yes' : 'NO'} entry=${n.entry_id}`);
    }
  }

  const results = [];

  for (const notification of pending) {
    try {
      if (!notification.phone) {
        console.log(`[Notification:cron] SKIP ${notification.id}: no phone number on user`);
        await slackDb.markNotificationFailed(notification.id);
        results.push({ id: notification.id, status: 'failed', reason: 'no phone' });
        continue;
      }

      // Check if prior notifications were missed for this event
      let message = notification.message;
      try {
        message = await buildEnrichedNotificationMessage(notification);
        console.log(`[Notification:cron] Enriched message for ${notification.id}: "${message.substring(0, 100)}..."`);
      } catch (enrichErr) {
        console.error(`[Notification:cron] Enrichment failed for ${notification.id}, using original:`, enrichErr.message);
      }

      const phone = toE164(notification.phone);
      console.log(`[Notification:cron] Sending SMS to ${phone} for notification ${notification.id}`);
      const smsResult = await sendSms(phone, message);
      if (smsResult.ok) {
        await slackDb.markNotificationSent(notification.id);
        results.push({ id: notification.id, status: 'sent' });
      } else {
        await slackDb.markNotificationFailed(notification.id);
        results.push({ id: notification.id, status: 'failed', reason: smsResult.error });
      }
    } catch (error) {
      console.error(`Notification send failed for ${notification.id}:`, error.message);
      await slackDb.markNotificationFailed(notification.id);
      results.push({ id: notification.id, status: 'failed', reason: error.message });
    }
  }

  return results;
}

/**
 * Build an enriched notification message by checking:
 * 1. Whether prior notifications (morning_of) were missed
 * 2. All related context from Slack facts, entries, and announcements
 * 3. Slack channel references for links
 */
async function buildEnrichedNotificationMessage(notification) {
  const { fact_id, entry_id, notification_type } = notification;

  // Check sibling notification states
  const siblings = await slackDb.getSiblingNotifications(fact_id);
  const missedTypes = [];
  const NOTIFICATION_ORDER = ['morning_of', 'two_hours_before', 'catch_up'];

  const currentIdx = NOTIFICATION_ORDER.indexOf(notification_type);
  for (let i = 0; i < currentIdx; i++) {
    const priorType = NOTIFICATION_ORDER[i];
    const priorNotif = siblings.find(s => s.notification_type === priorType);
    if (!priorNotif || (priorNotif.status !== 'sent')) {
      missedTypes.push(priorType);
    }
  }

  // catch_up always means all prior notifications were missed
  if (notification_type === 'catch_up') {
    missedTypes.push('morning_of', 'two_hours_before');
  }

  // Gather all context for a comprehensive message
  const allFacts = await slackDb.getFactsByEntry(entry_id, { currentOnly: true, limit: 30 });
  const channelNames = await slackDb.getChannelNamesForEntry(entry_id);

  // Find facts related to this event (same deadline_date or related keywords)
  const thisFact = allFacts.find(f => f.id === fact_id);
  const eventDate = notification.event_date;

  // Get all facts that share the same deadline_date (same event)
  const relatedFacts = allFacts.filter(f => {
    if (f.id === fact_id) return false;
    if (f.deadline_date && eventDate) {
      const fDate = new Date(f.deadline_date).toDateString();
      const eDate = new Date(eventDate).toDateString();
      if (fDate === eDate) return true;
    }
    return false;
  });

  // Check if any facts mention links/URLs
  const factsWithLinks = [...(thisFact ? [thisFact] : []), ...relatedFacts].filter(f => {
    const text = (f.raw_text || '') + ' ' + (f.extracted_fact || '');
    return /https?:\/\/|link|sign.?up|form|rsvp/i.test(text);
  });

  // Build context for LLM
  const factsList = [
    thisFact ? `MAIN EVENT: ${thisFact.extracted_fact}${thisFact.raw_text ? ` (raw: "${thisFact.raw_text.substring(0, 300)}")` : ''}` : '',
    ...relatedFacts.map(f => `RELATED: ${f.extracted_fact}${f.raw_text ? ` (raw: "${f.raw_text.substring(0, 200)}")` : ''}`)
  ].filter(Boolean).join('\n');

  const channelRef = channelNames.length > 0
    ? `Slack channels: #${channelNames.join(', #')}`
    : '';

  const hasLinks = factsWithLinks.length > 0;
  const missedInfo = missedTypes.length > 0
    ? `MISSED NOTIFICATIONS: ${missedTypes.join(', ')} — this person has NOT received any prior reminder about this event.`
    : '';

  // Use LLM to compose an efficient, comprehensive message
  if (!process.env.OPENAI_API_KEY) return notification.message;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are composing an SMS event reminder. Be concise but include ALL actionable details.

RULES:
- Include: event name, time, location/address, dress code, transportation info, any deadlines
- If there are links/signups mentioned in the facts, tell them to check Slack (mention the channel name) for links
- Keep under 320 characters if possible, but include all critical info
- Use casual, friendly tone
- ${missedInfo ? 'This person missed earlier reminders — make this a comprehensive catch-up message' : 'This is a scheduled reminder'}
- Do NOT make up details not in the facts` },
        { role: 'user', content: `Notification type: ${notification_type}
${missedInfo}

Event facts:
${factsList || notification.message}

${hasLinks ? `NOTE: Some facts reference links/signups. Direct user to check ${channelRef || 'Slack'} for links.` : ''}
${channelRef}

Compose the SMS reminder:` }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    const enriched = response.choices[0]?.message?.content?.trim();
    if (enriched && enriched.length > 10) {
      console.log(`[Notification] Enriched message for ${notification.id} (missed: ${missedTypes.join(',') || 'none'}): ${enriched.substring(0, 100)}...`);
      return enriched;
    }
  } catch (error) {
    console.error('[Notification] LLM enrichment failed:', error.message);
  }

  return notification.message;
}
