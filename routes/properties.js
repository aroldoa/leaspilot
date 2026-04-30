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

// Get all properties for user (owned + collaborated)
router.get('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT DISTINCT p.* FROM properties p
       WHERE p.user_id = $1
       UNION
       SELECT DISTINCT p.* FROM properties p
       JOIN property_collaborators pc ON pc.property_id = p.id AND pc.user_id = $1
       ORDER BY created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching properties:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single property (with units list)
router.get('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT * FROM properties WHERE id = $1 AND (
         user_id = $2 OR EXISTS (
           SELECT 1 FROM property_collaborators WHERE property_id = $1 AND user_id = $2
         )
       )`,
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const property = result.rows[0];
    const unitsResult = await pool.query(
      `SELECT id, unit_label, rent, display_order FROM property_units
       WHERE property_id = $1 ORDER BY display_order ASC, id ASC`,
      [req.params.id]
    );
    property.units = unitsResult.rows.map(u => ({ id: u.id, unit_label: u.unit_label, rent: u.rent }));
    if (property.number_of_units == null) property.number_of_units = 1;
    else property.number_of_units = Math.max(1, parseInt(property.number_of_units, 10) || 1);
    res.json(property);
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
      bedrooms, bathrooms, sqft, rent, image_url, status,
      number_of_units, units
    } = req.body;

    const pool = req.app.locals.pool;
    const numUnits = number_of_units != null ? parseInt(number_of_units, 10) : 1;
    const result = await pool.query(
      `INSERT INTO properties 
       (user_id, name, type, address, city, state, zip, bedrooms, bathrooms, sqft, rent, image_url, status, number_of_units)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [req.userId, name, type, address, city, state, zip, bedrooms || 0, bathrooms || 0, sqft || 0, rent || 0, image_url, status || 'vacant', isNaN(numUnits) ? 1 : Math.max(1, numUnits)]
    );

    const property = result.rows[0];
    const unitLabels = Array.isArray(units) ? units : (typeof units === 'string' && units ? units.split(',').map(s => s.trim()).filter(Boolean) : []);
    for (let i = 0; i < unitLabels.length; i++) {
      const label = String(unitLabels[i]).slice(0, 100);
      if (label) await pool.query(
        `INSERT INTO property_units (property_id, unit_label, display_order) VALUES ($1, $2, $3)`,
        [property.id, label, i]
      );
    }

    const unitsResult = await pool.query(
      `SELECT id, unit_label FROM property_units WHERE property_id = $1 ORDER BY display_order ASC, id ASC`,
      [property.id]
    );
    property.units = unitsResult.rows.map(u => ({ id: u.id, unit_label: u.unit_label }));
    res.status(201).json(property);
  } catch (error) {
    console.error('Error creating property:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update property
router.put('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const body = req.body || {};
    if (process.env.NODE_ENV !== 'production') {
      console.log('PUT /properties/:id body keys:', Object.keys(body), 'id=', req.params.id);
    }
    const name = body.name ?? '';
    const type = body.type ?? '';
    const address = body.address ?? '';
    const city = body.city ?? '';
    const state = body.state ?? '';
    const zip = body.zip ?? '';
    const bedrooms = body.bedrooms != null ? parseInt(body.bedrooms, 10) : 0;
    const bathrooms = body.bathrooms != null ? parseFloat(body.bathrooms) : 0;
    const sqft = body.sqft != null ? parseInt(body.sqft, 10) : 0;
    const rent = body.rent != null ? parseFloat(body.rent) : 0;
    const image_url = body.image_url ?? null;
    const status = body.status ?? 'vacant';
    const pool = req.app.locals.pool;
    const rawNumUnits = body.number_of_units;
    const numUnits = (rawNumUnits != null && rawNumUnits !== '') ? parseInt(rawNumUnits, 10) : 1;
    const safeNumUnits = (typeof numUnits === 'number' && !isNaN(numUnits) && numUnits >= 1) ? numUnits : 1;
    const units = body.units;

    const result = await pool.query(
      `UPDATE properties 
       SET name = $1, type = $2, address = $3, city = $4, state = $5, zip = $6,
           bedrooms = $7, bathrooms = $8, sqft = $9, rent = $10, image_url = $11,
           status = $12, number_of_units = $13, updated_at = CURRENT_TIMESTAMP
       WHERE id = $14 AND user_id = $15
       RETURNING *`,
      [name, type, address, city, state, zip, isNaN(bedrooms) ? 0 : bedrooms, isNaN(bathrooms) ? 0 : bathrooms, isNaN(sqft) ? 0 : sqft, isNaN(rent) ? 0 : rent, image_url, status, safeNumUnits, req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    // Replace property_units
    await pool.query('DELETE FROM property_units WHERE property_id = $1', [req.params.id]);
    const unitLabels = Array.isArray(units) ? units : (typeof units === 'string' && units ? units.split(',').map(s => s.trim()).filter(Boolean) : []);
    for (let i = 0; i < unitLabels.length; i++) {
      const label = String(unitLabels[i]).slice(0, 100);
      if (label) await pool.query(
        `INSERT INTO property_units (property_id, unit_label, display_order) VALUES ($1, $2, $3)`,
        [req.params.id, label, i]
      );
    }

    const property = result.rows[0];
    const unitsResult = await pool.query(
      `SELECT id, unit_label FROM property_units WHERE property_id = $1 ORDER BY display_order ASC, id ASC`,
      [req.params.id]
    );
    property.units = unitsResult.rows.map(u => ({ id: u.id, unit_label: u.unit_label }));
    property.number_of_units = safeNumUnits;
    res.json(property);
  } catch (error) {
    console.error('Error updating property:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/properties/:id/rent — update only the property-level rent
router.patch('/:id/rent', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  const pool = req.app.locals.pool;
  const propId = parseInt(req.params.id, 10);
  const rent = parseFloat(req.body.rent);
  if (isNaN(rent) || rent < 0) return res.status(400).json({ error: 'Invalid rent value' });
  try {
    const result = await pool.query(
      `UPDATE properties SET rent = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND (user_id = $3 OR EXISTS (
         SELECT 1 FROM property_collaborators WHERE property_id = $2 AND user_id = $3
       )) RETURNING id, rent`,
      [rent, propId, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /api/properties/:id/rent error:', err);
    res.status(500).json({ error: 'Failed to update rent' });
  }
});

// PATCH /api/properties/:id/units/:unitId — update rent for a single unit
router.patch('/:id/units/:unitId', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  const pool = req.app.locals.pool;
  const propId = parseInt(req.params.id, 10);
  const unitId = parseInt(req.params.unitId, 10);
  const rent = parseFloat(req.body.rent);
  if (isNaN(rent) || rent < 0) return res.status(400).json({ error: 'Invalid rent value' });
  try {
    const own = await pool.query(
      `SELECT id FROM properties WHERE id = $1 AND (user_id = $2 OR EXISTS (
         SELECT 1 FROM property_collaborators WHERE property_id = $1 AND user_id = $2
       ))`,
      [propId, req.userId]
    );
    if (own.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
    const result = await pool.query(
      `UPDATE property_units SET rent = $1 WHERE id = $2 AND property_id = $3 RETURNING id, unit_label, rent`,
      [rent, unitId, propId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Unit not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /api/properties/:id/units/:unitId error:', err);
    res.status(500).json({ error: 'Failed to update unit rent' });
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



