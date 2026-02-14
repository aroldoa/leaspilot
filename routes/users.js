import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectAvatarDir = path.join(__dirname, '..', 'uploads', 'avatars');
const tmpAvatarDir = path.join(os.tmpdir(), 'leasepilot-uploads', 'avatars');
const isServerless = __dirname.startsWith('/var/task') || process.env.VERCEL === '1';
let avatarDir = tmpAvatarDir;
if (!isServerless) {
  try {
    fs.mkdirSync(projectAvatarDir, { recursive: true });
    avatarDir = projectAvatarDir;
  } catch (err) {
    try {
      fs.mkdirSync(tmpAvatarDir, { recursive: true });
    } catch (e) {}
  }
} else {
  try {
    fs.mkdirSync(tmpAvatarDir, { recursive: true });
  } catch (e) {}
}

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        fs.mkdirSync(avatarDir, { recursive: true });
      } catch (e) {}
      cb(null, avatarDir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase();
      const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const safe = allowed.includes(ext) ? ext : '.jpg';
      cb(null, `user-${req.userId}-${Date.now()}${safe}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, GIF or WebP images allowed (max 2MB)'), false);
  },
  limits: { fileSize: 2 * 1024 * 1024 }
}).single('avatar');

const router = express.Router();

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'SELECT id, email, name, role, avatar_url, created_at FROM users WHERE id = $1',
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
       RETURNING id, email, name, role, avatar_url`,
      [name || null, email || null, req.userId]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload profile avatar (multipart: field name "avatar")
router.post('/me/avatar', authenticateToken, (req, res, next) => {
  avatarUpload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }
    const pool = req.app.locals.pool;
    const avatarUrl = '/uploads/avatars/' + req.file.filename;
    await pool.query(
      'UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [avatarUrl, req.userId]
    );
    const result = await pool.query(
      'SELECT id, email, name, role, avatar_url FROM users WHERE id = $1',
      [req.userId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving avatar:', error);
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



