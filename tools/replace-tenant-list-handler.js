/*
replace-tenant-list-handler.js
Usage: node tools/replace-tenant-list-handler.js
Replaces the router.get('/', ...) handler in routes/tenants.js with an org-scoped version.
*/
import fs from 'fs';

const path = 'routes/tenants.js';
let src = fs.readFileSync(path, 'utf8');

// Already org-scoped?
if (src.includes('t.organization_id = $1') && src.includes('req.orgId]')) {
  console.log('routes/tenants.js list handler already org-scoped. No change.');
  process.exit(0);
}

const replacement = `// Get all tenants for the organization (org-scoped)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      \`SELECT t.*, p.name as property_name, p.address as property_address
       FROM tenants t
       LEFT JOIN properties p ON t.property_id = p.id
       WHERE t.organization_id = $1
       ORDER BY t.created_at DESC\`,
      [req.orgId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tenants:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});`;

// Match the router.get('/', ...) list handler block
const re = /\/\/ Get all tenants[^\n]*\nrouter\.get\('\/', authenticateToken, async \(req, res\) => \{[\s\S]*?\n\}\);/m;
if (!re.test(src)) {
  console.error("Could not find the router.get('/') handler in routes/tenants.js. Aborting.");
  process.exit(1);
}

src = src.replace(re, replacement);
fs.writeFileSync(path, src, 'utf8');
console.log('routes/tenants.js list handler patched successfully.');
