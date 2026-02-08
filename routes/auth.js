import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function ensureJwtSecret(res) {
  if (!process.env.JWT_SECRET) {
    res.status(500).json({ error: 'Server misconfiguration' });
    return false;
  }
  return true;
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, company } = req.body;
    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const pool = req.app.locals.pool;

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, created_at`,
      [email, passwordHash, name, 'Portfolio Manager']
    );

    const user = result.rows[0];

    if (!ensureJwtSecret(res)) return;
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const rawEmail = (req.body.email || '').toString().trim();
    const password = (req.body.password ?? '').toString().trim();
    if (!rawEmail || !EMAIL_REGEX.test(rawEmail)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    const pool = req.app.locals.pool;

    // Find user (case-insensitive email so Demo@x.com and demo@x.com both work)
    const result = await pool.query(
      'SELECT id, email, password_hash, name, role FROM users WHERE LOWER(email) = LOWER($1)',
      [rawEmail]
    );

    const isDev = process.env.NODE_ENV !== 'production';
    if (result.rows.length === 0) {
      return res.status(401).json({
        error: isDev ? 'No account found with this email. Sign up first or use the correct site (local vs production use different databases).' : 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    // Verify password (compare with trimmed password)
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({
        error: isDev ? 'Wrong password.' : 'Invalid credentials'
      });
    }

    if (!ensureJwtSecret(res)) return;
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Demo login (creates demo user if doesn't exist)
router.post('/demo', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const demoEmail = 'demo@leasepilot.ai';

    // Check if demo user exists
    let result = await pool.query(
      'SELECT id, email, name, role FROM users WHERE email = $1',
      [demoEmail]
    );

    let user;
    if (result.rows.length === 0) {
      // Create demo user
      const passwordHash = await bcrypt.hash('demo123', 10);
      const createResult = await pool.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, role`,
        [demoEmail, passwordHash, 'Sarah Jenkins', 'Portfolio Manager']
      );
      user = createResult.rows[0];
    } else {
      user = result.rows[0];
    }

    if (!ensureJwtSecret(res)) return;
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Demo login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify token
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'Server misconfiguration' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const pool = req.app.locals.pool;

    const result = await pool.query(
      'SELECT id, email, name, role FROM users WHERE id = $1',
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



