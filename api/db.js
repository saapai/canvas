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
    const connectionString = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (!connectionString) {
      throw new Error('POSTGRES_URL or POSTGRES_URL_NON_POOLING environment variable is not set');
    }

    // Always enable SSL but do not reject self-signed certificates.
    // This matches the working pattern:
    // new Pool({ connectionString, ssl: { rejectUnauthorized: false } })
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });
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
        link_cards_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        username TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create index on phone for lookups (since we removed UNIQUE constraint)
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
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

    // Add link_cards_data column if it doesn't exist (migration for existing databases)
    try {
      await db.query(`
        ALTER TABLE entries 
        ADD COLUMN IF NOT EXISTS link_cards_data JSONB;
      `);
    } catch (error) {
      // Column might already exist, ignore error
      console.log('Note: link_cards_data column check:', error.message);
    }

    // Add deleted_at column if it doesn't exist (migration for soft deletes)
    try {
      await db.query(`
        ALTER TABLE entries 
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
      `);
    } catch (error) {
      // Column might already exist, ignore error
      console.log('Note: deleted_at column check:', error.message);
    }

    // Remove UNIQUE constraint from phone column if it exists (migration for multi-username support)
    try {
      // First, check if the constraint exists
      const constraintCheck = await db.query(`
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'users' 
          AND constraint_type = 'UNIQUE' 
          AND constraint_name LIKE '%phone%';
      `);
      
      if (constraintCheck.rows.length > 0) {
        for (const row of constraintCheck.rows) {
          await db.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS ${row.constraint_name};`);
          console.log(`Dropped constraint: ${row.constraint_name}`);
        }
      }
    } catch (error) {
      // Constraint might not exist, ignore error
      console.log('Note: phone unique constraint migration:', error.message);
    }

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
      `SELECT id, text, position_x, position_y, parent_entry_id, link_cards_data
       FROM entries
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [userId]
    );
    return result.rows.map(row => ({
      id: row.id,
      text: row.text,
      position: { x: row.position_x, y: row.position_y },
      parentEntryId: row.parent_entry_id || null,
      linkCardsData: row.link_cards_data || null
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
    const db = getPool();
    const linkCardsData = entry.linkCardsData ? JSON.stringify(entry.linkCardsData) : null;
    await db.query(
      `INSERT INTO entries (id, text, position_x, position_y, parent_entry_id, user_id, link_cards_data, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (id) 
       DO UPDATE SET 
         text = EXCLUDED.text,
         position_x = EXCLUDED.position_x,
         position_y = EXCLUDED.position_y,
         parent_entry_id = EXCLUDED.parent_entry_id,
         user_id = EXCLUDED.user_id,
         link_cards_data = EXCLUDED.link_cards_data,
         updated_at = CURRENT_TIMESTAMP`,
      [entry.id, entry.text, entry.position.x, entry.position.y, entry.parentEntryId || null, entry.userId, linkCardsData]
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
    // Soft delete: set deleted_at timestamp instead of actually deleting
    await db.query(
      `UPDATE entries 
       SET deleted_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
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
        const linkCardsData = entry.linkCardsData ? JSON.stringify(entry.linkCardsData) : null;
        await client.query(
          `INSERT INTO entries (id, text, position_x, position_y, parent_entry_id, user_id, link_cards_data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
           ON CONFLICT (id) 
           DO UPDATE SET 
             text = EXCLUDED.text,
             position_x = EXCLUDED.position_x,
             position_y = EXCLUDED.position_y,
             parent_entry_id = EXCLUDED.parent_entry_id,
             user_id = EXCLUDED.user_id,
             link_cards_data = EXCLUDED.link_cards_data,
             updated_at = CURRENT_TIMESTAMP`,
          [entry.id, entry.text, entry.position.x, entry.position.y, entry.parentEntryId || null, userId, linkCardsData]
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
    // Normalize phone by removing spaces
    const normalizedPhone = phone.replace(/\s/g, '');
    
    const result = await db.query(
      `SELECT id, phone, username
       FROM users
       WHERE REPLACE(phone, ' ', '') = $1`,
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
    // Normalize phone by removing spaces and other non-digit characters except +
    const normalizedPhone = phone.replace(/\s/g, '');
    
    // Search for phone numbers that match when normalized (spaces removed)
    const result = await db.query(
      `SELECT id, phone, username
       FROM users
       WHERE REPLACE(phone, ' ', '') = $1
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

export async function getEntriesByUsername(username) {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT e.id, e.text, e.position_x, e.position_y, e.parent_entry_id, e.created_at
       FROM entries e
       JOIN users u ON e.user_id = u.id
       WHERE u.username = $1 AND e.deleted_at IS NULL
       ORDER BY e.created_at ASC`,
      [username]
    );
    return result.rows.map(row => ({
      id: row.id,
      text: row.text,
      position: { x: row.position_x, y: row.position_y },
      parentEntryId: row.parent_entry_id || null,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error('Error fetching entries by username:', error);
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

// Aggregate stats for dashboard
export async function getStats() {
  const db = getPool();

  // Common slug expression (mirrors frontend generateEntrySlug roughly)
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
