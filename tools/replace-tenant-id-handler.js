/*
replace-tenant-id-handler.js
Usage: node tools/replace-tenant-id-handler.js
Replaces the router.get('/:id', ...) handler in routes/tenants.js
with an organization-scoped version.
*/
import fs from 'fs';

const path = 'routes/tenants.js';
let src = fs.readFileSync(path, 'utf8');

// Already org-scoped?
if (src.includes('WHERE t.id = $1 AND t.organization_id = $2') && src.includes('req.orgId]')) {
  console.log('routes/tenants.js id handler already org-scoped. No change.');
  process.exit(0);
}

const replacement = `// Get single tenant (org-scoped)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      \`SELECT t.*, p.name as property_name, p.address as property_address
       FROM tenants t
       LEFT JOIN properties p ON t.property_id = p.id
       WHERE t.id = $1 AND t.organization_id = $2\`,
      [req.params.id, req.orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching tenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});`;

// Match the router.get('/:id', ...) handler block
const re = /\/\/ Get single tenant[^\n]*\nrouter\.get\('\/:id', authenticateToken, async \(req, res\) => \{[\s\S]*?\n\}\);/m;
if (!re.test(src)) {
  console.error("Could not find the router.get('/:id') handler in routes/tenants.js. Aborting.");
  process.exit(1);
}

src = src.replace(re, replacement);
fs.writeFileSync(path, src, 'utf8');
console.log('routes/tenants.js id handler patched successfully.');
