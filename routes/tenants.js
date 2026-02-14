import express from 'express';
import bcrypt from 'bcryptjs';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// All routes below require manager role (except invite which has its own requireRole)
// Get all tenants for user
router.get('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT t.*, p.name as property_name, p.address as property_address
       FROM tenants t
       LEFT JOIN properties p ON t.property_id = p.id
       WHERE t.user_id = $1
       ORDER BY t.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tenants:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Invite tenant to portal (manager only): create Tenant user and link to tenant record
router.post('/:id/invite', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const emailStr = (email || '').toString().trim();
    if (!emailStr || !EMAIL_REGEX.test(emailStr)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const pool = req.app.locals.pool;
    const tenantResult = await pool.query(
      'SELECT id, first_name, last_name, email, portal_user_id FROM tenants WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    const tenant = tenantResult.rows[0];
    if (tenant.portal_user_id) {
      return res.status(400).json({ error: 'This tenant already has a portal account' });
    }
    let userResult = await pool.query('SELECT id, role FROM users WHERE LOWER(email) = LOWER($1)', [emailStr]);
    let portalUser;
    if (userResult.rows.length > 0) {
      const existing = userResult.rows[0];
      if (existing.role && existing.role.toLowerCase() === 'tenant') {
        await pool.query('UPDATE tenants SET portal_user_id = $1 WHERE id = $2 AND user_id = $3', [existing.id, tenant.id, req.userId]);
        const u = await pool.query('SELECT id, email, name, role FROM users WHERE id = $1', [existing.id]);
        return res.json({ message: 'Tenant account already existed; linked to this tenant.', user: u.rows[0] });
      }
      return res.status(400).json({ error: 'A non-tenant account already exists with this email' });
    }
    const passwordHash = await bcrypt.hash(String(password), 10);
    const name = [tenant.first_name, tenant.last_name].filter(Boolean).join(' ') || emailStr;
    const insertUser = await pool.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'Tenant')
       RETURNING id, email, name, role`,
      [emailStr, passwordHash, name]
    );
    portalUser = insertUser.rows[0];
    await pool.query(
      'UPDATE tenants SET portal_user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3',
      [portalUser.id, tenant.id, req.userId]
    );
    res.status(201).json({
      message: 'Tenant invited. They can sign in with this email and password.',
      user: portalUser
    });
  } catch (error) {
    console.error('Invite tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single tenant
router.get('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT t.*, p.name as property_name, p.address as property_address
       FROM tenants t
       LEFT JOIN properties p ON t.property_id = p.id
       WHERE t.id = $1 AND t.user_id = $2`,
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching tenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create tenant
router.post('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const raw = req.body || {};
    const first_name = (raw.first_name || '').toString().trim();
    const last_name = (raw.last_name || '').toString().trim();
    const email = (raw.email || '').toString().trim() || null;
    const phone = (raw.phone || '').toString().trim() || null;
    let property_id = null;
    if (raw.property_id !== '' && raw.property_id != null && raw.property_id !== undefined) {
      const n = Number(raw.property_id);
      property_id = Number.isInteger(n) ? n : null;
    }
    const unit = (raw.unit || '').toString().trim() || null;
    const status = (raw.status || 'active').toString();
    const lease_start = raw.lease_start || null;
    const lease_end = raw.lease_end || null;

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }

    const pool = req.app.locals.pool;
    const result = await pool.query(
      `INSERT INTO tenants 
       (user_id, first_name, last_name, email, phone, property_id, unit, status, lease_start, lease_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.userId, first_name, last_name, email, phone, property_id, unit, status, lease_start, lease_end]
    );

    const row = result.rows[0];
    console.log('Tenant created:', row?.id, first_name, last_name);
    res.status(201).json(row);
  } catch (error) {
    console.error('Error creating tenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update tenant
router.put('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const {
      first_name, last_name, email, phone, property_id, unit, status, lease_start, lease_end
    } = req.body;

    const pool = req.app.locals.pool;
    const result = await pool.query(
      `UPDATE tenants 
       SET first_name = $1, last_name = $2, email = $3, phone = $4,
           property_id = $5, unit = $6, status = $7, lease_start = $8,
           lease_end = $9, updated_at = CURRENT_TIMESTAMP
       WHERE id = $10 AND user_id = $11
       RETURNING *`,
      [first_name, last_name, email, phone, property_id, unit, status, lease_start, lease_end, req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating tenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete tenant
router.delete('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'DELETE FROM tenants WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({ message: 'Tenant deleted successfully' });
  } catch (error) {
    console.error('Error deleting tenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



