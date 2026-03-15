/**
 * One-time script: creates (or updates) the super admin account.
 * Run with: node scripts/create-super-admin.js
 */
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { createPool } from '../db/pool.js';

dotenv.config();

const EMAIL    = 'support@leasepilotai.com';
const PASSWORD = 'Primomotif2!';
const NAME     = 'LeasePilot Support';
const ROLE     = 'super_admin';

const pool = createPool();
if (!pool) {
  console.error('❌ DATABASE_URL is not set.');
  process.exit(1);
}

const hash = await bcrypt.hash(PASSWORD, 12);

await pool.query(
  `INSERT INTO users (email, password_hash, name, role)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (email)
   DO UPDATE SET password_hash = EXCLUDED.password_hash,
                 name          = EXCLUDED.name,
                 role          = EXCLUDED.role,
                 updated_at    = CURRENT_TIMESTAMP`,
  [EMAIL, hash, NAME, ROLE]
);

console.log('✅ Super admin account ready:', EMAIL);
await pool.end();
