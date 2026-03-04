import dotenv from 'dotenv';
import crypto from 'crypto';
import { getPool } from '../shared/db.js';

dotenv.config();

const SEP_MEMBERS = [
  { phone: '3853687238', name: 'Saathvik', role: 'owner' },
  { phone: '8019419643', name: 'Harsha', role: 'member' },
  { phone: '8018588770', name: 'Ram', role: 'member' },
  { phone: '5107102280', name: 'Akhil', role: 'member' },
  { phone: '5108610597', name: 'Shubham', role: 'member' },
  { phone: '6692037710', name: 'Ananya', role: 'member' },
  { phone: '4083091998', name: 'Anirudh', role: 'member' },
  { phone: '5103878665', name: 'Anish', role: 'member' },
  { phone: '6506786076', name: 'Anshul', role: 'member' },
  { phone: '6509469919', name: 'Arjun', role: 'member' },
  { phone: '4088874802', name: 'Astha', role: 'member' },
  { phone: '6508047571', name: 'Atharva', role: 'member' },
  { phone: '7348476710', name: 'Brahmajit', role: 'member' },
  { phone: '6508047063', name: 'Devathi', role: 'member' },
  { phone: '4157228192', name: 'Ferdaws', role: 'member' },
  { phone: '5106156069', name: 'Guneev', role: 'member' },
  { phone: '6504227696', name: 'Harshil', role: 'member' },
  { phone: '4088002218', name: 'Ishan', role: 'member' },
  { phone: '6502168001', name: 'Ishaan', role: 'member' },
  { phone: '9253894553', name: 'Jayden', role: 'member' },
  { phone: '6507734747', name: 'Jeremia', role: 'member' },
  { phone: '6692989437', name: 'Karthik', role: 'member' },
  { phone: '4086219291', name: 'Lakshmi', role: 'member' },
  { phone: '3852141814', name: 'Manas', role: 'member' },
  { phone: '6508621117', name: 'Megan', role: 'member' },
  { phone: '9253900652', name: 'Meghna', role: 'member' },
  { phone: '6509069614', name: 'Misha', role: 'member' },
  { phone: '4083549791', name: 'Mokshith', role: 'member' },
  { phone: '5108616076', name: 'Naman', role: 'member' },
  { phone: '8582496665', name: 'Nikhil', role: 'member' },
  { phone: '9256990809', name: 'Nimisha', role: 'member' },
  { phone: '4158238073', name: 'Ojas', role: 'member' },
  { phone: '6692009498', name: 'Omkar', role: 'member' },
  { phone: '6503535250', name: 'Pranav', role: 'member' },
  { phone: '6508085289', name: 'Pratheek', role: 'member' },
  { phone: '4088327131', name: 'Priyanshi', role: 'member' },
  { phone: '8582489618', name: 'Rohan', role: 'member' },
  { phone: '6504501085', name: 'Roshini', role: 'member' },
  { phone: '6692009464', name: 'Sai Pranav', role: 'member' },
  { phone: '9252023680', name: 'Samarth', role: 'member' },
  { phone: '5107997629', name: 'Sarah', role: 'member' },
  { phone: '4085076649', name: 'Sarvesh', role: 'member' },
  { phone: '4084807605', name: 'Shamanth', role: 'member' },
  { phone: '4086366069', name: 'Shreeya', role: 'member' },
  { phone: '6507613345', name: 'Shreya', role: 'member' },
  { phone: '4088877476', name: 'Sindhu', role: 'member' },
  { phone: '9252098850', name: 'Sriya', role: 'member' },
  { phone: '4089665960', name: 'Tanvi', role: 'member' },
  { phone: '4082216012', name: 'Tarun', role: 'member' },
  { phone: '4087055261', name: 'Varun', role: 'member' },
  { phone: '4085498012', name: 'Veda', role: 'member' },
  { phone: '4086368780', name: 'Hari', role: 'member' },
  { phone: '8586102019', name: 'Brijesh', role: 'member' },
  { phone: '4088397373', name: 'Charvi', role: 'member' },
  { phone: '4083185008', name: 'Deepti', role: 'member' },
  { phone: '6693001413', name: 'Eesha', role: 'member' },
  { phone: '6696006966', name: 'Jayant', role: 'member' },
  { phone: '5108580277', name: 'Kedar', role: 'member' },
  { phone: '4088876703', name: 'Navya', role: 'member' },
  { phone: '4087779455', name: 'Pranav K', role: 'member' },
  { phone: '4088770804', name: 'Sathvik', role: 'member' },
  { phone: '6507709003', name: 'Sneha', role: 'member' },
  { phone: '6502087543', name: 'Sri Suhas', role: 'member' },
];

async function seed() {
  const pool = getPool();

  // 1. Look up user "Saathvik"
  console.log('Looking up user "Saathvik"...');
  const userResult = await pool.query(
    `SELECT id FROM users WHERE username = $1`,
    ['Saathvik']
  );
  if (userResult.rows.length === 0) {
    throw new Error('User "Saathvik" not found in users table');
  }
  const userId = userResult.rows[0].id;
  console.log(`Found user "Saathvik" with id: ${userId}`);

  // 2. Create the SEP entry (idempotent via sms_join_code unique index)
  console.log('Creating SEP entry...');
  const entryId = crypto.randomUUID();
  const entryResult = await pool.query(
    `INSERT INTO entries (id, text, text_html, position_x, position_y, parent_entry_id, user_id, sms_join_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (sms_join_code) WHERE sms_join_code IS NOT NULL
     DO UPDATE SET text = EXCLUDED.text, text_html = EXCLUDED.text_html
     RETURNING id`,
    [entryId, 'SEP', 'SEP', 0, 0, null, userId, 'SEP']
  );
  const sepEntryId = entryResult.rows[0].id;
  console.log(`SEP entry id: ${sepEntryId}`);

  // 3. Insert members
  console.log(`Inserting ${SEP_MEMBERS.length} members...`);
  let inserted = 0;
  for (const member of SEP_MEMBERS) {
    const phone = `+1${member.phone}`;
    const phoneNormalized = member.phone;
    const memberId = crypto.randomUUID();
    const result = await pool.query(
      `INSERT INTO sms_members (id, entry_id, phone, phone_normalized, name, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (entry_id, phone_normalized) DO NOTHING`,
      [memberId, sepEntryId, phone, phoneNormalized, member.name, member.role]
    );
    if (result.rowCount > 0) {
      inserted++;
      console.log(`  + ${member.name} (${phone})`);
    } else {
      console.log(`  ~ ${member.name} (${phone}) already exists`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`SEP entry id: ${sepEntryId}`);
  console.log(`Total members: ${SEP_MEMBERS.length}`);
  console.log(`Newly inserted: ${inserted}`);
  console.log(`Already existed: ${SEP_MEMBERS.length - inserted}`);
}

seed()
  .then(() => {
    console.log('\nSeed completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nSeed failed:', err);
    process.exit(1);
  });
