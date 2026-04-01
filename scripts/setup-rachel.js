import pkg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pkg;
dotenv.config();

async function main() {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Set Rachel's view_mode to article
    const result = await pool.query(
      `UPDATE users SET view_mode = 'article' WHERE username = 'rachel' RETURNING id, username, view_mode`
    );
    if (result.rows.length === 0) {
      console.log('User "rachel" not found. Please check the username.');
      return;
    }
    const user = result.rows[0];
    console.log('Updated view_mode:', user);

    // Soft-delete all existing entries for Rachel
    const deleted = await pool.query(
      `UPDATE entries SET deleted_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND deleted_at IS NULL RETURNING id`,
      [user.id]
    );
    console.log(`Soft-deleted ${deleted.rows.length} entries for Rachel.`);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
