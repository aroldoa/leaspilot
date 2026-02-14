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

    // Contractors (vendors) per manager - for assigning to maintenance requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contractors (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        company VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        specialty VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tenant portal: maintenance requests (tenant-submitted)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS maintenance_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
        subject VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'open',
        priority VARCHAR(50) DEFAULT 'normal',
        issue_type VARCHAR(50) DEFAULT 'other',
        photo_urls TEXT,
        assigned_vendor VARCHAR(255),
        assigned_contractor_id INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Announcements per property (visible to tenants of that property)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Documents per tenant (manager-uploaded for tenant to download)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_documents (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        file_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add balance column to tenants if not exists (for rent balance display)
    await pool.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS balance DECIMAL(10,2) DEFAULT 0
    `);
    // Resident login: user account that can access tenant portal (manager stays as user_id owner)
    await pool.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS portal_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL UNIQUE
    `);

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
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_maintenance_requests_tenant_id ON maintenance_requests(tenant_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_announcements_property_id ON announcements(property_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_documents_tenant_id ON tenant_documents(tenant_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenants_portal_user_id ON tenants(portal_user_id)
    `);

    // Add maintenance_requests columns if table already existed without them
    await pool.query(`
      ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS priority VARCHAR(50) DEFAULT 'normal'
    `);
    await pool.query(`
      ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS issue_type VARCHAR(50) DEFAULT 'other'
    `);
    await pool.query(`
      ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS photo_urls TEXT
    `);
    await pool.query(`
      ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS assigned_vendor VARCHAR(255)
    `);
    await pool.query(`
      ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS assigned_contractor_id INTEGER REFERENCES contractors(id) ON DELETE SET NULL
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_contractors_user_id ON contractors(user_id)
    `);

    // In-app messages: manager → tenant or contractor; replies from tenant/contractor
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('tenant', 'contractor')),
        recipient_tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        recipient_contractor_id INTEGER REFERENCES contractors(id) ON DELETE CASCADE,
        subject VARCHAR(255) NOT NULL,
        body TEXT,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Reply/thread columns and contractor portal (migrations)
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_contractor_id INTEGER REFERENCES contractors(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE messages ALTER COLUMN sender_user_id DROP NOT NULL`);
    await pool.query(`
      ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_recipient_type_check
    `).catch(() => {});
    await pool.query(`
      ALTER TABLE messages ADD CONSTRAINT messages_recipient_type_check
      CHECK (recipient_type IN ('tenant', 'contractor', 'manager'))
    `).catch(() => {});
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_sender_tenant ON messages(sender_tenant_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_sender_contractor ON messages(sender_contractor_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_recipient_tenant ON messages(recipient_tenant_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_recipient_contractor ON messages(recipient_contractor_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_recipient_user ON messages(recipient_user_id)
    `);

    // Contractor portal login (like tenants.portal_user_id)
    await pool.query(`
      ALTER TABLE contractors ADD COLUMN IF NOT EXISTS portal_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL UNIQUE
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_contractors_portal_user_id ON contractors(portal_user_id)
    `).catch(() => {});

    // User profile avatar
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT
    `);

    console.log('✅ Database schema created successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}



