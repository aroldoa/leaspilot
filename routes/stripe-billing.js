/**
 * Platform billing — Stripe Subscriptions for landlords paying LeasePilot monthly dues.
 *
 * GET  /api/billing/status    → current plan + subscription state
 * POST /api/billing/subscribe → Stripe Checkout for subscription → { checkoutUrl }
 * POST /api/billing/portal    → Stripe Customer Portal (manage / cancel) → { portalUrl }
 * POST /api/billing/webhook   → Stripe webhook: invoice.paid, subscription events
 */
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return import('stripe').then(m => new m.default(key));
}

async function getOrCreateCustomer(stripe, pool, userId) {
  const result = await pool.query(
    'SELECT email, name, stripe_customer_id FROM users WHERE id = $1',
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw new Error('User not found');

  if (user.stripe_customer_id) return user.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || user.email,
    metadata: { leasepilot_user_id: String(userId) },
  });

  await pool.query(
    'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
    [customer.id, userId]
  );

  return customer.id;
}

// ── Webhook (raw body — must be first) ────────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const pool = req.app.locals.pool;
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !webhookSecret) {
    return res.status(500).json({ error: 'Billing webhook not configured' });
  }

  let event;
  try {
    if (webhookSecret) {
      const stripe = await getStripe();
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Billing webhook error:', err.message);
    return res.status(400).json({ error: 'Webhook signature failed' });
  }

  const obj = event.data.object;

  try {
    switch (event.type) {
      // Subscription created or updated
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const status = obj.status;
        const priceId = obj.items?.data?.[0]?.price?.id;
        const plan = planFromPrice(priceId) || obj.items?.data?.[0]?.price?.nickname || 'starter';
        await pool.query(
          `UPDATE users
           SET subscription_id = $1, subscription_status = $2, plan = $3
           WHERE stripe_customer_id = $4`,
          [obj.id, status, status === 'active' ? plan : 'free', obj.customer]
        );
        break;
      }

      // Subscription cancelled / expired
      case 'customer.subscription.deleted': {
        await pool.query(
          `UPDATE users
           SET subscription_id = NULL, subscription_status = 'canceled', plan = 'free'
           WHERE stripe_customer_id = $1`,
          [obj.customer]
        );
        break;
      }

      // Invoice paid — keep status fresh
      case 'invoice.paid': {
        if (obj.subscription) {
          await pool.query(
            `UPDATE users SET subscription_status = 'active'
             WHERE stripe_customer_id = $1`,
            [obj.customer]
          );
        }
        break;
      }

      // Invoice payment failed — flag as past_due
      case 'invoice.payment_failed': {
        if (obj.subscription) {
          await pool.query(
            `UPDATE users SET subscription_status = 'past_due'
             WHERE stripe_customer_id = $1`,
            [obj.customer]
          );
        }
        break;
      }

      // Checkout completed — link subscription if it's a billing checkout
      case 'checkout.session.completed': {
        if (obj.mode === 'subscription' && obj.subscription) {
          const userId = obj.metadata?.leasepilot_user_id;
          const plan = obj.metadata?.plan || 'starter';
          if (userId) {
            await pool.query(
              `UPDATE users SET subscription_id = $1, subscription_status = 'active', plan = $2,
               stripe_customer_id = COALESCE(stripe_customer_id, $3)
               WHERE id = $4`,
              [obj.subscription, plan, obj.customer, parseInt(userId, 10)]
            );
          }
        }
        break;
      }
    }
  } catch (err) {
    console.error('Billing webhook DB error:', err);
    return res.status(500).json({ error: 'Database error' });
  }

  res.json({ received: true });
});

// ── Authenticated routes ───────────────────────────────────────────────────────
router.use(authenticateToken);

// GET /api/billing/status
router.get('/status', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(
      `SELECT plan, subscription_status, subscription_id, stripe_customer_id
       FROM users WHERE id = $1`,
      [req.userId]
    );
    const row = result.rows[0] || {};
    res.json({
      plan: row.plan || 'free',
      subscription_status: row.subscription_status || 'inactive',
      subscription_id: row.subscription_id || null,
      has_customer: !!row.stripe_customer_id,
      is_active: row.subscription_status === 'active',
    });
  } catch (err) {
    console.error('Billing status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Plan + interval → price ID
function getPriceId(plan, interval = 'monthly') {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
  return process.env[key] || null;
}

// Price ID → plan name
function planFromPrice(priceId) {
  const plans = ['starter', 'growth', 'portfolio'];
  const intervals = ['monthly', 'annual'];
  for (const plan of plans) {
    for (const interval of intervals) {
      const key = `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
      if (process.env[key] === priceId) return plan;
    }
  }
  return 'pro';
}

// POST /api/billing/subscribe — create Checkout Session for subscription
router.post('/subscribe', async (req, res) => {
  const pool = req.app.locals.pool;
  const { plan = 'starter', interval = 'monthly' } = req.body;

  const priceId = getPriceId(plan, interval);
  if (!priceId) {
    return res.status(500).json({ error: `Price ID for ${plan} (${interval}) is not configured.` });
  }

  try {
    const stripe = await getStripe();
    const customerId = await getOrCreateCustomer(stripe, pool, req.userId);

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${proto}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { leasepilot_user_id: String(req.userId), plan, interval },
      success_url: `${baseUrl}/settings.html?billing=success`,
      cancel_url: `${baseUrl}/settings.html?billing=cancelled`,
      allow_promotion_codes: true,
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/billing/portal — open Stripe Customer Portal (manage/cancel)
router.post('/portal', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const stripe = await getStripe();
    const customerId = await getOrCreateCustomer(stripe, pool, req.userId);

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${proto}://${req.get('host')}`;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/settings.html`,
    });

    res.json({ portalUrl: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

export default router;
