import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPool } from './db/pool.js';
import { initializeDatabase } from './db/schema.js';
import authRoutes from './routes/auth.js';
import propertyRoutes from './routes/properties.js';
import tenantRoutes from './routes/tenants.js';
import transactionRoutes from './routes/transactions.js';
import userRoutes from './routes/users.js';
import notificationsRoutes from './routes/notifications.js';
import orgRoutes from './routes/org.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicPath = path.join(__dirname, 'public');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(publicPath));

// Initialize database only when DATABASE_URL is set (required on Vercel)
let pool = createPool();
app.locals.pool = pool;

if (pool) {
  initializeDatabase(pool).then(() => {
    console.log('✅ Database initialized successfully');
  }).catch(err => {
    console.error('❌ Database initialization failed:', err);
    app.locals.pool = null;
    pool = null;
  });
}

// Require pool for API routes (except health) when DB is not configured
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/health/') {
    return next();
  }
  if (!pool) {
    return res.status(503).json({
      error: 'Database unavailable',
      message: 'DATABASE_URL is not set. Add it in Vercel Project Settings → Environment Variables.'
    });
  }
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/org', orgRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'LeasePilot AI API is running' });
});

// SPA fallback: serve index.html for non-API routes so static and client routing work on Vercel
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Start server only when not on Vercel (serverless handles requests there)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API available at http://localhost:${PORT}/api`);
  });
}

export default app;



