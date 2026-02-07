import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all tenants for the organization (org-scoped)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT t.*, p.name as property_name, p.address as property_address
       FROM tenants t
       LEFT JOIN properties p ON t.property_id = p.id
       WHERE t.organization_id = $1
       ORDER BY t.created_at DESC`,
      [req.orgId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tenants:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single tenant (org-scoped)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT t.*, p.name as property_name, p.address as property_address
       FROM tenants t
       LEFT JOIN properties p ON t.property_id = p.id
       WHERE t.id = $1 AND t.organization_id = $2`,
      [req.params.id, req.orgId]
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
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      first_name, last_name, email, phone, property_id, unit, status, lease_start, lease_end
    } = req.body;

    const pool = req.app.locals.pool;
    const result = await pool.query(
      `INSERT INTO tenants 
       (user_id, first_name, last_name, email, phone, property_id, unit, status, lease_start, lease_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.userId, first_name, last_name, email, phone, property_id || null, unit, status || 'active', lease_start || null, lease_end || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating tenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update tenant
router.put('/:id', authenticateToken, async (req, res) => {
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
router.delete('/:id', authenticateToken, async (req, res) => {
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



