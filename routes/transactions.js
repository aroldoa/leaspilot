import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all transactions for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT t.*, p.name as property_name
       FROM transactions t
       LEFT JOIN properties p ON t.property_id = p.id
       WHERE t.user_id = $1
       ORDER BY t.transaction_date DESC, t.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single transaction
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT t.*, p.name as property_name
       FROM transactions t
       LEFT JOIN properties p ON t.property_id = p.id
       WHERE t.id = $1 AND t.user_id = $2`,
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create transaction
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      type, description, amount, category, property_id, transaction_date, status
    } = req.body;

    const pool = req.app.locals.pool;
    const result = await pool.query(
      `INSERT INTO transactions 
       (user_id, type, description, amount, category, property_id, transaction_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.userId, type, description, amount, category, property_id || null, transaction_date, status || 'cleared']
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update transaction
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const {
      type, description, amount, category, property_id, transaction_date, status
    } = req.body;

    const pool = req.app.locals.pool;
    const result = await pool.query(
      `UPDATE transactions 
       SET type = $1, description = $2, amount = $3, category = $4,
           property_id = $5, transaction_date = $6, status = $7,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [type, description, amount, category, property_id, transaction_date, status, req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete transaction
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

