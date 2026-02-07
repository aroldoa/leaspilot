/*
replace-property-id-handler.js
Usage: node tools/replace-property-id-handler.js
Replaces the first router.get('/:id', ...) handler in routes/properties.js
with an organization-scoped version that uses req.orgId.
*/
import fs from 'fs';

const path = 'routes/properties.js';
let src = fs.readFileSync(path, 'utf8');

// Already org-scoped? Skip.
if (src.includes("WHERE id = $1 AND organization_id = $2") && src.includes('req.orgId')) {
  console.log('routes/properties.js already has org-scoped GET /:id handler. No change.');
  process.exit(0);
}

const replacement = `// Get single property (org-scoped)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      \`SELECT * FROM properties 
       WHERE id = $1 AND organization_id = $2\`,
      [req.params.id, req.orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});`;

// Match first router.get('/:id', ...) block (handles both user_id and organization_id versions)
const re = /\/\/ Get single property[^\n]*\nrouter\.get\('\/:id', authenticateToken, async \(req, res\) => \{[\s\S]*?\n\}\);/m;
if (!re.test(src)) {
  console.error("Could not find the router.get('/:id') handler in routes/properties.js. Aborting.");
  process.exit(1);
}

src = src.replace(re, replacement);
fs.writeFileSync(path, src, 'utf8');
console.log('routes/properties.js patched successfully.');
