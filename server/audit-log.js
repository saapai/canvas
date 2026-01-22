import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (!connectionString) {
      throw new Error('POSTGRES_URL environment variable is not set');
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

// Create audit log table
export async function initAuditLog() {
  try {
    const db = getPool();
    await db.query(`
      CREATE TABLE IF NOT EXISTS entry_audit_log (
        id SERIAL PRIMARY KEY,
        entry_id TEXT NOT NULL,
        user_id TEXT,
        action TEXT NOT NULL,
        entry_text TEXT,
        entry_data JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB
      );
    `);
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_entry_id ON entry_audit_log(entry_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON entry_audit_log(timestamp);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_action ON entry_audit_log(action);
    `);
    
    console.log('Audit log table initialized');
  } catch (error) {
    console.error('Error initializing audit log:', error);
  }
}

// Log entry actions
export async function logEntryAction(action, entryId, userId, entryData, metadata = {}) {
  try {
    const db = getPool();
    await db.query(`
      INSERT INTO entry_audit_log (entry_id, user_id, action, entry_text, entry_data, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      entryId,
      userId,
      action,
      entryData?.text || null,
      entryData ? JSON.stringify(entryData) : null,
      JSON.stringify(metadata)
    ]);
    
    console.log(`[AUDIT] ${action}: entry=${entryId}, user=${userId}`);
  } catch (error) {
    console.error('Error logging entry action:', error);
    // Don't throw - logging failure shouldn't break the app
  }
}

// Get audit history for an entry
export async function getEntryAuditHistory(entryId) {
  try {
    const db = getPool();
    const result = await db.query(`
      SELECT *
      FROM entry_audit_log
      WHERE entry_id = $1
      ORDER BY timestamp DESC
    `, [entryId]);
    
    return result.rows;
  } catch (error) {
    console.error('Error fetching audit history:', error);
    return [];
  }
}

// Get recent deletions
export async function getRecentDeletions(limit = 50) {
  try {
    const db = getPool();
    const result = await db.query(`
      SELECT 
        a.*,
        u.username,
        u.phone
      FROM entry_audit_log a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.action IN ('DELETE', 'SOFT_DELETE', 'HARD_DELETE')
      ORDER BY a.timestamp DESC
      LIMIT $1
    `, [limit]);
    
    return result.rows;
  } catch (error) {
    console.error('Error fetching recent deletions:', error);
    return [];
  }
}

// Alert on suspicious deletion patterns
export async function checkForSuspiciousDeletions() {
  try {
    const db = getPool();
    
    // Check for bulk deletions (>10 entries in 1 minute)
    const bulkDeletions = await db.query(`
      SELECT 
        user_id,
        COUNT(*) as deletion_count,
        MIN(timestamp) as first_deletion,
        MAX(timestamp) as last_deletion
      FROM entry_audit_log
      WHERE action IN ('DELETE', 'SOFT_DELETE', 'HARD_DELETE')
        AND timestamp > NOW() - INTERVAL '1 minute'
      GROUP BY user_id
      HAVING COUNT(*) > 10
    `);
    
    if (bulkDeletions.rows.length > 0) {
      console.warn('[AUDIT ALERT] Bulk deletion detected:', bulkDeletions.rows);
      return { alert: true, type: 'BULK_DELETION', data: bulkDeletions.rows };
    }
    
    // Check for hard deletes (should never happen in production)
    const hardDeletes = await db.query(`
      SELECT *
      FROM entry_audit_log
      WHERE action = 'HARD_DELETE'
        AND timestamp > NOW() - INTERVAL '1 hour'
      ORDER BY timestamp DESC
    `);
    
    if (hardDeletes.rows.length > 0) {
      console.error('[AUDIT ALERT] HARD DELETE DETECTED:', hardDeletes.rows);
      return { alert: true, type: 'HARD_DELETE', data: hardDeletes.rows };
    }
    
    return { alert: false };
  } catch (error) {
    console.error('Error checking for suspicious deletions:', error);
    return { alert: false, error: error.message };
  }
}
