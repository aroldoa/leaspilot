import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createPool } from './db/pool.js';
import { initializeDatabase } from './db/schema.js';
import { requirePool } from './middleware/requirePool.js';
import authRoutes from './routes/auth.js';
import propertyRoutes from './routes/properties.js';
import tenantRoutes from './routes/tenants.js';
import tenantPortalRoutes from './routes/tenant.js';
import transactionRoutes from './routes/transactions.js';
import userRoutes from './routes/users.js';
import maintenanceRequestsRoutes from './routes/maintenance-requests.js';
import contractorsRoutes from './routes/contractors.js';
import contractorPortalRoutes from './routes/contractor.js';
import smsRoutes from './routes/sms.js';
import messagesRoutes from './routes/messages.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
// Root and status first so they always work
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/status', (req, res) => {
  res.type('html').send(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>LeasePilot</title></head>
    <body style="font-family:sans-serif;max-width:600px;margin:2rem auto;padding:1rem;">
      <h1>Server is running</h1>
      <p>If you see this, the server is working.</p>
      <p><a href="/">Open the app</a> &middot; <a href="/api/health">API health</a></p>
    </body></html>
  `);
});
// Serve static files (HTML, JS, etc.) from project root
app.use(express.static(__dirname));
// Serve uploaded files (avatars, maintenance photos)
const uploadsPath = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsPath));

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

// General API rate limit (300 req/15 min per IP). Auth and read-only data loads are skipped so normal use never hits 429.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', (req, res, next) => {
  const p = req.path;
  if (p.startsWith('auth') || p.startsWith('/auth')) return next();
  // Don't count GET /properties or GET /tenants (loaded on every page)
  if (req.method === 'GET' && (p.startsWith('properties') || p.startsWith('/properties') || p.startsWith('tenants') || p.startsWith('/tenants'))) return next();
  apiLimiter(req, res, next);
});

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
app.use('/api/tenant', requirePool, tenantPortalRoutes);
app.use('/api/maintenance-requests', requirePool, maintenanceRequestsRoutes);
app.use('/api/contractors', requirePool, contractorsRoutes);
app.use('/api/contractor', requirePool, contractorPortalRoutes);
app.use('/api/sms', requirePool, smsRoutes);
app.use('/api/messages', requirePool, messagesRoutes);
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
  try {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 API available at http://localhost:${PORT}/api`);
    });
  } catch (err) {
    console.error('❌ Server failed to start:', err);
    process.exit(1);
  }
}

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
});

export default app;


