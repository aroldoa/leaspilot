import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all properties for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT * FROM properties 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching properties:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single property
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT * FROM properties 
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create property
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      name, type, address, city, state, zip,
      bedrooms, bathrooms, sqft, rent, image_url, status
    } = req.body;

    const pool = req.app.locals.pool;
    const result = await pool.query(
      `INSERT INTO properties 
       (user_id, name, type, address, city, state, zip, bedrooms, bathrooms, sqft, rent, image_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [req.userId, name, type, address, city, state, zip, bedrooms || 0, bathrooms || 0, sqft || 0, rent || 0, image_url, status || 'vacant']
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating property:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update property
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const {
      name, type, address, city, state, zip,
      bedrooms, bathrooms, sqft, rent, image_url, status
    } = req.body;

    const pool = req.app.locals.pool;
    const result = await pool.query(
      `UPDATE properties 
       SET name = $1, type = $2, address = $3, city = $4, state = $5, zip = $6,
           bedrooms = $7, bathrooms = $8, sqft = $9, rent = $10, image_url = $11,
           status = $12, updated_at = CURRENT_TIMESTAMP
       WHERE id = $13 AND user_id = $14
       RETURNING *`,
      [name, type, address, city, state, zip, bedrooms, bathrooms, sqft, rent, image_url, status, req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating property:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete property
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'DELETE FROM properties WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    res.json({ message: 'Property deleted successfully' });
  } catch (error) {
    console.error('Error deleting property:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



