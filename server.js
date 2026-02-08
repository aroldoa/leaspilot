import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
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

// Security middleware with per-request CSP nonce
app.use((req, res, next) => {
  // generate nonce for inline scripts on this request
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": [
        "'self'",
        "https://cdn.tailwindcss.com",
        "https://unpkg.com",
        (req, res) => `'nonce-${res.locals.cspNonce}'`
      ],
      "style-src": ["'self'", "https://cdn.tailwindcss.com", "'unsafe-inline'"],
      "img-src": [
        "'self'",
        "data:",
        "https://ik.imagekit.io",
        "https://images.unsplash.com",
        "https://hoirqrkdgbmvpwutwuwj.supabase.co"
      ],
      "font-src": ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      "connect-src": ["'self'"],
      "upgrade-insecure-requests": []
    }
  }
}));

// CORS configuration - restrict via ALLOWED_ORIGINS env var (comma-separated)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim());
app.use(cors({
  origin: function(origin, callback) {
    // allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: Origin not allowed'));
    }
  },
  credentials: true
}));

// Cookie parser
app.use(cookieParser());

// Basic rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX || '60', 10), // limit each IP
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Body size limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Serve static files
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
// Mount auth routes first (public): register/login/refresh/demo/logout/verify
app.use('/api/auth', authRoutes);

// Authentication middleware (attach req.user and req.activeOrg) for the rest of /api
import { authMiddleware } from './middleware/auth.js';
app.use('/api', authMiddleware);

app.use('/api/properties', propertyRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/users', userRoutes);

// Global error handler
import { errorHandler } from './middleware/error.js';
app.use(errorHandler);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'LeasePilot AI API is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 API available at http://localhost:${PORT}/api`);
});
