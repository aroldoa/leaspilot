export async function initializeDatabase(pool) {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(100) DEFAULT 'Portfolio Manager',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create properties table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(100),
        address TEXT,
        city VARCHAR(255),
        state VARCHAR(100),
        zip VARCHAR(20),
        bedrooms INTEGER DEFAULT 0,
        bathrooms DECIMAL(3,1) DEFAULT 0,
        sqft INTEGER DEFAULT 0,
        rent DECIMAL(10,2) DEFAULT 0,
        image_url TEXT,
        status VARCHAR(50) DEFAULT 'vacant',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create tenants table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        unit VARCHAR(100),
        status VARCHAR(50) DEFAULT 'active',
        lease_start DATE,
        lease_end DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create transactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('income', 'expense')),
        description TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        category VARCHAR(100),
        transaction_date DATE NOT NULL,
        status VARCHAR(50) DEFAULT 'cleared',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create notifications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        type VARCHAR(50) DEFAULT 'info',
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create refresh_tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ---- Multi-tenant support: organizations and memberships ----
    // Create organizations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create user_organizations membership table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_organizations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        role VARCHAR(50) DEFAULT 'member',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, org_id)
      )
    `);

    // Add org_id to resources (if not exists)
    await pool.query(`
      ALTER TABLE IF EXISTS properties ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE;
    `);
    await pool.query(`
      ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE;
    `);
    await pool.query(`
      ALTER TABLE IF EXISTS transactions ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE;
    `);
    await pool.query(`
      ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE;
    `);

    // Ensure existing data is assigned to a default organization if none exist
    const usersRes = await pool.query('SELECT id FROM users LIMIT 1');
    if (usersRes.rows.length > 0) {
      const orgsRes = await pool.query('SELECT id FROM organizations LIMIT 1');
      let orgId;
      if (orgsRes.rows.length === 0) {
        const createOrg = await pool.query(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, ['Default Organization']);
        orgId = createOrg.rows[0].id;
      } else {
        orgId = orgsRes.rows[0].id;
      }

      // Associate existing users to default org if not already
      await pool.query(`
        INSERT INTO user_organizations (user_id, org_id, role)
        SELECT id, $1, 'owner' FROM users
        WHERE id NOT IN (SELECT user_id FROM user_organizations)
      `, [orgId]);

      // Assign existing resources to default org where null
      await pool.query(`UPDATE properties SET org_id = $1 WHERE org_id IS NULL`, [orgId]);
      await pool.query(`UPDATE tenants SET org_id = $1 WHERE org_id IS NULL`, [orgId]);
      await pool.query(`UPDATE transactions SET org_id = $1 WHERE org_id IS NULL`, [orgId]);
      await pool.query(`UPDATE notifications SET org_id = $1 WHERE org_id IS NULL`, [orgId]);
    }

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_properties_user_id ON properties(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenants_user_id ON tenants(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenants_property_id ON tenants(property_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_property_id ON transactions(property_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)
    `);

    console.log('✅ Database schema created successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}



