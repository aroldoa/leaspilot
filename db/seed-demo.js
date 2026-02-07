import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { createPool } from './pool.js';

dotenv.config();

const pool = createPool();
if (!pool) {
  console.error('❌ DATABASE_URL not set. Cannot run seed-demo.');
  process.exit(1);
}

async function run() {
  try {
    // Get demo organization (create if none)
    const orgRes = await pool.query('SELECT id FROM organizations LIMIT 1');
    let orgId;
    if (orgRes.rows.length === 0) {
      const created = await pool.query(
        'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
        ['Demo Organization']
      );
      orgId = created.rows[0].id;
      console.log('✅ created demo organization id=', orgId);
    } else {
      orgId = orgRes.rows[0].id;
      console.log('ℹ️ using organization id=', orgId);
    }

    // Create a sample investor user if not exists (demo email demo@leasepilot.ai)
    const userRes = await pool.query('SELECT id FROM users WHERE email = $1', ['demo@leasepilot.ai']);
    let userId;
    if (userRes.rows.length === 0) {
      const pwHash = await bcrypt.hash('demo123', 10);
      const createUser = await pool.query(
        `INSERT INTO users (email, password_hash, name, role, organization_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        ['demo@leasepilot.ai', pwHash, 'Demo Manager', 'Portfolio Manager', orgId]
      );
      userId = createUser.rows[0].id;
      console.log('✅ created demo user: demo@leasepilot.ai (password: demo123)');
    } else {
      userId = userRes.rows[0].id;
      await pool.query('UPDATE users SET organization_id = $1 WHERE id = $2', [orgId, userId]);
      console.log('ℹ️ demo user exists, ensured organization_id');
    }

    // Sample properties
    const props = [
      ['Oceanview House', 'house', '123 Ocean Ave', 'Santa Monica', 'CA', '90401', 3, 2.0, 1200, 2500.00, 'occupied'],
      ['Downtown Apt A', 'apartment', '456 Main St', 'Los Angeles', 'CA', '90012', 2, 1.5, 900, 1800.00, 'occupied'],
      ['Suburb Duplex', 'duplex', '789 Elm St', 'Glendale', 'CA', '91203', 4, 2.5, 1600, 3200.00, 'vacant']
    ];
    for (const p of props) {
      await pool.query(
        `INSERT INTO properties (user_id, organization_id, name, type, address, city, state, zip, bedrooms, bathrooms, sqft, rent, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [userId, orgId, ...p]
      );
    }
    console.log('✅ seeded sample properties');

    // Sample tenants for first two properties
    const propRes = await pool.query('SELECT id FROM properties WHERE organization_id = $1 ORDER BY id LIMIT 2', [orgId]);
    if (propRes.rows.length >= 1) {
      await pool.query(
        `INSERT INTO tenants (user_id, organization_id, property_id, first_name, last_name, email, phone, unit, status, lease_start, lease_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [userId, orgId, propRes.rows[0].id, 'Alice', 'Garcia', 'alice@example.com', '555-0100', '1A', 'active', '2024-07-01', '2025-06-30']
      );
    }
    if (propRes.rows.length >= 2) {
      await pool.query(
        `INSERT INTO tenants (user_id, organization_id, property_id, first_name, last_name, email, phone, unit, status, lease_start, lease_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [userId, orgId, propRes.rows[1].id, 'Marcus', 'Lee', 'marcus@example.com', '555-0111', '2B', 'active', '2024-01-15', '2024-12-31']
      );
    }
    console.log('✅ seeded sample tenants');

    // Sample transactions
    await pool.query(
      `INSERT INTO transactions (user_id, organization_id, property_id, type, description, amount, category, transaction_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, orgId, propRes.rows[0]?.id || null, 'income', 'Rent payment (Alice)', 2500.00, 'rent', '2025-01-05', 'cleared']
    );
    await pool.query(
      `INSERT INTO transactions (user_id, organization_id, property_id, type, description, amount, category, transaction_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, orgId, propRes.rows[1]?.id || null, 'income', 'Rent payment (Marcus)', 1800.00, 'rent', '2025-01-03', 'cleared']
    );
    await pool.query(
      `INSERT INTO transactions (user_id, organization_id, property_id, type, description, amount, category, transaction_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, orgId, null, 'expense', 'Roof repair - Oceanview', 450.00, 'repairs', '2025-01-10', 'cleared']
    );
    console.log('✅ seeded sample transactions');

    console.log('Seeding complete.');
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
  process.exit(0);
}

run();
