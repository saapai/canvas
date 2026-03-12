/**
 * SMS Database Queries
 * All SMS-related database operations (members, messages, drafts, announcements, polls, meta-instructions, conversation state)
 * Ported from Jarvis repositories/ layer, adapted for duttapad's raw pg Pool pattern.
 */

import { getPool } from './db.js';
import crypto from 'crypto';

// ============================================
// PHONE NORMALIZATION
// ============================================

export function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\(\)\+]/g, '').replace(/^1(\d{10})$/, '$1');
}

export function toE164(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.startsWith('+')) return normalized;
  return `+1${normalized}`;
}

// ============================================
// MEMBERS
// ============================================

export async function getMembers(entryId) {
  const db = getPool();
  const result = await db.query(
    `SELECT id, entry_id, phone, phone_normalized, name, role, opted_out, created_at
     FROM sms_members
     WHERE entry_id = $1
     ORDER BY created_at ASC`,
    [entryId]
  );
  return result.rows;
}

export async function getOptedInMembers(entryId) {
  const db = getPool();
  const result = await db.query(
    `SELECT id, entry_id, phone, phone_normalized, name, role, opted_out
     FROM sms_members
     WHERE entry_id = $1 AND opted_out = FALSE
     ORDER BY created_at ASC`,
    [entryId]
  );
  return result.rows;
}

export async function getMemberByPhone(entryId, phone) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  const result = await db.query(
    `SELECT id, entry_id, phone, phone_normalized, name, role, opted_out
     FROM sms_members
     WHERE entry_id = $1 AND phone_normalized = $2`,
    [entryId, normalized]
  );
  return result.rows[0] || null;
}

export async function getMembershipsByPhone(phone) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  const result = await db.query(
    `SELECT m.id, m.entry_id, m.phone_normalized, m.name, m.role, m.opted_out,
            e.text AS entry_text, e.sms_join_code
     FROM sms_members m
     JOIN entries e ON m.entry_id = e.id
     WHERE m.phone_normalized = $1 AND m.opted_out = FALSE AND e.deleted_at IS NULL
     ORDER BY m.created_at ASC`,
    [normalized]
  );
  return result.rows;
}

export async function addMember(entryId, phone, name = null, role = 'member') {
  const db = getPool();
  const id = crypto.randomUUID();
  const normalized = normalizePhone(phone);
  const result = await db.query(
    `INSERT INTO sms_members (id, entry_id, phone, phone_normalized, name, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (entry_id, phone_normalized) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, sms_members.name),
       role = EXCLUDED.role,
       opted_out = FALSE,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [id, entryId, phone, normalized, name, role]
  );
  return result.rows[0];
}

export async function removeMember(entryId, phone) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  await db.query(
    `DELETE FROM sms_members WHERE entry_id = $1 AND phone_normalized = $2`,
    [entryId, normalized]
  );
}

export async function updateMemberRole(entryId, phone, role) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  await db.query(
    `UPDATE sms_members SET role = $3, updated_at = CURRENT_TIMESTAMP
     WHERE entry_id = $1 AND phone_normalized = $2`,
    [entryId, normalized, role]
  );
}

export async function updateMemberName(entryId, phone, name) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  await db.query(
    `UPDATE sms_members SET name = $3, updated_at = CURRENT_TIMESTAMP
     WHERE entry_id = $1 AND phone_normalized = $2`,
    [entryId, normalized, name]
  );
}

export async function setMemberOptedOut(entryId, phone, optedOut) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  await db.query(
    `UPDATE sms_members SET opted_out = $3, updated_at = CURRENT_TIMESTAMP
     WHERE entry_id = $1 AND phone_normalized = $2`,
    [entryId, normalized, optedOut]
  );
}

export async function isAdmin(entryId, phone) {
  const member = await getMemberByPhone(entryId, phone);
  return member?.role === 'owner' || member?.role === 'admin';
}

export async function isAdminForUserEntries(phone, userId) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  const result = await db.query(
    `SELECT 1 FROM sms_members m
     JOIN entries e ON m.entry_id = e.id
     WHERE m.phone_normalized = $1 AND e.user_id = $2
       AND m.role IN ('admin', 'owner')
       AND m.opted_out = FALSE AND e.deleted_at IS NULL
     LIMIT 1`,
    [normalized, userId]
  );
  return result.rows.length > 0;
}

// ============================================
// MESSAGES
// ============================================

export async function logMessage(entryId, phone, direction, text, meta = null) {
  const db = getPool();
  const id = crypto.randomUUID();
  const normalized = normalizePhone(phone);
  await db.query(
    `INSERT INTO sms_messages (id, entry_id, phone, phone_normalized, direction, text, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, entryId, phone, normalized, direction, text, meta ? JSON.stringify(meta) : null]
  );
  return { id, entry_id: entryId, phone_normalized: normalized, direction, text, meta };
}

export async function getRecentMessages(phone, limit = 10, entryId = null) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  let query, params;
  if (entryId) {
    query = `SELECT id, entry_id, phone_normalized, direction, text, meta, created_at
             FROM sms_messages
             WHERE phone_normalized = $1 AND entry_id = $2
             ORDER BY created_at DESC LIMIT $3`;
    params = [normalized, entryId, limit];
  } else {
    query = `SELECT id, entry_id, phone_normalized, direction, text, meta, created_at
             FROM sms_messages
             WHERE phone_normalized = $1
             ORDER BY created_at DESC LIMIT $2`;
    params = [normalized, limit];
  }
  const result = await db.query(query, params);
  return result.rows.reverse().map(row => ({
    ...row,
    meta: row.meta ? (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta) : null
  }));
}

export async function getMessagesByEntry(entryId, limit = 100) {
  const db = getPool();
  const result = await db.query(
    `SELECT id, entry_id, phone_normalized, direction, text, meta, created_at
     FROM sms_messages
     WHERE entry_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [entryId, limit]
  );
  return result.rows.map(row => ({
    ...row,
    meta: row.meta ? (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta) : null
  }));
}

export async function getPastActions(entryId, limit = 20) {
  const db = getPool();
  const result = await db.query(
    `SELECT id, phone_normalized, direction, text, meta, created_at
     FROM sms_messages
     WHERE entry_id = $1 AND direction = 'outbound' AND meta::text LIKE '%draft_send%'
     ORDER BY created_at DESC LIMIT $2`,
    [entryId, limit]
  );
  const actions = [];
  for (const row of result.rows) {
    const meta = row.meta ? (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta) : null;
    if (meta?.action === 'draft_send' && meta?.draftContent) {
      const isPoll = meta.draftContent.includes('?') || row.text.includes('📊');
      actions.push({
        type: isPoll ? 'poll' : 'announcement',
        content: meta.draftContent,
        sentAt: row.created_at,
        sentBy: row.phone_normalized
      });
    }
  }
  return actions;
}

// ============================================
// CONVERSATION STATE
// ============================================

export async function getConversationState(phone) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  const result = await db.query(
    `SELECT id, phone_normalized, active_entry_id, state_type, state_payload, updated_at
     FROM sms_conversation_state
     WHERE phone_normalized = $1`,
    [normalized]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    ...row,
    state_payload: row.state_payload ? (typeof row.state_payload === 'string' ? JSON.parse(row.state_payload) : row.state_payload) : null
  };
}

export async function setConversationState(phone, activeEntryId, stateType = null, statePayload = null) {
  const db = getPool();
  const id = crypto.randomUUID();
  const normalized = normalizePhone(phone);
  await db.query(
    `INSERT INTO sms_conversation_state (id, phone_normalized, active_entry_id, state_type, state_payload, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (phone_normalized) DO UPDATE SET
       active_entry_id = EXCLUDED.active_entry_id,
       state_type = EXCLUDED.state_type,
       state_payload = EXCLUDED.state_payload,
       updated_at = CURRENT_TIMESTAMP`,
    [id, normalized, activeEntryId, stateType, statePayload ? JSON.stringify(statePayload) : null]
  );
}

export async function getActiveEntryId(phone) {
  const state = await getConversationState(phone);
  return state?.active_entry_id || null;
}

export async function setActiveEntryId(phone, entryId) {
  await setConversationState(phone, entryId);
}

// ============================================
// DRAFTS
// ============================================

export async function createDraft(phone, entryId, draftType, content = '', structuredPayload = null) {
  const db = getPool();
  const id = crypto.randomUUID();
  const normalized = normalizePhone(phone);
  const payload = structuredPayload ? { ...structuredPayload, type: draftType } : { type: draftType };
  await db.query(
    `INSERT INTO sms_drafts (id, phone_normalized, entry_id, draft_type, draft_text, structured_payload, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'in_progress')`,
    [id, normalized, entryId, draftType, content, JSON.stringify(payload)]
  );
  return { id, phone_normalized: normalized, entry_id: entryId, draft_type: draftType, draft_text: content, structured_payload: payload, status: 'in_progress' };
}

export async function getActiveDraft(phone, entryId = null) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  let query, params;
  if (entryId) {
    query = `SELECT * FROM sms_drafts WHERE phone_normalized = $1 AND entry_id = $2 AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`;
    params = [normalized, entryId];
  } else {
    query = `SELECT * FROM sms_drafts WHERE phone_normalized = $1 AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`;
    params = [normalized];
  }
  const result = await db.query(query, params);
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  const payload = row.structured_payload ? (typeof row.structured_payload === 'string' ? JSON.parse(row.structured_payload) : row.structured_payload) : {};
  // Convert to planner-style Draft object
  return {
    type: payload.type || row.draft_type || 'announcement',
    content: row.draft_text,
    status: row.draft_text ? 'ready' : 'drafting',
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    requiresExcuse: payload.requiresExcuse || false,
    pendingMandatory: payload.pendingMandatory || false,
    pendingLink: payload.pendingLink || false,
    links: payload.links || [],
    _dbId: row.id,
    _entryId: row.entry_id
  };
}

export async function updateDraftByPhone(phone, updates, entryId = null) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  let query, params;
  if (entryId) {
    query = `SELECT id FROM sms_drafts WHERE phone_normalized = $1 AND entry_id = $2 AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`;
    params = [normalized, entryId];
  } else {
    query = `SELECT id FROM sms_drafts WHERE phone_normalized = $1 AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`;
    params = [normalized];
  }
  const existing = await db.query(query, params);
  if (!existing.rows[0]) return null;
  const id = existing.rows[0].id;

  const setClauses = ['updated_at = CURRENT_TIMESTAMP'];
  const setParams = [];
  let paramIdx = 1;

  if (updates.draftText !== undefined) {
    setClauses.push(`draft_text = $${paramIdx++}`);
    setParams.push(updates.draftText);
  }
  if (updates.structuredPayload !== undefined) {
    setClauses.push(`structured_payload = $${paramIdx++}`);
    setParams.push(JSON.stringify(updates.structuredPayload));
  }
  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIdx++}`);
    setParams.push(updates.status);
  }

  setParams.push(id);
  await db.query(
    `UPDATE sms_drafts SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
    setParams
  );
  return { id };
}

export async function finalizeDraft(phone, entryId = null) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  let query, params;
  if (entryId) {
    query = `UPDATE sms_drafts SET status = 'finalized', updated_at = CURRENT_TIMESTAMP WHERE phone_normalized = $1 AND entry_id = $2 AND status = 'in_progress'`;
    params = [normalized, entryId];
  } else {
    query = `UPDATE sms_drafts SET status = 'finalized', updated_at = CURRENT_TIMESTAMP WHERE phone_normalized = $1 AND status = 'in_progress'`;
    params = [normalized];
  }
  await db.query(query, params);
}

export async function deleteDraft(phone, entryId = null) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  let query, params;
  if (entryId) {
    query = `DELETE FROM sms_drafts WHERE phone_normalized = $1 AND entry_id = $2 AND status = 'in_progress'`;
    params = [normalized, entryId];
  } else {
    query = `DELETE FROM sms_drafts WHERE phone_normalized = $1 AND status = 'in_progress'`;
    params = [normalized];
  }
  await db.query(query, params);
}

// ============================================
// ANNOUNCEMENTS
// ============================================

export async function createAnnouncement(entryId, content, createdBy = null, source = 'manual') {
  const db = getPool();
  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO announcements (id, entry_id, content, status, created_by, source)
     VALUES ($1, $2, $3, 'draft', $4, $5)
     RETURNING *`,
    [id, entryId, content, createdBy, source]
  );
  return result.rows[0];
}

export async function getAnnouncements(entryId) {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM announcements WHERE entry_id = $1 ORDER BY created_at DESC`,
    [entryId]
  );
  return result.rows;
}

export async function getAnnouncementById(id) {
  const db = getPool();
  const result = await db.query(`SELECT * FROM announcements WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

export async function updateAnnouncement(id, updates) {
  const db = getPool();
  const setClauses = [];
  const params = [];
  let idx = 1;
  if (updates.content !== undefined) { setClauses.push(`content = $${idx++}`); params.push(updates.content); }
  if (updates.status !== undefined) { setClauses.push(`status = $${idx++}`); params.push(updates.status); }
  if (updates.sent_count !== undefined) { setClauses.push(`sent_count = $${idx++}`); params.push(updates.sent_count); }
  if (updates.sent_at !== undefined) { setClauses.push(`sent_at = $${idx++}`); params.push(updates.sent_at); }
  params.push(id);
  await db.query(`UPDATE announcements SET ${setClauses.join(', ')} WHERE id = $${idx}`, params);
}

export async function deleteAnnouncement(id) {
  const db = getPool();
  await db.query(`DELETE FROM announcements WHERE id = $1`, [id]);
}

// ============================================
// POLLS
// ============================================

export async function createPoll(entryId, questionText, createdBy = null, requiresReasonForNo = false) {
  const db = getPool();
  const id = crypto.randomUUID();
  // Deactivate prior polls for this entry
  await db.query(`UPDATE polls SET is_active = FALSE WHERE entry_id = $1 AND is_active = TRUE`, [entryId]);
  const result = await db.query(
    `INSERT INTO polls (id, entry_id, question_text, requires_reason_for_no, is_active, created_by)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     RETURNING *`,
    [id, entryId, questionText, requiresReasonForNo, createdBy]
  );
  return result.rows[0];
}

export async function getPolls(entryId) {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM polls WHERE entry_id = $1 ORDER BY created_at DESC`,
    [entryId]
  );
  return result.rows;
}

export async function getActivePoll(entryId) {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM polls WHERE entry_id = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 1`,
    [entryId]
  );
  return result.rows[0] || null;
}

export async function getPollById(id) {
  const db = getPool();
  const result = await db.query(`SELECT * FROM polls WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

export async function deactivatePoll(id) {
  const db = getPool();
  await db.query(`UPDATE polls SET is_active = FALSE, closed_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
}

export async function deletePoll(id) {
  const db = getPool();
  await db.query(`DELETE FROM poll_responses WHERE poll_id = $1`, [id]);
  await db.query(`DELETE FROM polls WHERE id = $1`, [id]);
}

// ============================================
// POLL RESPONSES
// ============================================

export async function savePollResponse(pollId, phone, response, notes = null) {
  const db = getPool();
  const id = crypto.randomUUID();
  const normalized = normalizePhone(phone);
  const result = await db.query(
    `INSERT INTO poll_responses (id, poll_id, phone_normalized, response, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (poll_id, phone_normalized) DO UPDATE SET
       response = EXCLUDED.response,
       notes = EXCLUDED.notes,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [id, pollId, normalized, response, notes]
  );
  return result.rows[0];
}

export async function getPollResponse(pollId, phone) {
  const db = getPool();
  const normalized = normalizePhone(phone);
  const result = await db.query(
    `SELECT * FROM poll_responses WHERE poll_id = $1 AND phone_normalized = $2`,
    [pollId, normalized]
  );
  return result.rows[0] || null;
}

export async function getPollResponses(pollId) {
  const db = getPool();
  const result = await db.query(
    `SELECT pr.*, m.name
     FROM poll_responses pr
     LEFT JOIN polls p ON pr.poll_id = p.id
     LEFT JOIN sms_members m ON m.entry_id = p.entry_id AND m.phone_normalized = pr.phone_normalized
     WHERE pr.poll_id = $1
     ORDER BY pr.created_at ASC`,
    [pollId]
  );
  return result.rows;
}

export async function getPollResponseSummary(pollId) {
  const responses = await getPollResponses(pollId);
  const summary = { yes: 0, no: 0, maybe: 0, total: responses.length };
  for (const r of responses) {
    const res = r.response.toLowerCase();
    if (res === 'yes') summary.yes++;
    else if (res === 'no') summary.no++;
    else if (res === 'maybe') summary.maybe++;
  }
  return summary;
}

// ============================================
// META INSTRUCTIONS
// ============================================

export async function getMetaInstructions(entryId) {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM meta_instructions WHERE entry_id = $1 ORDER BY created_at ASC`,
    [entryId]
  );
  return result.rows;
}

export async function addMetaInstruction(entryId, instruction, createdBy = null) {
  const db = getPool();
  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO meta_instructions (id, entry_id, instruction, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, entryId, instruction, createdBy]
  );
  return result.rows[0];
}

export async function deleteMetaInstruction(id) {
  const db = getPool();
  await db.query(`DELETE FROM meta_instructions WHERE id = $1`, [id]);
}

// ============================================
// ENTRY LOOKUP BY JOIN CODE
// ============================================

export async function findEntryByJoinCode(joinCode) {
  const db = getPool();
  const code = joinCode.toUpperCase().trim();
  const result = await db.query(
    `SELECT id, text, sms_join_code, user_id, parent_entry_id
     FROM entries
     WHERE sms_join_code = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [code]
  );
  return result.rows[0] || null;
}

// ============================================
// UPDATE ENTRY SMS FIELDS
// ============================================

// ============================================
// UNANSWERED QUESTIONS
// ============================================

export async function createUnansweredQuestion(phone, entryId, question, initialAnswer, questionType = 'general') {
  const db = getPool();
  const id = crypto.randomUUID();
  const normalized = normalizePhone(phone);
  // event/logistics: 48h expiry, general: 7 days
  const expiryHours = (questionType === 'event' || questionType === 'logistics') ? 48 : 168;
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
  const result = await db.query(
    `INSERT INTO unanswered_questions (id, phone_normalized, entry_id, question, initial_answer, question_type, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, normalized, entryId, question, initialAnswer, questionType, expiresAt]
  );
  return result.rows[0];
}

export async function getPendingUnansweredQuestions() {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM unanswered_questions
     WHERE status = 'pending' AND expires_at > NOW()
     ORDER BY created_at ASC`
  );
  return result.rows;
}

export async function markQuestionResolved(id, resolvedAnswer) {
  const db = getPool();
  await db.query(
    `UPDATE unanswered_questions SET status = 'resolved', resolved_answer = $2, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id, resolvedAnswer]
  );
}

export async function markQuestionFailed(id) {
  const db = getPool();
  await db.query(
    `UPDATE unanswered_questions SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id]
  );
}

export async function incrementAttemptCount(id) {
  const db = getPool();
  await db.query(
    `UPDATE unanswered_questions SET attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id]
  );
}

export async function expireOldQuestions() {
  const db = getPool();
  const result = await db.query(
    `UPDATE unanswered_questions SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'pending' AND (expires_at <= NOW() OR attempt_count >= max_attempts)
     RETURNING id`
  );
  return result.rows.length;
}

export async function updateEntrySmsFields(entryId, { smsType, smsRefId }) {
  const db = getPool();
  const setClauses = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [];
  let idx = 1;
  if (smsType !== undefined) { setClauses.push(`sms_type = $${idx++}`); params.push(smsType); }
  if (smsRefId !== undefined) { setClauses.push(`sms_ref_id = $${idx++}`); params.push(smsRefId); }
  params.push(entryId);
  await db.query(`UPDATE entries SET ${setClauses.join(', ')} WHERE id = $${idx}`, params);
}
