import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let pool = null;

function isPlaceholderDatabaseUrl(url) {
  if (!url || typeof url !== 'string') return true;
  try {
    const u = new URL(url);
    const host = (u.hostname || '').toLowerCase();
    // Refuse placeholder/invalid hosts so we don't crash with ENOTFOUND (allow localhost for local dev)
    if (['base', 'host', 'changeme', 'example.com', 'dbname'].includes(host)) return true;
    if (host.startsWith('your-') || host === '') return true;
    return false;
  } catch {
    return true;
  }
}

export function createPool() {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL not set — database disabled (set in Vercel env for production)');
    return null;
  }
  if (isPlaceholderDatabaseUrl(process.env.DATABASE_URL)) {
    console.warn('⚠️ DATABASE_URL looks like a placeholder (e.g. host "base") — database disabled. Set a real Neon/Postgres URL in Vercel.');
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
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
  if (!pool && process.env.DATABASE_URL) {
    return createPool();
  }
  return pool;
}



