import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { sendSms } from '../lib/twilio.js';

const router = express.Router();

const COLS = `mr.id, mr.tenant_id, mr.property_id, mr.subject, mr.description, mr.status, mr.priority, mr.issue_type, mr.photo_urls, mr.assigned_vendor, mr.assigned_contractor_id, mr.created_at, mr.updated_at,
       p.name as property_name,
       t.first_name as tenant_first_name, t.last_name as tenant_last_name, t.unit as tenant_unit,
       c.name as contractor_name, c.company as contractor_company, c.phone as contractor_phone, c.email as contractor_email, c.specialty as contractor_specialty`;
const ORDER = `ORDER BY (CASE WHEN mr.priority = 'emergency' THEN 0 ELSE 1 END), mr.created_at DESC`;

// List maintenance requests for manager's properties (optionally filter by property_id). Emergency first.
router.get('/', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const propertyId = req.query.property_id ? parseInt(req.query.property_id, 10) : null;
    const propFilter = propertyId && Number.isInteger(propertyId) ? ' AND p.id = $2' : '';
    const query = `
      SELECT ${COLS}
      FROM maintenance_requests mr
      JOIN properties p ON p.id = mr.property_id AND p.user_id = $1${propFilter}
      LEFT JOIN tenants t ON t.id = mr.tenant_id
      LEFT JOIN contractors c ON c.id = mr.assigned_contractor_id
      ${ORDER}
    `;
    const params = propertyId && Number.isInteger(propertyId) ? [req.userId, propertyId] : [req.userId];
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching maintenance requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/maintenance-requests/:id - update status, assigned_vendor, or assigned_contractor_id (manager only)
router.patch('/:id', authenticateToken, requireRole('Portfolio Manager'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid request ID' });
    const { status, assigned_vendor, assigned_contractor_id } = req.body || {};
    const pool = req.app.locals.pool;
    const updates = [];
    const values = [];
    let idx = 1;
    const validStatuses = ['open', 'in_progress', 'waiting_vendor', 'completed'];
    if (status != null && validStatuses.includes(String(status))) {
      updates.push(`status = $${idx++}`);
      values.push(String(status));
    }
    if (assigned_vendor !== undefined) {
      updates.push(`assigned_vendor = $${idx++}`);
      values.push(assigned_vendor ? String(assigned_vendor).trim() : null);
    }
    if (assigned_contractor_id !== undefined) {
      const cid = assigned_contractor_id === null || assigned_contractor_id === '' ? null : parseInt(assigned_contractor_id, 10);
      updates.push(`assigned_contractor_id = $${idx++}`);
      values.push(Number.isInteger(cid) ? cid : null);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Provide status, assigned_vendor, and/or assigned_contractor_id' });
    values.push(id, req.userId);
    // #region agent log
    fetch('http://127.0.0.1:7249/ingest/883d00fc-6419-4636-bf2d-d40db9bb5ee7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hypothesisId:'H3',location:'maintenance-requests.js:PATCH',message:'Manager PATCH assign before update',data:{requestId:id,bodyAssignedContractorId:assigned_contractor_id},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const result = await pool.query(
      `UPDATE maintenance_requests mr
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       FROM properties p
       WHERE mr.id = $${idx} AND mr.property_id = p.id AND p.user_id = $${idx + 1}
       RETURNING mr.id, mr.status, mr.assigned_vendor, mr.assigned_contractor_id, mr.updated_at`,
      values
    );
    // #region agent log
    fetch('http://127.0.0.1:7249/ingest/883d00fc-6419-4636-bf2d-d40db9bb5ee7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hypothesisId:'H3',location:'maintenance-requests.js:PATCH',message:'Manager PATCH assign after update',data:{rowsAffected:result.rows.length,returned:result.rows[0]?{id:result.rows[0].id,assigned_contractor_id:result.rows[0].assigned_contractor_id}:null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const updated = result.rows[0];

    // When a contractor is assigned, send them the maintenance request via SMS
    const cid = assigned_contractor_id === null || assigned_contractor_id === '' ? null : parseInt(assigned_contractor_id, 10);
    if (Number.isInteger(cid) && cid > 0) {
      try {
        const detail = await pool.query(
          `SELECT mr.subject, mr.priority, p.name as property_name, t.unit as tenant_unit, c.phone as contractor_phone
           FROM maintenance_requests mr
           JOIN properties p ON p.id = mr.property_id AND p.user_id = $2
           LEFT JOIN tenants t ON t.id = mr.tenant_id
           LEFT JOIN contractors c ON c.id = mr.assigned_contractor_id
           WHERE mr.id = $1`,
          [id, req.userId]
        );
        const row = detail.rows[0];
        if (row && row.contractor_phone && row.contractor_phone.trim()) {
          const prop = row.property_name || 'Property';
          const unit = row.tenant_unit ? ` Unit ${row.tenant_unit}` : '';
          const subj = row.subject || 'Maintenance request';
          const pri = (row.priority === 'emergency') ? ' [EMERGENCY]' : '';
          const body = `You've been assigned to a maintenance request: "${subj}"${pri} at ${prop}${unit}. Please contact the property manager to schedule.`;
          const sms = await sendSms(row.contractor_phone, body);
          if (!sms.success) console.error('Failed to send assignment SMS to contractor:', sms.error);
        }
      } catch (smsErr) {
        console.error('Error sending assignment SMS to contractor:', smsErr);
      }
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating maintenance request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
