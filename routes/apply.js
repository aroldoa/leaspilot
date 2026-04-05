/**
 * Public rental application routes — no auth required.
 * GET  /api/apply/:token          → property info for the form
 * POST /api/apply/:token          → submit application + create Stripe checkout
 * POST /api/apply/webhook         → Stripe webhook (must be before /:token route)
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

const router = express.Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────
const applyReadLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const applySubmitLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many application submissions from this IP.' },
});

// ── Input schema ──────────────────────────────────────────────────────────────
const ApplicationSchema = z.object({
  first_name:             z.string().min(1).max(100).trim(),
  last_name:              z.string().min(1).max(100).trim(),
  email:                  z.string().email().max(255).toLowerCase(),
  phone:                  z.string().max(50).trim().optional().nullable(),
  date_of_birth:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  employer:               z.string().max(255).trim().optional().nullable(),
  job_title:              z.string().max(255).trim().optional().nullable(),
  monthly_income:         z.coerce.number().min(0).max(10_000_000).optional().nullable(),
  employment_status:      z.enum(['employed','part_time','self_employed','retired','student','unemployed']).optional(),
  current_address:        z.string().max(500).trim().optional().nullable(),
  current_landlord:       z.string().max(255).trim().optional().nullable(),
  current_landlord_phone: z.string().max(50).trim().optional().nullable(),
  move_in_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  reason_for_moving:      z.string().max(2000).trim().optional().nullable(),
  num_occupants:          z.coerce.number().int().min(1).max(20).default(1),
  has_pets:               z.union([z.boolean(), z.enum(['true','false'])]).transform(v => v === true || v === 'true').default(false),
  pet_description:        z.string().max(500).trim().optional().nullable(),
  additional_notes:       z.string().max(2000).trim().optional().nullable(),
});

// ── Stripe webhook (raw body — must stay before JSON middleware) ───────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const pool = req.app.locals.pool;
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  // Block unauthenticated webhooks in production
  if (isProduction && !webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set in production — webhook rejected');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let event;
  try {
    if (webhookSecret) {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // Dev/demo only — never reached in production (guarded above)
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Stripe webhook signature error:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const applicationId = parseInt(session.metadata?.applicationId, 10);
    if (applicationId) {
      try {
        // Idempotency: only update if still pending to prevent double-processing
        await pool.query(
          `UPDATE rental_applications
           SET payment_status = 'paid', stripe_payment_intent = $1, updated_at = NOW()
           WHERE id = $2 AND payment_status != 'paid'`,
          [session.payment_intent, applicationId]
        );
      } catch (err) {
        console.error('Webhook DB update error:', err);
        // Return 500 so Stripe retries — do NOT return 200 on DB failure
        return res.status(500).json({ error: 'Database error' });
      }
    }
  }

  res.json({ received: true });
});

// ── Get property info by token ────────────────────────────────────────────────
router.get('/:token', applyReadLimit, async (req, res) => {
  const pool = req.app.locals.pool;
  // Tokens are 64-char hex strings — reject anything else immediately
  if (!/^[a-f0-9]{64}$/.test(req.params.token)) {
    return res.status(404).json({ error: 'Application link not found' });
  }
  try {
    const result = await pool.query(`
      SELECT pl.id, pl.token, pl.application_fee, pl.is_active,
             p.id AS property_id, p.name, p.address, p.city, p.state, p.zip,
             p.bedrooms, p.bathrooms, p.rent,
             u.name AS manager_name
      FROM property_listings pl
      JOIN properties p ON p.id = pl.property_id
      JOIN users      u ON u.id = p.user_id
      WHERE pl.token = $1
    `, [req.params.token]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application link not found' });
    }
    const listing = result.rows[0];
    if (!listing.is_active) {
      return res.status(410).json({ error: 'This application link is no longer active' });
    }
    res.json(listing);
  } catch (err) {
    console.error('Apply GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Submit application + create Stripe checkout ───────────────────────────────
router.post('/:token', applySubmitLimit, async (req, res) => {
  const pool = req.app.locals.pool;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!/^[a-f0-9]{64}$/.test(req.params.token)) {
    return res.status(404).json({ error: 'Application link not found' });
  }

  // Validate and sanitize input
  const parsed = ApplicationSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return res.status(400).json({ error: `${first.path.join('.')}: ${first.message}` });
  }
  const data = parsed.data;

  try {
    const listingResult = await pool.query(`
      SELECT pl.*, p.name AS property_name, p.address, p.city, p.state
      FROM property_listings pl
      JOIN properties p ON p.id = pl.property_id
      WHERE pl.token = $1 AND pl.is_active = true
    `, [req.params.token]);

    if (listingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application link not found or inactive' });
    }

    const listing = listingResult.rows[0];

    // Insert application (pending payment)
    const appResult = await pool.query(`
      INSERT INTO rental_applications (
        listing_id, property_id, first_name, last_name, email, phone, date_of_birth,
        employer, job_title, monthly_income, employment_status,
        current_address, current_landlord, current_landlord_phone,
        move_in_date, reason_for_moving, num_occupants, has_pets, pet_description,
        additional_notes, application_fee, payment_status, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'pending','submitted')
      RETURNING id
    `, [
      listing.id, listing.property_id,
      data.first_name, data.last_name, data.email,
      data.phone ?? null, data.date_of_birth ?? null,
      data.employer ?? null, data.job_title ?? null,
      data.monthly_income ?? null,
      data.employment_status ?? 'employed',
      data.current_address ?? null, data.current_landlord ?? null, data.current_landlord_phone ?? null,
      data.move_in_date ?? null, data.reason_for_moving ?? null,
      data.num_occupants,
      data.has_pets,
      data.pet_description ?? null, data.additional_notes ?? null,
      listing.application_fee,
    ]);

    const applicationId = appResult.rows[0].id;

    // No Stripe key → mark paid immediately (dev/demo mode)
    if (!stripeKey) {
      await pool.query(
        `UPDATE rental_applications SET payment_status = 'paid' WHERE id = $1`,
        [applicationId]
      );
      return res.json({ success: true, applicationId, noPayment: true });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${proto}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Rental Application – ${listing.property_name}`,
            description: `${listing.address}, ${listing.city}, ${listing.state}`,
          },
          unit_amount: Math.round(listing.application_fee * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: data.email,
      metadata: { applicationId: String(applicationId) },
      success_url: `${baseUrl}/apply.html?token=${req.params.token}&success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/apply.html?token=${req.params.token}&cancelled=1`,
    });

    await pool.query(
      `UPDATE rental_applications SET stripe_session_id = $1 WHERE id = $2`,
      [session.id, applicationId]
    );

    res.json({ checkoutUrl: session.url, applicationId });
  } catch (err) {
    console.error('Apply POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
