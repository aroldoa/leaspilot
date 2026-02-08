import jwt from 'jsonwebtoken';

export async function authMiddleware(req, res, next) {
  try {
    const token = req.cookies?.access_token;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const pool = req.app.locals.pool;

    const userRes = await pool.query('SELECT id, email, name, role FROM users WHERE id = $1', [decoded.userId]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'User not found' });

    const user = userRes.rows[0];

    // Fetch user's org memberships
    const orgsRes = await pool.query(
      `SELECT o.id, o.name, uo.role
       FROM organizations o
       JOIN user_organizations uo ON uo.org_id = o.id
       WHERE uo.user_id = $1`,
      [user.id]
    );

    const orgs = orgsRes.rows;
    if (orgs.length === 0) {
      return res.status(403).json({ error: 'User not associated with any organization' });
    }

    // Attach user and default org (first) to request
    req.user = user;
    req.orgs = orgs;
    req.activeOrg = orgs[0];

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
