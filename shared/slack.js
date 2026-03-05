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
  if (!fact.deadline_date) return [];

  const eventDate = new Date(fact.deadline_date);
  const now = new Date();
  const notifications = [];

  // Morning of: 10:00 AM PST on event day
  const morningOf = new Date(eventDate);
  morningOf.setUTCHours(18, 0, 0, 0); // 10am PST = 18:00 UTC
  if (morningOf > now) {
    notifications.push({
      userId,
      entryId,
      factId: fact.id,
      notificationType: 'morning_of',
      scheduledFor: morningOf,
      eventDate,
      message: `Reminder: ${fact.extracted_fact}`
    });
  }

  // 2 hours before event
  const twoHoursBefore = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000);
  if (twoHoursBefore > now) {
    notifications.push({
      userId,
      entryId,
      factId: fact.id,
      notificationType: 'two_hours_before',
      scheduledFor: twoHoursBefore,
      eventDate,
      message: `Starting soon (2 hours): ${fact.extracted_fact}`
    });
  }

  return notifications;
}

// ============================================
// SYNC ORCHESTRATOR
// ============================================

export async function syncChannel(syncRecord) {
  const { id: syncId, user_id: userId, entry_id: entryId, channel_id: channelId, channel_name: channelName, last_sync_ts: lastSyncTs } = syncRecord;

  // 1. Fetch new messages since last sync
  const messages = await fetchChannelMessages(channelId, lastSyncTs);
  if (!messages.length) {
    await slackDb.updateSyncTimestamp(syncId, lastSyncTs || '0');
    return { newFacts: 0 };
  }

  // 2. Extract facts via LLM
  const extractedFacts = await extractFacts(messages, channelName);

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
  for (const fact of savedFacts) {
    if (fact.fact_type === 'deadline' || fact.fact_type === 'event') {
      const notifs = scheduleDeadlineNotifications(userId, entryId, fact);
      for (const n of notifs) {
        await slackDb.createNotification(n);
      }
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
  const pending = await slackDb.getPendingNotifications(now);
  const results = [];

  for (const notification of pending) {
    try {
      if (!notification.phone) {
        await slackDb.markNotificationFailed(notification.id);
        results.push({ id: notification.id, status: 'failed', reason: 'no phone' });
        continue;
      }
      const phone = toE164(notification.phone);
      const smsResult = await sendSms(phone, notification.message);
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
