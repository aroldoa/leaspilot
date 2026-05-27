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
    await pool.query(`
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS number_of_units INTEGER DEFAULT 1
    `);

    // Property units (unit # or letter per property — for multifamily, condo, apartment, commercial)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS property_units (
        id SERIAL PRIMARY KEY,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        unit_label VARCHAR(100) NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_property_units_property_id ON property_units(property_id)
    `).catch(() => {});

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

    // Documents per property (manager-uploaded; leases, inspections, etc.)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS property_documents (
        id SERIAL PRIMARY KEY,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
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
      CREATE INDEX IF NOT EXISTS idx_property_documents_property_id ON property_documents(property_id)
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

    // Performance indexes: date-range filters, status filters, unread message lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON transactions(user_id, type)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_maintenance_requests_status ON maintenance_requests(status)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_maintenance_requests_property_id ON maintenance_requests(property_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_read_at ON messages(read_at)
    `).catch(() => {});

    // Billing: subscriptions per landlord
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id               SERIAL PRIMARY KEY,
        user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        plan             VARCHAR(50)     DEFAULT 'free',
        status           VARCHAR(50)     DEFAULT 'active',
        billing_cycle    VARCHAR(20)     DEFAULT 'monthly',
        amount           DECIMAL(10,2)   DEFAULT 0,
        discount_percent INTEGER         DEFAULT 0,
        credit_balance   DECIMAL(10,2)   DEFAULT 0,
        next_billing_date DATE,
        trial_ends_at    TIMESTAMP,
        notes            TEXT,
        created_at       TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP       DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Billing: invoice history
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount         DECIMAL(10,2) NOT NULL,
        status         VARCHAR(50)   DEFAULT 'pending',
        description    TEXT,
        due_date       DATE,
        paid_at        TIMESTAMP,
        failure_reason TEXT,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Billing: credit / discount adjustments log
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_adjustments (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type        VARCHAR(20) NOT NULL,
        amount      DECIMAL(10,2),
        percent     INTEGER,
        reason      TEXT,
        applied_by  INTEGER REFERENCES users(id),
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Rental applications: shareable listing link per property
    await pool.query(`
      CREATE TABLE IF NOT EXISTS property_listings (
        id               SERIAL PRIMARY KEY,
        property_id      INTEGER REFERENCES properties(id) ON DELETE CASCADE UNIQUE,
        token            VARCHAR(64) UNIQUE NOT NULL,
        application_fee  DECIMAL(10,2) DEFAULT 50.00,
        is_active        BOOLEAN DEFAULT true,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Rental applications submitted by prospective tenants
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rental_applications (
        id                     SERIAL PRIMARY KEY,
        listing_id             INTEGER REFERENCES property_listings(id) ON DELETE CASCADE,
        property_id            INTEGER REFERENCES properties(id) ON DELETE SET NULL,
        first_name             VARCHAR(100) NOT NULL,
        last_name              VARCHAR(100) NOT NULL,
        email                  VARCHAR(255) NOT NULL,
        phone                  VARCHAR(50),
        date_of_birth          DATE,
        employer               VARCHAR(255),
        job_title              VARCHAR(255),
        monthly_income         DECIMAL(10,2),
        employment_status      VARCHAR(50) DEFAULT 'employed',
        current_address        TEXT,
        current_landlord       VARCHAR(255),
        current_landlord_phone VARCHAR(50),
        move_in_date           DATE,
        reason_for_moving      TEXT,
        num_occupants          INTEGER DEFAULT 1,
        has_pets               BOOLEAN DEFAULT false,
        pet_description        TEXT,
        additional_notes       TEXT,
        stripe_session_id      VARCHAR(255),
        stripe_payment_intent  VARCHAR(255),
        application_fee        DECIMAL(10,2),
        payment_status         VARCHAR(50) DEFAULT 'pending',
        status                 VARCHAR(50) DEFAULT 'submitted',
        submitted_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Unit field on rental applications (added for multi-family support)
    await pool.query(`ALTER TABLE rental_applications ADD COLUMN IF NOT EXISTS unit VARCHAR(100)`);

    // Stripe Connect: per-manager connected account
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_account_email VARCHAR(255)`);

    // Tenant rent payments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rent_payments (
        id                    SERIAL PRIMARY KEY,
        tenant_id             INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        property_id           INTEGER REFERENCES properties(id) ON DELETE SET NULL,
        amount                DECIMAL(10,2) NOT NULL,
        payment_method        VARCHAR(50) DEFAULT 'ach',
        stripe_payment_intent VARCHAR(255),
        stripe_charge_id      VARCHAR(255),
        status                VARCHAR(50) DEFAULT 'pending',
        description           TEXT,
        period_month          VARCHAR(7),
        created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // AI columns on rental_applications
    await pool.query(`ALTER TABLE rental_applications ADD COLUMN IF NOT EXISTS ai_recommendation VARCHAR(20)`);
    await pool.query(`ALTER TABLE rental_applications ADD COLUMN IF NOT EXISTS ai_score INTEGER`);
    await pool.query(`ALTER TABLE rental_applications ADD COLUMN IF NOT EXISTS ai_summary TEXT`);
    await pool.query(`ALTER TABLE rental_applications ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMP`);

    // AI columns on maintenance_requests
    await pool.query(`ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS ai_priority VARCHAR(50)`);
    await pool.query(`ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS ai_issue_type VARCHAR(100)`);
    await pool.query(`ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS ai_summary TEXT`);

    // Property mortgages
    await pool.query(`
      CREATE TABLE IF NOT EXISTS property_mortgages (
        id SERIAL PRIMARY KEY,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        lender_name VARCHAR(255),
        loan_amount DECIMAL(12,2) DEFAULT 0,
        monthly_payment DECIMAL(10,2) DEFAULT 0,
        interest_rate DECIMAL(5,3) DEFAULT 0,
        loan_start_date DATE,
        loan_term_years INTEGER DEFAULT 30,
        escrow_amount DECIMAL(10,2) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE property_units ADD COLUMN IF NOT EXISTS rent DECIMAL(10,2) DEFAULT 0`);
    // Deduplicate before creating the unique index (safe to run multiple times)
    await pool.query(`
      DELETE FROM property_units a
      USING property_units b
      WHERE a.id < b.id
        AND a.property_id = b.property_id
        AND a.unit_label = b.unit_label
    `).catch(() => {});
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_property_units_prop_unit
      ON property_units(property_id, unit_label)
    `).catch(() => {});
    await pool.query(`ALTER TABLE property_mortgages ADD COLUMN IF NOT EXISTS loan_number VARCHAR(100)`);
    await pool.query(`ALTER TABLE property_mortgages ADD COLUMN IF NOT EXISTS monthly_tax DECIMAL(10,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE property_mortgages ADD COLUMN IF NOT EXISTS monthly_insurance DECIMAL(10,2) DEFAULT 0`);

    // Team: user-level team membership (member can access all owner's properties)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        owner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        member_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role           VARCHAR(50) DEFAULT 'manager',
        invited_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(owner_user_id, member_user_id)
      )
    `);

    // Team: invite tokens for property collaboration
    await pool.query(`
      CREATE TABLE IF NOT EXISTS property_invites (
        id SERIAL PRIMARY KEY,
        token VARCHAR(64) UNIQUE NOT NULL,
        property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
        invited_email VARCHAR(255),
        role VARCHAR(50) DEFAULT 'manager',
        invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        accepted_at TIMESTAMP,
        accepted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Ensure columns added after initial deploy exist
    await pool.query(`ALTER TABLE property_invites ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP`);
    await pool.query(`ALTER TABLE property_invites ADD COLUMN IF NOT EXISTS accepted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);

    // Team: active property collaborators
    await pool.query(`
      CREATE TABLE IF NOT EXISTS property_collaborators (
        id SERIAL PRIMARY KEY,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(50) DEFAULT 'manager',
        invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(property_id, user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS property_notes (
        id SERIAL PRIMARY KEY,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        note_type VARCHAR(20) DEFAULT 'note',
        reminder_date DATE,
        is_pinned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Password reset tokens (tenant self-service password reset)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token      VARCHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database schema created successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}



