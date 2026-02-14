import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// List contractors for the logged-in manager
router.get('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT id, name, company, phone, email, specialty, created_at
       FROM contractors
       WHERE user_id = $1
       ORDER BY name`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching contractors:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create contractor
router.post('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const { name, company, phone, email, specialty } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `INSERT INTO contractors (user_id, name, company, phone, email, specialty)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, company, phone, email, specialty, created_at`,
      [
        req.userId,
        String(name).trim(),
        company ? String(company).trim() : null,
        phone ? String(phone).trim() : null,
        email ? String(email).trim() : null,
        specialty ? String(specialty).trim() : null
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating contractor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update contractor
router.patch('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid contractor ID' });
    const { name, company, phone, email, specialty } = req.body || {};
    const pool = req.app.locals.pool;
    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name ? String(name).trim() : null);
    }
    if (company !== undefined) {
      updates.push(`company = $${idx++}`);
      values.push(company ? String(company).trim() : null);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${idx++}`);
      values.push(phone ? String(phone).trim() : null);
    }
    if (email !== undefined) {
      updates.push(`email = $${idx++}`);
      values.push(email ? String(email).trim() : null);
    }
    if (specialty !== undefined) {
      updates.push(`specialty = $${idx++}`);
      values.push(specialty ? String(specialty).trim() : null);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Provide at least one field to update' });
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, req.userId);
    const result = await pool.query(
      `UPDATE contractors SET ${updates.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1}
       RETURNING id, name, company, phone, email, specialty, updated_at`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Contractor not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating contractor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete contractor
router.delete('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid contractor ID' });
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'DELETE FROM contractors WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Contractor not found' });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting contractor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
