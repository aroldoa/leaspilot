import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let pool = null;

export function createPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });

    pool.on('connect', () => {
      console.log('✅ Connected to PostgreSQL database');
    });
  }

  return pool;
}

export function getPool() {
  if (!pool) {
    return createPool();
  }
  return pool;
}

