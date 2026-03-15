import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// Password must be ≥8 chars, contain at least one uppercase letter and one digit
function isStrongPassword(pw) {
  return pw.length >= MIN_PASSWORD_LENGTH && /[A-Z]/.test(pw) && /[0-9]/.test(pw);
}

function ensureJwtSecret(res) {
  if (!process.env.JWT_SECRET) {
    res.status(500).json({ error: 'Server misconfiguration' });
    return false;
  }
  return true;
}

function cookieOpts(req) {
  // Use HTTPS-based detection so the secure flag is accurate even when
  // NODE_ENV=production but the server is behind a plain-HTTP reverse proxy
  // or being tested locally.
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  };
}

function issueToken(user, jwtSecret) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role || 'Portfolio Manager' },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

// Strict rate limiters for auth endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many accounts created. Try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many demo requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Register
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { email, password, name, company } = req.body;
    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || !isStrongPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and contain an uppercase letter and a number' });
    }
    const pool = req.app.locals.pool;

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, created_at`,
      [email.trim().toLowerCase(), passwordHash, (name || '').trim(), 'Portfolio Manager']
    );

    const user = result.rows[0];
    if (!ensureJwtSecret(res)) return;
    const token = issueToken(user, process.env.JWT_SECRET);

    res.cookie('token', token, cookieOpts(req));
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const rawEmail = (req.body.email || '').toString().trim();
    const password = (req.body.password ?? '').toString();
    if (!rawEmail || !EMAIL_REGEX.test(rawEmail)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    const pool = req.app.locals.pool;

    const result = await pool.query(
      'SELECT id, email, password_hash, name, role FROM users WHERE LOWER(email) = LOWER($1)',
      [rawEmail]
    );

    // Always use the same error message to prevent user enumeration
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!ensureJwtSecret(res)) return;
    const token = issueToken(user, process.env.JWT_SECRET);

    res.cookie('token', token, cookieOpts(req));
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Demo login — only enabled when ENABLE_DEMO=true
router.post('/demo', demoLimiter, async (req, res) => {
  if (process.env.ENABLE_DEMO !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const pool = req.app.locals.pool;
    const demoEmail = 'demo@leasepilot.ai';

    let result = await pool.query(
      'SELECT id, email, name, role FROM users WHERE email = $1',
      [demoEmail]
    );

    let user;
    if (result.rows.length === 0) {
      const passwordHash = await bcrypt.hash(process.env.DEMO_PASSWORD || 'ChangeMe123!', 12);
      const createResult = await pool.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, role`,
        [demoEmail, passwordHash, 'Demo User', 'Portfolio Manager']
      );
      user = createResult.rows[0];
    } else {
      user = result.rows[0];
    }

    if (!ensureJwtSecret(res)) return;
    const token = issueToken(user, process.env.JWT_SECRET);

    res.cookie('token', token, cookieOpts(req));
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    console.error('Demo login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout — clears the auth cookie
router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
});

// Verify token (reads from cookie or Authorization header)
router.get('/verify', async (req, res) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'Server misconfiguration' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const pool = req.app.locals.pool;

    const result = await pool.query(
      'SELECT id, email, name, role, avatar_url FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
