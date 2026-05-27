import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = process.env.VERCEL === '1' || __dirname.startsWith('/var/task')
  ? path.join(os.tmpdir(), 'leasepilot-uploads', 'maintenance')
  : path.join(__dirname, '..', 'uploads', 'maintenance');

const maintenanceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
      } catch (e) {}
      cb(null, uploadDir);
    },
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

// ── Stripe webhook for rent payments (raw body — before auth middleware) ──────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const pool = req.app.locals.pool;
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_RENT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !webhookSecret) {
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let event;
  try {
    if (webhookSecret) {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Rent webhook signature error:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.metadata?.type === 'rent') {
      const paymentId = parseInt(session.metadata.payment_id, 10);
      if (paymentId) {
        try {
          await pool.query(
            `UPDATE rent_payments
             SET status = 'paid', stripe_payment_intent = $1, updated_at = NOW()
             WHERE id = $2 AND status != 'paid'`,
            [session.payment_intent, paymentId]
          );
        } catch (err) {
          console.error('Rent webhook DB error:', err);
          return res.status(500).json({ error: 'Database error' });
        }
      }
    }
  }

  res.json({ received: true });
});

// All other tenant routes: authenticate then require tenant record
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

// GET /api/tenant/payments - rent payment history
router.get('/payments', authenticateToken, requireTenant, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT id, amount, payment_method, status, description, period_month, created_at
       FROM rent_payments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 24`,
      [req.tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Tenant payments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tenant/pay - create Stripe Checkout Session for rent payment
router.post('/pay', authenticateToken, requireTenant, async (req, res) => {
  const pool = req.app.locals.pool;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  try {
    const tenantResult = await pool.query(
      `SELECT t.id, t.first_name, t.last_name, t.email, t.property_id, t.unit,
              p.rent, p.name AS property_name,
              u.stripe_account_id, u.stripe_charges_enabled
       FROM tenants t
       JOIN properties p ON p.id = t.property_id
       JOIN users u ON u.id = p.user_id
       WHERE t.id = $1`,
      [req.tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenant = tenantResult.rows[0];
    const { amount, period_month, description } = req.body;
    const payAmount = amount ? parseFloat(amount) : parseFloat(tenant.rent || 0);

    if (!payAmount || payAmount <= 0) {
      return res.status(400).json({ error: 'No rent amount set. Please contact your property manager.' });
    }

    const periodLabel = period_month || new Date().toISOString().slice(0, 7);
    const desc = description || `Rent – ${tenant.property_name}${tenant.unit ? ' Unit ' + tenant.unit : ''}`;

    // No Stripe → record pending manual payment
    if (!stripeKey || !tenant.stripe_account_id || !tenant.stripe_charges_enabled) {
      await pool.query(
        `INSERT INTO rent_payments (tenant_id, property_id, amount, payment_method, status, description, period_month)
         VALUES ($1, $2, $3, 'manual', 'pending', $4, $5)`,
        [req.tenantId, tenant.property_id, payAmount, desc, periodLabel]
      );
      return res.json({
        noPayment: true,
        message: !tenant.stripe_account_id
          ? 'Your property manager has not connected online payments yet. Please pay by check or contact them directly.'
          : 'Payment recorded.',
      });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);

    const amountCents = Math.round(payAmount * 100);
    const platformFee = Math.round(amountCents * 0.01);

    // Insert pending record first so we have an ID for the webhook
    const payment = await pool.query(
      `INSERT INTO rent_payments (tenant_id, property_id, amount, payment_method, status, description, period_month)
       VALUES ($1, $2, $3, 'card', 'pending', $4, $5) RETURNING id`,
      [req.tenantId, tenant.property_id, payAmount, desc, periodLabel]
    );

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${proto}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: desc },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      customer_email: tenant.email,
      payment_intent_data: {
        application_fee_amount: platformFee,
        transfer_data: { destination: tenant.stripe_account_id },
        description: desc,
        metadata: {
          type: 'rent',
          payment_id: String(payment.rows[0].id),
          tenant_id: String(req.tenantId),
        },
      },
      metadata: {
        type: 'rent',
        payment_id: String(payment.rows[0].id),
        tenant_id: String(req.tenantId),
      },
      success_url: `${baseUrl}/tenant/payments.html?success=1`,
      cancel_url: `${baseUrl}/tenant/payments.html?cancelled=1`,
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('Tenant pay error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tenant/maintenance - my maintenance requests (with assigned contractor when set)
router.get('/maintenance', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
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
