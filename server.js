import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createPool } from './db/pool.js';
import { initializeDatabase } from './db/schema.js';
import authRoutes from './routes/auth.js';
import propertyRoutes from './routes/properties.js';
import tenantRoutes from './routes/tenants.js';
import transactionRoutes from './routes/transactions.js';
import userRoutes from './routes/users.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS: allow production app and localhost (configurable via ALLOWED_ORIGINS)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['https://app.leasepilotai.com', 'http://localhost:3000', 'http://127.0.0.1:3000'];
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());
app.use(express.static('.'));

// Initialize database connection
const pool = createPool();

// Initialize database schema
initializeDatabase(pool).then(() => {
  console.log('✅ Database initialized successfully');
}).catch(err => {
  console.error('❌ Database initialization failed:', err);
});

// Make pool available to routes
app.locals.pool = pool;

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/users', userRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'LeasePilot AI API is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 API available at http://localhost:${PORT}/api`);
});



