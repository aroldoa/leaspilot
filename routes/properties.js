import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const propertyDocsDir = process.env.VERCEL === '1' || __dirname.startsWith('/var/task')
  ? path.join(os.tmpdir(), 'leasepilot-uploads', 'property-documents')
  : path.join(__dirname, '..', 'uploads', 'property-documents');

const propertyDocUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try { fs.mkdirSync(propertyDocsDir, { recursive: true }); } catch (e) {}
      cb(null, propertyDocsDir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase();
      const safe = /^[.a-z0-9]+$/i.test(ext) ? ext : '';
      const name = `prop-${req.params.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safe}`;
      cb(null, name);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Allowed: PDF, images (JPEG/PNG/GIF/WebP), or Word docs'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 }
}).single('file');

const router = express.Router();

// Get all properties for user (manager only)
router.get('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
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
router.get('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
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
router.post('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
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
router.put('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
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
router.delete('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
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

// Get property documents
router.get('/:id/documents', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const prop = await pool.query(
      'SELECT id FROM properties WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

    const result = await pool.query(
      `SELECT id, name, file_url, created_at FROM property_documents
       WHERE property_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching property documents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload property document (multipart/form-data with field "file")
router.post('/:id/documents', authenticateToken, requireRole('Portfolio Manager'), (req, res, next) => {
  propertyDocUpload(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File must be under 10MB' });
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const pool = req.app.locals.pool;
    const prop = await pool.query(
      'SELECT id FROM properties WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

    const name = (req.body && req.body.name && String(req.body.name).trim()) || req.file.originalname || 'Document';
    const fileUrl = '/uploads/property-documents/' + req.file.filename;
    const result = await pool.query(
      `INSERT INTO property_documents (property_id, name, file_url)
       VALUES ($1, $2, $3) RETURNING id, name, file_url, created_at`,
      [req.params.id, name.slice(0, 255), fileUrl]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error saving property document:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



