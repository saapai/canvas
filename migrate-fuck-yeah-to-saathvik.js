import pkg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pkg;
dotenv.config();

const SAATHVIK_USER_ID = '9703fd4e-fac9-4b7d-bbde-2e99ce0b1237';
const FUCK_YEAH_USER_ID = '170e2d8a-e93f-4061-b207-3127229a17af';

async function migrate() {
  const connectionString = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('❌ POSTGRES_URL or POSTGRES_URL_NON_POOLING environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔄 Starting migration: moving entries from fuck-yeah to Saathvik...\n');

    // First, check how many entries need to be migrated
    const checkResult = await pool.query(
      `SELECT COUNT(*) as count FROM entries WHERE user_id = $1 AND deleted_at IS NULL`,
      [FUCK_YEAH_USER_ID]
    );
    
    const totalEntries = parseInt(checkResult.rows[0].count);
    console.log(`📊 Found ${totalEntries} entries to migrate from fuck-yeah to Saathvik\n`);

    if (totalEntries === 0) {
      console.log('✅ No entries to migrate. Done!');
      await pool.end();
      return;
    }

    // Get sample entries to show what will be migrated
    const sampleResult = await pool.query(
      `SELECT id, text, created_at FROM entries 
       WHERE user_id = $1 AND deleted_at IS NULL 
       ORDER BY created_at DESC 
       LIMIT 5`,
      [FUCK_YEAH_USER_ID]
    );

    console.log('📝 Sample entries to be migrated:');
    sampleResult.rows.forEach((row, i) => {
      console.log(`  ${i + 1}. "${row.text.substring(0, 50)}${row.text.length > 50 ? '...' : ''}" (${row.created_at.toISOString()})`);
    });
    console.log('');

    // Perform the migration
    console.log('🔄 Migrating entries...');
    const migrateResult = await pool.query(
      `UPDATE entries 
       SET user_id = $1 
       WHERE user_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [SAATHVIK_USER_ID, FUCK_YEAH_USER_ID]
    );

    const migratedCount = migrateResult.rows.length;
    console.log(`✅ Successfully migrated ${migratedCount} entries from fuck-yeah to Saathvik\n`);

    // Verify migration
    const verifyResult = await pool.query(
      `SELECT COUNT(*) as count FROM entries WHERE user_id = $1 AND deleted_at IS NULL`,
      [FUCK_YEAH_USER_ID]
    );
    
    const remainingEntries = parseInt(verifyResult.rows[0].count);
    
    if (remainingEntries === 0) {
      console.log('✅ Migration verified: No entries remaining under fuck-yeah user ID');
    } else {
      console.log(`⚠️  Warning: ${remainingEntries} entries still remain under fuck-yeah user ID`);
    }

    // Show final count for Saathvik
    const saathvikResult = await pool.query(
      `SELECT COUNT(*) as count FROM entries WHERE user_id = $1 AND deleted_at IS NULL`,
      [SAATHVIK_USER_ID]
    );
    
    const saathvikTotal = parseInt(saathvikResult.rows[0].count);
    console.log(`📊 Total entries for Saathvik: ${saathvikTotal}\n`);

    console.log('✅ Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
