/**
 * Link a contractor to a portal account so they can log in and reply to messages.
 * Usage: node db/link-contractor-user.js <contractor-email-or-id> [password]
 * - If contractor is specified by email: finds contractor by contractors.email, creates user with that email and role Contractor (or uses existing), sets portal_user_id.
 * - If contractor is specified by ID: finds contractor by id, uses contractor.email for the user; creates user with role Contractor, sets portal_user_id.
 * Default password if not provided: "password123"
 */
import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('ssl') ? { rejectUnauthorized: false } : undefined
});

async function main() {
  const arg = process.argv[2];
  const password = process.argv[3] || 'password123';
  if (!arg) {
    console.log('Usage: node db/link-contractor-user.js <contractor-email-or-id> [password]');
    process.exit(1);
  }

  const idNum = parseInt(arg, 10);
  const byId = Number.isInteger(idNum) && idNum > 0;

  let contractor;
  if (byId) {
    const r = await pool.query('SELECT id, email, name, user_id FROM contractors WHERE id = $1', [idNum]);
    if (r.rows.length === 0) {
      console.log('Contractor ID not found.');
      process.exit(1);
    }
    contractor = r.rows[0];
  } else {
    const r = await pool.query('SELECT id, email, name, user_id FROM contractors WHERE LOWER(email) = LOWER($1)', [arg]);
    if (r.rows.length === 0) {
      console.log('No contractor found with that email. Create the contractor in the app first.');
      process.exit(1);
    }
    contractor = r.rows[0];
  }

  const email = (contractor.email || arg).trim();
  if (!email) {
    console.log('Contractor has no email. Set email on the contractor in the app, then run this script with their email.');
    process.exit(1);
  }

  let userResult = await pool.query('SELECT id, role FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  let userId;
  if (userResult.rows.length === 0) {
    const hashed = await bcrypt.hash(password, 10);
    const name = contractor.name || email.split('@')[0];
    const ins = await pool.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'Contractor') RETURNING id`,
      [email, hashed, name]
    );
    userId = ins.rows[0].id;
    console.log('Created user with role Contractor:', email);
  } else {
    userId = userResult.rows[0].id;
    await pool.query("UPDATE users SET role = 'Contractor' WHERE id = $1", [userId]);
    console.log('Updated user to role Contractor:', email);
  }

  await pool.query('UPDATE contractors SET portal_user_id = $1 WHERE id = $2', [userId, contractor.id]);
  console.log('Linked contractor', contractor.name || contractor.id, 'to portal user. They can log in at the app login page and will be redirected to Messages.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
