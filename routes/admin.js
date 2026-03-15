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

// ── Billing: all subscriptions ────────────────────────────────────────────────

router.get('/billing', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.name, u.created_at AS joined_at,
             COALESCE(s.plan, 'free')             AS plan,
             COALESCE(s.status, 'active')         AS status,
             COALESCE(s.billing_cycle, 'monthly') AS billing_cycle,
             COALESCE(s.amount, 0)                AS amount,
             COALESCE(s.discount_percent, 0)      AS discount_percent,
             COALESCE(s.credit_balance, 0)        AS credit_balance,
             s.next_billing_date, s.trial_ends_at, s.notes, s.id AS sub_id
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id
      WHERE u.role NOT IN ('super_admin','tenant','contractor')
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin billing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Billing: update subscription for a landlord ───────────────────────────────

router.put('/billing/:userId/subscription', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { plan, status, billing_cycle, amount, discount_percent, next_billing_date, trial_ends_at, notes } = req.body;
  const userId = parseInt(req.params.userId, 10);
  try {
    await pool.query(`
      INSERT INTO subscriptions (user_id, plan, status, billing_cycle, amount, discount_percent, next_billing_date, trial_ends_at, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        plan              = EXCLUDED.plan,
        status            = EXCLUDED.status,
        billing_cycle     = EXCLUDED.billing_cycle,
        amount            = EXCLUDED.amount,
        discount_percent  = EXCLUDED.discount_percent,
        next_billing_date = EXCLUDED.next_billing_date,
        trial_ends_at     = EXCLUDED.trial_ends_at,
        notes             = EXCLUDED.notes,
        updated_at        = CURRENT_TIMESTAMP
    `, [userId, plan, status, billing_cycle, amount, discount_percent, next_billing_date || null, trial_ends_at || null, notes || null]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin update subscription error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Billing: apply credit ─────────────────────────────────────────────────────

router.post('/billing/:userId/credit', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { amount, reason } = req.body;
  const userId = parseInt(req.params.userId, 10);
  try {
    await pool.query(`
      INSERT INTO subscriptions (user_id, credit_balance, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        credit_balance = subscriptions.credit_balance + $2,
        updated_at     = CURRENT_TIMESTAMP
    `, [userId, parseFloat(amount)]);
    await pool.query(`
      INSERT INTO billing_adjustments (user_id, type, amount, reason, applied_by)
      VALUES ($1, 'credit', $2, $3, $4)
    `, [userId, parseFloat(amount), reason || null, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin apply credit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Billing: apply discount ───────────────────────────────────────────────────

router.post('/billing/:userId/discount', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { percent, reason } = req.body;
  const userId = parseInt(req.params.userId, 10);
  try {
    await pool.query(`
      INSERT INTO subscriptions (user_id, discount_percent, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        discount_percent = $2,
        updated_at       = CURRENT_TIMESTAMP
    `, [userId, parseInt(percent, 10)]);
    await pool.query(`
      INSERT INTO billing_adjustments (user_id, type, percent, reason, applied_by)
      VALUES ($1, 'discount', NULL, $2, $3)
    `, [userId, reason || null, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin apply discount error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Billing: invoices ─────────────────────────────────────────────────────────

router.get('/invoices', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT i.*, u.name AS landlord_name, u.email AS landlord_email
      FROM invoices i
      JOIN users u ON u.id = i.user_id
      ORDER BY i.created_at DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin invoices error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/invoices', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { user_id, amount, status, description, due_date } = req.body;
  try {
    const result = await pool.query(`
      INSERT INTO invoices (user_id, amount, status, description, due_date)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [user_id, parseFloat(amount), status || 'pending', description || null, due_date || null]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin create invoice error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/invoices/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { status, failure_reason } = req.body;
  try {
    const paid_at = status === 'paid' ? 'CURRENT_TIMESTAMP' : 'NULL';
    await pool.query(`
      UPDATE invoices SET status=$1, failure_reason=$2, paid_at=${paid_at} WHERE id=$3
    `, [status, failure_reason || null, parseInt(req.params.id, 10)]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin update invoice error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Billing: adjustments log ──────────────────────────────────────────────────

router.get('/billing/:userId/adjustments', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT ba.*, adm.name AS applied_by_name
      FROM billing_adjustments ba
      LEFT JOIN users adm ON adm.id = ba.applied_by
      WHERE ba.user_id = $1
      ORDER BY ba.created_at DESC
    `, [parseInt(req.params.userId, 10)]);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin adjustments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Usage analysis ────────────────────────────────────────────────────────────

router.get('/usage', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.name, u.created_at,
             COUNT(DISTINCT p.id)::int   AS properties,
             COUNT(DISTINCT t.id)::int   AS tenants,
             COUNT(DISTINCT mr.id)::int  AS maintenance_requests,
             COUNT(DISTINCT m.id)::int   AS messages,
             COUNT(DISTINCT tr.id)::int  AS transactions,
             GREATEST(
               MAX(p.created_at),
               MAX(t.created_at),
               MAX(mr.created_at),
               MAX(m.created_at),
               MAX(tr.created_at)
             ) AS last_activity
      FROM users u
      LEFT JOIN properties           p  ON p.user_id  = u.id
      LEFT JOIN tenants              t  ON t.user_id  = u.id
      LEFT JOIN maintenance_requests mr ON mr.property_id IN (SELECT id FROM properties WHERE user_id = u.id)
      LEFT JOIN messages             m  ON m.sender_user_id = u.id
      LEFT JOIN transactions         tr ON tr.user_id  = u.id
      WHERE u.role NOT IN ('super_admin','tenant','contractor')
      GROUP BY u.id
      ORDER BY properties DESC, tenants DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin usage error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── System health ─────────────────────────────────────────────────────────────

router.get('/system-health', authenticateToken, requireSuperAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const [dbPing, counts, recentErrors, activity] = await Promise.all([
      pool.query(`SELECT 1 AS ok`),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM users)                 AS total_users,
          (SELECT COUNT(*) FROM users WHERE role NOT IN ('super_admin','tenant','contractor')) AS landlords,
          (SELECT COUNT(*) FROM users WHERE role='tenant')  AS tenant_users,
          (SELECT COUNT(*) FROM tenants)               AS tenants,
          (SELECT COUNT(*) FROM properties)            AS properties,
          (SELECT COUNT(*) FROM maintenance_requests)  AS maintenance_requests,
          (SELECT COUNT(*) FROM messages)              AS messages,
          (SELECT COUNT(*) FROM transactions)          AS transactions,
          (SELECT COUNT(*) FROM invoices)              AS invoices
      `),
      pool.query(`
        SELECT COUNT(*) AS failed_invoices FROM invoices WHERE status='failed'
      `),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM users    WHERE created_at > NOW() - INTERVAL '30 days') AS new_users_30d,
          (SELECT COUNT(*) FROM tenants  WHERE created_at > NOW() - INTERVAL '30 days') AS new_tenants_30d,
          (SELECT COUNT(*) FROM maintenance_requests WHERE created_at > NOW() - INTERVAL '30 days') AS new_maintenance_30d,
          (SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '30 days') AS new_messages_30d
      `),
    ]);

    const mem = process.memoryUsage();
    res.json({
      db: { status: 'connected' },
      counts: counts.rows[0],
      failed_invoices: parseInt(recentErrors.rows[0].failed_invoices, 10),
      activity_30d: activity.rows[0],
      process: {
        uptime_seconds: Math.floor(process.uptime()),
        node_version: process.version,
        memory_mb: {
          rss:       Math.round(mem.rss / 1024 / 1024),
          heap_used: Math.round(mem.heapUsed / 1024 / 1024),
          heap_total:Math.round(mem.heapTotal / 1024 / 1024),
        },
        env: process.env.NODE_ENV || 'development',
      },
    });
  } catch (err) {
    console.error('Admin system-health error:', err);
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
