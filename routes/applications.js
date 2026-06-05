/**
 * Landlord rental-application management routes.
 * All routes require authentication.
 *
 * GET  /api/applications                          → list all apps for this landlord
 * GET  /api/applications/:id                      → single application detail
 * PUT  /api/applications/:id/status               → update review status
 * GET  /api/applications/listing/:propertyId      → get/create listing for a property
 * PUT  /api/applications/listing/:propertyId      → update listing (fee / active)
 * POST /api/applications/listing/:propertyId/regenerate → new token (invalidates old link)
 */
import express from 'express';
import crypto from 'crypto';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// ── Listing management ────────────────────────────────────────────────────────

// Get (or auto-create) listing for a property
router.get('/listing/:propertyId', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const prop = await pool.query(
      `SELECT id, name FROM properties WHERE id = $1 AND user_id = $2`,
      [req.params.propertyId, req.userId]
    );
    if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

    let listing = await pool.query(
      `SELECT * FROM property_listings WHERE property_id = $1`,
      [req.params.propertyId]
    );

    if (listing.rows.length === 0) {
      const token = crypto.randomBytes(32).toString('hex');
      listing = await pool.query(
        `INSERT INTO property_listings (property_id, token) VALUES ($1, $2) RETURNING *`,
        [req.params.propertyId, token]
      );
    }

    res.json(listing.rows[0]);
  } catch (err) {
    console.error('Get listing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update listing settings (fee, active)
router.put('/listing/:propertyId', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  const pool = req.app.locals.pool;
  const { application_fee, is_active } = req.body;
  try {
    const prop = await pool.query(
      `SELECT id FROM properties WHERE id = $1 AND user_id = $2`,
      [req.params.propertyId, req.userId]
    );
    if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

    const result = await pool.query(
      `UPDATE property_listings SET application_fee = $1, is_active = $2, updated_at = NOW()
       WHERE property_id = $3 RETURNING *`,
      [application_fee, is_active, req.params.propertyId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Listing not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update listing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Regenerate shareable token (old link stops working)
router.post('/listing/:propertyId/regenerate', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const prop = await pool.query(
      `SELECT id FROM properties WHERE id = $1 AND user_id = $2`,
      [req.params.propertyId, req.userId]
    );
    if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

    const token = crypto.randomBytes(32).toString('hex');
    const result = await pool.query(
      `UPDATE property_listings SET token = $1, updated_at = NOW()
       WHERE property_id = $2 RETURNING *`,
      [token, req.params.propertyId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Listing not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Regenerate token error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Application review ────────────────────────────────────────────────────────

// List all applications across this landlord's properties
router.get('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT ra.id, ra.first_name, ra.last_name, ra.email, ra.phone,
             ra.employer, ra.monthly_income, ra.employment_status,
             ra.move_in_date, ra.num_occupants, ra.has_pets,
             ra.application_fee, ra.payment_status, ra.status,
             ra.submitted_at,
             p.name AS property_name, p.address, p.city, p.state
      FROM rental_applications ra
      JOIN properties p ON p.id = ra.property_id
      WHERE p.user_id = $1
      ORDER BY ra.submitted_at DESC
    `, [req.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('List applications error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Single application full detail
router.get('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT ra.*, p.name AS property_name, p.address, p.city, p.state
      FROM rental_applications ra
      JOIN properties p ON p.id = ra.property_id
      WHERE ra.id = $1 AND p.user_id = $2
    `, [req.params.id, req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Application not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get application error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update review status
router.put('/:id/status', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  const pool = req.app.locals.pool;
  const { status } = req.body;
  const valid = ['submitted', 'under_review', 'approved', 'denied'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  try {
    const result = await pool.query(`
      UPDATE rental_applications ra
      SET status = $1, updated_at = NOW()
      FROM properties p
      WHERE ra.id = $2 AND ra.property_id = p.id AND p.user_id = $3
      RETURNING ra.*
    `, [status, req.params.id, req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Application not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
