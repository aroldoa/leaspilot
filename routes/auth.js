import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { Resend } from 'resend';

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

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many reset requests. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

async function sendResetEmail(toEmail, resetUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'LeasePilot <no-reply@leasepilotai.com>';

  if (!apiKey) {
    console.log(`\n🔑 [DEV] Password reset link for ${toEmail}:\n   ${resetUrl}\n`);
    return;
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: toEmail,
    subject: 'Reset your LeasePilot password',
    text: `You requested a password reset.\n\nClick the link below to set a new password (expires in 1 hour):\n\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <img src="https://ik.imagekit.io/primo/Primo%20Motif/leasepilot-logo.svg" alt="LeasePilot" style="height:36px;margin-bottom:24px">
        <h2 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 8px">Reset your password</h2>
        <p style="font-size:14px;color:#64748b;margin:0 0 24px">Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:500">Reset password</a>
        <p style="font-size:12px;color:#94a3b8;margin:24px 0 0">If you didn't request this, you can safely ignore this email.</p>
      </div>`,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
  console.log(`✅ Reset email sent to ${toEmail} (id: ${data?.id})`);
}

// Register
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;
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
    const demoEmail = 'demo@leasepilotai.com';

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

// Forgot password — generate a reset token and email it
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const rawEmail = (req.body.email || '').toString().trim().toLowerCase();
  if (!rawEmail || !EMAIL_REGEX.test(rawEmail)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  // Always return 200 to avoid user enumeration
  res.json({ ok: true });

  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'SELECT id, email FROM users WHERE LOWER(email) = $1',
      [rawEmail]
    );
    if (result.rows.length === 0) return; // no such user — silently do nothing

    const user = result.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate any existing tokens for this user
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const resetUrl = `${proto}://${host}/reset-password.html?token=${token}`;
    await sendResetEmail(user.email, resetUrl);
  } catch (err) {
    console.error('Forgot-password error:', err);
  }
});

// Reset password — validate token and set new password
router.post('/reset-password', resetLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: 'Invalid or missing token' });
  }
  if (!password || !isStrongPassword(String(password))) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters and include an uppercase letter and a number` });
  }

  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT prt.user_id, prt.expires_at
       FROM password_reset_tokens prt
       WHERE prt.token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Reset link is invalid or has already been used' });
    }

    const row = result.rows[0];
    if (new Date(row.expires_at) < new Date()) {
      await pool.query('DELETE FROM password_reset_tokens WHERE token = $1', [token]);
      return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, row.user_id]
    );
    await pool.query('DELETE FROM password_reset_tokens WHERE token = $1', [token]);

    res.json({ ok: true });
  } catch (err) {
    console.error('Reset-password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
