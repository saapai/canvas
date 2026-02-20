import pkg from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';

const { Pool } = pkg;
dotenv.config();

let pool = null;
let dbInitialized = false;

export function getPool() {
  if (!pool) {
    // Check for POSTGRES_URL first, then fall back to POSTGRES_URL_NON_POOLING
    const connectionString = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (!connectionString) {
      throw new Error('POSTGRES_URL or POSTGRES_URL_NON_POOLING environment variable is not set');
    }

    // Always enable SSL but do not reject self-signed certificates.
    // Configure connection pool for scale: max 20 connections, timeout after 30s idle
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
      allowExitOnIdle: false // Keep pool alive even when idle
    });

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }
  return pool;
}

export async function initDatabase() {
  if (dbInitialized) return;

  try {
    const db = getPool();
    
    // MATCHES PRODUCTION SCHEMA - DO NOT CHANGE
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        phone_normalized TEXT,
        username TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add phone_normalized column if it doesn't exist (migration)
    try {
      await db.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS phone_normalized TEXT;
      `);
      // Create index on normalized phone for fast lookups
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_users_phone_normalized ON users(phone_normalized);
      `);
      // Backfill existing records - normalize to match lookup logic
      // Remove spaces, dashes, parentheses, then remove +1 or leading 1
      await db.query(`
        UPDATE users 
        SET phone_normalized = REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(phone, '[\\s\\-\\(\\)]', '', 'g'),
            '^\\+1',
            ''
          ),
          '^1',
          ''
        )
        WHERE phone_normalized IS NULL;
      `);
    } catch (error) {
      console.log('Note: phone_normalized column/index check:', error.message);
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        position_x REAL NOT NULL,
        position_y REAL NOT NULL,
        parent_entry_id TEXT,
        user_id TEXT,
        link_cards_data JSONB,
        media_card_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS phone_verification_codes (
        phone TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL
      );
    `);
    
    // Create index on phone for lookups (since we removed UNIQUE constraint)
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
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
    
    // Add index on deleted_at for efficient soft delete filtering
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_entries_deleted_at ON entries(deleted_at) WHERE deleted_at IS NULL;
    `);
    
    // Add index on username for faster lookups
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;
    `);

    // Add columns if they don't exist (migration for existing databases)
    try {
      await db.query(`
        ALTER TABLE entries 
        ADD COLUMN IF NOT EXISTS link_cards_data JSONB;
      `);
    } catch (error) {
      console.log('Note: link_cards_data column check:', error.message);
    }

    try {
      await db.query(`
        ALTER TABLE entries 
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
      `);
    } catch (error) {
      console.log('Note: deleted_at column check:', error.message);
    }

    try {
      await db.query(`
        ALTER TABLE entries 
        ADD COLUMN IF NOT EXISTS text_html TEXT;
      `);
      // Verify the column was added/exists
      const checkResult = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'entries' AND column_name = 'text_html';
      `);
      if (checkResult.rows.length > 0) {
        console.log('[DB] text_html column exists and is ready');
      } else {
        console.warn('[DB] WARNING: text_html column was not found after migration attempt');
      }
    } catch (error) {
      console.error('[DB] ERROR: Failed to add text_html column:', error.message);
      console.error('[DB] Please manually run: ALTER TABLE entries ADD COLUMN text_html TEXT;');
    }

    try {
      await db.query(`
        ALTER TABLE entries
        ADD COLUMN IF NOT EXISTS media_card_data JSONB;
      `);
    } catch (error) {
      console.log('Note: media_card_data column check:', error.message);
    }

    try {
      await db.query(`
        ALTER TABLE entries
        ADD COLUMN IF NOT EXISTS latex_data JSONB;
      `);
    } catch (error) {
      console.log('Note: latex_data column check:', error.message);
    }

    // Add background settings columns to users table
    try {
      await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bg_url TEXT;`);
      await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bg_uploads JSONB DEFAULT '[]'::jsonb;`);
    } catch (error) {
      console.log('Note: bg columns migration:', error.message);
    }

    // Google OAuth tokens table
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS google_tokens (
          user_id TEXT PRIMARY KEY REFERENCES users(id),
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          token_expiry TIMESTAMP,
          scopes TEXT,
          calendar_settings JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (error) {
      console.log('Note: google_tokens table check:', error.message);
    }

    dbInitialized = true;
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    dbInitialized = true;
  }
}

export async function getAllEntries(userId, options = {}) {
  try {
    const db = getPool();
    const { limit, offset } = options;
    const hasPagination = limit !== undefined && offset !== undefined;
    
    let result;
    try {
      // Try to select with text_html column
      let query = `SELECT id, text, text_html, position_x, position_y, parent_entry_id, link_cards_data, media_card_data, latex_data
         FROM entries
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY created_at ASC`;
      
      const params = [userId];
      if (hasPagination) {
        query += ` LIMIT $2 OFFSET $3`;
        params.push(limit, offset);
      }
      
      result = await db.query(query, params);
    } catch (dbError) {
      // If column doesn't exist, select without it
      if (dbError.code === '42703' || dbError.message.includes('text_html') || (dbError.message.includes('column') && dbError.message.includes('text_html'))) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[DB] ERROR: text_html column does not exist when loading entries!');
        }
        let query = `SELECT id, text, position_x, position_y, parent_entry_id, link_cards_data, media_card_data
           FROM entries
           WHERE user_id = $1 AND deleted_at IS NULL
           ORDER BY created_at ASC`;
        
        const params = [userId];
        if (hasPagination) {
          query += ` LIMIT $2 OFFSET $3`;
          params.push(limit, offset);
        }
        
        result = await db.query(query, params);
      } else {
        throw dbError;
      }
    }
    const mapped = result.rows.map(row => ({
      id: row.id,
      text: row.text,
      textHtml: row.text_html || null, // Will be null if column doesn't exist
      position: { x: row.position_x, y: row.position_y },
      parentEntryId: row.parent_entry_id || null,
      linkCardsData: row.link_cards_data || null,
      mediaCardData: row.media_card_data || null,
      latexData: row.latex_data || null
    }));
    
    return mapped;
  } catch (error) {
    console.error('Error fetching entries:', error);
    throw error;
  }
}

export async function getEntriesCount(userId) {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM entries
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    return result.rows[0]?.count || 0;
  } catch (error) {
    console.error('Error counting entries:', error);
    throw error;
  }
}

export async function getEntryById(id, userId) {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT id, text, position_x, position_y, parent_entry_id
       FROM entries
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
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
    // Removed verbose logging - use DEBUG env var if needed
    
    const db = getPool();
    const linkCardsData = entry.linkCardsData ? JSON.stringify(entry.linkCardsData) : null;
    const mediaCardData = entry.mediaCardData ? JSON.stringify(entry.mediaCardData) : null;
    const latexData = entry.latexData ? JSON.stringify(entry.latexData) : null;

    // Try to save with text_html, but handle case where column might not exist yet
    let result;
    let textHtmlActuallySaved = false;
    try {
      result = await db.query(
        `INSERT INTO entries (id, text, text_html, position_x, position_y, parent_entry_id, user_id, link_cards_data, media_card_data, latex_data, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, NULL)
         ON CONFLICT (id)
         DO UPDATE SET
           text = EXCLUDED.text,
           text_html = EXCLUDED.text_html,
           position_x = EXCLUDED.position_x,
           position_y = EXCLUDED.position_y,
           parent_entry_id = EXCLUDED.parent_entry_id,
           user_id = EXCLUDED.user_id,
           link_cards_data = EXCLUDED.link_cards_data,
           media_card_data = EXCLUDED.media_card_data,
           latex_data = EXCLUDED.latex_data,
           deleted_at = NULL,
           updated_at = CURRENT_TIMESTAMP`,
        [entry.id, entry.text, entry.textHtml || null, entry.position.x, entry.position.y, entry.parentEntryId || null, entry.userId, linkCardsData, mediaCardData, latexData]
      );
      textHtmlActuallySaved = !!entry.textHtml; // Successfully saved with text_html column
    } catch (dbError) {
      // If column doesn't exist, try without text_html
      // PostgreSQL error code 42703 = undefined_column
      const isColumnError = dbError.code === '42703' || 
                           (dbError.message && (dbError.message.includes('text_html') || 
                            (dbError.message.includes('column') && dbError.message.includes('text_html'))));
      
      if (isColumnError) {
        console.error('[DB] ERROR: text_html column does not exist!');
        console.error('[DB] Error code:', dbError.code, 'Message:', dbError.message);
        console.error('[DB] Please run: ALTER TABLE entries ADD COLUMN text_html TEXT;');
        console.warn('[DB] Saving without text_html for now (formatting will be lost)...');
        textHtmlActuallySaved = false; // Column doesn't exist, couldn't save
        result = await db.query(
          `INSERT INTO entries (id, text, position_x, position_y, parent_entry_id, user_id, link_cards_data, media_card_data, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, NULL)
           ON CONFLICT (id) 
           DO UPDATE SET 
             text = EXCLUDED.text,
             position_x = EXCLUDED.position_x,
             position_y = EXCLUDED.position_y,
             parent_entry_id = EXCLUDED.parent_entry_id,
             user_id = EXCLUDED.user_id,
             link_cards_data = EXCLUDED.link_cards_data,
             media_card_data = EXCLUDED.media_card_data,
             deleted_at = NULL,
             updated_at = CURRENT_TIMESTAMP`,
          [entry.id, entry.text, entry.position.x, entry.position.y, entry.parentEntryId || null, entry.userId, linkCardsData, mediaCardData]
        );
      } else {
        throw dbError;
      }
    }
    
    // Removed verbose verification logging - use DEBUG env var if needed
    
    return entry;
  } catch (error) {
    console.error('[DB] Error saving entry:', entry.id, error);
    console.error('[DB] Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint
    });
    throw error;
  }
}

// CRITICAL: SOFT DELETE ONLY - NEVER HARD DELETE
export async function deleteEntry(id, userId) {
  try {
    const db = getPool();
    
    // Soft delete: set deleted_at timestamp instead of actually deleting
    const result = await db.query(
      `UPDATE entries 
       SET deleted_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING id, text`,
      [id, userId]
    );
    
    return true;
  } catch (error) {
    console.error('Error deleting entry:', error);
    throw error;
  }
}

export async function restoreDeletedEntries(userId) {
  try {
    const db = getPool();
    const result = await db.query(
      `UPDATE entries
       SET deleted_at = NULL
       WHERE user_id = $1 AND deleted_at IS NOT NULL
       RETURNING id, text, deleted_at`,
      [userId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error restoring entries:', error);
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
        // Skip entries with null/undefined positions to prevent NOT NULL constraint violations
        const posX = entry.position && entry.position.x != null ? entry.position.x : null;
        const posY = entry.position && entry.position.y != null ? entry.position.y : null;
        if (posX == null || posY == null) {
          console.warn('[DB] Skipping entry with null position:', entry.id);
          continue;
        }
        const linkCardsData = entry.linkCardsData ? JSON.stringify(entry.linkCardsData) : null;
        const mediaCardData = entry.mediaCardData ? JSON.stringify(entry.mediaCardData) : null;
        const latexData = entry.latexData ? JSON.stringify(entry.latexData) : null;
        await client.query(
          `INSERT INTO entries (id, text, position_x, position_y, parent_entry_id, user_id, link_cards_data, media_card_data, latex_data, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, NULL)
           ON CONFLICT (id)
           DO UPDATE SET
             text = EXCLUDED.text,
             position_x = EXCLUDED.position_x,
             position_y = EXCLUDED.position_y,
             parent_entry_id = EXCLUDED.parent_entry_id,
             -- user_id NEVER changes once set
             link_cards_data = EXCLUDED.link_cards_data,
             media_card_data = EXCLUDED.media_card_data,
             latex_data = EXCLUDED.latex_data,
             deleted_at = NULL,
             updated_at = CURRENT_TIMESTAMP`,
          [entry.id, entry.text, posX, posY, entry.parentEntryId || null, userId, linkCardsData, mediaCardData, latexData]
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
      `SELECT id, phone, username, bg_url, bg_uploads
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

export async function setUserBackground(userId, bgUrl, bgUploads) {
  try {
    const db = getPool();
    await db.query(
      `UPDATE users SET bg_url = $1, bg_uploads = $2 WHERE id = $3`,
      [bgUrl, JSON.stringify(bgUploads), userId]
    );
  } catch (error) {
    console.error('Error setting user background:', error);
    throw error;
  }
}

export async function getUserByPhone(phone) {
  try {
    const db = getPool();
    // Normalize phone: remove spaces, dashes, and ensure consistent format
    const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+1/, '').replace(/^1/, '');
    
    // Use indexed phone_normalized column for fast lookup
    const result = await db.query(
      `SELECT id, phone, username
       FROM users
       WHERE phone_normalized = $1
       LIMIT 1`,
      [normalizedPhone]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching user by phone:', error);
    throw error;
  }
}

export async function getUsersByPhone(phone) {
  try {
    const db = getPool();
    // Normalize phone: remove spaces, dashes, and ensure consistent format
    const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+1/, '').replace(/^1/, '');
    
    // Use indexed phone_normalized column for fast lookup
    const result = await db.query(
      `SELECT id, phone, username, created_at
       FROM users
       WHERE phone_normalized = $1
       ORDER BY created_at ASC`,
      [normalizedPhone]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching users by phone:', error);
    throw error;
  }
}

export async function getUserByUsername(username) {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT id, phone, username
       FROM users
       WHERE username = $1`,
      [username]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching user by username:', error);
    throw error;
  }
}

export async function getEntriesByUsername(username, options = {}) {
  try {
    const db = getPool();
    const { limit, offset } = options;
    const hasPagination = limit !== undefined && offset !== undefined;
    
    let query = `SELECT e.id, e.text, e.text_html, e.position_x, e.position_y, e.parent_entry_id, e.link_cards_data, e.media_card_data, e.latex_data, e.created_at
       FROM entries e
       JOIN users u ON e.user_id = u.id
       WHERE u.username = $1 AND e.deleted_at IS NULL
       ORDER BY e.created_at ASC`;
    
    const params = [username];
    if (hasPagination) {
      query += ` LIMIT $2 OFFSET $3`;
      params.push(limit, offset);
    }
    
    const result = await db.query(query, params);
    return result.rows.map(row => ({
      id: row.id,
      text: row.text,
      textHtml: row.text_html || null,
      position: { x: row.position_x, y: row.position_y },
      parentEntryId: row.parent_entry_id || null,
      linkCardsData: row.link_cards_data || null,
      mediaCardData: row.media_card_data || null,
      latexData: row.latex_data || null,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error('Error fetching entries by username:', error);
    throw error;
  }
}

export async function getEntriesCountByUsername(username) {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM entries e
       JOIN users u ON e.user_id = u.id
       WHERE u.username = $1 AND e.deleted_at IS NULL`,
      [username]
    );
    return result.rows[0]?.count || 0;
  } catch (error) {
    console.error('Error counting entries by username:', error);
    throw error;
  }
}

export async function getEntryPath(entryId, userId) {
  try {
    const db = getPool();
    const path = [];
    let currentId = entryId;
    
    while (currentId) {
      const result = await db.query(
        `SELECT id, text, parent_entry_id
         FROM entries
         WHERE id = $1 AND user_id = $2`,
        [currentId, userId]
      );
      
      if (result.rows.length === 0) break;
      
      const entry = result.rows[0];
      path.unshift({ id: entry.id, text: entry.text });
      currentId = entry.parent_entry_id;
    }
    
    return path;
  } catch (error) {
    console.error('Error getting entry path:', error);
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
    // Normalize phone on insert for consistent lookups
    const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+1/, '').replace(/^1/, '');
    await db.query(
      `INSERT INTO users (id, phone, phone_normalized)
       VALUES ($1, $2, $3)`,
      [id, phone, normalizedPhone]
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
    // Get old username before updating
    const oldUser = await getUserById(userId);
    const oldUsername = oldUser?.username;
    
    // Update username in users table
    await db.query(
      `UPDATE users
       SET username = $1
       WHERE id = $2`,
      [username, userId]
    );
    
    // If there was an old username, we don't need to update entries
    // because entries are linked by user_id, not username
    // The username change only affects the URL/path, not the data ownership
    
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

// Aggregate stats for dashboard
export async function getStats() {
  const db = getPool();

  const slugExpr = `
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(text), '[^a-z0-9\\s-]', '', 'g'),
        '\\\\s+',
        '-',
        'g'
      ),
      '-+$',
      '',
      'g'
    )
  `;

  const [
    totalUsersRes,
    totalEntriesRes,
    dailyNewUsersRes,
    dailyNewEntriesRes,
    dailyActiveUsersRes,
    leaderboardRes
  ] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS count FROM users`),
    db.query(`SELECT COUNT(*)::int AS count FROM entries WHERE deleted_at IS NULL`),
    db.query(`
      SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
      FROM users
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `),
    db.query(`
      SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
      FROM entries
      WHERE deleted_at IS NULL
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `),
    db.query(`
      SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS date, COUNT(DISTINCT user_id)::int AS count
      FROM entries
      WHERE user_id IS NOT NULL AND deleted_at IS NULL
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `),
    db.query(`
      SELECT
        u.id,
        u.username,
        u.created_at,
        COUNT(e.id) FILTER (WHERE e.deleted_at IS NULL)::int AS entry_count,
        COUNT(e.id)::int AS total_entries_made,
        COUNT(e.id) FILTER (WHERE e.deleted_at IS NOT NULL)::int AS entries_deleted,
        COUNT(DISTINCT ${slugExpr})::int AS unique_pages
      FROM users u
      LEFT JOIN entries e ON e.user_id = u.id
      GROUP BY u.id
      ORDER BY entry_count DESC, u.created_at ASC
      LIMIT 50
    `)
  ]);

  const totalUsers = totalUsersRes.rows[0]?.count || 0;
  const totalEntries = totalEntriesRes.rows[0]?.count || 0;
  const avgEntriesPerUser = totalUsers === 0 ? 0 : +(totalEntries / totalUsers).toFixed(2);

  return {
    totals: {
      users: totalUsers,
      entries: totalEntries,
      avgEntriesPerUser
    },
    dailyNewUsers: dailyNewUsersRes.rows,
    dailyNewEntries: dailyNewEntriesRes.rows,
    dailyActiveUsers: dailyActiveUsersRes.rows,
    leaderboard: leaderboardRes.rows
  };
}

// ——— Google OAuth token storage ———

export async function getGoogleTokens(userId) {
  const db = getPool();
  const result = await db.query(
    `SELECT access_token, refresh_token, token_expiry, scopes, calendar_settings FROM google_tokens WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function saveGoogleTokens(userId, tokens) {
  const db = getPool();
  await db.query(`
    INSERT INTO google_tokens (user_id, access_token, refresh_token, token_expiry, scopes, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, google_tokens.refresh_token),
      token_expiry = EXCLUDED.token_expiry,
      scopes = EXCLUDED.scopes,
      updated_at = NOW()
  `, [userId, tokens.access_token, tokens.refresh_token || null, tokens.expiry_date ? new Date(tokens.expiry_date) : null, tokens.scope || null]);
}

export async function deleteGoogleTokens(userId) {
  const db = getPool();
  await db.query(`DELETE FROM google_tokens WHERE user_id = $1`, [userId]);
}

export async function saveGoogleCalendarSettings(userId, settings) {
  const db = getPool();
  await db.query(
    `UPDATE google_tokens SET calendar_settings = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, JSON.stringify(settings)]
  );
}
