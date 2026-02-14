import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { sendSms, isTwilioConfigured } from '../lib/twilio.js';

const router = express.Router();

// Whether Twilio is configured (manager only)
router.get('/status', authenticateToken, requireRole('Portfolio Manager'), (req, res) => {
  res.json({ configured: isTwilioConfigured() });
});

// Send SMS to any number (manager only)
router.post('/send', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !String(to).trim()) {
    return res.status(400).json({ error: 'Phone number (to) is required' });
  }
  if (!body || !String(body).trim()) {
    return res.status(400).json({ error: 'Message (body) is required' });
  }
  const result = await sendSms(to, body);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true, sid: result.sid });
});

// Send SMS to a contractor by id (manager only)
router.post('/send-to-contractor/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid contractor ID' });
  const { body } = req.body || {};
  const message = body && String(body).trim() ? String(body).trim() : 'Hi, this is your property manager. Please reach out when you can.';
  const pool = req.app.locals.pool;
  const contractor = await pool.query(
    'SELECT id, name, phone FROM contractors WHERE id = $1 AND user_id = $2',
    [id, req.userId]
  );
  if (contractor.rows.length === 0) return res.status(404).json({ error: 'Contractor not found' });
  const phone = contractor.rows[0].phone;
  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ error: 'This contractor has no phone number on file' });
  }
  const result = await sendSms(phone, message);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true, sid: result.sid });
});

// Send SMS to a tenant by id (manager only)
router.post('/send-to-tenant/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid tenant ID' });
  const { body } = req.body || {};
  const message = body && String(body).trim() ? String(body).trim() : 'Hi, this is your property manager. Please reach out when you can.';
  const pool = req.app.locals.pool;
  const tenant = await pool.query(
    'SELECT t.id, t.first_name, t.last_name, t.phone FROM tenants t JOIN properties p ON p.id = t.property_id AND p.user_id = $2 WHERE t.id = $1',
    [id, req.userId]
  );
  if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
  const phone = tenant.rows[0].phone;
  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ error: 'This tenant has no phone number on file' });
  }
  const result = await sendSms(phone, message);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true, sid: result.sid });
});

export default router;
