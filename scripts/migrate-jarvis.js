/**
 * Jarvis → Duttapad Migration Script
 *
 * Migrates SEP space data from the Jarvis Supabase to Duttapad Supabase:
 *  - Creates SEP entry on Saathvik's canvas
 *  - Migrates SpaceMember → sms_members
 *  - Migrates Fact → child entries (so content queries work via SMS)
 *  - Migrates Message → sms_messages
 *  - Migrates ScheduledAnnouncement → announcements
 *  - Migrates PollMeta → polls
 *  - Migrates PollResponse → poll_responses
 *
 * Usage:
 *   JARVIS_DATABASE_URL=postgresql://... node scripts/migrate-jarvis.js
 *
 * Reads POSTGRES_URL from .env for Duttapad. Requires JARVIS_DATABASE_URL env var.
 */

import dotenv from 'dotenv';
import pg from 'pg';
import crypto from 'crypto';

dotenv.config();

const JARVIS_URL = process.env.JARVIS_DATABASE_URL;
const DUTTAPAD_URL = process.env.POSTGRES_URL;

if (!JARVIS_URL) {
  console.error('Missing JARVIS_DATABASE_URL env var');
  process.exit(1);
}
if (!DUTTAPAD_URL) {
  console.error('Missing POSTGRES_URL env var (for Duttapad)');
  process.exit(1);
}

const sslConfig = { rejectUnauthorized: false };
const jarvis = new pg.Pool({ connectionString: JARVIS_URL, ssl: sslConfig });
const duttapad = new pg.Pool({ connectionString: DUTTAPAD_URL, ssl: sslConfig });

function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\(\)\+]/g, '').replace(/^1(\d{10})$/, '$1');
}

async function migrate() {
  console.log('=== Jarvis → Duttapad Migration ===\n');

  // 1. Find SEP space in Jarvis
  const spaceResult = await jarvis.query(`SELECT * FROM "Space" WHERE "joinCode" = 'SEP' LIMIT 1`);
  if (spaceResult.rows.length === 0) {
    console.error('SEP space not found in Jarvis');
    process.exit(1);
  }
  const space = spaceResult.rows[0];
  console.log(`Found Jarvis space: ${space.name} (id: ${space.id})`);

  // 2. Find Saathvik in Duttapad
  const userResult = await duttapad.query(`SELECT id, username, phone FROM users WHERE username = 'Saathvik' LIMIT 1`);
  if (userResult.rows.length === 0) {
    console.error('User "Saathvik" not found in Duttapad. Trying by phone...');
    const phoneResult = await duttapad.query(`SELECT id, username, phone FROM users WHERE phone_normalized = '3853687238' LIMIT 1`);
    if (phoneResult.rows.length === 0) {
      console.error('Could not find Saathvik in Duttapad by phone either');
      process.exit(1);
    }
  }
  const saathvik = userResult.rows[0] || (await duttapad.query(`SELECT id, username, phone FROM users WHERE phone_normalized = '3853687238' LIMIT 1`)).rows[0];
  console.log(`Found Duttapad user: ${saathvik.username} (id: ${saathvik.id})`);

  // 3. Find or create SEP entry in Duttapad
  let sepEntryId;
  const existing = await duttapad.query(`SELECT id FROM entries WHERE sms_join_code = 'SEP' AND deleted_at IS NULL LIMIT 1`);
  if (existing.rows.length > 0) {
    sepEntryId = existing.rows[0].id;
    console.log(`SEP entry already exists: ${sepEntryId}`);
  } else {
    sepEntryId = `sep-${crypto.randomUUID().slice(0, 8)}-entry-1`;
    await duttapad.query(
      `INSERT INTO entries (id, text, text_html, position_x, position_y, parent_entry_id, user_id, sms_join_code)
       VALUES ($1, 'SEP', 'SEP', 0, 0, NULL, $2, 'SEP')`,
      [sepEntryId, saathvik.id]
    );
    console.log(`Created SEP entry: ${sepEntryId}`);
  }

  // 4. Migrate members: Jarvis SpaceMember + User → Duttapad sms_members
  console.log('\n--- Migrating Members ---');
  const membersResult = await jarvis.query(
    `SELECT sm.id, sm.role, sm.name as member_name, sm."optedOut", sm."joinedAt",
            u."phoneNumber", u.name as user_name
     FROM "SpaceMember" sm
     JOIN "User" u ON sm."userId" = u.id
     WHERE sm."spaceId" = $1`,
    [space.id]
  );
  console.log(`Found ${membersResult.rows.length} members in Jarvis`);

  let membersInserted = 0;
  for (const m of membersResult.rows) {
    const phone = m.phoneNumber;
    const normalized = normalizePhone(phone);
    const name = m.member_name || m.user_name || null;
    const role = m.role || 'member';
    const optedOut = m.optedOut || false;

    try {
      await duttapad.query(
        `INSERT INTO sms_members (id, entry_id, phone, phone_normalized, name, role, opted_out, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (entry_id, phone_normalized) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, sms_members.name),
           role = EXCLUDED.role,
           opted_out = EXCLUDED.opted_out`,
        [crypto.randomUUID(), sepEntryId, phone.startsWith('+') ? phone : `+1${normalized}`, normalized, name, role, optedOut, m.joinedAt || new Date()]
      );
      membersInserted++;
    } catch (err) {
      console.error(`  Failed to insert member ${phone}: ${err.message}`);
    }
  }
  console.log(`Inserted/updated ${membersInserted} members`);

  // 5. Migrate Facts → child entries on SEP page
  console.log('\n--- Migrating Facts → Child Entries ---');
  const factsResult = await jarvis.query(
    `SELECT f.id, f.content, f."sourceText", f.category, f.subcategory, f."timeRef",
            f."dateStr", f.entities, f."createdAt",
            u.name as uploader_name
     FROM "Fact" f
     LEFT JOIN "Upload" up ON f."uploadId" = up.id
     LEFT JOIN "User" u ON up.id IS NOT NULL
     WHERE f."spaceId" = $1
     ORDER BY f."createdAt" ASC`,
    [space.id]
  );
  console.log(`Found ${factsResult.rows.length} facts in Jarvis`);

  let factsInserted = 0;
  for (const fact of factsResult.rows) {
    // Build entry text from fact content
    let text = fact.content;
    if (fact.category && fact.category !== 'general') {
      text = `[${fact.category}${fact.subcategory ? '/' + fact.subcategory : ''}] ${text}`;
    }
    if (fact.dateStr) {
      text = `${text} (${fact.dateStr})`;
    }

    const factEntryId = `fact-${fact.id.slice(0, 12)}`;

    // Position child entries in a grid layout
    const col = factsInserted % 5;
    const row = Math.floor(factsInserted / 5);
    const posX = col * 400;
    const posY = 100 + row * 150;

    try {
      await duttapad.query(
        `INSERT INTO entries (id, text, text_html, position_x, position_y, parent_entry_id, user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT ON CONSTRAINT entries_pkey DO NOTHING`,
        [factEntryId, text, `<p>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`, posX, posY, sepEntryId, saathvik.id, fact.createdAt || new Date()]
      );
      factsInserted++;
    } catch (err) {
      console.error(`  Failed to insert fact ${fact.id}: ${err.message}`);
    }
  }
  console.log(`Inserted ${factsInserted} facts as child entries`);

  // 6. Migrate Messages → sms_messages
  console.log('\n--- Migrating Messages ---');
  const messagesResult = await jarvis.query(
    `SELECT id, "phoneNumber", direction, text, meta, "createdAt"
     FROM "Message"
     WHERE "spaceId" = $1
     ORDER BY "createdAt" ASC`,
    [space.id]
  );
  console.log(`Found ${messagesResult.rows.length} messages in Jarvis`);

  let messagesInserted = 0;
  for (const msg of messagesResult.rows) {
    const normalized = normalizePhone(msg.phoneNumber);
    try {
      await duttapad.query(
        `INSERT INTO sms_messages (id, entry_id, phone, phone_normalized, direction, text, meta, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT ON CONSTRAINT sms_messages_pkey DO NOTHING`,
        [msg.id, sepEntryId, msg.phoneNumber, normalized, msg.direction, msg.text, msg.meta, msg.createdAt]
      );
      messagesInserted++;
    } catch (err) {
      console.error(`  Failed to insert message ${msg.id}: ${err.message}`);
    }
  }
  console.log(`Inserted ${messagesInserted} messages`);

  // 7. Migrate ScheduledAnnouncement → announcements
  console.log('\n--- Migrating Announcements ---');
  const announcementsResult = await jarvis.query(
    `SELECT id, content, "scheduledFor", sent, "sentAt", "createdAt"
     FROM "ScheduledAnnouncement"
     WHERE "spaceId" = $1
     ORDER BY "createdAt" ASC`,
    [space.id]
  );
  console.log(`Found ${announcementsResult.rows.length} announcements in Jarvis`);

  let announcementsInserted = 0;
  for (const ann of announcementsResult.rows) {
    const status = ann.sent ? 'sent' : 'draft';
    try {
      await duttapad.query(
        `INSERT INTO announcements (id, entry_id, content, status, sent_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT announcements_pkey DO NOTHING`,
        [ann.id, sepEntryId, ann.content, status, ann.sentAt, ann.createdAt]
      );
      announcementsInserted++;
    } catch (err) {
      console.error(`  Failed to insert announcement ${ann.id}: ${err.message}`);
    }
  }
  console.log(`Inserted ${announcementsInserted} announcements`);

  // 8. Migrate PollMeta → polls
  console.log('\n--- Migrating Polls ---');
  const pollsResult = await jarvis.query(
    `SELECT id, "questionText", "requiresReasonForNo", "isActive", "createdBy", "createdAt"
     FROM "PollMeta"
     WHERE "spaceId" = $1
     ORDER BY "createdAt" ASC`,
    [space.id]
  );
  console.log(`Found ${pollsResult.rows.length} polls in Jarvis`);

  let pollsInserted = 0;
  for (const poll of pollsResult.rows) {
    try {
      await duttapad.query(
        `INSERT INTO polls (id, entry_id, question_text, requires_reason_for_no, is_active, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT polls_pkey DO NOTHING`,
        [poll.id, sepEntryId, poll.questionText, poll.requiresReasonForNo, poll.isActive, normalizePhone(poll.createdBy), poll.createdAt]
      );
      pollsInserted++;
    } catch (err) {
      console.error(`  Failed to insert poll ${poll.id}: ${err.message}`);
    }
  }
  console.log(`Inserted ${pollsInserted} polls`);

  // 9. Migrate PollResponse → poll_responses
  console.log('\n--- Migrating Poll Responses ---');
  const pollResponsesResult = await jarvis.query(
    `SELECT pr.id, pr."pollId", pr."phoneNumber", pr.response, pr.notes, pr."createdAt", pr."updatedAt"
     FROM "PollResponse" pr
     JOIN "PollMeta" pm ON pr."pollId" = pm.id
     WHERE pm."spaceId" = $1
     ORDER BY pr."createdAt" ASC`,
    [space.id]
  );
  console.log(`Found ${pollResponsesResult.rows.length} poll responses in Jarvis`);

  let responsesInserted = 0;
  for (const pr of pollResponsesResult.rows) {
    const normalized = normalizePhone(pr.phoneNumber);
    try {
      await duttapad.query(
        `INSERT INTO poll_responses (id, poll_id, phone_normalized, response, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT poll_responses_pkey DO NOTHING`,
        [pr.id, pr.pollId, normalized, pr.response, pr.notes, pr.createdAt, pr.updatedAt]
      );
      responsesInserted++;
    } catch (err) {
      console.error(`  Failed to insert poll response ${pr.id}: ${err.message}`);
    }
  }
  console.log(`Inserted ${responsesInserted} poll responses`);

  // 10. Set conversation state for all members → active page = SEP
  console.log('\n--- Setting conversation state ---');
  let statesSet = 0;
  for (const m of membersResult.rows) {
    const normalized = normalizePhone(m.phoneNumber);
    try {
      await duttapad.query(
        `INSERT INTO sms_conversation_state (id, phone_normalized, active_entry_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (phone_normalized) DO UPDATE SET
           active_entry_id = EXCLUDED.active_entry_id,
           updated_at = CURRENT_TIMESTAMP`,
        [crypto.randomUUID(), normalized, sepEntryId]
      );
      statesSet++;
    } catch (err) {
      console.error(`  Failed to set state for ${normalized}: ${err.message}`);
    }
  }
  console.log(`Set ${statesSet} conversation states`);

  // Summary
  console.log('\n=== Migration Complete ===');
  console.log(`SEP Entry ID: ${sepEntryId}`);
  console.log(`Members: ${membersInserted}`);
  console.log(`Facts → Entries: ${factsInserted}`);
  console.log(`Messages: ${messagesInserted}`);
  console.log(`Announcements: ${announcementsInserted}`);
  console.log(`Polls: ${pollsInserted}`);
  console.log(`Poll Responses: ${responsesInserted}`);
  console.log(`Conversation States: ${statesSet}`);
}

migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => {
    jarvis.end();
    duttapad.end();
  });
