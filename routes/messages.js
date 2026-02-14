import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { sendSms } from '../lib/twilio.js';

const router = express.Router();

// Unread count: replies received by the manager (recipient_user_id = me, read_at IS NULL)
router.get('/unread-count', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM messages
       WHERE recipient_user_id = $1 AND read_at IS NULL`,
      [req.userId]
    );
    res.json({ count: result.rows[0]?.count ?? 0 });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark all replies to the manager as read (call when manager opens Messages page)
router.post('/mark-replies-read', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      `UPDATE messages SET read_at = CURRENT_TIMESTAMP
       WHERE recipient_user_id = $1 AND read_at IS NULL`,
      [req.userId]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error marking replies read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List messages sent by the manager (optionally filter by recipient_type), with replies
router.get('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const type = req.query.recipient_type; // 'tenant' | 'contractor' | omit for all
    let query = `
      SELECT m.id, m.recipient_type, m.subject, m.body, m.read_at, m.created_at,
             m.recipient_tenant_id, m.recipient_contractor_id,
             t.first_name as tenant_first_name, t.last_name as tenant_last_name, t.unit as tenant_unit,
             p.name as tenant_property_name,
             c.name as contractor_name, c.company as contractor_company
      FROM messages m
      LEFT JOIN tenants t ON t.id = m.recipient_tenant_id
      LEFT JOIN properties p ON p.id = t.property_id AND p.user_id = $1
      LEFT JOIN contractors c ON c.id = m.recipient_contractor_id AND c.user_id = $1
      WHERE m.sender_user_id = $1 AND m.parent_message_id IS NULL
    `;
    const params = [req.userId];
    if (type === 'tenant' || type === 'contractor') {
      query += ` AND m.recipient_type = $2`;
      params.push(type);
    }
    query += ` ORDER BY m.created_at DESC`;
    const result = await pool.query(query, params);
    const rows = result.rows;
    const ids = rows.map(r => r.id).filter(Boolean);
    let replies = [];
    if (ids.length > 0) {
      const replyResult = await pool.query(
        `SELECT r.id, r.parent_message_id, r.body, r.created_at,
                r.sender_user_id, r.sender_tenant_id, r.sender_contractor_id,
                t.first_name as tenant_first_name, t.last_name as tenant_last_name,
                c.name as contractor_name
         FROM messages r
         LEFT JOIN tenants t ON t.id = r.sender_tenant_id
         LEFT JOIN contractors c ON c.id = r.sender_contractor_id
         WHERE r.parent_message_id = ANY($1::int[])
         ORDER BY r.created_at ASC`,
        [ids]
      );
      replies = replyResult.rows;
    }
    const repliesByParent = new Map();
    for (const r of replies) {
      const pid = r.parent_message_id;
      if (!repliesByParent.has(pid)) repliesByParent.set(pid, []);
      const fromManager = !!r.sender_user_id;
      repliesByParent.get(pid).push({
        id: r.id,
        body: r.body,
        created_at: r.created_at,
        from_tenant: !!r.sender_tenant_id,
        from_contractor: !!r.sender_contractor_id,
        from_manager: fromManager,
        tenant_name: r.sender_tenant_id ? [r.tenant_first_name, r.tenant_last_name].filter(Boolean).join(' ') : null,
        contractor_name: r.contractor_name || null
      });
    }
    const list = rows.map(m => ({
      ...m,
      replies: repliesByParent.get(m.id) || []
    }));
    res.json(list);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send a message to a tenant or contractor (manager only)
router.post('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const { recipient_type, recipient_id, subject, body, send_sms } = req.body || {};
    if (!recipient_type || !['tenant', 'contractor'].includes(recipient_type)) {
      return res.status(400).json({ error: 'recipient_type must be "tenant" or "contractor"' });
    }
    const rid = parseInt(recipient_id, 10);
    if (!Number.isInteger(rid) || rid < 1) {
      return res.status(400).json({ error: 'Valid recipient_id is required' });
    }
    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    const pool = req.app.locals.pool;
    const bodyText = body ? String(body).trim() : null;

    let recipient_tenant_id = null;
    let recipient_contractor_id = null;
    let phone = null;

    if (recipient_type === 'tenant') {
      const t = await pool.query(
        `SELECT t.id FROM tenants t JOIN properties p ON p.id = t.property_id AND p.user_id = $2 WHERE t.id = $1`,
        [rid, req.userId]
      );
      if (t.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
      recipient_tenant_id = rid;
      const phoneRow = await pool.query('SELECT phone FROM tenants WHERE id = $1', [rid]);
      phone = phoneRow.rows[0]?.phone;
    } else {
      const c = await pool.query(
        'SELECT id FROM contractors WHERE id = $1 AND user_id = $2',
        [rid, req.userId]
      );
      if (c.rows.length === 0) return res.status(404).json({ error: 'Contractor not found' });
      recipient_contractor_id = rid;
      const phoneRow = await pool.query('SELECT phone FROM contractors WHERE id = $1', [rid]);
      phone = phoneRow.rows[0]?.phone;
    }

    const insert = await pool.query(
      `INSERT INTO messages (sender_user_id, recipient_type, recipient_tenant_id, recipient_contractor_id, subject, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, recipient_type, subject, body, created_at`,
      [req.userId, recipient_type, recipient_tenant_id, recipient_contractor_id, String(subject).trim(), bodyText]
    );
    const message = insert.rows[0];

    if (send_sms && phone && String(phone).trim()) {
      const smsBody = bodyText ? `${subject}\n\n${bodyText}`.slice(0, 1600) : String(subject).trim();
      const sms = await sendSms(phone, smsBody);
      if (!sms.success) {
        console.error('Message saved but SMS failed:', sms.error);
      }
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reply to an existing thread (manager only). reply_to_message_id = root message id (the one you sent).
router.post('/reply', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const { reply_to_message_id, body, send_sms } = req.body || {};
    const rootId = parseInt(reply_to_message_id, 10);
    if (!Number.isInteger(rootId) || rootId < 1) {
      return res.status(400).json({ error: 'Valid reply_to_message_id is required' });
    }
    const bodyText = body != null ? String(body).trim() : '';
    if (!bodyText) return res.status(400).json({ error: 'Message body is required' });
    const pool = req.app.locals.pool;
    const root = await pool.query(
      `SELECT id, subject, recipient_type, recipient_tenant_id, recipient_contractor_id, sender_user_id
       FROM messages
       WHERE id = $1 AND parent_message_id IS NULL`,
      [rootId]
    );
    if (root.rows.length === 0) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    const r = root.rows[0];
    if (r.sender_user_id !== req.userId) {
      return res.status(403).json({ error: 'You can only reply to your own threads' });
    }
    const subject = (r.subject || '').trim().startsWith('Re:') ? r.subject : `Re: ${(r.subject || '').trim()}`;
    const insert = await pool.query(
      `INSERT INTO messages (parent_message_id, sender_user_id, recipient_type, recipient_tenant_id, recipient_contractor_id, subject, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, subject, body, created_at`,
      [rootId, req.userId, r.recipient_type, r.recipient_tenant_id, r.recipient_contractor_id, subject, bodyText]
    );
    const message = insert.rows[0];

    if (send_sms) {
      const recipientId = r.recipient_tenant_id || r.recipient_contractor_id;
      const table = r.recipient_type === 'tenant' ? 'tenants' : 'contractors';
      const phoneRow = await pool.query(`SELECT phone FROM ${table} WHERE id = $1`, [recipientId]);
      const phone = phoneRow.rows[0]?.phone;
      if (phone && String(phone).trim()) {
        const smsBody = bodyText.slice(0, 1600);
        const sms = await sendSms(phone, smsBody);
        if (!sms.success) console.error('Reply saved but SMS failed:', sms.error);
      }
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Error replying to message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
