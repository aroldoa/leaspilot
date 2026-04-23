import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/mortgages — all mortgages for the authenticated user (with property info)
router.get('/', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT pm.*, p.name AS property_name, p.rent AS monthly_rent, p.status AS property_status
      FROM property_mortgages pm
      JOIN properties p ON p.id = pm.property_id
      WHERE p.user_id = $1
      ORDER BY p.name
    `, [req.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/mortgages error:', err);
    res.status(500).json({ error: 'Failed to load mortgages' });
  }
});

// GET /api/mortgages/:propertyId — mortgage for a specific property
router.get('/:propertyId', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const propId = parseInt(req.params.propertyId, 10);
  if (!propId) return res.status(400).json({ error: 'Invalid property ID' });
  try {
    // Verify ownership
    const own = await pool.query(`SELECT id FROM properties WHERE id = $1 AND user_id = $2`, [propId, req.userId]);
    if (own.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

    const result = await pool.query(`SELECT * FROM property_mortgages WHERE property_id = $1`, [propId]);
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('GET /api/mortgages/:propertyId error:', err);
    res.status(500).json({ error: 'Failed to load mortgage' });
  }
});

// POST /api/mortgages/:propertyId — create or update mortgage (upsert)
router.post('/:propertyId', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const propId = parseInt(req.params.propertyId, 10);
  if (!propId) return res.status(400).json({ error: 'Invalid property ID' });

  const { lender_name, loan_amount, monthly_payment, interest_rate, loan_start_date, loan_term_years, escrow_amount, notes } = req.body;

  try {
    // Verify ownership
    const own = await pool.query(`SELECT id FROM properties WHERE id = $1 AND user_id = $2`, [propId, req.userId]);
    if (own.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

    const result = await pool.query(`
      INSERT INTO property_mortgages
        (property_id, lender_name, loan_amount, monthly_payment, interest_rate, loan_start_date, loan_term_years, escrow_amount, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      ON CONFLICT (property_id) DO UPDATE SET
        lender_name     = EXCLUDED.lender_name,
        loan_amount     = EXCLUDED.loan_amount,
        monthly_payment = EXCLUDED.monthly_payment,
        interest_rate   = EXCLUDED.interest_rate,
        loan_start_date = EXCLUDED.loan_start_date,
        loan_term_years = EXCLUDED.loan_term_years,
        escrow_amount   = EXCLUDED.escrow_amount,
        notes           = EXCLUDED.notes,
        updated_at      = NOW()
      RETURNING *
    `, [propId, lender_name || null, loan_amount || 0, monthly_payment || 0, interest_rate || 0, loan_start_date || null, loan_term_years || 30, escrow_amount || 0, notes || null]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/mortgages/:propertyId error:', err);
    res.status(500).json({ error: 'Failed to save mortgage' });
  }
});

// DELETE /api/mortgages/:propertyId — remove mortgage record
router.delete('/:propertyId', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const propId = parseInt(req.params.propertyId, 10);
  if (!propId) return res.status(400).json({ error: 'Invalid property ID' });
  try {
    const own = await pool.query(`SELECT id FROM properties WHERE id = $1 AND user_id = $2`, [propId, req.userId]);
    if (own.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
    await pool.query(`DELETE FROM property_mortgages WHERE property_id = $1`, [propId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/mortgages/:propertyId error:', err);
    res.status(500).json({ error: 'Failed to delete mortgage' });
  }
});

export default router;
