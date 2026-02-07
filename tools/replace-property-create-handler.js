/*
replace-property-create-handler.js
Usage: node tools/replace-property-create-handler.js
Replaces the router.post('/', ...) create handler in routes/properties.js
to ensure organization_id is set from req.orgId.
*/
import fs from 'fs';

const path = 'routes/properties.js';
let src = fs.readFileSync(path, 'utf8');

// Already org-scoped (has organization_id and req.orgId in INSERT)?
if (src.includes('organization_id, name, type, address') && src.includes('req.orgId') && src.includes('req.userId, req.orgId,')) {
  console.log('routes/properties.js create handler already sets organization_id. No change.');
  process.exit(0);
}

const replacement = `// Create property (org-scoped)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      name, type, address, city, state, zip,
      bedrooms, bathrooms, sqft, rent, image_url, status
    } = req.body;

    const pool = req.app.locals.pool;
    const result = await pool.query(
      \`INSERT INTO properties 
       (user_id, organization_id, name, type, address, city, state, zip, bedrooms, bathrooms, sqft, rent, image_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *\`,
      [req.userId, req.orgId, name, type, address, city, state, zip, bedrooms || 0, bathrooms || 0, sqft || 0, rent || 0, image_url, status || 'vacant']
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating property:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});`;

// Match the router.post('/', ...) create handler block
const re = /\/\/ Create property[^\n]*\nrouter\.post\('\/', authenticateToken, async \(req, res\) => \{[\s\S]*?\n\}\);/m;
if (!re.test(src)) {
  console.error("Could not find the router.post('/') create handler in routes/properties.js. Aborting.");
  process.exit(1);
}

src = src.replace(re, replacement);
fs.writeFileSync(path, src, 'utf8');
console.log('routes/properties.js create handler patched successfully.');
