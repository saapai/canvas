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
    // Set Amia's view_mode to article
    const result = await pool.query(
      `UPDATE users SET view_mode = 'article' WHERE username = 'Amia' RETURNING id, username, view_mode`
    );
    if (result.rows.length === 0) {
      console.log('User "Amia" not found. Please check the username.');
    } else {
      console.log('Updated:', result.rows[0]);
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
