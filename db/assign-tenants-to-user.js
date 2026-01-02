import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function assignTenantsToUser(email) {
  try {
    console.log(`🔍 Looking up user with email: ${email}`);
    
    // Find or create user
    let userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    
    let userId;
    if (userResult.rows.length === 0) {
      console.log(`👤 User not found. Creating new user...`);
      // Create user with default password
      const hashedPassword = await bcrypt.hash('password123', 10);
      const newUserResult = await pool.query(
        'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
        [email, hashedPassword, email.split('@')[0]]
      );
      userId = newUserResult.rows[0].id;
      console.log(`✅ Created new user with ID: ${userId}`);
    } else {
      userId = userResult.rows[0].id;
      console.log(`✅ Found user with ID: ${userId}`);
    }
    
    // Get all tenants
    const tenantsResult = await pool.query('SELECT id, first_name, last_name, user_id FROM tenants ORDER BY id');
    console.log(`\n📋 Found ${tenantsResult.rows.length} tenants in database`);
    
    if (tenantsResult.rows.length === 0) {
      console.log('⚠️  No tenants found in database.');
      await pool.end();
      return;
    }
    
    // Update all tenants to belong to this user
    const updateResult = await pool.query(
      'UPDATE tenants SET user_id = $1 WHERE user_id IS NULL OR user_id != $1 RETURNING id',
      [userId]
    );
    
    console.log(`\n✅ Assigned ${updateResult.rows.length} tenants to user ${email} (ID: ${userId})`);
    
    // Show summary
    console.log('\n📊 Summary:');
    tenantsResult.rows.forEach(tenant => {
      const wasAssigned = updateResult.rows.some(t => t.id === tenant.id);
      const status = wasAssigned ? '✅ Assigned' : '⏭️  Already assigned';
      console.log(`  ${status}: ${tenant.first_name} ${tenant.last_name} (ID: ${tenant.id})`);
    });
    
    await pool.end();
    console.log('\n✨ Done!');
  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

// Get email from command line argument
const email = process.argv[2];

if (!email) {
  console.error('❌ Please provide an email address as an argument');
  console.log('Usage: node db/assign-tenants-to-user.js <email>');
  console.log('Example: node db/assign-tenants-to-user.js aroldo@investsupreme.com');
  process.exit(1);
}

assignTenantsToUser(email);



