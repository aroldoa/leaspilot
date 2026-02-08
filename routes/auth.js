import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Utility - set access token cookie
function setAccessCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('access_token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000 // 15 minutes
  });
}

// Utility - set refresh token cookie
function setRefreshCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
}

import { registerSchema, loginSchema } from './auth.validation.js';

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, company } = req.body;
    // Validate input
    try {
      registerSchema.parse({ email, password, name });
    } catch (e) {
      return res.status(400).json({ error: 'Invalid input', details: e.errors });
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
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, created_at`,
      [email, passwordHash, name, 'Portfolio Manager']
    );

    const user = result.rows[0];

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '30d' }
    );

    // Store refresh token in DB
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, refreshToken]
    );

    // Set cookies (access + refresh as httpOnly)
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    res.json({
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
    const { email, password } = req.body;
    try {
      loginSchema.parse({ email, password });
    } catch (e) {
      return res.status(400).json({ error: 'Invalid input', details: e.errors });
    }
    const pool = req.app.locals.pool;

    // Find user
    const result = await pool.query(
      'SELECT id, email, password_hash, name, role FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '30d' }
    );

    // Store refresh token in DB
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, refreshToken]
    );

    // Set cookies (access + refresh as httpOnly)
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    res.json({
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
      const passwordHash = await bcrypt.hash('demo123', 12);
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

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '30d' }
    );

    // Store refresh token in DB (ignore errors if exists)
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days') ON CONFLICT DO NOTHING`,
      [user.id, refreshToken]
    );

    // Set cookies (access + refresh as httpOnly)
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    res.json({
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

// Refresh token endpoint (reads refresh cookie, rotates tokens)
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) return res.status(400).json({ error: 'No refresh token provided' });

    const pool = req.app.locals.pool;
    const result = await pool.query(
      'SELECT id, user_id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [refreshToken]
    );

    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid refresh token' });

    const tokenRow = result.rows[0];
    const userId = tokenRow.user_id;

    // Rotate refresh token: delete old, create new
    await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenRow.id]);

    const newRefreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [userId, newRefreshToken]
    );

    const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, newRefreshToken);

    res.json({ ok: true });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const refreshToken = req.cookies?.refresh_token;
    if (refreshToken) {
      await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }

    // Clear cookies
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.json({ ok: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify token (reads cookie)
router.get('/verify', async (req, res) => {
  try {
    const token = req.cookies?.access_token;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
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
