import dotenv from 'dotenv';
import { createPool } from './pool.js';
import bcrypt from 'bcryptjs';

dotenv.config();

const pool = createPool();

async function assignToUser() {
  try {
    const email = process.env.ASSIGN_TO_EMAIL || 'aroldo@investsupreme.com';
    if (!email) {
      console.error('❌ Set ASSIGN_TO_EMAIL in env (e.g. ASSIGN_TO_EMAIL=you@example.com)');
      process.exit(1);
    }
    console.log(`🔄 Assigning all data to ${email}...`);

    // Get or create user
    let userId;
    const userCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (userCheck.rows.length > 0) {
      userId = userCheck.rows[0].id;
      console.log(`✅ Found existing user with ID: ${userId}`);
    } else {
      // Create user if doesn't exist
      const passwordHash = await bcrypt.hash('password123', 10);
      const userResult = await pool.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [email, passwordHash, 'Aroldo', 'Portfolio Manager']
      );
      userId = userResult.rows[0].id;
      console.log(`✅ Created new user with ID: ${userId}`);
    }

    // Update all properties
    const propertiesResult = await pool.query(
      'UPDATE properties SET user_id = $1 RETURNING id',
      [userId]
    );
    console.log(`✅ Assigned ${propertiesResult.rows.length} properties`);

    // Update all tenants
    const tenantsResult = await pool.query(
      'UPDATE tenants SET user_id = $1 RETURNING id',
      [userId]
    );
    console.log(`✅ Assigned ${tenantsResult.rows.length} tenants`);

    // Update all transactions
    const transactionsResult = await pool.query(
      'UPDATE transactions SET user_id = $1 RETURNING id',
      [userId]
    );
    console.log(`✅ Assigned ${transactionsResult.rows.length} transactions`);

    // Update all notifications
    const notificationsResult = await pool.query(
      'UPDATE notifications SET user_id = $1 RETURNING id',
      [userId]
    );
    console.log(`✅ Assigned ${notificationsResult.rows.length} notifications`);

    console.log(`\n✅ Successfully assigned all data to ${email}`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Properties: ${propertiesResult.rows.length}`);
    console.log(`   Tenants: ${tenantsResult.rows.length}`);
    console.log(`   Transactions: ${transactionsResult.rows.length}`);
    console.log(`   Notifications: ${notificationsResult.rows.length}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error assigning data:', error);
    process.exit(1);
  }
}

assignToUser();



