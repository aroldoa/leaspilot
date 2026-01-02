import dotenv from 'dotenv';
import { createPool } from './pool.js';
import bcrypt from 'bcryptjs';

dotenv.config();

const pool = createPool();

async function setPassword() {
  try {
    const email = 'aroldo@investsupreme.com';
    const password = 'Primomotif2!';
    
    console.log(`🔐 Setting password for ${email}...`);
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id, email, name',
      [passwordHash, email]
    );
    
    if (result.rows.length > 0) {
      console.log(`✅ Password set successfully for ${email}`);
      console.log(`   User ID: ${result.rows[0].id}`);
      console.log(`   Name: ${result.rows[0].name}`);
      console.log(`   Password: ${password}`);
    } else {
      console.log(`❌ User ${email} not found`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error setting password:', error);
    process.exit(1);
  }
}

setPassword();



