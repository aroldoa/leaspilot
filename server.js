import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { createPool } from './db/pool.js';
import { initializeDatabase } from './db/schema.js';
import { requirePool } from './middleware/requirePool.js';
import authRoutes from './routes/auth.js';
import propertyRoutes from './routes/properties.js';
import tenantRoutes from './routes/tenants.js';
import tenantPortalRoutes from './routes/tenant.js';
import transactionRoutes from './routes/transactions.js';
import maintenanceRequestsRoutes from './routes/maintenance-requests.js';
import contractorsRoutes from './routes/contractors.js';
import contractorPortalRoutes from './routes/contractor.js';
import smsRoutes from './routes/sms.js';
import messagesRoutes from './routes/messages.js';
import createUserRouter from './routes/users.js';
import adminRoutes from './routes/admin.js';
import applyRoutes from './routes/apply.js';
import applicationsRoutes from './routes/applications.js';
import aiRoutes from './routes/ai.js';
import stripeConnectRoutes from './routes/stripe-connect.js';
import stripeBillingRoutes from './routes/stripe-billing.js';
import mortgageRoutes from './routes/mortgages.js';
import inviteRoutes from './routes/invites.js';

dotenv.config();

// ── Startup env validation ────────────────────────────────────────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET must be at least 32 characters');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('⚠️  STRIPE_WEBHOOK_SECRET not set — Stripe webhooks will be rejected in production');
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn('⚠️  STRIPE_SECRET_KEY not set — application fee payments will be skipped');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — AI recommendations will use rule-based fallback');
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isServerless = __dirname.startsWith('/var/task') || process.env.VERCEL === '1';
const serverAvatarDir = isServerless
  ? path.join(os.tmpdir(), 'leasepilot-uploads', 'avatars')
  : path.join(__dirname, 'uploads', 'avatars');
try {
  fs.mkdirSync(serverAvatarDir, { recursive: true });
} catch (e) {}

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Required behind Vercel/reverse proxy so rate limiter and X-Forwarded-* are trusted
app.set('trust proxy', 1);

if ((process.env.VERCEL === '1' || process.env.VERCEL === 'true') && !process.env.BLOB_READ_WRITE_TOKEN) {
  console.warn('⚠️ BLOB_READ_WRITE_TOKEN is not set. Profile avatars will not persist.');
}

// Security headers
// CSP is disabled because the app uses inline onclick handlers and CDN scripts throughout
// all HTML pages. Enabling strict CSP requires refactoring all pages to use external
// event listeners and adding nonces — tracked as a future hardening task.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS — exact whitelist only; no regex fallback
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://leaspilot.vercel.app',
      'https://www.leasepilotai.com',
      'https://app.leasepilotai.com',
    ];

function corsOrigin(origin, cb) {
  // Allow requests with no origin (server-to-server, curl, mobile apps)
  if (!origin) return cb(null, true);
  const o = origin.replace(/\/$/, '');
  if (ALLOWED_ORIGINS.some(allowed => allowed.replace(/\/$/, '') === o)) {
    return cb(null, origin);
  }
  return cb(null, false);
}
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Root and status first so they always work
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/status', (req, res) => {
  res.type('html').send(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>LeasePilot</title></head>
    <body style="font-family:sans-serif;max-width:600px;margin:2rem auto;padding:1rem;">
      <h1>Server is running</h1>
      <p><a href="/">Open the app</a> &middot; <a href="/api/health">API health</a></p>
    </body></html>
  `);
});

// Serve avatar files
app.get('/uploads/avatars/:filename', (req, res, next) => {
  const filename = path.basename(req.params.filename);
  if (!filename || filename.includes('..')) return next();
  const filePath = path.join(serverAvatarDir, filename);
  const fallbackPath = path.join(__dirname, 'uploads', 'avatars', filename);
  function tryServe(where) {
    const ext = path.extname(filename).toLowerCase();
    const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
    res.type(types[ext] || 'image/jpeg');
    fs.createReadStream(where).pipe(res);
  }
  fs.stat(filePath, (err, stat) => {
    if (!err && stat && stat.isFile()) return tryServe(filePath);
    fs.stat(fallbackPath, (err2, stat2) => {
      if (!err2 && stat2 && stat2.isFile()) return tryServe(fallbackPath);
      next();
    });
  });
});

// Serve static files from project root
app.use(express.static(__dirname));
// Serve uploaded files (maintenance photos, etc.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Request logging (development only)
if (!isProduction) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });
}

// General API rate limit — 200 req / 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
// Apply to all /api routes except auth (auth has its own per-endpoint limiters)
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('auth')) return next();
  apiLimiter(req, res, next);
});

// Initialize database
const pool = createPool();
app.locals.pool = pool;

if (pool) {
  initializeDatabase(pool).then(() => {
    console.log('✅ Database initialized');
  }).catch(err => {
    console.error('❌ Database initialization failed:', err);
  });
} else {
  console.warn('⚠️ DATABASE_URL not set; API will return 503 for database-dependent routes');
}

// Health check
app.get('/api/health', async (req, res) => {
  const payload = { status: 'ok', message: 'LeasePilot AI API is running' };
  if (!pool) {
    payload.db = 'unavailable';
    return res.json(payload);
  }
  try {
    await pool.query('SELECT 1');
    payload.db = 'connected';
  } catch {
    payload.db = 'error';
    payload.status = 'degraded';
  }
  res.json(payload);
});

// Avatar stream endpoint
app.get('/api/avatar/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename || filename.includes('..')) return res.status(400).end();
  const primaryPath = path.join(serverAvatarDir, filename);
  const fallbackPath = path.join(__dirname, 'uploads', 'avatars', filename);

  function tryStream(filePath) {
    const ext = path.extname(filename).toLowerCase();
    const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
    res.type(types[ext] || 'image/jpeg');
    fs.createReadStream(filePath).pipe(res);
  }

  fs.stat(primaryPath, (err, stat) => {
    if (!err && stat && stat.isFile()) return tryStream(primaryPath);
    fs.stat(fallbackPath, (err2, stat2) => {
      if (!err2 && stat2 && stat2.isFile()) return tryStream(fallbackPath);
      res.status(404).end();
    });
  });
});

// API routes
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
app.use('/api/users', requirePool, createUserRouter(serverAvatarDir));
app.use('/api/admin', requirePool, adminRoutes);
app.use('/api/apply', requirePool, applyRoutes);
app.use('/api/applications', requirePool, applicationsRoutes);
app.use('/api/ai', requirePool, aiRoutes);
app.use('/api/stripe', requirePool, stripeConnectRoutes);
app.use('/api/billing', requirePool, stripeBillingRoutes);
app.use('/api/mortgages', requirePool, mortgageRoutes);
app.use('/api/invites', requirePool, inviteRoutes);

// 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', isProduction ? err.message : err);
  res.status(500).json({
    error: isProduction ? 'Internal server error' : err.message,
  });
});

// Start server (not in Vercel serverless)
if (process.env.VERCEL !== '1') {
  try {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
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

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
});

export default app;
