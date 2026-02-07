/*
replace-property-delete-handler.js
Usage: node tools/replace-property-delete-handler.js
Replaces the router.delete('/:id', ...) handler in routes/properties.js
to enforce organization scoping when deleting.
*/
import fs from 'fs';

const path = 'routes/properties.js';
let src = fs.readFileSync(path, 'utf8');

// Already org-scoped?
if (src.includes('DELETE FROM properties WHERE id = $1 AND organization_id = $2') && src.includes('req.orgId]')) {
  console.log('routes/properties.js delete handler already org-scoped. No change.');
  process.exit(0);
}

const replacement = `// Delete property (org-scoped)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'DELETE FROM properties WHERE id = $1 AND organization_id = $2 RETURNING id',
      [req.params.id, req.orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    res.json({ message: 'Property deleted successfully' });
  } catch (error) {
    console.error('Error deleting property:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});`;

// Match the router.delete('/:id', ...) handler block
const re = /\/\/ Delete property[^\n]*\nrouter\.delete\('\/:id', authenticateToken, async \(req, res\) => \{[\s\S]*?\n\}\);/m;
if (!re.test(src)) {
  console.error("Could not find the router.delete('/:id') handler in routes/properties.js. Aborting.");
  process.exit(1);
}

src = src.replace(re, replacement);
fs.writeFileSync(path, src, 'utf8');
console.log('routes/properties.js delete handler patched successfully.');
