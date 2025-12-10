import express from 'express';
import bcrypt from 'bcryptjs';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
router.put('/me', authenticateToken, async (req, res) => {
  try {
    const { name, email } = req.body;
    const pool = req.app.locals.pool;

    // Check if email is already taken by another user
    if (email) {
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, req.userId]
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    }

    const result = await pool.query(
      `UPDATE users 
       SET name = COALESCE($1, name), 
           email = COALESCE($2, email),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, email, name, role`,
      [name, email, req.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
router.put('/me/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const pool = req.app.locals.pool;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    // Get current password hash
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, req.userId]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user account
router.delete('/me', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

