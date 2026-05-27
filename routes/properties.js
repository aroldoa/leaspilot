import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { getOwnerIds } from '../middleware/teamAccess.js';

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

// ── Plan limits ───────────────────────────────────────────────────────────────
// Free plan: max 1 property. Paid plans: max units across all properties.
const PLAN_UNIT_LIMITS  = { starter: 5, growth: 25, portfolio: 100 };
const OWNER_EMAIL = 'aroldo@investsupreme.com';

async function checkUnitLimit(pool, userId, incomingUnits, excludePropertyId = null) {
  const userResult = await pool.query(
    'SELECT email, plan FROM users WHERE id = $1',
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) return { allowed: false, error: 'User not found' };

  // Owner has no limit
  if (user.email.toLowerCase() === OWNER_EMAIL.toLowerCase()) return { allowed: true };

  const plan = (user.plan || 'free').toLowerCase();

  // Free plan: limited to 1 property
  if (plan === 'free' || plan === 'inactive') {
    const params = [userId];
    let sql = `SELECT COUNT(*)::int AS total FROM properties WHERE user_id = $1`;
    if (excludePropertyId) { sql += ` AND id != $2`; params.push(excludePropertyId); }
    const { rows } = await pool.query(sql, params);
    const propertyCount = rows[0].total;
    if (propertyCount >= 1) {
      return {
        allowed: false,
        error: 'The Free plan is limited to 1 property. Please upgrade to a paid plan in Settings → Billing to add more properties.',
      };
    }
    return { allowed: true };
  }

  // Paid plans: limited by total units
  const limit = PLAN_UNIT_LIMITS[plan];
  if (!limit) return { allowed: true }; // unknown plan — allow

  const params = [userId];
  let sql = `SELECT COALESCE(SUM(number_of_units), 0)::int AS total FROM properties WHERE user_id = $1`;
  if (excludePropertyId) { sql += ` AND id != $2`; params.push(excludePropertyId); }
  const { rows } = await pool.query(sql, params);
  const current = rows[0].total;

  if (current + incomingUnits > limit) {
    const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
    return {
      allowed: false,
      error: `Your ${planName} plan allows up to ${limit} units total. You currently have ${current} and are trying to add ${incomingUnits}. Please upgrade your plan in Settings → Billing.`,
    };
  }
  return { allowed: true };
}

// Get all properties for user (owned + collaborated)
router.get('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT * FROM properties WHERE user_id = ANY($1::int[]) ORDER BY created_at DESC`,
      [await getOwnerIds(pool, req.userId)]
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
    const ownerIds = await getOwnerIds(pool, req.userId);
    const result = await pool.query(
      `SELECT * FROM properties WHERE id = $1 AND user_id = ANY($2::int[])`,
      [req.params.id, ownerIds]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const property = result.rows[0];
    const numUnits = Math.max(1, parseInt(property.number_of_units, 10) || 1);
    property.number_of_units = numUnits;

    let unitsResult = await pool.query(
      `SELECT id, unit_label, rent, display_order FROM property_units
       WHERE property_id = $1 ORDER BY display_order ASC, id ASC`,
      [req.params.id]
    );

    // Auto-create unit rows for multi-unit properties that have none yet
    const isSingleFamily = /(single|house|sfr)/i.test(property.type || '');
    if (!isSingleFamily && numUnits > 1 && unitsResult.rows.length === 0) {
      for (let i = 0; i < numUnits; i++) {
        await pool.query(
          `INSERT INTO property_units (property_id, unit_label, display_order) VALUES ($1, $2, $3)
           ON CONFLICT (property_id, unit_label) DO NOTHING`,
          [req.params.id, `Unit ${i + 1}`, i]
        );
      }
      unitsResult = await pool.query(
        `SELECT id, unit_label, rent, display_order FROM property_units
         WHERE property_id = $1 ORDER BY display_order ASC, id ASC`,
        [req.params.id]
      );
    }

    property.units = unitsResult.rows.map(u => ({ id: u.id, unit_label: u.unit_label, rent: u.rent }));
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
    const safeNew = isNaN(numUnits) ? 1 : Math.max(1, numUnits);

    const limitCheck = await checkUnitLimit(pool, req.userId, safeNew);
    if (!limitCheck.allowed) return res.status(403).json({ error: limitCheck.error });

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
      `SELECT id, unit_label, rent FROM property_units WHERE property_id = $1 ORDER BY display_order ASC, id ASC`,
      [property.id]
    );
    property.units = unitsResult.rows.map(u => ({ id: u.id, unit_label: u.unit_label, rent: u.rent }));
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

    const limitCheck = await checkUnitLimit(pool, req.userId, safeNumUnits, req.params.id);
    if (!limitCheck.allowed) return res.status(403).json({ error: limitCheck.error });

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

    // Upsert property_units preserving per-unit rent
    const unitLabels = Array.isArray(units) ? units : (typeof units === 'string' && units ? units.split(',').map(s => s.trim()).filter(Boolean) : []);
    const safeLabels = unitLabels.map(u => String(u).slice(0, 100)).filter(Boolean);
    for (let i = 0; i < safeLabels.length; i++) {
      await pool.query(
        `INSERT INTO property_units (property_id, unit_label, display_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (property_id, unit_label) DO UPDATE SET display_order = EXCLUDED.display_order`,
        [req.params.id, safeLabels[i], i]
      );
    }
    // Remove units no longer in the list
    if (safeLabels.length > 0) {
      await pool.query(
        `DELETE FROM property_units WHERE property_id = $1 AND unit_label != ALL($2::text[])`,
        [req.params.id, safeLabels]
      );
    } else {
      await pool.query('DELETE FROM property_units WHERE property_id = $1', [req.params.id]);
    }

    const property = result.rows[0];
    const unitsResult = await pool.query(
      `SELECT id, unit_label, rent FROM property_units WHERE property_id = $1 ORDER BY display_order ASC, id ASC`,
      [req.params.id]
    );
    property.units = unitsResult.rows.map(u => ({ id: u.id, unit_label: u.unit_label, rent: u.rent }));
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
       WHERE id = $2 AND user_id = ANY($3::int[]) RETURNING id, rent`,
      [rent, propId, await getOwnerIds(pool, req.userId)]
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
      `SELECT id FROM properties WHERE id = $1 AND user_id = ANY($2::int[])`,
      [propId, await getOwnerIds(pool, req.userId)]
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

// GET /api/properties/:id/notes
router.get('/:id/notes', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const ownerIds = await getOwnerIds(pool, req.userId);
    const prop = await pool.query('SELECT id FROM properties WHERE id = $1 AND user_id = ANY($2::int[])', [req.params.id, ownerIds]);
    if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
    const result = await pool.query(
      `SELECT id, content, note_type, reminder_date, is_pinned, created_at, updated_at
       FROM property_notes WHERE property_id = $1
       ORDER BY is_pinned DESC, created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/properties/:id/notes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/properties/:id/notes
router.post('/:id/notes', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const ownerIds = await getOwnerIds(pool, req.userId);
    const prop = await pool.query('SELECT id FROM properties WHERE id = $1 AND user_id = ANY($2::int[])', [req.params.id, ownerIds]);
    if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
    const content = (req.body.content || '').toString().trim();
    if (!content) return res.status(400).json({ error: 'Content is required' });
    const note_type = ['note', 'reminder', 'todo'].includes(req.body.note_type) ? req.body.note_type : 'note';
    const reminder_date = req.body.reminder_date || null;
    const result = await pool.query(
      `INSERT INTO property_notes (property_id, user_id, content, note_type, reminder_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, req.userId, content, note_type, reminder_date]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/properties/:id/notes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/properties/:id/notes/:noteId
router.patch('/:id/notes/:noteId', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const fields = [];
    const vals = [];
    let idx = 1;
    if (req.body.content !== undefined) { fields.push(`content = $${idx++}`); vals.push(req.body.content); }
    if (req.body.note_type !== undefined) { fields.push(`note_type = $${idx++}`); vals.push(req.body.note_type); }
    if (req.body.reminder_date !== undefined) { fields.push(`reminder_date = $${idx++}`); vals.push(req.body.reminder_date || null); }
    if (req.body.is_pinned !== undefined) { fields.push(`is_pinned = $${idx++}`); vals.push(!!req.body.is_pinned); }
    if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    vals.push(req.params.noteId, req.userId);
    const result = await pool.query(
      `UPDATE property_notes SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx++} RETURNING *`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /api/properties/:id/notes/:noteId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/properties/:id/notes/:noteId
router.delete('/:id/notes/:noteId', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'DELETE FROM property_notes WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.noteId, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/properties/:id/notes/:noteId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



