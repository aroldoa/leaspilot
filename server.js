import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createPool } from './db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { initializeDatabase } from './db/schema.js';
import { requirePool } from './middleware/requirePool.js';
import authRoutes from './routes/auth.js';
import propertyRoutes from './routes/properties.js';
import tenantRoutes from './routes/tenants.js';
import transactionRoutes from './routes/transactions.js';
import userRoutes from './routes/users.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Security headers (CSP disabled to avoid breaking static HTML/scripts)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS: allow production app and localhost (configurable via ALLOWED_ORIGINS)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['https://app.leasepilotai.com', 'http://localhost:3000', 'http://127.0.0.1:3000'];
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());
// Serve static files from project root (required on Vercel where cwd may not be project root)
app.use(express.static(__dirname));
// Explicit fallback for / so root always serves index.html
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Request logging (verbose only in development to avoid leaking request details in production logs)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (!isProduction) {
      const ms = Date.now() - start;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// General API rate limit (100 req/15 min per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
// Stricter limit for auth (login/register) to reduce brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many login attempts. Please try again in 15 minutes.' });
  },
});
app.use('/api/', apiLimiter);
app.use('/api/auth', authLimiter);

// Initialize database connection (null when DATABASE_URL is missing)
const pool = createPool();
app.locals.pool = pool;

if (pool) {
  initializeDatabase(pool).then(() => {
    console.log('✅ Database initialized successfully');
  }).catch(err => {
    console.error('❌ Database initialization failed:', err);
  });
} else {
  console.warn('⚠️ DATABASE_URL not set; API will return 503 for database-dependent routes');
}

// Health check (no DB required; reports DB status)
app.get('/api/health', async (req, res) => {
  const payload = { status: 'ok', message: 'LeasePilot AI API is running' };
  if (!pool) {
    payload.db = 'unavailable';
    return res.json(payload);
  }
  try {
    await pool.query('SELECT 1');
    payload.db = 'connected';
  } catch (err) {
    payload.db = 'error';
    payload.status = 'degraded';
  }
  res.json(payload);
});

// API routes (require DB)
app.use('/api/auth', requirePool, authRoutes);
app.use('/api/properties', requirePool, propertyRoutes);
app.use('/api/tenants', requirePool, tenantRoutes);
app.use('/api/transactions', requirePool, transactionRoutes);
app.use('/api/users', requirePool, userRoutes);

// 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler (no stack trace in production)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: isProduction ? 'Internal server error' : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
});

// Start server only when not in Vercel serverless
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API available at http://localhost:${PORT}/api`);
  });
}

export default app;


