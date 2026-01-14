import pkg from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';

const { Pool } = pkg;
dotenv.config();

let pool = null;
let dbInitialized = false;

function getPool() {
  if (!pool) {
    // Check for POSTGRES_URL first, then fall back to POSTGRES_URL_NON_POOLING
    let connectionString = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (!connectionString) {
      throw new Error('POSTGRES_URL or POSTGRES_URL_NON_POOLING environment variable is not set');
    }
    
    // Determine if this is a Supabase connection (check multiple patterns)
    const connectionLower = connectionString.toLowerCase();
    const hasSupabaseInString = connectionLower.includes('supabase');
    const hasSupabaseEnvVars = !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    const isSupabase = hasSupabaseInString || hasSupabaseEnvVars;
    
    // For Supabase, ensure SSL is properly configured
    // Option 1 (recommended): provide Supabase CA cert via POSTGRES_CA_CERT env var
    // Option 2: fall back to rejectUnauthorized: false for self-signed certs
    let sslConfig = undefined;
    if (isSupabase) {
      const rawCa = process.env.POSTGRES_CA_CERT;
      // Vercel env vars sometimes store multiline PEMs with literal "\n"
      // Normalize those to real newlines so Node TLS can parse the certificate.
      const ca = (rawCa && rawCa.includes('\\n') && !rawCa.includes('\n'))
        ? rawCa.replace(/\\n/g, '\n')
        : rawCa;

      // Ensure connection string has sslmode if not already present
      if (!connectionString.includes('sslmode=')) {
        const separator = connectionString.includes('?') ? '&' : '?';
        connectionString = `${connectionString}${separator}sslmode=require`;
      }

      if (ca && ca.trim()) {
        sslConfig = {
          ca,
          rejectUnauthorized: true
        };
      } else {
        sslConfig = {
          rejectUnauthorized: false
        };
      }
    }
    
    pool = new Pool({
      connectionString,
      ssl: sslConfig
    });
    
    // Log connection info for debugging (without exposing sensitive data)
    if (isSupabase) {
      const detectedVia = hasSupabaseInString ? 'connection string' : 'environment variables';
      console.log(`Using Supabase Postgres connection with SSL (detected via ${detectedVia})`);
      const caPresent = !!(process.env.POSTGRES_CA_CERT && process.env.POSTGRES_CA_CERT.trim());
      const caLen = process.env.POSTGRES_CA_CERT ? process.env.POSTGRES_CA_CERT.length : 0;
      const caLooksPem = !!(process.env.POSTGRES_CA_CERT && process.env.POSTGRES_CA_CERT.includes('BEGIN CERTIFICATE'));
      const caHasRealNewlines = !!(process.env.POSTGRES_CA_CERT && process.env.POSTGRES_CA_CERT.includes('\n'));
      const caHasEscapedNewlines = !!(process.env.POSTGRES_CA_CERT && process.env.POSTGRES_CA_CERT.includes('\\n'));
      console.log(`POSTGRES_CA_CERT present=${caPresent} len=${caLen} pem=${caLooksPem} newline=${caHasRealNewlines} escapedNewline=${caHasEscapedNewlines}`);
    }
  }
  return pool;
}

export async function initDatabase() {
  if (dbInitialized) return;

  try {
    const db = getPool();
    
    await db.query(`
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
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        phone TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS phone_verification_codes (
        phone TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL
      );
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_parent_entry_id ON entries(parent_entry_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_entries_user_id ON entries(user_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_phone_verification_phone ON phone_verification_codes(phone);
    `);

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
    const db = getPool();
    const result = await db.query(
      `SELECT id, text, position_x, position_y, parent_entry_id
       FROM entries
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );
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
    const db = getPool();
    const result = await db.query(
      `SELECT id, text, position_x, position_y, parent_entry_id
       FROM entries
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
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
    const db = getPool();
    await db.query(
      `INSERT INTO entries (id, text, position_x, position_y, parent_entry_id, user_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (id) 
       DO UPDATE SET 
         text = EXCLUDED.text,
         position_x = EXCLUDED.position_x,
         position_y = EXCLUDED.position_y,
         parent_entry_id = EXCLUDED.parent_entry_id,
         user_id = EXCLUDED.user_id,
         updated_at = CURRENT_TIMESTAMP`,
      [entry.id, entry.text, entry.position.x, entry.position.y, entry.parentEntryId || null, entry.userId]
    );
    return entry;
  } catch (error) {
    console.error('Error saving entry:', error);
    throw error;
  }
}

export async function deleteEntry(id, userId) {
  try {
    const db = getPool();
    await db.query(
      `DELETE FROM entries WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return true;
  } catch (error) {
    console.error('Error deleting entry:', error);
    throw error;
  }
}

export async function saveAllEntries(entries, userId) {
  try {
    if (entries.length === 0) return;

    const db = getPool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      
      for (const entry of entries) {
        await client.query(
          `INSERT INTO entries (id, text, position_x, position_y, parent_entry_id, user_id, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
           ON CONFLICT (id) 
           DO UPDATE SET 
             text = EXCLUDED.text,
             position_x = EXCLUDED.position_x,
             position_y = EXCLUDED.position_y,
             parent_entry_id = EXCLUDED.parent_entry_id,
             user_id = EXCLUDED.user_id,
             updated_at = CURRENT_TIMESTAMP`,
          [entry.id, entry.text, entry.position.x, entry.position.y, entry.parentEntryId || null, userId]
        );
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
    return entries;
  } catch (error) {
    console.error('Error saving all entries:', error);
    throw error;
  }
}

export async function getUserById(id) {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT id, phone, username
       FROM users
       WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching user by id:', error);
    throw error;
  }
}

export async function getUserByPhone(phone) {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT id, phone, username
       FROM users
       WHERE phone = $1`,
      [phone]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching user by phone:', error);
    throw error;
  }
}

export async function isUsernameTaken(username) {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT 1
       FROM users
       WHERE username = $1
       LIMIT 1`,
      [username]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking username:', error);
    throw error;
  }
}

export async function createUser(phone) {
  try {
    const db = getPool();
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO users (id, phone)
       VALUES ($1, $2)`,
      [id, phone]
    );
    return { id, phone, username: null };
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
}

export async function setUsername(userId, username) {
  try {
    const db = getPool();
    await db.query(
      `UPDATE users
       SET username = $1
       WHERE id = $2`,
      [username, userId]
    );
    return getUserById(userId);
  } catch (error) {
    console.error('Error setting username:', error);
    throw error;
  }
}

export async function saveVerificationCode(phone, code, expiresAt) {
  try {
    const db = getPool();
    await db.query(
      `DELETE FROM phone_verification_codes
       WHERE phone = $1`,
      [phone]
    );
    await db.query(
      `INSERT INTO phone_verification_codes (phone, code, expires_at)
       VALUES ($1, $2, $3)`,
      [phone, code, expiresAt]
    );
  } catch (error) {
    console.error('Error saving verification code:', error);
    throw error;
  }
}

export async function verifyPhoneCode(phone, code) {
  try {
    const db = getPool();
    const result = await db.query(
      `DELETE FROM phone_verification_codes
       WHERE phone = $1
       AND code = $2
       AND expires_at > NOW()
       RETURNING phone`,
      [phone, code]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error verifying phone code:', error);
    throw error;
  }
}
