import express from 'express';
import { authenticateToken, requireContractor } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken, (req, res, next) => {
  requireContractor(req, res, next).catch(next);
});

// GET /api/contractor/messages - messages sent to this contractor (from manager) with replies
router.get('/messages', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT id, subject, body, read_at, created_at, parent_message_id,
              sender_user_id, sender_tenant_id, sender_contractor_id
       FROM messages
       WHERE (recipient_type = 'contractor' AND recipient_contractor_id = $1)
          OR (sender_contractor_id = $1)
       ORDER BY COALESCE(parent_message_id, id), created_at ASC`,
      [req.contractorId]
    );
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
        from_me: !!row.sender_contractor_id,
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
    console.error('Contractor messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/contractor/messages - reply to a message (contractor)
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
       WHERE id = $1 AND recipient_type = 'contractor' AND recipient_contractor_id = $2 AND parent_message_id IS NULL`,
      [pid, req.contractorId]
    );
    if (parent.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found or you cannot reply to it' });
    }
    const p = parent.rows[0];
    const subject = (p.subject || '').trim().startsWith('Re:') ? p.subject : `Re: ${(p.subject || '').trim()}`;
    const insert = await pool.query(
      `INSERT INTO messages (parent_message_id, sender_contractor_id, recipient_type, recipient_user_id, subject, body)
       VALUES ($1, $2, 'manager', $3, $4, $5)
       RETURNING id, subject, body, created_at`,
      [pid, req.contractorId, p.sender_user_id, subject, bodyText]
    );
    res.status(201).json(insert.rows[0]);
  } catch (error) {
    console.error('Contractor reply error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/contractor/messages/:id/read - mark message as read
router.patch('/messages/:id/read', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid message ID' });
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `UPDATE messages SET read_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND recipient_type = 'contractor' AND recipient_contractor_id = $2
       RETURNING id, read_at`,
      [id, req.contractorId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Contractor mark message read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
