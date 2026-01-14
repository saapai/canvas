import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

let dbInitialized = false;

export async function initDatabase() {
  if (dbInitialized) return;

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        position_x REAL NOT NULL,
        position_y REAL NOT NULL,
        parent_entry_id TEXT,
        user_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        phone TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS phone_verification_codes (
        phone TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL
      );
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_parent_entry_id ON entries(parent_entry_id);
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_entries_user_id ON entries(user_id);
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_phone_verification_phone ON phone_verification_codes(phone);
    `;

    dbInitialized = true;
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    // Don't throw - allow app to continue (database might already exist)
    dbInitialized = true;
  }
}

export async function getAllEntries(userId) {
  try {
    const result = await sql`
      SELECT id, text, position_x, position_y, parent_entry_id
      FROM entries
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
    `;
    return result.rows.map(row => ({
      id: row.id,
      text: row.text,
      position: { x: row.position_x, y: row.position_y },
      parentEntryId: row.parent_entry_id || null
    }));
  } catch (error) {
    console.error('Error fetching entries:', error);
    throw error;
  }
}

export async function getEntryById(id, userId) {
  try {
    const result = await sql`
      SELECT id, text, position_x, position_y, parent_entry_id
      FROM entries
      WHERE id = ${id} AND user_id = ${userId}
    `;
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      id: row.id,
      text: row.text,
      position: { x: row.position_x, y: row.position_y },
      parentEntryId: row.parent_entry_id || null
    };
  } catch (error) {
    console.error('Error fetching entry:', error);
    throw error;
  }
}

export async function saveEntry(entry) {
  try {
    await sql`
      INSERT INTO entries (id, text, position_x, position_y, parent_entry_id, user_id, updated_at)
      VALUES (${entry.id}, ${entry.text}, ${entry.position.x}, ${entry.position.y}, ${entry.parentEntryId || null}, ${entry.userId}, CURRENT_TIMESTAMP)
      ON CONFLICT (id) 
      DO UPDATE SET 
        text = EXCLUDED.text,
        position_x = EXCLUDED.position_x,
        position_y = EXCLUDED.position_y,
        parent_entry_id = EXCLUDED.parent_entry_id,
        user_id = EXCLUDED.user_id,
        updated_at = CURRENT_TIMESTAMP
    `;
    return entry;
  } catch (error) {
    console.error('Error saving entry:', error);
    throw error;
  }
}

export async function deleteEntry(id, userId) {
  try {
    await sql`
      DELETE FROM entries WHERE id = ${id} AND user_id = ${userId}
    `;
    return true;
  } catch (error) {
    console.error('Error deleting entry:', error);
    throw error;
  }
}

export async function saveAllEntries(entries, userId) {
  try {
    if (entries.length === 0) return;

    const values = entries.map(entry => 
      sql`(${entry.id}, ${entry.text}, ${entry.position.x}, ${entry.position.y}, ${entry.parentEntryId || null}, ${userId})`
    );

    await sql`
      INSERT INTO entries (id, text, position_x, position_y, parent_entry_id, user_id, updated_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (id) 
      DO UPDATE SET 
        text = EXCLUDED.text,
        position_x = EXCLUDED.position_x,
        position_y = EXCLUDED.position_y,
        parent_entry_id = EXCLUDED.parent_entry_id,
        user_id = EXCLUDED.user_id,
        updated_at = CURRENT_TIMESTAMP
    `;
    return entries;
  } catch (error) {
    console.error('Error saving all entries:', error);
    throw error;
  }
}

export async function getUserById(id) {
  try {
    const result = await sql`
      SELECT id, phone, username
      FROM users
      WHERE id = ${id}
    `;
    if (result.rows.length === 0) return null;
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching user by id:', error);
    throw error;
  }
}

export async function getUserByPhone(phone) {
  try {
    const result = await sql`
      SELECT id, phone, username
      FROM users
      WHERE phone = ${phone}
    `;
    if (result.rows.length === 0) return null;
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching user by phone:', error);
    throw error;
  }
}

export async function isUsernameTaken(username) {
  try {
    const result = await sql`
      SELECT 1
      FROM users
      WHERE username = ${username}
      LIMIT 1
    `;
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking username:', error);
    throw error;
  }
}

export async function createUser(phone) {
  try {
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO users (id, phone)
      VALUES (${id}, ${phone})
    `;
    return { id, phone, username: null };
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
}

export async function setUsername(userId, username) {
  try {
    await sql`
      UPDATE users
      SET username = ${username}
      WHERE id = ${userId}
    `;
    return getUserById(userId);
  } catch (error) {
    console.error('Error setting username:', error);
    throw error;
  }
}

export async function saveVerificationCode(phone, code, expiresAt) {
  try {
    await sql`
      DELETE FROM phone_verification_codes
      WHERE phone = ${phone}
    `;
    await sql`
      INSERT INTO phone_verification_codes (phone, code, expires_at)
      VALUES (${phone}, ${code}, ${expiresAt})
    `;
  } catch (error) {
    console.error('Error saving verification code:', error);
    throw error;
  }
}

export async function verifyPhoneCode(phone, code) {
  try {
    const result = await sql`
      DELETE FROM phone_verification_codes
      WHERE phone = ${phone}
      AND code = ${code}
      AND expires_at > NOW()
      RETURNING phone
    `;
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error verifying phone code:', error);
    throw error;
  }
}

