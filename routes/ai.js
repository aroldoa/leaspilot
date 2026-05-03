/**
 * AI-powered endpoints using Google Gemini Flash (free tier).
 * Falls back to rule-based logic if GOOGLE_AI_API_KEY is not set.
 *
 * GET  /api/ai/recommendation          → dashboard portfolio recommendation
 * POST /api/ai/screen-applicant/:id    → tenant application screening
 * POST /api/ai/classify-maintenance/:id → maintenance priority/type classification
 * GET  /api/ai/income-analysis         → per-property income optimization suggestions
 */
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// ── Gemini helper ─────────────────────────────────────────────────────────────
async function callGemini(prompt) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return null;
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Gemini API error:', err.message);
    return null;
  }
}

function parseJSON(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// ── GET /api/ai/recommendation ────────────────────────────────────────────────
router.get('/recommendation', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId;

  try {
    const today = new Date();
    const in60Days   = new Date(today); in60Days.setDate(today.getDate() + 60);
    const in30Days   = new Date(today); in30Days.setDate(today.getDate() + 30);
    const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(today.getDate() - 30);

    const [propsRes, tenantsRes, maintRes, txnRes] = await Promise.all([
      pool.query(`SELECT id, name, status, rent FROM properties WHERE user_id = $1`, [userId]),
      pool.query(`
        SELECT t.id, t.first_name, t.last_name, t.status, t.lease_end, t.balance, t.unit,
               p.name AS property_name
        FROM tenants t
        JOIN properties p ON p.id = t.property_id
        WHERE p.user_id = $1
      `, [userId]),
      pool.query(`
        SELECT mr.id, mr.subject, mr.status, mr.priority, mr.created_at,
               p.name AS property_name
        FROM maintenance_requests mr
        JOIN properties p ON p.id = mr.property_id
        WHERE p.user_id = $1 AND mr.status NOT IN ('completed','closed')
      `, [userId]),
      pool.query(`
        SELECT type, amount, transaction_date
        FROM transactions
        WHERE user_id = $1 AND transaction_date >= $2
        ORDER BY transaction_date DESC
      `, [userId, thirtyDaysAgo.toISOString().split('T')[0]]),
    ]);

    const props      = propsRes.rows;
    const tenants    = tenantsRes.rows;
    const openMaint  = maintRes.rows;
    const recentTxns = txnRes.rows;

    const totalProps   = props.length;
    const occupied     = props.filter(p => (p.status || '').toLowerCase() === 'occupied').length;
    const vacant       = props.filter(p => (p.status || '').toLowerCase() === 'vacant').length;
    const maintenance  = props.filter(p => (p.status || '').toLowerCase() === 'maintenance').length;
    const occupancyPct = totalProps > 0 ? Math.round(occupied / totalProps * 100) : 0;

    const emergencies     = openMaint.filter(r => (r.priority || '').toLowerCase() === 'emergency');
    const openCount       = openMaint.length;
    const expiringIn30    = tenants.filter(t => { if (!t.lease_end) return false; const d = new Date(t.lease_end); return d >= today && d <= in30Days; });
    const expiringIn60    = tenants.filter(t => { if (!t.lease_end) return false; const d = new Date(t.lease_end); return d > in30Days && d <= in60Days; });
    const overdueBalance  = tenants.filter(t => parseFloat(t.balance || 0) < 0);

    const income30d  = recentTxns.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const expense30d = recentTxns.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const netIncome  = income30d - expense30d;

    const context = {
      totalProperties: totalProps,
      occupied, vacant, maintenanceStatus: maintenance,
      occupancyRate: `${occupancyPct}%`,
      openMaintenanceRequests: openCount,
      emergencyRequests: emergencies.length,
      emergencyDetails: emergencies.slice(0, 3).map(e => e.subject),
      leasesExpiringIn30Days: expiringIn30.length,
      leasesExpiringIn31To60Days: expiringIn60.length,
      tenantsWithOverdueBalance: overdueBalance.length,
      last30DaysIncome: Math.round(income30d),
      last30DaysExpenses: Math.round(expense30d),
      last30DaysNetIncome: Math.round(netIncome),
    };

    const raw = await callGemini(
      `You are an AI assistant for a property management platform. Based on this portfolio data, give ONE concise, specific, actionable recommendation (2 sentences max). Be direct and practical. Return only valid JSON with no markdown: {"title": "short title 4-6 words", "description": "your recommendation", "action": "link_key"} where link_key is one of: maintenance, tenants, properties, financials, messages.\n\nPortfolio data: ${JSON.stringify(context)}`
    );

    const parsed = parseJSON(raw);
    if (parsed?.title) {
      return res.json({ title: parsed.title, description: parsed.description || '', action: parsed.action || 'properties', source: 'ai', context });
    }

    // Rule-based fallback
    let title, description, action;
    if (emergencies.length > 0) {
      title = `${emergencies.length} Emergency Request${emergencies.length > 1 ? 's' : ''} Need Attention`;
      description = `You have ${emergencies.length} emergency maintenance request${emergencies.length > 1 ? 's' : ''} open${emergencies[0]?.subject ? ` including "${emergencies[0].subject}"` : ''}. These should be addressed immediately.`;
      action = 'maintenance';
    } else if (expiringIn30.length > 0) {
      title = `${expiringIn30.length} Lease${expiringIn30.length > 1 ? 's' : ''} Expiring This Month`;
      description = `${expiringIn30.length} tenant lease${expiringIn30.length > 1 ? 's expire' : ' expires'} within 30 days. Reach out now to begin renewal conversations.`;
      action = 'tenants';
    } else if (overdueBalance.length > 0) {
      title = `${overdueBalance.length} Tenant${overdueBalance.length > 1 ? 's' : ''} With Outstanding Balance`;
      description = `${overdueBalance.length} tenant${overdueBalance.length > 1 ? 's have' : ' has'} an outstanding balance. Review their accounts and follow up.`;
      action = 'tenants';
    } else if (openCount > 0) {
      title = `${openCount} Open Maintenance Request${openCount > 1 ? 's' : ''}`;
      description = `${openCount} maintenance request${openCount > 1 ? 's are' : ' is'} awaiting action.${vacant > 0 ? ` Also, ${vacant} propert${vacant > 1 ? 'ies are' : 'y is'} vacant.` : ''}`;
      action = 'maintenance';
    } else if (vacant > 0) {
      title = `${vacant} Vacant Propert${vacant > 1 ? 'ies' : 'y'} Available`;
      description = `${vacant} of your ${totalProps} propert${totalProps > 1 ? 'ies are' : 'y is'} currently vacant. Share an application link to find qualified tenants faster.`;
      action = 'properties';
    } else if (expiringIn60.length > 0) {
      title = `${expiringIn60.length} Lease${expiringIn60.length > 1 ? 's' : ''} Expiring in 60 Days`;
      description = `${expiringIn60.length} lease${expiringIn60.length > 1 ? 's expire' : ' expires'} within 60 days. Starting renewal conversations early improves retention.`;
      action = 'tenants';
    } else if (netIncome < 0) {
      title = 'Expenses Exceed Income This Month';
      description = `Your portfolio spent $${Math.abs(netIncome).toLocaleString()} more than it earned in the last 30 days. Review financials to identify cost-reduction opportunities.`;
      action = 'financials';
    } else {
      title = 'Portfolio Running Smoothly';
      description = `${occupancyPct}% occupancy, no urgent maintenance, no expiring leases. A great time to review financials or explore adding new properties.`;
      action = 'properties';
    }

    res.json({ title, description, action, source: 'rules', context });
  } catch (err) {
    console.error('AI recommendation error:', err);
    res.status(500).json({ error: 'Failed to generate recommendation' });
  }
});

// ── POST /api/ai/screen-applicant/:id ─────────────────────────────────────────
router.post('/screen-applicant/:id', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId;
  const appId = parseInt(req.params.id, 10);
  if (!appId) return res.status(400).json({ error: 'Invalid application ID' });

  try {
    // Verify ownership and fetch application + property rent
    const result = await pool.query(`
      SELECT ra.*, p.rent AS property_rent, p.name AS property_name
      FROM rental_applications ra
      JOIN properties p ON p.id = ra.property_id
      WHERE ra.id = $1 AND p.user_id = $2
    `, [appId, userId]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Application not found' });
    const app = result.rows[0];

    // Return cached result if already analyzed (unless force=true)
    if (app.ai_analyzed_at && req.query.force !== 'true') {
      return res.json({
        recommendation: app.ai_recommendation,
        score: app.ai_score,
        summary: app.ai_summary,
        flags: [],
        cached: true,
        analyzed_at: app.ai_analyzed_at,
      });
    }

    const rent = parseFloat(app.property_rent || 0);
    const income = parseFloat(app.monthly_income || 0);
    const incomeRatio = rent > 0 ? (income / rent).toFixed(2) : null;

    const context = {
      property_name: app.property_name,
      monthly_rent: rent,
      applicant: {
        employment_status: app.employment_status,
        employer: app.employer,
        job_title: app.job_title,
        monthly_income: income,
        income_to_rent_ratio: incomeRatio,
        num_occupants: app.num_occupants,
        has_pets: app.has_pets,
        reason_for_moving: app.reason_for_moving,
        current_landlord: app.current_landlord,
        additional_notes: app.additional_notes,
        move_in_date: app.move_in_date,
      },
    };

    const raw = await callGemini(
      `You are a tenant screening assistant for a property management platform. Analyze this rental application and return only valid JSON with no markdown:\n{"recommendation":"approve|review|deny","score":1-10,"summary":"2-3 sentence analysis","flags":["list","of","concerns"]}\n\nScore 8-10 = strong approve, 5-7 = needs review, 1-4 = deny. Consider income ratio (3x rent is standard), employment stability, and any red flags.\n\nApplication data: ${JSON.stringify(context)}`
    );

    let recommendation, score, summary, flags;
    const parsed = parseJSON(raw);
    if (parsed?.recommendation) {
      recommendation = parsed.recommendation;
      score = parsed.score;
      summary = parsed.summary || '';
      flags = parsed.flags || [];
    } else {
      // Rule-based fallback
      flags = [];
      if (app.employment_status === 'unemployed') flags.push('Currently unemployed');
      if (incomeRatio !== null && parseFloat(incomeRatio) < 2) flags.push(`Income ratio ${incomeRatio}x is below 2x minimum`);
      else if (incomeRatio !== null && parseFloat(incomeRatio) < 2.5) flags.push(`Income ratio ${incomeRatio}x is below recommended 2.5x`);

      if (app.employment_status === 'unemployed' || (incomeRatio !== null && parseFloat(incomeRatio) < 2)) {
        recommendation = 'deny'; score = 3;
        summary = `Applicant does not meet minimum income requirements. Income ratio is ${incomeRatio}x against a 2x minimum.`;
      } else if (flags.length > 0 || (incomeRatio !== null && parseFloat(incomeRatio) < 2.5)) {
        recommendation = 'review'; score = 6;
        summary = `Applicant meets minimum requirements but has items worth reviewing. Income ratio is ${incomeRatio}x rent.`;
      } else {
        recommendation = 'approve'; score = 8;
        summary = `Applicant appears to meet standard qualification criteria. Income ratio is ${incomeRatio}x rent with stable employment.`;
      }
    }

    // Cache result on the application row
    await pool.query(
      `UPDATE rental_applications
       SET ai_recommendation = $1, ai_score = $2, ai_summary = $3, ai_analyzed_at = NOW()
       WHERE id = $4`,
      [recommendation, score, summary, appId]
    );

    res.json({ recommendation, score, summary, flags, cached: false, source: parsed ? 'ai' : 'rules' });
  } catch (err) {
    console.error('AI screening error:', err);
    res.status(500).json({ error: 'Failed to screen application' });
  }
});

// ── POST /api/ai/classify-maintenance/:id ─────────────────────────────────────
router.post('/classify-maintenance/:id', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId;
  const reqId = parseInt(req.params.id, 10);
  if (!reqId) return res.status(400).json({ error: 'Invalid request ID' });

  try {
    // Verify ownership
    const result = await pool.query(`
      SELECT mr.*
      FROM maintenance_requests mr
      JOIN properties p ON p.id = mr.property_id
      WHERE mr.id = $1 AND p.user_id = $2
    `, [reqId, userId]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Maintenance request not found' });
    const mr = result.rows[0];

    // Return cached result
    if (mr.ai_issue_type && req.query.force !== 'true') {
      return res.json({
        priority: mr.ai_priority,
        issue_type: mr.ai_issue_type,
        summary: mr.ai_summary,
        cached: true,
      });
    }

    const raw = await callGemini(
      `You are a property maintenance classifier. Analyze this maintenance request and return only valid JSON with no markdown:\n{"priority":"emergency|high|normal|low","issue_type":"plumbing|electrical|hvac|appliance|structural|pest|other","summary":"1-2 sentence assessment","response_window":"e.g. Immediate, Within 24 hours, Within 3 days, Within a week"}\n\nSubject: ${mr.subject}\nDescription: ${mr.description || '(no description provided)'}`
    );

    let priority, issue_type, summary, response_window;
    const parsed = parseJSON(raw);
    if (parsed?.issue_type) {
      priority = parsed.priority;
      issue_type = parsed.issue_type;
      summary = parsed.summary || '';
      response_window = parsed.response_window || '';
    } else {
      // Keyword-based fallback
      const text = `${mr.subject} ${mr.description || ''}`.toLowerCase();
      if (/flood|fire|gas leak|no heat|burst pipe|sewage|electrical spark/.test(text)) {
        priority = 'emergency'; issue_type = 'other'; response_window = 'Immediate';
        summary = 'This appears to be an emergency situation requiring immediate attention.';
      } else if (/leak|drain|toilet|water damage|pipe/.test(text)) {
        priority = 'high'; issue_type = 'plumbing'; response_window = 'Within 24 hours';
        summary = 'Plumbing issue detected. Should be addressed promptly to prevent further damage.';
      } else if (/outlet|breaker|power|electrical|wiring/.test(text)) {
        priority = 'high'; issue_type = 'electrical'; response_window = 'Within 24 hours';
        summary = 'Electrical issue detected. Should be assessed by a qualified electrician.';
      } else if (/ac|heat|hvac|furnace|air conditioning/.test(text)) {
        priority = 'high'; issue_type = 'hvac'; response_window = 'Within 24 hours';
        summary = 'HVAC issue detected. Comfort and habitability may be affected.';
      } else if (/pest|bug|roach|mouse|rat|ant/.test(text)) {
        priority = 'normal'; issue_type = 'pest'; response_window = 'Within 3 days';
        summary = 'Pest issue reported. Schedule exterminator visit.';
      } else {
        priority = 'normal'; issue_type = 'other'; response_window = 'Within a week';
        summary = 'General maintenance request. Review and schedule accordingly.';
      }
    }

    // Cache on the request row
    await pool.query(
      `UPDATE maintenance_requests
       SET ai_priority = $1, ai_issue_type = $2, ai_summary = $3
       WHERE id = $4`,
      [priority, issue_type, summary, reqId]
    );

    res.json({ priority, issue_type, summary, response_window, cached: false, source: parsed ? 'ai' : 'rules' });
  } catch (err) {
    console.error('AI maintenance classification error:', err);
    res.status(500).json({ error: 'Failed to classify maintenance request' });
  }
});

// ── GET /api/ai/income-analysis ───────────────────────────────────────────────
router.get('/income-analysis', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId;

  try {
    const today = new Date();
    const ninetyDaysAgo = new Date(today); ninetyDaysAgo.setDate(today.getDate() - 90);

    const [propsRes, txnRes] = await Promise.all([
      pool.query(`
        SELECT p.id, p.name, p.rent, p.sqft, p.bedrooms, p.bathrooms,
               p.status, p.city, p.state, p.updated_at,
               COUNT(t.id) AS tenant_count,
               AVG(t.balance) AS avg_balance
        FROM properties p
        LEFT JOIN tenants t ON t.property_id = p.id AND t.status = 'active'
        WHERE p.user_id = $1
        GROUP BY p.id
        ORDER BY p.status, p.name
      `, [userId]),
      pool.query(`
        SELECT property_id, type, SUM(amount) AS total
        FROM transactions
        WHERE user_id = $1 AND transaction_date >= $2
        GROUP BY property_id, type
      `, [userId, ninetyDaysAgo.toISOString().split('T')[0]]),
    ]);

    const props = propsRes.rows;
    if (props.length === 0) return res.json({ suggestions: [] });

    // Build per-property financials
    const txnMap = {};
    for (const t of txnRes.rows) {
      if (!txnMap[t.property_id]) txnMap[t.property_id] = { income: 0, expenses: 0 };
      if (t.type === 'income') txnMap[t.property_id].income += parseFloat(t.total);
      else txnMap[t.property_id].expenses += parseFloat(t.total);
    }

    const propertyData = props.map(p => {
      const txn = txnMap[p.id] || { income: 0, expenses: 0 };
      const vacantDays = p.status === 'vacant'
        ? Math.floor((today - new Date(p.updated_at)) / (1000 * 60 * 60 * 24))
        : 0;
      return {
        name: p.name,
        status: p.status,
        monthly_rent: parseFloat(p.rent || 0),
        bedrooms: p.bedrooms,
        sqft: p.sqft,
        city: p.city,
        state: p.state,
        tenant_count: parseInt(p.tenant_count || 0),
        vacant_days: vacantDays,
        last_90_days_income: Math.round(txn.income),
        last_90_days_expenses: Math.round(txn.expenses),
        net_income_90d: Math.round(txn.income - txn.expenses),
      };
    });

    const raw = await callGemini(
      `You are a property investment advisor. Analyze this rental portfolio and return only valid JSON with no markdown — an array of up to 5 income optimization suggestions:\n[{"property_name":"name or 'Portfolio'","suggestion":"specific actionable advice","potential_impact":"e.g. +$200/mo","action":"properties|tenants|financials|maintenance"}]\n\nBe specific — mention actual property names, dollar amounts, and concrete steps. Focus on vacant properties, underpriced rents, high expenses, or missed income opportunities.\n\nPortfolio: ${JSON.stringify(propertyData)}`
    );

    let suggestions = parseJSON(raw);
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      // Rule-based fallback
      suggestions = [];
      for (const p of propertyData) {
        if (p.status === 'vacant' && p.vacant_days > 30) {
          suggestions.push({
            property_name: p.name,
            suggestion: `${p.name} has been vacant for ${p.vacant_days} days. Consider reducing the asking rent by 5-10% or sharing the application link to attract qualified tenants faster.`,
            potential_impact: `Filling vacancy adds $${p.monthly_rent.toLocaleString()}/mo`,
            action: 'properties',
          });
        } else if (p.status === 'occupied' && p.last_90_days_income === 0) {
          suggestions.push({
            property_name: p.name,
            suggestion: `No income recorded for ${p.name} in the last 90 days. Verify rent collection is up to date and all payments are logged.`,
            potential_impact: 'Recover potentially missed rent',
            action: 'financials',
          });
        } else if (p.net_income_90d < 0) {
          suggestions.push({
            property_name: p.name,
            suggestion: `${p.name} had negative net income over the last 90 days ($${Math.abs(p.net_income_90d).toLocaleString()} deficit). Review expenses for cost reduction opportunities.`,
            potential_impact: `Reduce expenses to improve cash flow`,
            action: 'financials',
          });
        }
        if (suggestions.length >= 5) break;
      }
      if (suggestions.length === 0) {
        suggestions.push({
          property_name: 'Portfolio',
          suggestion: 'Your portfolio appears healthy. Consider reviewing market rent rates annually to ensure your properties are priced competitively.',
          potential_impact: 'Maximize rental income',
          action: 'properties',
        });
      }
    }

    res.json({ suggestions, source: raw && parseJSON(raw) ? 'ai' : 'rules' });
  } catch (err) {
    console.error('AI income analysis error:', err);
    res.status(500).json({ error: 'Failed to generate income analysis' });
  }
});

// ── GET /api/ai/insights-summary ─────────────────────────────────────────────
router.get('/insights-summary', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId;
  try {
    const [appRes, maintRes] = await Promise.all([
      pool.query(`
        SELECT ra.id, ra.first_name, ra.last_name, ra.email, ra.status,
               ra.ai_recommendation, ra.ai_score, ra.ai_summary, ra.ai_analyzed_at,
               p.name AS property_name
        FROM rental_applications ra
        JOIN properties p ON p.id = ra.property_id
        WHERE p.user_id = $1 AND ra.ai_analyzed_at IS NOT NULL
        ORDER BY ra.ai_analyzed_at DESC
        LIMIT 10
      `, [userId]),
      pool.query(`
        SELECT mr.id, mr.subject, mr.status, mr.priority,
               mr.ai_priority, mr.ai_issue_type, mr.ai_summary,
               p.name AS property_name
        FROM maintenance_requests mr
        JOIN properties p ON p.id = mr.property_id
        WHERE p.user_id = $1 AND mr.ai_issue_type IS NOT NULL
        ORDER BY mr.updated_at DESC
        LIMIT 10
      `, [userId]),
    ]);
    res.json({
      screened_applications: appRes.rows,
      classified_maintenance: maintRes.rows,
    });
  } catch (err) {
    console.error('AI insights summary error:', err);
    res.status(500).json({ error: 'Failed to load insights summary' });
  }
});

// ── GET /api/ai/property-insights/:id ─────────────────────────────────────────
router.get('/property-insights/:id', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId;
  const propId = parseInt(req.params.id, 10);
  if (!propId) return res.status(400).json({ error: 'Invalid property ID' });

  try {
    const ninetyDaysAgo = new Date(); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const today = new Date();

    const [propRes, txnRes, maintRes, appRes] = await Promise.all([
      pool.query(`
        SELECT p.*, COUNT(t.id) AS tenant_count
        FROM properties p
        LEFT JOIN tenants t ON t.property_id = p.id AND t.status = 'active'
        WHERE p.id = $1 AND p.user_id = $2
        GROUP BY p.id
      `, [propId, userId]),
      pool.query(`
        SELECT type, SUM(amount) AS total
        FROM transactions
        WHERE property_id = $1 AND transaction_date >= $2
        GROUP BY type
      `, [propId, ninetyDaysAgo.toISOString().split('T')[0]]),
      pool.query(`
        SELECT mr.id, mr.subject, mr.status, mr.priority, mr.created_at,
               mr.ai_priority, mr.ai_issue_type, mr.ai_summary,
               t.first_name AS tenant_first_name, t.last_name AS tenant_last_name
        FROM maintenance_requests mr
        LEFT JOIN tenants t ON t.id = mr.tenant_id
        WHERE mr.property_id = $1 AND mr.status NOT IN ('completed','closed')
        ORDER BY CASE WHEN mr.priority = 'emergency' THEN 0 ELSE 1 END, mr.created_at DESC
      `, [propId]),
      pool.query(`
        SELECT ra.id, ra.first_name, ra.last_name, ra.status, ra.payment_status,
               ra.ai_recommendation, ra.ai_score, ra.ai_summary, ra.submitted_at
        FROM rental_applications ra
        WHERE ra.property_id = $1
        ORDER BY ra.submitted_at DESC
        LIMIT 10
      `, [propId]),
    ]);

    if (propRes.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
    const prop = propRes.rows[0];

    const income90d = txnRes.rows.find(r => r.type === 'income');
    const expense90d = txnRes.rows.find(r => r.type === 'expense');
    const netIncome = (parseFloat(income90d?.total || 0) - parseFloat(expense90d?.total || 0));
    const vacantDays = prop.status === 'vacant'
      ? Math.floor((today - new Date(prop.updated_at)) / (1000 * 60 * 60 * 24))
      : 0;

    const context = {
      property_name: prop.name,
      status: prop.status,
      monthly_rent: parseFloat(prop.rent || 0),
      bedrooms: prop.bedrooms,
      sqft: prop.sqft,
      city: prop.city,
      state: prop.state,
      tenant_count: parseInt(prop.tenant_count || 0),
      vacant_days: vacantDays,
      open_maintenance: maintRes.rows.length,
      emergency_maintenance: maintRes.rows.filter(r => r.priority === 'emergency').length,
      income_90d: Math.round(parseFloat(income90d?.total || 0)),
      expenses_90d: Math.round(parseFloat(expense90d?.total || 0)),
      net_income_90d: Math.round(netIncome),
      total_applications: appRes.rows.length,
    };

    const raw = await callGemini(
      `You are a property investment advisor. Analyze this single rental property and return only valid JSON with no markdown:\n{"analysis":"2-3 sentence overall assessment of this property's performance and key opportunities","suggestions":[{"suggestion":"specific actionable advice","potential_impact":"e.g. +$200/mo","action":"properties|tenants|financials|maintenance"}],"health_score":1-10}\n\nBe specific with dollar amounts and concrete steps. Include up to 3 suggestions.\n\nProperty data: ${JSON.stringify(context)}`
    );

    const parsed = parseJSON(raw);

    res.json({
      property: { id: prop.id, name: prop.name, status: prop.status, rent: prop.rent, bedrooms: prop.bedrooms, city: prop.city, state: prop.state },
      analysis: parsed?.analysis || generatePropertyAnalysis(context),
      health_score: parsed?.health_score || calculateHealthScore(context),
      suggestions: parsed?.suggestions || generatePropertySuggestions(context),
      maintenance: maintRes.rows,
      applications: appRes.rows,
      source: parsed ? 'ai' : 'rules',
    });
  } catch (err) {
    console.error('Property insights error:', err);
    res.status(500).json({ error: 'Failed to load property insights' });
  }
});

function generatePropertyAnalysis(c) {
  if (c.status === 'vacant' && c.vacant_days > 30) return `${c.property_name} has been vacant for ${c.vacant_days} days, representing $${(c.monthly_rent * (c.vacant_days / 30)).toFixed(0)} in lost income. Immediate attention is recommended to reduce vacancy period.`;
  if (c.emergency_maintenance > 0) return `${c.property_name} has ${c.emergency_maintenance} emergency maintenance request(s) requiring immediate attention. Address these first to protect the property and tenant satisfaction.`;
  if (c.net_income_90d < 0) return `${c.property_name} shows a net loss of $${Math.abs(c.net_income_90d).toLocaleString()} over the last 90 days. Review expenses and consider rent adjustment at next lease renewal.`;
  return `${c.property_name} is performing adequately with ${c.tenant_count} active tenant(s). ${c.open_maintenance > 0 ? `There are ${c.open_maintenance} open maintenance request(s) to address.` : 'No urgent maintenance issues.'} Net income for the last 90 days is $${c.net_income_90d.toLocaleString()}.`;
}

function calculateHealthScore(c) {
  let score = 7;
  if (c.status === 'vacant') score -= 3;
  if (c.emergency_maintenance > 0) score -= 2;
  if (c.open_maintenance > 2) score -= 1;
  if (c.net_income_90d < 0) score -= 2;
  if (c.net_income_90d > 0) score += 1;
  return Math.max(1, Math.min(10, score));
}

function generatePropertySuggestions(c) {
  const s = [];
  if (c.status === 'vacant' && c.vacant_days > 30) s.push({ suggestion: `Reduce asking rent by 5-10% to attract tenants faster — property has been vacant ${c.vacant_days} days.`, potential_impact: `Fill vacancy: +$${c.monthly_rent.toLocaleString()}/mo`, action: 'properties' });
  if (c.open_maintenance > 0) s.push({ suggestion: `${c.open_maintenance} open maintenance request(s). Resolving promptly improves tenant retention.`, potential_impact: 'Improve tenant retention', action: 'maintenance' });
  if (c.net_income_90d < 0) s.push({ suggestion: `Property had negative net income last 90 days. Review recurring expenses and evaluate rent increase at next renewal.`, potential_impact: `Recover $${Math.abs(c.net_income_90d).toLocaleString()} deficit`, action: 'financials' });
  if (s.length === 0) s.push({ suggestion: 'Property is performing well. Review market rents annually to stay competitive.', potential_impact: 'Maintain/optimize income', action: 'financials' });
  return s;
}

// ── POST /api/ai/property-analysis/:id/:type ─────────────────────────────────
// type: market-rent | property-value | expense-leaks | tenant-risk | cashflow
router.post('/property-analysis/:id/:type', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId;
  const propId = parseInt(req.params.id, 10);
  const type = req.params.type;
  const validTypes = ['market-rent', 'property-value', 'expense-leaks', 'tenant-risk', 'cashflow'];
  if (!propId) return res.status(400).json({ error: 'Invalid property ID' });
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid analysis type' });

  try {
    const propRes = await pool.query(`
      SELECT p.*, pm.monthly_payment, pm.monthly_tax, pm.monthly_insurance,
             pm.escrow_amount, pm.loan_amount, pm.interest_rate, pm.loan_term_years
      FROM properties p
      LEFT JOIN property_mortgages pm ON pm.property_id = p.id
      WHERE p.id = $1 AND p.user_id = $2
    `, [propId, userId]);
    if (propRes.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
    const prop = propRes.rows[0];
    const today = new Date();

    // ── Market Rent ──────────────────────────────────────────────────────────
    if (type === 'market-rent') {
      const tenantsRes = await pool.query(
        `SELECT lease_end FROM tenants WHERE property_id = $1 AND status = 'active'`, [propId]
      );
      const rent = parseFloat(prop.rent || 0);
      const context = {
        property_name: prop.name, current_rent: rent,
        bedrooms: prop.bedrooms, bathrooms: prop.bathrooms, sqft: prop.sqft,
        property_type: prop.type, city: prop.city, state: prop.state,
        status: prop.status, active_tenants: tenantsRes.rows.length,
      };
      const raw = await callGemini(
        `You are a rental market expert. Analyze this property and suggest optimal rent pricing. Return only valid JSON with no markdown:\n{"headline":"one sentence summary","analysis":"2-3 sentence market analysis","suggested_rent_min":number,"suggested_rent_max":number,"confidence":"low|medium|high","factors":["up to 4 key market factors"],"action":"raise|hold|reduce"}\n\nProperty: ${JSON.stringify(context)}`
      );
      const parsed = parseJSON(raw);
      if (parsed?.analysis) return res.json({ ...parsed, source: 'ai' });
      const min = Math.round(rent * 0.95), max = Math.round(rent * 1.08);
      return res.json({
        headline: 'Rent review for ' + prop.name,
        analysis: `Current rent is $${rent.toLocaleString()}/mo${prop.sqft > 0 ? ` ($${(rent / prop.sqft).toFixed(2)}/sqft)` : ''}. Review comparable listings in ${prop.city || 'your area'} to validate pricing. Industry standard is to review rent at each lease renewal.`,
        suggested_rent_min: min, suggested_rent_max: max, confidence: 'low', action: 'hold',
        factors: ['Review local comparables', 'Annual rent review recommended', 'Adjust at lease renewal'],
        source: 'rules',
      });
    }

    // ── Property Value ───────────────────────────────────────────────────────
    if (type === 'property-value') {
      const rent = parseFloat(prop.rent || 0);
      const loanAmt = parseFloat(prop.loan_amount || 0);
      const fixedMonthly = parseFloat(prop.monthly_payment || 0) + parseFloat(prop.monthly_tax || 0) +
        parseFloat(prop.monthly_insurance || 0) + parseFloat(prop.escrow_amount || 0);
      const annualRent = rent * 12;
      const noi = annualRent - fixedMonthly * 12;
      const context = {
        property_name: prop.name, property_type: prop.type,
        city: prop.city, state: prop.state,
        bedrooms: prop.bedrooms, bathrooms: prop.bathrooms, sqft: prop.sqft,
        monthly_rent: rent, annual_gross_rent: annualRent,
        total_monthly_costs: Math.round(fixedMonthly), estimated_noi: Math.round(noi),
        outstanding_loan: loanAmt,
      };
      const raw = await callGemini(
        `You are a real estate appraiser. Estimate this property's current market value. Return only valid JSON with no markdown:\n{"headline":"one sentence summary","analysis":"2-3 sentence valuation analysis","estimated_value_low":number,"estimated_value_high":number,"estimated_cap_rate":number,"notes":"key assumptions made"}\n\nProperty: ${JSON.stringify(context)}`
      );
      const parsed = parseJSON(raw);
      if (parsed?.analysis) return res.json({ ...parsed, loan_amount: loanAmt, source: 'ai' });
      const low = Math.round(annualRent * 10), high = Math.round(annualRent * 15);
      const midVal = (low + high) / 2;
      const capRate = midVal > 0 ? parseFloat(((noi / midVal) * 100).toFixed(1)) : null;
      return res.json({
        headline: 'Value estimate for ' + prop.name,
        analysis: `Based on a 10–15× annual rent multiplier, ${prop.name} may be worth $${low.toLocaleString()}–$${high.toLocaleString()}. For an accurate figure, consult a local appraiser familiar with the ${prop.city || ''} market.`,
        estimated_value_low: low, estimated_value_high: high,
        estimated_cap_rate: capRate,
        notes: 'Estimate uses gross rent multiplier (10–15× annual rent). Actual value depends on condition, location, and local market.',
        loan_amount: loanAmt, source: 'rules',
      });
    }

    // ── Expense Leaks ────────────────────────────────────────────────────────
    if (type === 'expense-leaks') {
      const twelveMonthsAgo = new Date(today); twelveMonthsAgo.setFullYear(today.getFullYear() - 1);
      const txnRes = await pool.query(`
        SELECT category, SUM(amount) AS total, COUNT(*) AS count
        FROM transactions
        WHERE property_id = $1 AND type = 'expense' AND transaction_date >= $2
        GROUP BY category ORDER BY total DESC
      `, [propId, twelveMonthsAgo.toISOString().split('T')[0]]);
      const rent = parseFloat(prop.rent || 0);
      const annualRent = rent * 12;
      const totalExpenses = txnRes.rows.reduce((s, r) => s + parseFloat(r.total || 0), 0);
      const expenseRatio = annualRent > 0 ? parseFloat(((totalExpenses / annualRent) * 100).toFixed(1)) : null;
      const context = {
        property_name: prop.name, monthly_rent: rent, annual_rent: annualRent,
        total_expenses_12m: Math.round(totalExpenses), expense_to_rent_ratio: expenseRatio,
        expenses_by_category: txnRes.rows.map(r => ({
          category: r.category || 'Uncategorized',
          annual_total: Math.round(parseFloat(r.total)), count: parseInt(r.count),
        })),
      };
      const raw = await callGemini(
        `You are a property expense auditor. Identify expense leaks and savings opportunities. Return only valid JSON with no markdown:\n{"headline":"one sentence summary","analysis":"2-3 sentence expense assessment","leaks":[{"category":"name","amount":number,"concern":"why it is high","suggestion":"how to reduce it"}],"expense_ratio_assessment":"healthy|elevated|concerning"}\n\nInclude up to 3 genuine leaks only.\n\nData: ${JSON.stringify(context)}`
      );
      const parsed = parseJSON(raw);
      if (parsed?.analysis) return res.json({ ...parsed, total_expenses: Math.round(totalExpenses), expense_ratio: expenseRatio, source: 'ai' });
      const leaks = txnRes.rows.slice(0, 3).filter(r => annualRent > 0 && parseFloat(r.total) / annualRent > 0.15).map(r => ({
        category: r.category || 'Uncategorized',
        amount: Math.round(parseFloat(r.total)),
        concern: `${((parseFloat(r.total) / annualRent) * 100).toFixed(0)}% of annual rent`,
        suggestion: 'Review for alternative vendors or negotiation',
      }));
      const ratio = expenseRatio || 0;
      return res.json({
        headline: 'Expense analysis for ' + prop.name,
        analysis: `Total expenses over 12 months: $${Math.round(totalExpenses).toLocaleString()}${expenseRatio != null ? ` (${expenseRatio}% of annual rent)` : ''}. ${ratio > 60 ? 'Expense ratio is high — review largest categories for savings.' : ratio > 40 ? 'Expense ratio is slightly elevated.' : 'Expense ratio looks healthy.'}`,
        leaks, expense_ratio_assessment: ratio > 60 ? 'concerning' : ratio > 40 ? 'elevated' : 'healthy',
        total_expenses: Math.round(totalExpenses), expense_ratio: expenseRatio, source: 'rules',
      });
    }

    // ── Tenant Risk ──────────────────────────────────────────────────────────
    if (type === 'tenant-risk') {
      const tenantsRes = await pool.query(
        `SELECT first_name, last_name, lease_start, lease_end, balance FROM tenants WHERE property_id = $1 AND status = 'active'`,
        [propId]
      );
      if (tenantsRes.rows.length === 0) {
        return res.json({ headline: 'No active tenants', analysis: 'There are no active tenants at this property to assess.', tenants: [], source: 'rules' });
      }
      const tenantData = tenantsRes.rows.map(t => {
        const leaseEnd = t.lease_end ? new Date(t.lease_end) : null;
        const daysToExpiry = leaseEnd ? Math.floor((leaseEnd - today) / (1000 * 60 * 60 * 24)) : null;
        return {
          name: `${t.first_name} ${t.last_name}`,
          days_to_lease_expiry: daysToExpiry,
          outstanding_balance: parseFloat(t.balance || 0),
          overdue: parseFloat(t.balance || 0) < 0,
        };
      });
      const raw = await callGemini(
        `You are a tenant risk analyst. Score payment and retention risk for each tenant. Return only valid JSON with no markdown:\n{"headline":"one sentence summary","analysis":"2-3 sentence overall risk assessment","tenants":[{"name":"full name","risk_level":"low|medium|high","score":1-10,"factors":["key risk factors"]}]}\n\nScore: 8-10 = low risk, 4-7 = medium, 1-3 = high risk.\n\nData: ${JSON.stringify({ property_name: prop.name, monthly_rent: parseFloat(prop.rent || 0), tenants: tenantData })}`
      );
      const parsed = parseJSON(raw);
      if (parsed?.analysis) return res.json({ ...parsed, source: 'ai' });
      const tenants = tenantData.map(t => {
        let score = 8; const factors = [];
        if (t.overdue) { score -= 3; factors.push('Outstanding balance'); }
        if (t.days_to_lease_expiry != null && t.days_to_lease_expiry < 30) { score -= 2; factors.push('Lease expiring < 30 days'); }
        else if (t.days_to_lease_expiry != null && t.days_to_lease_expiry < 60) { score -= 1; factors.push('Lease expiring < 60 days'); }
        if (!factors.length) factors.push('No immediate concerns');
        const risk = score >= 7 ? 'low' : score >= 5 ? 'medium' : 'high';
        return { name: t.name, risk_level: risk, score: Math.max(1, score), factors };
      });
      const highRisk = tenants.filter(t => t.risk_level === 'high').length;
      return res.json({
        headline: 'Tenant risk assessment',
        analysis: `${tenants.length} active tenant(s) assessed. ${highRisk > 0 ? `${highRisk} tenant(s) flagged as high risk — follow up recommended.` : 'No high-risk tenants detected at this time.'}`,
        tenants, source: 'rules',
      });
    }

    // ── Cash Flow Prediction ─────────────────────────────────────────────────
    if (type === 'cashflow') {
      const sixMonthsAgo = new Date(today); sixMonthsAgo.setMonth(today.getMonth() - 6);
      const txnRes = await pool.query(`
        SELECT DATE_TRUNC('month', transaction_date) AS month, type, SUM(amount) AS total
        FROM transactions
        WHERE property_id = $1 AND transaction_date >= $2
        GROUP BY month, type ORDER BY month
      `, [propId, sixMonthsAgo.toISOString().split('T')[0]]);
      const rent = parseFloat(prop.rent || 0);
      const fixedCosts = parseFloat(prop.monthly_payment || 0) + parseFloat(prop.monthly_tax || 0) +
        parseFloat(prop.monthly_insurance || 0) + parseFloat(prop.escrow_amount || 0);
      const monthMap = {};
      for (const r of txnRes.rows) {
        const m = new Date(r.month).toISOString().slice(0, 7);
        if (!monthMap[m]) monthMap[m] = { income: 0, expenses: 0 };
        if (r.type === 'income') monthMap[m].income += parseFloat(r.total);
        else monthMap[m].expenses += parseFloat(r.total);
      }
      const months = Object.entries(monthMap).map(([month, v]) => ({ month, income: Math.round(v.income), expenses: Math.round(v.expenses), net: Math.round(v.income - v.expenses) }));
      const avgIncome = months.length > 0 ? months.reduce((s, m) => s + m.income, 0) / months.length : rent;
      const avgVarExp = months.length > 0 ? months.reduce((s, m) => s + m.expenses, 0) / months.length : 0;
      const predicted = Math.round(avgIncome - avgVarExp - fixedCosts);
      const context = {
        property_name: prop.name, monthly_rent: rent, fixed_monthly_costs: Math.round(fixedCosts),
        status: prop.status, last_6_months: months,
        avg_monthly_income: Math.round(avgIncome), avg_monthly_variable_expenses: Math.round(avgVarExp),
      };
      const raw = await callGemini(
        `You are a rental property cash flow analyst. Predict the next 3-6 months and identify risks. Return only valid JSON with no markdown:\n{"headline":"one sentence summary","analysis":"2-3 sentence cash flow assessment","predicted_monthly_cashflow":number,"risks":["up to 3 risks"],"opportunities":["up to 2 opportunities"],"outlook":"positive|neutral|negative"}\n\nData: ${JSON.stringify(context)}`
      );
      const parsed = parseJSON(raw);
      if (parsed?.analysis) return res.json({ ...parsed, history: months, source: 'ai' });
      const risks = [], opps = [];
      if (prop.status === 'vacant') risks.push('Property is currently vacant — no rental income');
      if (fixedCosts > rent * 0.8) risks.push('Fixed costs exceed 80% of monthly rent');
      if (months.some(m => m.net < 0)) risks.push('Negative net cash flow observed in recent months');
      if (predicted > 0) opps.push(`Projected positive cash flow of $${predicted.toLocaleString()}/mo`);
      if (prop.status === 'occupied' && rent > 0) opps.push('Stable rental income expected if lease is maintained');
      return res.json({
        headline: 'Cash flow projection for ' + prop.name,
        analysis: `Projected monthly net: $${predicted.toLocaleString()} ($${rent.toLocaleString()} rent − $${Math.round(fixedCosts).toLocaleString()} fixed costs${avgVarExp > 0 ? ` − $${Math.round(avgVarExp).toLocaleString()} avg variable expenses` : ''}).`,
        predicted_monthly_cashflow: predicted, risks, opportunities: opps,
        outlook: predicted > 200 ? 'positive' : predicted < 0 ? 'negative' : 'neutral',
        history: months, source: 'rules',
      });
    }

    res.status(400).json({ error: 'Unknown analysis type' });
  } catch (err) {
    console.error(`AI property-analysis/${type} error:`, err);
    res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
});

export default router;
