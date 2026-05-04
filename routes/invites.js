import express from 'express';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// POST /api/invites — create an invite (grants access to ALL of the owner's properties)
router.post('/', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const { invited_email, role = 'manager' } = req.body;

  try {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await pool.query(`
      INSERT INTO property_invites (token, property_id, invited_email, role, invited_by, expires_at)
      VALUES ($1, NULL, $2, $3, $4, $5)
      RETURNING *
    `, [token, invited_email?.trim() || null, role, req.userId, expiresAt]);

    const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
    const inviteUrl = `${origin}/accept-invite.html?token=${token}`;
    res.json({ ...result.rows[0], invite_url: inviteUrl });
  } catch (err) {
    console.error('POST /api/invites error:', err);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// GET /api/invites — list pending invites + active team members
router.get('/', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const [invites, members] = await Promise.all([
      pool.query(`
        SELECT id, invited_email, role, expires_at, created_at
        FROM property_invites
        WHERE invited_by = $1 AND property_id IS NULL
          AND accepted_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC
      `, [req.userId]),
      pool.query(`
        SELECT tm.id, tm.role, tm.created_at,
               u.id as user_id, u.name as user_name, u.email as user_email
        FROM team_members tm
        JOIN users u ON u.id = tm.member_user_id
        WHERE tm.owner_user_id = $1
        ORDER BY tm.created_at DESC
      `, [req.userId]),
    ]);
    res.json({ invites: invites.rows, collaborators: members.rows });
  } catch (err) {
    console.error('GET /api/invites error:', err);
    res.status(500).json({ error: 'Failed to load invites' });
  }
});

// DELETE /api/invites/:id — cancel a pending invite
router.delete('/:id', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const check = await pool.query(
      `SELECT id FROM property_invites WHERE id = $1 AND invited_by = $2`,
      [req.params.id, req.userId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Invite not found' });
    await pool.query(`DELETE FROM property_invites WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/invites/:id error:', err);
    res.status(500).json({ error: 'Failed to cancel invite' });
  }
});

// DELETE /api/invites/members/:memberId — remove a team member
router.delete('/members/:memberId', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(
      `DELETE FROM team_members WHERE owner_user_id = $1 AND member_user_id = $2`,
      [req.userId, req.params.memberId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Team member not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/invites/members/:memberId error:', err);
    res.status(500).json({ error: 'Failed to remove team member' });
  }
});

// GET /api/invites/accept/:token — public: look up invite details
router.get('/accept/:token', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT pi.id, pi.role, pi.expires_at, pi.invited_email, pi.accepted_at,
             u.name as invited_by_name, u.email as invited_by_email
      FROM property_invites pi
      JOIN users u ON u.id = pi.invited_by
      WHERE pi.token = $1
    `, [req.params.token]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Invite not found or expired' });
    const inv = result.rows[0];
    if (inv.accepted_at) return res.status(410).json({ error: 'This invite has already been used' });
    if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ error: 'This invite has expired' });
    res.json(inv);
  } catch (err) {
    console.error('GET /api/invites/accept/:token error:', err);
    res.status(500).json({ error: 'Failed to load invite' });
  }
});

// POST /api/invites/accept/:token — authenticated user accepts invite
router.post('/accept/:token', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT * FROM property_invites
      WHERE token = $1 AND expires_at > NOW() AND accepted_at IS NULL
    `, [req.params.token]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Invite not found or expired' });
    const inv = result.rows[0];

    if (inv.invited_by === req.userId) return res.status(400).json({ error: 'You cannot accept your own invite' });

    await pool.query(`
      INSERT INTO team_members (owner_user_id, member_user_id, role, invited_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (owner_user_id, member_user_id) DO NOTHING
    `, [inv.invited_by, req.userId, inv.role, inv.invited_by]);

    await pool.query(
      `UPDATE property_invites SET accepted_at = NOW(), accepted_by_user_id = $1 WHERE id = $2`,
      [req.userId, inv.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/invites/accept/:token error:', err);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

export default router;
