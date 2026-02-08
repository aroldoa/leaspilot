import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let pool = null;

function isPlaceholderUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const u = url.toLowerCase();
  return u.includes('changeme') || u.includes('your-') || u.includes('password@host') || u.includes(':password@');
}

export function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url || isPlaceholderUrl(url)) {
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      },
      max: process.env.VERCEL ? 2 : 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: process.env.VERCEL ? 10000 : 2000,
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



