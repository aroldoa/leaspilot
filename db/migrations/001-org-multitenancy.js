import dotenv from 'dotenv';
import { createPool } from '../pool.js';

dotenv.config();

const pool = createPool();
if (!pool) {
  console.error('❌ DATABASE_URL not set. Cannot run migration.');
  process.exit(1);
}

async function run() {
  try {
    // 1) Create organizations table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ ensured organizations table');

    // 2) Add organization_id columns if they don't exist (nullable initially)
    const addCols = [
      { table: 'users', col: 'organization_id' },
      { table: 'properties', col: 'organization_id' },
      { table: 'tenants', col: 'organization_id' },
      { table: 'transactions', col: 'organization_id' },
      { table: 'notifications', col: 'organization_id' }
    ];

    for (const { table, col } of addCols) {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = '${table}' AND column_name = '${col}'
          ) THEN
            ALTER TABLE ${table} ADD COLUMN ${col} INTEGER REFERENCES organizations(id) ON DELETE CASCADE;
          END IF;
        END
        $$;
      `);
      console.log(`✅ ensured ${table}.${col}`);
    }

    // 3) Create a demo organization if none exists
    const resOrg = await pool.query('SELECT id FROM organizations LIMIT 1');
    let orgId;
    if (resOrg.rows.length === 0) {
      const created = await pool.query(
        'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
        ['Demo Organization']
      );
      orgId = created.rows[0].id;
      console.log('✅ created demo organization id=', orgId);
    } else {
      orgId = resOrg.rows[0].id;
      console.log('ℹ️ found existing organization id=', orgId);
    }

    // 4) Backfill organization_id for existing rows when null
    await pool.query('UPDATE users SET organization_id = $1 WHERE organization_id IS NULL', [orgId]);
    await pool.query('UPDATE properties SET organization_id = $1 WHERE organization_id IS NULL', [orgId]);
    await pool.query('UPDATE tenants SET organization_id = $1 WHERE organization_id IS NULL', [orgId]);
    await pool.query('UPDATE transactions SET organization_id = $1 WHERE organization_id IS NULL', [orgId]);
    await pool.query('UPDATE notifications SET organization_id = $1 WHERE organization_id IS NULL', [orgId]);
    console.log('✅ backfilled organization_id for existing rows (where null)');

    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
  process.exit(0);
}

run();
