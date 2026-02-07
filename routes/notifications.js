import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get notifications for organization (org-scoped)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [req.orgId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create notification (org-scoped)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, message, type } = req.body;
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `INSERT INTO notifications (user_id, organization_id, title, message, type)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.userId, req.orgId, title, message, type || 'info']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
