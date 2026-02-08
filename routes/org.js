import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Org summary: MRR (sum of rent for non-vacant properties), arrears (unpaid income), vacancy %
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const mrrRes = await pool.query(
      `SELECT COALESCE(SUM(rent),0) AS mrr FROM properties WHERE organization_id = $1 AND status != 'vacant'`,
      [req.orgId]
    );
    const mrr = parseFloat(mrrRes.rows[0].mrr) || 0;
    const arrearsRes = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS arrears FROM transactions WHERE organization_id = $1 AND type = 'income' AND status != 'cleared'`,
      [req.orgId]
    );
    const arrears = parseFloat(arrearsRes.rows[0].arrears) || 0;

    const vacRes = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM properties WHERE organization_id = $1 AND status = 'vacant')::float AS vacant,
         (SELECT COUNT(*) FROM properties WHERE organization_id = $1)::float AS total`,
      [req.orgId]
    );
    const vacant = parseFloat(vacRes.rows[0].vacant) || 0;
    const total = parseFloat(vacRes.rows[0].total) || 0;
    const vacancy_rate = total > 0 ? +(vacant / total * 100).toFixed(2) : 0;

    res.json({ mrr, arrears, vacancy_rate });
  } catch (err) {
    console.error('Error computing org summary', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
