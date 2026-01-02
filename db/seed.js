import dotenv from 'dotenv';
import { createPool } from './pool.js';
import bcrypt from 'bcryptjs';

dotenv.config();

const pool = createPool();

async function seedDatabase() {
  try {
    console.log('🌱 Starting database seeding...');

    // Get or create a demo user
    let userId;
    const demoEmail = 'demo@leasepilot.ai';
    
    const userCheck = await pool.query('SELECT id FROM users WHERE email = $1', [demoEmail]);
    
    if (userCheck.rows.length > 0) {
      userId = userCheck.rows[0].id;
      console.log('✅ Using existing demo user');
    } else {
      const passwordHash = await bcrypt.hash('demo123', 10);
      const userResult = await pool.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [demoEmail, passwordHash, 'Sarah Jenkins', 'Portfolio Manager']
      );
      userId = userResult.rows[0].id;
      console.log('✅ Created demo user');
    }

    // Clear existing data for this user
    await pool.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM tenants WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM properties WHERE user_id = $1', [userId]);
    console.log('✅ Cleared existing data');

    // Insert Properties
    const properties = [
      {
        name: 'The Highland Lofts',
        type: 'Apartment',
        address: '123 Highland Avenue',
        city: 'San Francisco',
        state: 'CA',
        zip: '94102',
        bedrooms: 2,
        bathrooms: 2,
        sqft: 1200,
        rent: 3500,
        image_url: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&q=80&w=800&h=500',
        status: 'occupied'
      },
      {
        name: 'Sunset Villas',
        type: 'Condo',
        address: '101 Coastal Way',
        city: 'San Diego',
        state: 'CA',
        zip: '92101',
        bedrooms: 3,
        bathrooms: 2.5,
        sqft: 1800,
        rent: 4100,
        image_url: 'https://images.unsplash.com/photo-1600596542815-6ad4c1277855?auto=format&fit=crop&q=80&w=800&h=500',
        status: 'vacant'
      },
      {
        name: 'The Meridian',
        type: 'Apartment',
        address: '456 Westside Boulevard',
        city: 'Los Angeles',
        state: 'CA',
        zip: '90001',
        bedrooms: 1,
        bathrooms: 1,
        sqft: 850,
        rent: 2800,
        image_url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&q=80&w=800&h=500',
        status: 'maintenance'
      },
      {
        name: 'Riverside Apartments',
        type: 'Apartment',
        address: '789 River Road',
        city: 'Sacramento',
        state: 'CA',
        zip: '95814',
        bedrooms: 2,
        bathrooms: 1.5,
        sqft: 1100,
        rent: 2200,
        image_url: 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&q=80&w=800&h=500',
        status: 'occupied'
      },
      {
        name: 'Ocean View Condos',
        type: 'Condo',
        address: '321 Ocean Drive',
        city: 'Santa Monica',
        state: 'CA',
        zip: '90401',
        bedrooms: 3,
        bathrooms: 2,
        sqft: 1600,
        rent: 5200,
        image_url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&q=80&w=800&h=500',
        status: 'vacant'
      }
    ];

    const propertyIds = [];
    for (const prop of properties) {
      const result = await pool.query(
        `INSERT INTO properties (user_id, name, type, address, city, state, zip, bedrooms, bathrooms, sqft, rent, image_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [userId, prop.name, prop.type, prop.address, prop.city, prop.state, prop.zip, 
         prop.bedrooms, prop.bathrooms, prop.sqft, prop.rent, prop.image_url, prop.status]
      );
      propertyIds.push(result.rows[0].id);
    }
    console.log(`✅ Created ${properties.length} properties`);

    // Insert Tenants
    const tenants = [
      {
        first_name: 'Arthur',
        last_name: 'Campbell',
        email: 'arthur.c@example.com',
        phone: '(555) 123-4567',
        property_id: propertyIds[0],
        unit: '402',
        status: 'active',
        lease_start: '2024-01-15',
        lease_end: '2025-10-24'
      },
      {
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane.smith@example.com',
        phone: '(555) 234-5678',
        property_id: propertyIds[2],
        unit: '12B',
        status: 'active',
        lease_start: '2023-06-01',
        lease_end: '2024-12-31'
      },
      {
        first_name: 'Michael',
        last_name: 'Johnson',
        email: 'michael.j@example.com',
        phone: '(555) 345-6789',
        property_id: propertyIds[3],
        unit: '205',
        status: 'active',
        lease_start: '2024-03-01',
        lease_end: '2025-03-01'
      },
      {
        first_name: 'Emily',
        last_name: 'Davis',
        email: 'emily.davis@example.com',
        phone: '(555) 456-7890',
        property_id: propertyIds[0],
        unit: '301',
        status: 'pending',
        lease_start: '2024-12-01',
        lease_end: '2025-11-30'
      }
    ];

    for (const tenant of tenants) {
      await pool.query(
        `INSERT INTO tenants (user_id, first_name, last_name, email, phone, property_id, unit, status, lease_start, lease_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [userId, tenant.first_name, tenant.last_name, tenant.email, tenant.phone,
         tenant.property_id, tenant.unit, tenant.status, tenant.lease_start, tenant.lease_end]
      );
    }
    console.log(`✅ Created ${tenants.length} tenants`);

    // Insert Transactions
    const transactions = [
      {
        type: 'income',
        description: 'Monthly Rent - The Highland Lofts Unit 402',
        amount: 3500,
        category: 'Rent',
        property_id: propertyIds[0],
        transaction_date: '2024-12-01',
        status: 'cleared'
      },
      {
        type: 'income',
        description: 'Monthly Rent - The Meridian Unit 12B',
        amount: 2800,
        category: 'Rent',
        property_id: propertyIds[2],
        transaction_date: '2024-12-01',
        status: 'cleared'
      },
      {
        type: 'income',
        description: 'Monthly Rent - Riverside Apartments Unit 205',
        amount: 2200,
        category: 'Rent',
        property_id: propertyIds[3],
        transaction_date: '2024-12-01',
        status: 'cleared'
      },
      {
        type: 'expense',
        description: 'HVAC Repair - The Meridian',
        amount: 450,
        category: 'Maintenance',
        property_id: propertyIds[2],
        transaction_date: '2024-11-28',
        status: 'cleared'
      },
      {
        type: 'expense',
        description: 'Property Insurance',
        amount: 1200,
        category: 'Insurance',
        property_id: propertyIds[0],
        transaction_date: '2024-11-15',
        status: 'cleared'
      },
      {
        type: 'expense',
        description: 'Landscaping Services',
        amount: 300,
        category: 'Maintenance',
        property_id: propertyIds[1],
        transaction_date: '2024-11-20',
        status: 'cleared'
      },
      {
        type: 'income',
        description: 'Application Fee - Sunset Villas',
        amount: 50,
        category: 'Fees',
        property_id: propertyIds[1],
        transaction_date: '2024-11-25',
        status: 'cleared'
      },
      {
        type: 'expense',
        description: 'Property Management Fee',
        amount: 850,
        category: 'Management',
        property_id: null,
        transaction_date: '2024-12-01',
        status: 'pending'
      }
    ];

    for (const transaction of transactions) {
      await pool.query(
        `INSERT INTO transactions (user_id, type, description, amount, category, property_id, transaction_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, transaction.type, transaction.description, transaction.amount,
         transaction.category, transaction.property_id, transaction.transaction_date, transaction.status]
      );
    }
    console.log(`✅ Created ${transactions.length} transactions`);

    console.log('✅ Database seeding completed successfully!');
    console.log(`📊 Seeded data for user ID: ${userId}`);
    console.log(`   - ${properties.length} properties`);
    console.log(`   - ${tenants.length} tenants`);
    console.log(`   - ${transactions.length} transactions`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase();



