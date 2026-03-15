/**
 * Slack Integration
 * API client, fact extraction with recency bias, sync orchestration, notification scheduling.
 */

import { WebClient } from '@slack/web-api';
import OpenAI from 'openai';
import * as slackDb from './slack-db.js';
import { sendSms } from './sms.js';
import { toE164, getOptedInMembers } from './sms-db.js';

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
    isPrivate: ch.is_private || false,
    isMember: ch.is_member || false
  }));
}

// ============================================
// AUTO-JOIN PUBLIC CHANNELS
// ============================================

/**
 * Join a single public channel by ID.
 * Requires `channels:join` bot scope.
 */
export async function joinChannel(channelId) {
  const client = getSlackClient();
  if (!client) throw new Error('Slack not configured');

  try {
    await client.conversations.join({ channel: channelId });
    return { ok: true };
  } catch (err) {
    // already_in_channel is fine, not an error
    if (err.data?.error === 'already_in_channel') return { ok: true, alreadyIn: true };
    console.error(`[Slack:join] Failed to join ${channelId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Join ALL public channels the bot isn't already a member of.
 * Safe to call repeatedly — skips channels already joined.
 * Requires `channels:join` bot scope.
 */
export async function joinAllPublicChannels() {
  const client = getSlackClient();
  if (!client) throw new Error('Slack not configured');

  const channels = [];
  let cursor;
  do {
    const result = await client.conversations.list({
      types: 'public_channel',
      exclude_archived: true,
      limit: 200,
      cursor
    });
    channels.push(...(result.channels || []));
    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  const notMember = channels.filter(ch => !ch.is_member);
  console.log(`[Slack:autojoin] ${channels.length} public channels, ${notMember.length} not yet joined`);

  if (notMember.length === 0) return { total: channels.length, joined: 0, failed: 0 };

  let joined = 0, failed = 0;
  for (const ch of notMember) {
    try {
      await client.conversations.join({ channel: ch.id });
      console.log(`[Slack:autojoin] Joined #${ch.name}`);
      joined++;
    } catch (err) {
      console.error(`[Slack:autojoin] Failed #${ch.name}: ${err.message}`);
      failed++;
    }
  }

  return { total: channels.length, joined, failed };
}

/**
 * Handle incoming Slack Events API payloads.
 * Currently handles: channel_created (auto-join new channels).
 */
export async function handleSlackEvent(event) {
  if (event.type === 'channel_created') {
    const channel = event.channel;
    console.log(`[Slack:event] New channel: #${channel.name} (${channel.id})`);
    return joinChannel(channel.id);
  }
  return { ok: true, skipped: true };
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
- deadlineDate: ISO 8601 datetime string if applicable, null otherwise.
  CRITICAL: You MUST resolve ALL relative day references to absolute dates using the message's date as reference. A fact like "Formal is on Thursday" posted on March 3 (Tuesday) MUST have deadlineDate set to "2026-03-05T00:00:00Z" (the upcoming Thursday). Never leave deadlineDate as null if ANY day or date is mentioned or implied.
  Resolution rules:
  - "tomorrow" → the day after the message date
  - "Thursday" / "this Thursday" → the next Thursday on or after the message date
  - "next Thursday" → the Thursday of the following week
  - "this weekend" → the upcoming Saturday
  - "end of week" / "by end of week" → the upcoming Friday
  - "next week" → the Monday of the following week
  - "tonight" / "today" → the message date itself
  IMPORTANT: If a SPECIFIC TIME is mentioned (e.g. "7pm", "at 3:00", "doors open at 6"), include it in the ISO string using America/Los_Angeles timezone (currently ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' }).split(' ').pop()}, UTC offset ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset' }).split('GMT')[1] || '-07:00'}). Example: "7pm" → "2026-03-06T19:00:00-07:00". If only a DATE is mentioned with no time, use date-only format (e.g. "2026-03-06T00:00:00Z"). This distinction matters for notification scheduling.

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

  // "deadline_reminder" — before the deadline
  // For timed events: 4 hours before
  // For date-only deadlines (e.g. "end of weekend"): 6 PM PST on deadline day
  if (hasSpecificTime) {
    const fourHoursBefore = new Date(eventDate.getTime() - 4 * 60 * 60 * 1000);
    if (fourHoursBefore > now && fourHoursBefore.getTime() - now.getTime() > 2 * 60 * 60 * 1000) {
      // Only schedule if reminder is more than 2 hours from now
      console.log(`[Notification:schedule] → Scheduling deadline_reminder for ${fourHoursBefore.toISOString()}`);
      notifications.push({
        userId,
        entryId,
        factId: fact.id,
        notificationType: 'deadline_reminder',
        scheduledFor: fourHoursBefore,
        eventDate,
        message: `Coming up: ${fact.extracted_fact}`
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

  // 5. Schedule deadline_reminder notifications for facts with deadline_date only
  //    (Facts without deadline_date go into the weekly digest instead)
  const datedFacts = savedFacts.filter(f => f.deadline_date);
  console.log(`[Slack:sync] #${channelName}: ${datedFacts.length} dated facts to check for deadline reminders`);
  for (const fact of datedFacts) {
    // Check if a deadline_reminder already exists for this event
    const existing = await slackDb.getExistingEventNotifications(entryId, fact.deadline_date);
    const existingReminder = existing.find(n => n.notification_type === 'deadline_reminder');
    if (existingReminder && existingReminder.status === 'pending') {
      console.log(`[Slack:sync] #${channelName}: deadline_reminder already pending for fact ${fact.id}, skipping`);
      continue;
    }

    const notifs = scheduleDeadlineNotifications(userId, entryId, fact);
    for (const n of notifs) {
      const saved = await slackDb.createNotification(n);
      if (saved) {
        console.log(`[Slack:sync] #${channelName}: created notification ${saved.id} type=${n.notificationType} scheduled=${n.scheduledFor.toISOString()}`);
      } else {
        console.log(`[Slack:sync] #${channelName}: notification ${n.notificationType} already exists for fact ${fact.id}, skipping`);
      }
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
  // Auto-join any public channels the bot isn't in yet
  try {
    const joinResult = await joinAllPublicChannels();
    if (joinResult.joined > 0) {
      console.log(`[Slack:sync] Auto-joined ${joinResult.joined} new public channels`);
    }
  } catch (err) {
    console.error('[Slack:sync] Auto-join failed:', err.message);
  }

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
      // Build enriched message once for all recipients
      let message = notification.message;
      try {
        message = await buildEnrichedNotificationMessage(notification);
        console.log(`[Notification:cron] Enriched message for ${notification.id}: "${message.substring(0, 100)}..."`);
      } catch (enrichErr) {
        console.error(`[Notification:cron] Enrichment failed for ${notification.id}, using original:`, enrichErr.message);
      }

      // Send to ALL opted-in page members (not just the page owner)
      const members = await getOptedInMembers(notification.entry_id);
      if (members.length === 0 && notification.phone) {
        // Fallback: no SMS members set up, send to page owner
        const phone = toE164(notification.phone);
        console.log(`[Notification:cron] No SMS members, falling back to owner ${phone} for ${notification.id}`);
        const smsResult = await sendSms(phone, message);
        if (smsResult.ok) {
          await slackDb.markNotificationSent(notification.id, message);
          if (notification.fact_id) await slackDb.markFactsDigested([notification.fact_id]);
          results.push({ id: notification.id, status: 'sent', recipients: 1 });
        } else {
          await slackDb.markNotificationFailed(notification.id);
          results.push({ id: notification.id, status: 'failed', reason: smsResult.error });
        }
      } else if (members.length > 0) {
        let sent = 0;
        for (const member of members) {
          const phone = member.phone_normalized;
          if (!phone || phone.length < 10) continue;
          const smsResult = await sendSms(toE164(phone), message);
          if (smsResult.ok) sent++;
        }
        console.log(`[Notification:cron] Sent ${notification.id} to ${sent}/${members.length} members`);
        await slackDb.markNotificationSent(notification.id, message);
        if (notification.fact_id) await slackDb.markFactsDigested([notification.fact_id]);
        results.push({ id: notification.id, status: 'sent', recipients: sent });
      } else {
        console.log(`[Notification:cron] SKIP ${notification.id}: no phone and no members`);
        await slackDb.markNotificationFailed(notification.id);
        results.push({ id: notification.id, status: 'failed', reason: 'no recipients' });
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

  // When no today facts found, include the specific fact being notified about
  if (relevantFacts.length === 0) {
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
        { role: 'system', content: `You write clean SMS event reminders.

FORMAT RULES:
- Plain text only. No markdown, no asterisks, no bold, no emojis.
- Each item on its own line, like a quick list
- Extremely succinct — say more with fewer words
- Sound like a sharp friend texting you, not a bot
- No filler, no "Hey!" or "Hope you're well", no sign-offs
- Under 400 chars ideally

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

// ============================================
// CRON: WEEKLY DIGEST — Sunday 7PM PST
// ============================================

export async function sendWeeklyDigests() {
  console.log('[WeeklyDigest] Starting weekly digest run');

  // Auto-mark stale facts (older than 7 days) as digested so they don't accumulate
  try {
    const staleCount = await slackDb.markStaleFactsDigested();
    if (staleCount > 0) {
      console.log(`[WeeklyDigest] Auto-marked ${staleCount} stale facts as digested`);
    }
  } catch (staleErr) {
    console.error('[WeeklyDigest] Failed to mark stale facts:', staleErr.message);
  }

  // Get all entries with enabled slack syncs
  const entries = await slackDb.getEntriesWithEnabledSyncs();
  console.log(`[WeeklyDigest] ${entries.length} entries with enabled syncs`);

  const results = [];

  for (const { entry_id: entryId } of entries) {
    try {
      // Get undigested facts (no deadline_date, current, not yet digested)
      const facts = await slackDb.getUndigestedFactsByEntry(entryId);
      if (facts.length === 0) {
        console.log(`[WeeklyDigest] Entry ${entryId}: no undigested facts, skipping`);
        continue;
      }
      console.log(`[WeeklyDigest] Entry ${entryId}: ${facts.length} undigested facts`);

      // Extract URLs from raw_text
      const extractedLinks = [];
      for (const f of facts) {
        const text = f.raw_text || '';
        const slackLinks = [...text.matchAll(/<(https?:\/\/[^|>]+)(?:\|[^>]*)?>|(?<!="|'|<)(https?:\/\/[^\s>]+)/g)];
        for (const match of slackLinks) {
          const url = match[1] || match[2];
          if (url && !url.includes('slack.com') && !extractedLinks.includes(url)) {
            extractedLinks.push(url);
          }
        }
      }

      // Compose digest via LLM
      const factsList = facts.map(f => {
        const ch = f.channel_name || f.channel_id || '';
        let line = `[#${ch}] ${f.extracted_fact}`;
        if (f.raw_text && f.raw_text !== f.extracted_fact) {
          line += ` | original: "${f.raw_text.substring(0, 400)}"`;
        }
        return line;
      }).join('\n');

      const linkInfo = extractedLinks.length > 0
        ? `\nEXTRACTED LINKS (include relevant ones in the digest):\n${extractedLinks.join('\n')}`
        : '';

      let digestMessage;
      if (process.env.OPENAI_API_KEY) {
        try {
          const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: `You compose a weekly SMS digest of Slack updates.

FORMAT RULES:
- Plain text only. No markdown, no asterisks, no bold, no emojis.
- Each item on its own line, like a quick list
- Extremely succinct — say more with fewer words
- Sound like a sharp friend texting you, not a bot
- No filler, no "Hey!" or "Hope you're well", no sign-offs
- Under 600 chars ideally, but include all important info

TOPIC GROUPING:
- Group facts about the same topic or event together into one consolidated point
- If multiple facts mention "retreat", combine them into a single retreat update
- Deduplicate redundant information — don't repeat the same thing from different channels
- Present as consolidated points, not one-per-fact

CONTENT RULES:
- Summarize key announcements, updates, and info from the week
- NEVER generalize action items. Use SPECIFIC terms from the facts
- If URLs are provided, include the most relevant ones
- Do NOT make up details not in the facts
- Do NOT include events/deadlines that have specific dates — those get their own reminders` },
              { role: 'user', content: `Compose a weekly digest SMS from these Slack facts:\n${factsList}${linkInfo}` }
            ],
            temperature: 0.3,
            max_tokens: 600
          });
          digestMessage = response.choices[0]?.message?.content?.trim();
        } catch (llmErr) {
          console.error(`[WeeklyDigest] LLM failed for entry ${entryId}:`, llmErr.message);
        }
      }

      // Fallback if LLM fails
      if (!digestMessage || digestMessage.length < 10) {
        digestMessage = `Weekly update:\n${facts.map(f => `- ${f.extracted_fact}`).join('\n')}`;
      }

      // Send to ALL opted-in page members
      const members = await getOptedInMembers(entryId);
      let sent = 0;
      for (const member of members) {
        const phone = member.phone_normalized;
        if (!phone || phone.length < 10) continue;
        const smsResult = await sendSms(toE164(phone), digestMessage);
        if (smsResult.ok) sent++;
      }
      console.log(`[WeeklyDigest] Entry ${entryId}: sent digest to ${sent}/${members.length} members`);

      // Mark facts as digested
      const factIds = facts.map(f => f.id);
      await slackDb.markFactsDigested(factIds);

      results.push({ entryId, facts: facts.length, sent, members: members.length });
    } catch (error) {
      console.error(`[WeeklyDigest] Failed for entry ${entryId}:`, error.message);
      results.push({ entryId, error: error.message });
    }
  }

  console.log(`[WeeklyDigest] Complete: ${results.length} entries processed`);
  return results;
}

// ============================================
// BACKFILL: Re-resolve dates on old facts
// ============================================

/**
 * Re-run LLM date resolution on existing facts that have deadline_date = NULL.
 * Sends facts in batches to the LLM asking it to resolve any dates.
 * Updates facts in-place and schedules notifications for newly-dated ones.
 */
export async function backfillFactDates() {
  console.log('[Backfill] Starting date backfill');

  const facts = await slackDb.getFactsWithUnresolvedDates();
  console.log(`[Backfill] Found ${facts.length} facts with NULL deadline_date`);

  if (!facts.length) return { total: 0, resolved: 0, notifications: 0 };

  // Process in chunks of 30
  let resolved = 0;
  let notificationsCreated = 0;

  for (let i = 0; i < facts.length; i += 30) {
    const chunk = facts.slice(i, i + 30);
    const formatted = chunk.map(f => ({
      id: f.id,
      fact: f.extracted_fact,
      rawText: f.raw_text?.substring(0, 500) || '',
      messageDate: f.message_date ? new Date(f.message_date).toISOString() : null,
      factType: f.fact_type
    }));

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `You are re-analyzing facts extracted from Slack messages to resolve dates that were previously missed.

For each fact, determine if it mentions or implies a specific date/time. Use the messageDate (when the Slack message was posted) to resolve relative references.

RESOLUTION RULES:
- "tomorrow" → the day after messageDate
- "Thursday" / "this Thursday" → the next Thursday on or after messageDate
- "next Thursday" → the Thursday of the following week from messageDate
- "this weekend" → the upcoming Saturday from messageDate
- "end of week" → the upcoming Friday from messageDate
- "tonight" / "today" → messageDate itself
- Any specific date like "March 10" → resolve to that date

If a SPECIFIC TIME is mentioned (e.g. "7pm", "at 3:00"), use America/Los_Angeles timezone.
If only a DATE, use "YYYY-MM-DDT00:00:00Z" format.

Return JSON array of ONLY the facts that have a resolvable date:
[{"id": "...", "deadlineDate": "ISO8601", "factType": "event" or "deadline"}]

Return [] if no facts have resolvable dates. Do NOT guess — only resolve when a day/date is clearly mentioned or implied.`
          },
          {
            role: 'user',
            content: JSON.stringify(formatted)
          }
        ]
      });

      const content = response.choices[0]?.message?.content || '[]';
      const cleaned = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      const updates = JSON.parse(cleaned);

      if (!Array.isArray(updates)) continue;

      for (const update of updates) {
        if (!update.id || !update.deadlineDate) continue;
        const fact = chunk.find(f => f.id === update.id);
        if (!fact) continue;

        await slackDb.updateFactDeadline(update.id, update.deadlineDate, update.factType || null);
        resolved++;
        console.log(`[Backfill] Resolved fact ${update.id}: "${fact.extracted_fact?.substring(0, 60)}" → ${update.deadlineDate}`);

        // Schedule notifications for newly-dated facts if date is in the future
        const eventDate = new Date(update.deadlineDate);
        if (eventDate > new Date()) {
          const notifs = scheduleDeadlineNotifications(fact.user_id || fact.sync_user_id, fact.entry_id, {
            ...fact,
            deadline_date: update.deadlineDate
          });
          for (const n of notifs) {
            const saved = await slackDb.createNotification(n);
            if (saved) notificationsCreated++;
          }
        }
      }
    } catch (error) {
      console.error(`[Backfill] Error processing chunk at offset ${i}:`, error.message);
    }
  }

  console.log(`[Backfill] Complete: ${resolved} dates resolved, ${notificationsCreated} notifications created out of ${facts.length} total facts`);
  return { total: facts.length, resolved, notifications: notificationsCreated };
}
