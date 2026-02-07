/*
replace-property-update-handler.js
Usage: node tools/replace-property-update-handler.js
Replaces the router.put('/:id', ...) update handler in routes/properties.js
to enforce organization scoping when updating.
*/
import fs from 'fs';

const path = 'routes/properties.js';
let src = fs.readFileSync(path, 'utf8');

// Already org-scoped?
if (src.includes('WHERE id = $13 AND organization_id = $14') && src.includes('req.orgId]')) {
  console.log('routes/properties.js update handler already org-scoped. No change.');
  process.exit(0);
}

const replacement = `// Update property (org-scoped)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const {
      name, type, address, city, state, zip,
      bedrooms, bathrooms, sqft, rent, image_url, status
    } = req.body;

    const pool = req.app.locals.pool;
    const result = await pool.query(
      \`UPDATE properties 
       SET name = $1, type = $2, address = $3, city = $4, state = $5, zip = $6,
           bedrooms = $7, bathrooms = $8, sqft = $9, rent = $10, image_url = $11,
           status = $12, updated_at = CURRENT_TIMESTAMP
       WHERE id = $13 AND organization_id = $14
       RETURNING *\`,
      [name, type, address, city, state, zip, bedrooms, bathrooms, sqft, rent, image_url, status, req.params.id, req.orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating property:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});`;

// Match the router.put('/:id', ...) update handler block
const re = /\/\/ Update property[^\n]*\nrouter\.put\('\/:id', authenticateToken, async \(req, res\) => \{[\s\S]*?\n\}\);/m;
if (!re.test(src)) {
  console.error("Could not find the router.put('/:id') handler in routes/properties.js. Aborting.");
  process.exit(1);
}

src = src.replace(re, replacement);
fs.writeFileSync(path, src, 'utf8');
console.log('routes/properties.js update handler patched successfully.');
