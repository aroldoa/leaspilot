/**
 * Public rental application routes — no auth required.
 * GET  /api/apply/:token          → property info for the form
 * POST /api/apply/:token          → submit application + create Stripe checkout
 * POST /api/apply/webhook         → Stripe webhook (must be before /:token route)
 */
import express from 'express';

const router = express.Router();

// ── Stripe webhook (raw body) ─────────────────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const pool = req.app.locals.pool;
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (webhookSecret) {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const applicationId = session.metadata?.applicationId;
    if (applicationId) {
      await pool.query(
        `UPDATE rental_applications
         SET payment_status = 'paid', stripe_payment_intent = $1, updated_at = NOW()
         WHERE id = $2`,
        [session.payment_intent, applicationId]
      ).catch(err => console.error('Webhook DB update error:', err));
    }
  }

  res.json({ received: true });
});

// ── Get property info by token ────────────────────────────────────────────────
router.get('/:token', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT pl.id, pl.token, pl.application_fee, pl.is_active,
             p.id AS property_id, p.name, p.address, p.city, p.state, p.zip,
             p.bedrooms, p.bathrooms, p.rent_amount,
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
router.post('/:token', async (req, res) => {
  const pool = req.app.locals.pool;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

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
    const {
      first_name, last_name, email, phone, date_of_birth,
      employer, job_title, monthly_income, employment_status,
      current_address, current_landlord, current_landlord_phone,
      move_in_date, reason_for_moving,
      num_occupants, has_pets, pet_description, additional_notes,
    } = req.body;

    if (!first_name || !last_name || !email) {
      return res.status(400).json({ error: 'First name, last name, and email are required' });
    }

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
      first_name, last_name, email,
      phone || null, date_of_birth || null,
      employer || null, job_title || null,
      monthly_income ? parseFloat(monthly_income) : null,
      employment_status || 'employed',
      current_address || null, current_landlord || null, current_landlord_phone || null,
      move_in_date || null, reason_for_moving || null,
      parseInt(num_occupants) || 1,
      has_pets === true || has_pets === 'true',
      pet_description || null, additional_notes || null,
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
      customer_email: email,
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
