/*
replace-property-list-handler.js
Usage: node tools/replace-property-list-handler.js
Replaces the router.get('/', ...) handler in routes/properties.js with an org-scoped version.
*/
import fs from 'fs';

const path = 'routes/properties.js';
let src = fs.readFileSync(path, 'utf8');

// Already org-scoped? Skip.
if (src.includes('WHERE organization_id = $1') && src.includes('req.orgId') && src.includes('Get all properties for the organization')) {
  console.log('routes/properties.js already has org-scoped GET / list handler. No change.');
  process.exit(0);
}

const replacement = `// Get all properties for the organization
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      \`SELECT * FROM properties WHERE organization_id = $1 ORDER BY created_at DESC\`,
      [req.orgId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching properties:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});`;

// Match first router.get('/', ...) block
const re = /\/\/ Get all properties[^\n]*\nrouter\.get\('\/', authenticateToken, async \(req, res\) => \{[\s\S]*?\n\}\);/m;
if (!re.test(src)) {
  console.error("Could not find the router.get('/') handler in routes/properties.js. Aborting.");
  process.exit(1);
}

src = src.replace(re, replacement);
fs.writeFileSync(path, src, 'utf8');
console.log('routes/properties.js list handler patched successfully.');
