/**
 * Slack Database Queries
 * CRUD for slack_syncs, slack_facts, scheduled_notifications tables.
 * Follows the same raw pg Pool pattern as sms-db.js.
 */

import { getPool } from './db.js';
import crypto from 'crypto';

// ============================================
// SLACK SYNCS
// ============================================

export async function createSlackSync(userId, entryId, channelId, channelName) {
  const db = getPool();
  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO slack_syncs (id, user_id, entry_id, channel_id, channel_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, entry_id, channel_id) DO UPDATE
       SET sync_enabled = TRUE, channel_name = EXCLUDED.channel_name, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [id, userId, entryId, channelId, channelName]
  );
  return result.rows[0];
}

export async function getSlackSync(userId, entryId) {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM slack_syncs
     WHERE user_id = $1 AND entry_id = $2 AND sync_enabled = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [userId, entryId]
  );
  return result.rows[0] || null;
}

export async function getSlackSyncsByEntry(userId, entryId) {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM slack_syncs
     WHERE user_id = $1 AND entry_id = $2
     ORDER BY channel_name ASC`,
    [userId, entryId]
  );
  return result.rows;
}

export async function disableSyncByChannel(userId, entryId, channelId) {
  const db = getPool();
  await db.query(
    `UPDATE slack_syncs SET sync_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND entry_id = $2 AND channel_id = $3`,
    [userId, entryId, channelId]
  );
}

export async function getSlackSyncById(syncId) {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM slack_syncs WHERE id = $1`,
    [syncId]
  );
  return result.rows[0] || null;
}

export async function getAllEnabledSyncs() {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM slack_syncs WHERE sync_enabled = TRUE ORDER BY created_at ASC`
  );
  return result.rows;
}

export async function updateSyncTimestamp(syncId, lastSyncTs) {
  const db = getPool();
  await db.query(
    `UPDATE slack_syncs SET last_sync_ts = $2, last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [syncId, lastSyncTs]
  );
}

export async function disableSync(syncId) {
  const db = getPool();
  await db.query(
    `UPDATE slack_syncs SET sync_enabled = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [syncId]
  );
}

// ============================================
// SLACK FACTS
// ============================================

export async function saveFact({ syncId, entryId, channelId, messageTs, messageDate, author, rawText, extractedFact, factType, deadlineDate }) {
  const db = getPool();
  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO slack_facts (id, sync_id, entry_id, channel_id, message_ts, message_date, author, raw_text, extracted_fact, fact_type, deadline_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (sync_id, message_ts) DO UPDATE
       SET extracted_fact = EXCLUDED.extracted_fact, fact_type = EXCLUDED.fact_type, deadline_date = EXCLUDED.deadline_date
     RETURNING *`,
    [id, syncId, entryId, channelId, messageTs, messageDate || null, author || null, rawText || null, extractedFact, factType || 'info', deadlineDate || null]
  );
  return result.rows[0];
}

export async function getFactsByEntry(entryId, { currentOnly = true, limit = 50 } = {}) {
  const db = getPool();
  let query = `SELECT f.*, s.channel_name FROM slack_facts f
    LEFT JOIN slack_syncs s ON f.sync_id = s.id
    WHERE f.entry_id = $1`;
  if (currentOnly) query += ` AND f.is_current = TRUE`;
  query += ` ORDER BY f.message_date DESC NULLS LAST, f.created_at DESC LIMIT $2`;
  const result = await db.query(query, [entryId, limit]);
  return result.rows;
}

export async function getFactsBySync(syncId, { currentOnly = true, limit = 50 } = {}) {
  const db = getPool();
  let query = `SELECT * FROM slack_facts WHERE sync_id = $1`;
  if (currentOnly) query += ` AND is_current = TRUE`;
  query += ` ORDER BY message_date DESC NULLS LAST, created_at DESC LIMIT $2`;
  const result = await db.query(query, [syncId, limit]);
  return result.rows;
}

export async function supersedeFact(oldFactId, newFactId) {
  const db = getPool();
  await db.query(
    `UPDATE slack_facts SET is_current = FALSE, superseded_by = $2 WHERE id = $1`,
    [oldFactId, newFactId]
  );
}

export async function getFactsForChat(userId, limit = 50) {
  const db = getPool();
  const result = await db.query(
    `SELECT f.* FROM slack_facts f
     JOIN slack_syncs s ON f.sync_id = s.id
     WHERE s.user_id = $1 AND f.is_current = TRUE AND s.sync_enabled = TRUE
     ORDER BY f.message_date DESC NULLS LAST, f.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

// ============================================
// SCHEDULED NOTIFICATIONS
// ============================================

export async function createNotification({ userId, entryId, factId, notificationType, scheduledFor, eventDate, message }) {
  const db = getPool();
  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO scheduled_notifications (id, user_id, entry_id, fact_id, notification_type, scheduled_for, event_date, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (fact_id, notification_type) DO UPDATE
       SET scheduled_for = EXCLUDED.scheduled_for, event_date = EXCLUDED.event_date, message = EXCLUDED.message, status = 'pending'
     WHERE scheduled_notifications.status = 'pending'
     RETURNING *`,
    [id, userId, entryId, factId, notificationType, scheduledFor, eventDate || null, message]
  );
  return result.rows[0] || null;
}

export async function getPendingNotifications(beforeTime) {
  const db = getPool();
  const result = await db.query(
    `SELECT n.*, u.phone FROM scheduled_notifications n
     JOIN users u ON n.user_id = u.id
     WHERE n.status = 'pending' AND n.scheduled_for <= $1
     ORDER BY n.scheduled_for ASC`,
    [beforeTime]
  );
  return result.rows;
}

export async function markNotificationSent(id, enrichedMessage) {
  const db = getPool();
  if (enrichedMessage) {
    await db.query(
      `UPDATE scheduled_notifications SET status = 'sent', sent_at = CURRENT_TIMESTAMP, message = $2 WHERE id = $1`,
      [id, enrichedMessage]
    );
  } else {
    await db.query(
      `UPDATE scheduled_notifications SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );
  }
}

export async function markNotificationFailed(id) {
  const db = getPool();
  await db.query(
    `UPDATE scheduled_notifications SET status = 'failed' WHERE id = $1`,
    [id]
  );
}

export async function cancelNotificationsForFact(factId) {
  const db = getPool();
  await db.query(
    `UPDATE scheduled_notifications SET status = 'cancelled' WHERE fact_id = $1 AND status = 'pending'`,
    [factId]
  );
}

/**
 * Get all sibling notifications for the same fact (to check missed states).
 * Returns notifications for the same fact_id, grouped by notification_type.
 */
export async function getSiblingNotifications(factId) {
  const db = getPool();
  const result = await db.query(
    `SELECT id, notification_type, status, scheduled_for, sent_at FROM scheduled_notifications WHERE fact_id = $1 ORDER BY scheduled_for ASC`,
    [factId]
  );
  return result.rows;
}

/**
 * Get the Slack channel name(s) synced to an entry.
 */
export async function getChannelNamesForEntry(entryId) {
  const db = getPool();
  const result = await db.query(
    `SELECT channel_name FROM slack_syncs WHERE entry_id = $1 AND sync_enabled = TRUE ORDER BY channel_name ASC`,
    [entryId]
  );
  return result.rows.map(r => r.channel_name);
}

/**
 * Check if an event already has notifications (sent or pending).
 * Matches by entry_id and deadline_date within 24h tolerance.
 * Returns the existing initial notification + its fact text if found.
 */
export async function getExistingEventNotifications(entryId, deadlineDate) {
  const db = getPool();
  const result = await db.query(
    `SELECT sn.id, sn.notification_type, sn.status, sn.message, sn.scheduled_for,
            sf.extracted_fact, sf.deadline_date
     FROM scheduled_notifications sn
     JOIN slack_facts sf ON sn.fact_id = sf.id
     WHERE sn.entry_id = $1
       AND sf.deadline_date IS NOT NULL
       AND ABS(EXTRACT(EPOCH FROM (sf.deadline_date - $2::timestamp))) < 86400
       AND sn.status IN ('sent', 'pending')
     ORDER BY sn.created_at DESC`,
    [entryId, deadlineDate]
  );
  return result.rows;
}

// ============================================
// WEEKLY DIGEST
// ============================================

/**
 * Get undigested facts for an entry — current, no deadline_date, not yet digested.
 * These are the facts that belong in the weekly digest.
 */
export async function getUndigestedFactsByEntry(entryId) {
  const db = getPool();
  const result = await db.query(
    `SELECT f.*, s.channel_name FROM slack_facts f
     LEFT JOIN slack_syncs s ON f.sync_id = s.id
     WHERE f.entry_id = $1
       AND f.is_current = TRUE
       AND f.deadline_date IS NULL
       AND f.digested_at IS NULL
       AND f.message_date > (CURRENT_TIMESTAMP - INTERVAL '7 days')
     ORDER BY f.message_date ASC NULLS LAST, f.created_at ASC`,
    [entryId]
  );
  return result.rows;
}

/**
 * Auto-mark facts older than 7 days as digested so they don't accumulate.
 */
export async function markStaleFactsDigested() {
  const db = getPool();
  const result = await db.query(
    `UPDATE slack_facts SET digested_at = CURRENT_TIMESTAMP
     WHERE digested_at IS NULL
       AND deadline_date IS NULL
       AND is_current = TRUE
       AND message_date <= (CURRENT_TIMESTAMP - INTERVAL '7 days')
     RETURNING id`
  );
  return result.rows.length;
}

/**
 * Mark facts as digested so they won't appear in future weekly digests.
 */
export async function markFactsDigested(factIds) {
  if (!factIds.length) return;
  const db = getPool();
  const placeholders = factIds.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(
    `UPDATE slack_facts SET digested_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
    factIds
  );
}

/**
 * Get all unique entry_ids that have enabled slack syncs (for weekly digest).
 */
export async function getEntriesWithEnabledSyncs() {
  const db = getPool();
  const result = await db.query(
    `SELECT DISTINCT entry_id, user_id FROM slack_syncs WHERE sync_enabled = TRUE`
  );
  return result.rows;
}

/**
 * Get today's event/deadline facts that have NO scheduled notifications yet.
 * These are facts that were synced before catch-up logic existed.
 */
export async function getTodayUnnotifiedEventFacts() {
  const db = getPool();
  // Use PST timezone for "today" comparison (America/Los_Angeles)
  const result = await db.query(
    `SELECT f.*, s.user_id, s.entry_id AS sync_entry_id
     FROM slack_facts f
     JOIN slack_syncs s ON f.sync_id = s.id
     WHERE f.is_current = TRUE
       AND f.deadline_date IS NOT NULL
       AND f.fact_type IN ('deadline', 'event')
       AND (f.deadline_date AT TIME ZONE 'America/Los_Angeles')::date = (NOW() AT TIME ZONE 'America/Los_Angeles')::date
       AND NOT EXISTS (
         SELECT 1 FROM scheduled_notifications n
         WHERE n.fact_id = f.id AND n.status IN ('pending', 'sent')
       )
     ORDER BY f.deadline_date ASC`
  );
  return result.rows;
}
