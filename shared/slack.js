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
            content: `You extract key facts from Slack #${channelName} messages. For each message that contains actionable or notable information, extract a DETAILED fact. Focus on:
- Announcements, deadlines, events, schedule changes
- Important decisions or policy updates
- Action items or assignments (include WHAT to submit, WHERE, form names, URLs)
- Meeting times and locations

Skip casual chat, reactions, and trivial messages.

CRITICAL — PRESERVE SPECIFIC DETAILS:
- "submit uber reimbursement form" NOT "submit your work"
- "fill out Google form for PFC" NOT "complete a form"
- Include WHO posted and context about what the action is for
- Keep form names, URLs, specific instructions, exact actions
- Keep the full meaning — never generalize action items
- REPLY CONTEXT: If a message starts with "^" or is clearly a reply/follow-up to a previous message in the batch (e.g. "^ pls submit by end of weekend"), combine it with the referenced message. The fact should describe WHAT to submit, not just "submit by weekend".

For each fact, determine:
- factType: "info" (general), "deadline" (has a due date), "event" (has a date/time), "announcement" (broadcast)
- deadlineDate: ISO 8601 datetime string if applicable, null otherwise. Resolve relative dates ("next Tuesday") based on the message date.
  IMPORTANT: If a SPECIFIC TIME is mentioned (e.g. "7pm", "at 3:00", "doors open at 6"), include it in the ISO string (e.g. "2026-03-06T19:00:00-08:00"). If only a DATE is mentioned with no time, use date-only format (e.g. "2026-03-06T00:00:00Z"). This distinction matters for notification scheduling.

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

  // Detect if event has a specific time (not just a date).
  const hasSpecificTime = eventDate.getUTCHours() !== 0 || eventDate.getUTCMinutes() !== 0 || eventDate.getUTCSeconds() !== 0;

  console.log(`[Notification:schedule] Fact ${fact.id}: "${fact.extracted_fact?.substring(0, 60)}" | eventDate=${eventDate.toISOString()} | now=${now.toISOString()} | hasTime=${hasSpecificTime}`);

  // NOTIFICATION 1: "initial" — send soon after discovery (next cron tick, ~1 min from now)
  const initialTime = new Date(now.getTime() + 60 * 1000);
  console.log(`[Notification:schedule] → Scheduling initial for ${initialTime.toISOString()}`);
  notifications.push({
    userId,
    entryId,
    factId: fact.id,
    notificationType: 'initial',
    scheduledFor: initialTime,
    eventDate,
    message: `Heads up: ${fact.extracted_fact}`
  });

  // NOTIFICATION 2: "deadline_reminder" — right before the deadline
  // For timed events: 2 hours before
  // For date-only deadlines (e.g. "end of weekend"): 6 PM PST on deadline day
  if (hasSpecificTime) {
    const twoHoursBefore = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000);
    if (twoHoursBefore > now && twoHoursBefore.getTime() - now.getTime() > 3 * 60 * 60 * 1000) {
      // Only schedule if deadline is more than 3 hours away (otherwise initial is enough)
      console.log(`[Notification:schedule] → Scheduling deadline_reminder for ${twoHoursBefore.toISOString()}`);
      notifications.push({
        userId,
        entryId,
        factId: fact.id,
        notificationType: 'deadline_reminder',
        scheduledFor: twoHoursBefore,
        eventDate,
        message: `Starting soon: ${fact.extracted_fact}`
      });
    }
  } else {
    // Date-only deadline: remind at 6 PM PST on deadline day
    const eveningReminder = new Date(eventDate);
    eveningReminder.setUTCHours(2, 0, 0, 0); // 6pm PST = 02:00 UTC next day
    // If deadline is "end of day", the evening reminder should be same day 6pm
    // eventDate at midnight UTC → 6pm PST is eventDate - 6 hours + 18 hours = +12 hours? No.
    // Actually: if eventDate = 2026-03-07T00:00:00Z, that's Mar 6 4pm PST.
    // We want 6pm PST on Mar 7 = Mar 8 02:00 UTC.
    eveningReminder.setDate(eveningReminder.getDate() + 1); // next day 2am UTC = 6pm PST on deadline day
    if (eveningReminder > now && eveningReminder.getTime() - now.getTime() > 3 * 60 * 60 * 1000) {
      console.log(`[Notification:schedule] → Scheduling deadline_reminder (evening) for ${eveningReminder.toISOString()}`);
      notifications.push({
        userId,
        entryId,
        factId: fact.id,
        notificationType: 'deadline_reminder',
        scheduledFor: eveningReminder,
        eventDate,
        message: `Reminder — due soon: ${fact.extracted_fact}`
      });
    }
  }

  console.log(`[Notification:schedule] → Total scheduled: ${notifications.length} notifications`);
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

  // 6. Auto-create canvas entries for actionable facts
  const actionableFacts = savedFacts.filter(f =>
    f.fact_type === 'deadline' || f.fact_type === 'event' || f.fact_type === 'announcement'
  );
  let autoEntriesCreated = 0;
  if (actionableFacts.length > 0) {
    const { saveEntry, getPool } = await import('./db.js');
    const dbPool = getPool();
    for (const fact of actionableFacts) {
      // Check if an auto-entry already exists for this fact
      const existing = await dbPool.query(
        `SELECT id FROM entries WHERE id = $1 AND deleted_at IS NULL`,
        [`slack-fact-${fact.id}`]
      );
      if (existing.rows.length > 0) continue;

      // Build entry text
      let text = fact.extracted_fact;
      if (fact.deadline_date) {
        const d = new Date(fact.deadline_date);
        text += ` (${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`;
      }

      // Position: stagger auto-entries vertically
      const yOffset = autoEntriesCreated * 60;
      try {
        await saveEntry({
          id: `slack-fact-${fact.id}`,
          text,
          position: { x: 40, y: 40 + yOffset },
          parentEntryId: entryId,
          userId,
          mediaCardData: { source: 'slack_auto', factId: fact.id, factType: fact.fact_type, channelName }
        });
        autoEntriesCreated++;
      } catch (entryErr) {
        console.error(`[Slack:sync] Failed to create auto-entry for fact ${fact.id}:`, entryErr.message);
      }
    }
    if (autoEntriesCreated > 0) {
      console.log(`[Slack:sync] #${channelName}: created ${autoEntriesCreated} auto-entries`);
    }
  }

  // 7. Update sync timestamp to latest message
  const latestTs = messages.reduce((max, m) => m.ts > max ? m.ts : max, lastSyncTs || '0');
  await slackDb.updateSyncTimestamp(syncId, latestTs);

  return { newFacts: savedFacts.length, autoEntries: autoEntriesCreated };
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

  // Cleanup: soft-delete old auto-created entries whose event date has passed
  try {
    const { getPool } = await import('./db.js');
    const db = getPool();
    const cleaned = await db.query(
      `UPDATE entries SET deleted_at = CURRENT_TIMESTAMP
       WHERE id LIKE 'slack-fact-%'
       AND deleted_at IS NULL
       AND media_card_data->>'source' = 'slack_auto'
       AND media_card_data->>'factId' IN (
         SELECT id::text FROM slack_facts
         WHERE deadline_date < CURRENT_DATE AND deadline_date IS NOT NULL
       )
       RETURNING id`
    );
    if (cleaned.rows.length > 0) {
      console.log(`[Slack:cleanup] Soft-deleted ${cleaned.rows.length} old auto-entries`);
    }
  } catch (cleanupErr) {
    console.error('[Slack:cleanup] Error:', cleanupErr.message);
  }

  return results;
}

// ============================================
// CRON: SEND PENDING NOTIFICATIONS
// ============================================

export async function checkAndSendNotifications() {
  const now = new Date();
  console.log(`[Notification:cron] Checking for pending notifications at ${now.toISOString()}`);

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
        await slackDb.markNotificationSent(notification.id, message);
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
 * Build an enriched notification message.
 * Pulls ALL today's facts for this entry and composes one clean SMS.
 */
async function buildEnrichedNotificationMessage(notification) {
  const { fact_id, entry_id, notification_type } = notification;

  // Gather ALL current facts for this entry
  const allFacts = await slackDb.getFactsByEntry(entry_id, { currentOnly: true, limit: 50 });
  const channelNames = await slackDb.getChannelNamesForEntry(entry_id);

  // Get today's facts only (PST)
  const pstOptions = { timeZone: 'America/Los_Angeles' };
  const todayPST = new Date().toLocaleDateString('en-US', pstOptions);

  const todayFacts = allFacts.filter(f => {
    if (!f.deadline_date) return false;
    return new Date(f.deadline_date).toLocaleDateString('en-US', pstOptions) === todayPST;
  });

  // Also include general facts from today's messages (no deadline but posted today)
  const todayInfoFacts = allFacts.filter(f => {
    if (f.deadline_date) return false;
    if (!f.message_date) return false;
    return new Date(f.message_date).toLocaleDateString('en-US', pstOptions) === todayPST;
  });

  let relevantFacts = [...todayFacts, ...todayInfoFacts];

  // For initial notifications or when no today facts found, include the specific fact being notified about
  if (relevantFacts.length === 0 || notification_type === 'initial') {
    const thisFact = allFacts.find(f => f.id === fact_id);
    if (thisFact && !relevantFacts.some(f => f.id === thisFact.id)) {
      relevantFacts.unshift(thisFact);
    }
  }
  console.log(`[Notification:enrich] Entry ${entry_id}: ${todayFacts.length} today event facts, ${todayInfoFacts.length} today info facts, total relevant: ${relevantFacts.length}`);

  // Extract actual URLs from raw_text and track which channels they came from
  const extractedLinks = [];
  const channelsWithLinks = new Set();
  for (const f of relevantFacts) {
    const text = f.raw_text || '';
    // Match Slack-formatted links <url|label> and plain URLs
    const slackLinks = [...text.matchAll(/<(https?:\/\/[^|>]+)(?:\|[^>]*)?>|(?<!="|'|<)(https?:\/\/[^\s>]+)/g)];
    for (const match of slackLinks) {
      const url = match[1] || match[2];
      if (url && !url.includes('slack.com') && !extractedLinks.includes(url)) {
        extractedLinks.push(url);
        if (f.channel_name || f.channel_id) channelsWithLinks.add(f.channel_name || f.channel_id);
      }
    }
  }

  const linkInfo = extractedLinks.length > 0
    ? `\nEXTRACTED LINKS (include these directly in the SMS):\n${extractedLinks.join('\n')}`
    : '';
  const channelRefForLinks = channelsWithLinks.size > 0
    ? `#${[...channelsWithLinks].join(', #')}`
    : '';

  // Build facts list for LLM, include channel name per fact
  const factsList = relevantFacts.map(f => {
    const ch = f.channel_name || f.channel_id || '';
    let line = `[#${ch}] ${f.extracted_fact}`;
    if (f.raw_text && f.raw_text !== f.extracted_fact) {
      line += ` | original: "${f.raw_text.substring(0, 400)}"`;
    }
    return line;
  }).join('\n');

  if (!process.env.OPENAI_API_KEY) return notification.message;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You write clean SMS event reminders. Plain text only.

FORMAT RULES:
- PLAIN TEXT ONLY. No markdown, no asterisks, no bullet points, no bold, no formatting.
- Use line breaks to separate sections
- Keep it natural and readable, like a text from a friend
- Under 400 chars ideally
- 1-2 emoji max, only if natural

CONTENT RULES:
- Include ALL actionable details: times, addresses, dress code, transport
- Include details from the relevant events/deadlines being notified about
- NEVER generalize or paraphrase action items. Use SPECIFIC terms from the facts:
  "submit uber reimbursement form" NOT "submit your work"
  "fill out pledge parent application" NOT "complete your forms"
  "sign up for formal cars" NOT "sign up for things"
- If actual URLs are provided in the extracted links, include the URL directly in the text
- If links are mentioned but no URL is available, say "check #channel-name on Slack" (only the SPECIFIC channel, not all channels)
- Do NOT make up any details not in the facts
- Do NOT say "catch-up" or "reminder" in the header
- Look at ALL facts together — if one says "submit by weekend" and an adjacent one mentions a specific form/URL, they are related. Combine the specifics.` },
        { role: 'user', content: `Notification type: ${notification_type}\nEvent details:\n${factsList || notification.message}${linkInfo}\n\nCompose the SMS. Use the ORIGINAL Slack message text (after the | original:) to get specific details like form names, URLs, and exact actions:` }
      ],
      temperature: 0.3,
      max_tokens: 400
    });

    const enriched = response.choices[0]?.message?.content?.trim();
    if (enriched && enriched.length > 10) {
      console.log(`[Notification:enrich] Final message (${enriched.length} chars): ${enriched.substring(0, 120)}...`);
      return enriched;
    }
  } catch (error) {
    console.error('[Notification:enrich] LLM failed:', error.message);
  }

  return notification.message;
}
