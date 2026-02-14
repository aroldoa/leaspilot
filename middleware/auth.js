import jwt from 'jsonwebtoken';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.userId = decoded.userId;
    req.role = decoded.role || null;
    next();
  });
}

/** Require user to have one of the given roles (e.g. 'Portfolio Manager'). Used to protect manager-only routes. */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = (req.role || '').trim();
    const allowed = allowedRoles.map(r => (r || '').trim().toLowerCase());
    if (role && allowed.includes(role.toLowerCase())) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: insufficient role' });
  };
}

/** Require user to be a Tenant with a linked tenant record. Sets req.tenantId and req.tenant. */
export async function requireTenant(req, res, next) {
  try {
    const role = (req.role || '').trim().toLowerCase();
    if (role !== 'tenant') {
      return res.status(403).json({ error: 'Forbidden: tenant access only' });
    }
    const pool = req.app.locals.pool;
    if (!pool) {
      return res.status(503).json({ error: 'Service unavailable' });
    }
    const result = await pool.query(
      `SELECT t.id, t.property_id, t.unit, t.first_name, t.last_name, t.email, t.phone,
              t.lease_start, t.lease_end, t.status, t.balance,
              p.name as property_name, p.address as property_address,
              p.city as property_city, p.state as property_state, p.zip as property_zip,
              p.rent as property_rent
       FROM tenants t
       LEFT JOIN properties p ON t.property_id = p.id
       WHERE t.portal_user_id = $1
       LIMIT 1`,
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'No tenant record linked to this account' });
    }
    req.tenant = result.rows[0];
    req.tenantId = req.tenant.id;
    next();
  } catch (err) {
    console.error('requireTenant error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Require user to be a Contractor with a linked contractor record. Sets req.contractorId and req.contractor. */
export async function requireContractor(req, res, next) {
  try {
    const role = (req.role || '').trim().toLowerCase();
    if (role !== 'contractor') {
      return res.status(403).json({ error: 'Forbidden: contractor access only' });
    }
    const pool = req.app.locals.pool;
    if (!pool) {
      return res.status(503).json({ error: 'Service unavailable' });
    }
    const result = await pool.query(
      `SELECT id, user_id, name, company, phone, email, specialty
       FROM contractors
       WHERE portal_user_id = $1
       LIMIT 1`,
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'No contractor record linked to this account' });
    }
    req.contractor = result.rows[0];
    req.contractorId = req.contractor.id;
    next();
  } catch (err) {
    console.error('requireContractor error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}



