import express from 'express';
import jwt from 'jsonwebtoken';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

function requireSuperAdmin(req, res, next) {
  if ((req.role || '').toLowerCase() !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
}

// ── Stats overview ────────────────────────────────────────────────────────────

router.get('/stats', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const [landlords, tenants, properties] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM users WHERE role NOT IN ('super_admin','tenant','contractor')`),
      pool.query(`SELECT COUNT(*) FROM tenants`),
      pool.query(`SELECT COUNT(*) FROM properties`),
    ]);
    res.json({
      landlords: parseInt(landlords.rows[0].count, 10),
      tenants:   parseInt(tenants.rows[0].count, 10),
      properties: parseInt(properties.rows[0].count, 10),
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── All landlord accounts ─────────────────────────────────────────────────────

router.get('/landlords', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.name, u.role, u.created_at,
             COUNT(DISTINCT p.id)::int  AS property_count,
             COUNT(DISTINCT t.id)::int  AS tenant_count
      FROM users u
      LEFT JOIN properties p ON p.user_id = u.id
      LEFT JOIN tenants    t ON t.user_id = u.id
      WHERE u.role NOT IN ('super_admin','tenant','contractor')
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin landlords error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── All tenant portal accounts ────────────────────────────────────────────────

router.get('/tenants', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT t.id AS tenant_id, t.first_name, t.last_name, t.unit, t.status AS lease_status, t.created_at,
             u.id  AS user_id, u.email, u.name,
             p.name AS property_name,
             mgr.name AS manager_name, mgr.email AS manager_email
      FROM tenants t
      LEFT JOIN users      u   ON u.id = t.portal_user_id
      LEFT JOIN properties p   ON p.id = t.property_id
      LEFT JOIN users      mgr ON mgr.id = t.user_id
      ORDER BY t.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin tenants error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Impersonate a landlord ────────────────────────────────────────────────────
// Returns a short-lived token (2h) for the target user so admin can see their dashboard.

router.post('/impersonate/:userId', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const targetId = parseInt(req.params.userId, 10);
    const result = await pool.query(
      `SELECT id, email, name, role FROM users WHERE id = $1 AND role NOT IN ('super_admin')`,
      [targetId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or cannot impersonate' });
    }
    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, role: user.role, impersonatedBy: req.userId },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: 2 * 60 * 60 * 1000,
      path: '/',
    });
    res.json({ user });
  } catch (err) {
    console.error('Admin impersonate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete a user account ─────────────────────────────────────────────────────

router.delete('/users/:userId', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const targetId = parseInt(req.params.userId, 10);
    if (targetId === req.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const check = await pool.query(`SELECT role FROM users WHERE id = $1`, [targetId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (check.rows[0].role === 'super_admin') {
      return res.status(403).json({ error: 'Cannot delete another super admin' });
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [targetId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
