import express from 'express';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// POST /api/invites — owner creates an invite link for a property
router.post('/', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const { property_id, invited_email, role = 'manager' } = req.body;
  if (!property_id) return res.status(400).json({ error: 'property_id is required' });

  try {
    const own = await pool.query(
      `SELECT id FROM properties WHERE id = $1 AND user_id = $2`,
      [property_id, req.userId]
    );
    if (own.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await pool.query(`
      INSERT INTO property_invites (token, property_id, invited_email, role, invited_by, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [token, property_id, invited_email?.trim() || null, role, req.userId, expiresAt]);

    const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
    const inviteUrl = `${origin}/accept-invite.html?token=${token}`;
    res.json({ ...result.rows[0], invite_url: inviteUrl });
  } catch (err) {
    console.error('POST /api/invites error:', err);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// GET /api/invites — list pending invites + active collaborators for owned properties
router.get('/', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const [invites, collabs] = await Promise.all([
      pool.query(`
        SELECT pi.id, pi.invited_email, pi.role, pi.expires_at, pi.created_at,
               p.id as property_id, p.name as property_name
        FROM property_invites pi
        JOIN properties p ON p.id = pi.property_id
        WHERE p.user_id = $1 AND pi.accepted_at IS NULL AND pi.expires_at > NOW()
        ORDER BY pi.created_at DESC
      `, [req.userId]),
      pool.query(`
        SELECT pc.id, pc.role, pc.created_at,
               p.id as property_id, p.name as property_name,
               u.id as user_id, u.name as user_name, u.email as user_email
        FROM property_collaborators pc
        JOIN properties p ON p.id = pc.property_id
        JOIN users u ON u.id = pc.user_id
        WHERE p.user_id = $1
        ORDER BY pc.created_at DESC
      `, [req.userId]),
    ]);
    res.json({ invites: invites.rows, collaborators: collabs.rows });
  } catch (err) {
    console.error('GET /api/invites error:', err);
    res.status(500).json({ error: 'Failed to load invites' });
  }
});

// DELETE /api/invites/:id — cancel a pending invite
router.delete('/:id', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const check = await pool.query(`
      SELECT pi.id FROM property_invites pi
      JOIN properties p ON p.id = pi.property_id AND p.user_id = $1
      WHERE pi.id = $2
    `, [req.userId, req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Invite not found' });

    await pool.query(`DELETE FROM property_invites WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/invites/:id error:', err);
    res.status(500).json({ error: 'Failed to cancel invite' });
  }
});

// DELETE /api/invites/collaborators/:propertyId/:userId — remove a collaborator
router.delete('/collaborators/:propertyId/:userId', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const own = await pool.query(
      `SELECT id FROM properties WHERE id = $1 AND user_id = $2`,
      [req.params.propertyId, req.userId]
    );
    if (own.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

    await pool.query(
      `DELETE FROM property_collaborators WHERE property_id = $1 AND user_id = $2`,
      [req.params.propertyId, req.params.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/invites/collaborators error:', err);
    res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

// GET /api/invites/accept/:token — public: look up invite details
router.get('/accept/:token', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT pi.role, pi.expires_at, pi.invited_email,
             p.name as property_name, p.address as property_address,
             u.name as invited_by_name
      FROM property_invites pi
      JOIN properties p ON p.id = pi.property_id
      JOIN users u ON u.id = pi.invited_by
      WHERE pi.token = $1 AND pi.expires_at > NOW() AND pi.accepted_at IS NULL
    `, [req.params.token]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Invite not found or expired' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/invites/accept/:token error:', err);
    res.status(500).json({ error: 'Failed to load invite' });
  }
});

// POST /api/invites/accept/:token — authenticated user accepts the invite
router.post('/accept/:token', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT * FROM property_invites
      WHERE token = $1 AND expires_at > NOW() AND accepted_at IS NULL
    `, [req.params.token]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Invite not found or expired' });
    const inv = result.rows[0];

    // Don't allow the owner to accept their own invite
    const isOwner = await pool.query(
      `SELECT id FROM properties WHERE id = $1 AND user_id = $2`,
      [inv.property_id, req.userId]
    );
    if (isOwner.rows.length > 0) return res.status(400).json({ error: 'You already own this property' });

    // Upsert collaborator
    await pool.query(`
      INSERT INTO property_collaborators (property_id, user_id, role, invited_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (property_id, user_id) DO NOTHING
    `, [inv.property_id, req.userId, inv.role, inv.invited_by]);

    await pool.query(
      `UPDATE property_invites SET accepted_at = NOW(), accepted_by_user_id = $1 WHERE id = $2`,
      [req.userId, inv.id]
    );

    res.json({ success: true, property_id: inv.property_id });
  } catch (err) {
    console.error('POST /api/invites/accept/:token error:', err);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

export default router;
