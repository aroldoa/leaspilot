import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', 'uploads', 'maintenance');
fs.mkdirSync(uploadDir, { recursive: true });

const maintenanceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase();
      const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const safe = allowed.includes(ext) ? ext : '.jpg';
      const name = `${req.tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safe}`;
      cb(null, name);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images (JPEG, PNG, GIF, WebP) are allowed'), false);
  },
  limits: { fileSize: 5 * 1024 * 1024 }
}).array('photos', 6);

const router = express.Router();

// All tenant routes: authenticate then require tenant record
router.use(authenticateToken, (req, res, next) => {
  requireTenant(req, res, next).catch(next);
});

// GET /api/tenant/profile - own user + tenant info
router.get('/profile', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userResult = await pool.query(
      'SELECT id, email, name, role, avatar_url, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      user: userResult.rows[0],
      tenant: req.tenant
    });
  } catch (error) {
    console.error('Tenant profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tenant/lease - lease summary (tenant record + property address/rent)
router.get('/lease', (req, res) => {
  const t = req.tenant;
  // Explicitly map so frontend always gets property_* and numeric rent (pg may return decimals as strings)
  const rentRaw = t.property_rent ?? t.propertyRent;
  res.json({
    id: t.id,
    property_id: t.property_id,
    unit: t.unit,
    first_name: t.first_name,
    last_name: t.last_name,
    email: t.email,
    phone: t.phone,
    lease_start: t.lease_start,
    lease_end: t.lease_end,
    status: t.status,
    balance: t.balance != null ? parseFloat(t.balance) : 0,
    property_name: t.property_name ?? t.propertyName ?? null,
    property_address: t.property_address ?? t.propertyAddress ?? null,
    property_city: t.property_city ?? t.propertyCity ?? null,
    property_state: t.property_state ?? t.propertyState ?? null,
    property_zip: t.property_zip ?? t.propertyZip ?? null,
    property_rent: rentRaw != null && rentRaw !== '' ? parseFloat(rentRaw) : null
  });
});

// GET /api/tenant/balance - rent balance
router.get('/balance', (req, res) => {
  const balance = parseFloat(req.tenant.balance) || 0;
  res.json({ balance, currency: 'USD' });
});

// GET /api/tenant/payments - payment history (placeholder: no tenant_payments table yet)
router.get('/payments', async (req, res) => {
  try {
    // Could join with transactions for this property/tenant later; for now empty
    res.json([]);
  } catch (error) {
    console.error('Tenant payments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tenant/pay - stub for "pay rent" (no payment processor)
router.post('/pay', (req, res) => {
  res.status(501).json({ message: 'Online payment coming soon. Please pay by check or contact your property manager.' });
});

// GET /api/tenant/maintenance - my maintenance requests (with assigned contractor when set)
router.get('/maintenance', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    // #region agent log
    fetch('http://127.0.0.1:7249/ingest/883d00fc-6419-4636-bf2d-d40db9bb5ee7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hypothesisId:'H1,H4',location:'tenant.js:GET/maintenance',message:'Tenant maintenance GET entry',data:{tenantId:req.tenantId},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const result = await pool.query(
      `SELECT mr.id, mr.subject, mr.description, mr.status, mr.priority, mr.issue_type, mr.photo_urls,
              mr.assigned_contractor_id, mr.created_at, mr.updated_at,
              c.name AS contractor_name, c.company AS contractor_company, c.phone AS contractor_phone, c.email AS contractor_email
       FROM maintenance_requests mr
       LEFT JOIN contractors c ON c.id = mr.assigned_contractor_id
       WHERE mr.tenant_id = $1
       ORDER BY mr.created_at DESC`,
      [req.tenantId]
    );
    const rawRows = result.rows || [];
    // #region agent log
    fetch('http://127.0.0.1:7249/ingest/883d00fc-6419-4636-bf2d-d40db9bb5ee7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hypothesisId:'H1',location:'tenant.js:GET/maintenance',message:'Tenant maintenance raw DB rows',data:{rowCount:rawRows.length,sample:rawRows[0]?{id:rawRows[0].id,assigned_contractor_id:rawRows[0].assigned_contractor_id,contractor_name:rawRows[0].contractor_name}:null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // Build each row explicitly so assignment/contractor fields are always in the JSON (no reliance on spread/pg row shape)
    const rows = rawRows.map((r) => {
      const aid = r.assigned_contractor_id;
      const assignedId = aid != null && aid !== '' ? parseInt(aid, 10) : null;
      const hasAssignment = Number.isInteger(assignedId);
      const contractorName = r.contractor_name != null ? String(r.contractor_name).trim() : null;
      // So tenant sees correct status even if client only gets core fields: put "assigned" in status and contractor in description
      const status = hasAssignment ? 'assigned' : (r.status || 'open');
      const desc = r.description || '';
      const assignedLine = hasAssignment && contractorName ? `\n\n[Assigned to: ${contractorName}]` : '';
      return {
        id: r.id,
        subject: r.subject,
        description: desc + assignedLine,
        status,
        priority: r.priority,
        issue_type: r.issue_type,
        photo_urls: r.photo_urls,
        created_at: r.created_at,
        updated_at: r.updated_at,
        assigned_contractor_id: hasAssignment ? assignedId : null,
        contractor_name: contractorName,
        contractor_company: r.contractor_company != null ? String(r.contractor_company) : null,
        contractor_phone: r.contractor_phone != null ? String(r.contractor_phone) : null,
        contractor_email: r.contractor_email != null ? String(r.contractor_email) : null
      };
    });
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    // #region agent log
    const first = rows[0];
    const sentKeys = first ? Object.keys(first) : [];
    console.log('[DEBUG] GET /tenant/maintenance response:', { rowCount: rows.length, firstRowKeys: sentKeys, firstAssignedId: first ? first.assigned_contractor_id : null, firstContractorName: first ? first.contractor_name : null });
    try {
      const logPath = path.join(__dirname, '..', 'debug-maintenance.log');
      fs.appendFileSync(logPath, JSON.stringify({ hypothesisId: 'H5', location: 'tenant.js:GET/maintenance', message: 'Server sending rows', data: { rowCount: rows.length, firstRowKeys: sentKeys, firstAssignedId: first ? first.assigned_contractor_id : null, firstContractorName: first ? first.contractor_name : null }, timestamp: Date.now() }) + '\n');
    } catch (e) {}
    // #endregion
    res.json(rows);
  } catch (error) {
    console.error('Tenant maintenance list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tenant/maintenance - submit maintenance request (optional multipart with photos)
router.post('/maintenance', (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    maintenanceUpload(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Each photo must be under 5MB' });
        if (err.message && err.message.includes('Only images')) return res.status(400).json({ error: err.message });
        return res.status(400).json({ error: err.message || 'File upload error' });
      }
      next();
    });
  } else next();
}, async (req, res) => {
  try {
    const subject = req.body && req.body.subject != null ? req.body.subject : (req.body && req.body.subject);
    const description = req.body && req.body.description != null ? req.body.description : null;
    const priority = req.body && req.body.priority;
    const issue_type = req.body && req.body.issue_type;
    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    const pool = req.app.locals.pool;
    const pri = (priority === 'emergency') ? 'emergency' : 'normal';
    const itype = ['plumbing', 'electrical', 'hvac', 'appliance', 'pest', 'other'].includes(String(issue_type || '').toLowerCase())
      ? String(issue_type).toLowerCase() : 'other';
    let photoUrls = [];
    if (req.files && req.files.length) {
      photoUrls = req.files.map(f => '/uploads/maintenance/' + f.filename);
    } else if (req.body && req.body.photo_urls != null) {
      const urls = req.body.photo_urls;
      photoUrls = Array.isArray(urls) ? urls : (typeof urls === 'string' ? (urls ? [urls] : []) : []);
    }
    const photos = photoUrls.length ? JSON.stringify(photoUrls) : null;
    const result = await pool.query(
      `INSERT INTO maintenance_requests (tenant_id, property_id, subject, description, status, priority, issue_type, photo_urls)
       VALUES ($1, $2, $3, $4, 'open', $5, $6, $7)
       RETURNING id, subject, description, status, priority, issue_type, photo_urls, created_at`,
      [req.tenantId, req.tenant.property_id || null, String(subject).trim(), description ? String(description).trim() : null, pri, itype, photos]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Tenant maintenance submit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tenant/announcements - announcements for my property
router.get('/announcements', async (req, res) => {
  try {
    const propertyId = req.tenant.property_id;
    if (!propertyId) {
      return res.json([]);
    }
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT id, title, message, created_at
       FROM announcements
       WHERE property_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [propertyId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Tenant announcements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tenant/messages/unread-count - count of unread messages (for notification badge)
router.get('/messages/unread-count', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT COUNT(*)::int AS unread_count
       FROM messages
       WHERE recipient_type = 'tenant' AND recipient_tenant_id = $1
         AND parent_message_id IS NULL AND read_at IS NULL`,
      [req.tenantId]
    );
    const unread_count = result.rows[0]?.unread_count ?? 0;
    res.json({ unread_count });
  } catch (error) {
    console.error('Tenant unread count error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tenant/messages - messages sent to this tenant (from manager) with replies
router.get('/messages', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT id, subject, body, read_at, created_at, parent_message_id,
              sender_user_id, sender_tenant_id, sender_contractor_id
       FROM messages
       WHERE (recipient_type = 'tenant' AND recipient_tenant_id = $1)
          OR (sender_tenant_id = $1)
       ORDER BY COALESCE(parent_message_id, id), created_at ASC`,
      [req.tenantId]
    );
    // Build threads: root messages + replies
    const byRoot = new Map();
    const roots = [];
    for (const row of result.rows) {
      const msg = {
        id: row.id,
        subject: row.subject,
        body: row.body,
        read_at: row.read_at,
        created_at: row.created_at,
        is_reply: !!row.parent_message_id,
        from_me: !!row.sender_tenant_id,
        replies: []
      };
      if (!row.parent_message_id) {
        byRoot.set(row.id, { ...msg, replies: [] });
        roots.push(row.id);
      } else {
        const root = byRoot.get(row.parent_message_id);
        if (root) root.replies.push(msg);
      }
    }
    const list = roots.map(id => byRoot.get(id)).filter(Boolean);
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(list);
  } catch (error) {
    console.error('Tenant messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tenant/messages - reply to a message (tenant)
router.post('/messages', async (req, res) => {
  try {
    const { parent_message_id, body } = req.body || {};
    const pid = parseInt(parent_message_id, 10);
    if (!Number.isInteger(pid) || pid < 1) {
      return res.status(400).json({ error: 'Valid parent_message_id is required' });
    }
    const bodyText = body != null ? String(body).trim() : '';
    if (!bodyText) return res.status(400).json({ error: 'Message body is required' });
    const pool = req.app.locals.pool;
    const parent = await pool.query(
      `SELECT id, subject, sender_user_id FROM messages
       WHERE id = $1 AND recipient_type = 'tenant' AND recipient_tenant_id = $2 AND parent_message_id IS NULL`,
      [pid, req.tenantId]
    );
    if (parent.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found or you cannot reply to it' });
    }
    const p = parent.rows[0];
    const subject = (p.subject || '').trim().startsWith('Re:') ? p.subject : `Re: ${(p.subject || '').trim()}`;
    const insert = await pool.query(
      `INSERT INTO messages (parent_message_id, sender_tenant_id, recipient_type, recipient_user_id, subject, body)
       VALUES ($1, $2, 'manager', $3, $4, $5)
       RETURNING id, subject, body, created_at`,
      [pid, req.tenantId, p.sender_user_id, subject, bodyText]
    );
    res.status(201).json(insert.rows[0]);
  } catch (error) {
    console.error('Tenant reply error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/tenant/messages/:id/read - mark message as read
router.patch('/messages/:id/read', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid message ID' });
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `UPDATE messages SET read_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND recipient_type = 'tenant' AND recipient_tenant_id = $2
       RETURNING id, read_at`,
      [id, req.tenantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Tenant mark message read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tenant/documents - documents for my tenant record
router.get('/documents', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT id, name, file_url, created_at
       FROM tenant_documents
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [req.tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Tenant documents error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
