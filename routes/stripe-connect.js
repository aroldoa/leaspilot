/**
 * Stripe Connect — Express account onboarding for property managers.
 *
 * GET  /api/stripe/status           → connection status for the authed user
 * POST /api/stripe/onboard          → create/retrieve Express account + return onboarding URL
 * POST /api/stripe/refresh          → refresh expired onboarding URL
 * POST /api/stripe/sync             → re-sync account status from Stripe
 * DELETE /api/stripe/disconnect     → remove connected account from this user
 */
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return import('stripe').then(m => new m.default(key));
}

// ── Status ────────────────────────────────────────────────────────────────────
router.get('/status', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(
      `SELECT stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_account_email
       FROM users WHERE id = $1`,
      [req.userId]
    );
    const row = result.rows[0] || {};
    res.json({
      connected:        !!row.stripe_account_id,
      account_id:       row.stripe_account_id || null,
      charges_enabled:  row.stripe_charges_enabled || false,
      payouts_enabled:  row.stripe_payouts_enabled || false,
      account_email:    row.stripe_account_email || null,
    });
  } catch (err) {
    console.error('Stripe status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Start onboarding ──────────────────────────────────────────────────────────
router.post('/onboard', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const stripe = await getStripe();

    // Get current user info
    const userResult = await pool.query(
      `SELECT name, email, stripe_account_id FROM users WHERE id = $1`,
      [req.userId]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    let accountId = user.stripe_account_id;

    // Create Express account if not already created
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
          us_bank_account_ach_payments: { requested: true },
        },
        business_type: 'individual',
        metadata: { leasepilot_user_id: String(req.userId) },
      });
      accountId = account.id;
      await pool.query(
        `UPDATE users SET stripe_account_id = $1 WHERE id = $2`,
        [accountId, req.userId]
      );
    }

    // Build the return/refresh URLs
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${proto}://${req.get('host')}`;

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/settings.html?stripe=refresh`,
      return_url:  `${baseUrl}/settings.html?stripe=connected`,
      type: 'account_onboarding',
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error('Stripe onboard error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── Refresh onboarding link ───────────────────────────────────────────────────
router.post('/refresh', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const stripe = await getStripe();
    const result = await pool.query(
      `SELECT stripe_account_id FROM users WHERE id = $1`, [req.userId]
    );
    const accountId = result.rows[0]?.stripe_account_id;
    if (!accountId) return res.status(400).json({ error: 'No connected account found' });

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${proto}://${req.get('host')}`;

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/settings.html?stripe=refresh`,
      return_url:  `${baseUrl}/settings.html?stripe=connected`,
      type: 'account_onboarding',
    });
    res.json({ url: accountLink.url });
  } catch (err) {
    console.error('Stripe refresh error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Sync account status from Stripe ──────────────────────────────────────────
router.post('/sync', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const stripe = await getStripe();
    const result = await pool.query(
      `SELECT stripe_account_id FROM users WHERE id = $1`, [req.userId]
    );
    const accountId = result.rows[0]?.stripe_account_id;
    if (!accountId) return res.status(400).json({ error: 'No connected account' });

    const account = await stripe.accounts.retrieve(accountId);
    await pool.query(
      `UPDATE users
       SET stripe_charges_enabled = $1, stripe_payouts_enabled = $2, stripe_account_email = $3
       WHERE id = $4`,
      [account.charges_enabled, account.payouts_enabled, account.email || null, req.userId]
    );

    res.json({
      connected:       true,
      account_id:      accountId,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      account_email:   account.email || null,
    });
  } catch (err) {
    console.error('Stripe sync error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Disconnect ────────────────────────────────────────────────────────────────
router.delete('/disconnect', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    await pool.query(
      `UPDATE users
       SET stripe_account_id = NULL, stripe_charges_enabled = false,
           stripe_payouts_enabled = false, stripe_account_email = NULL
       WHERE id = $1`,
      [req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Stripe disconnect error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
