/**
 * AI-powered dashboard recommendation endpoint.
 * GET /api/ai/recommendation
 *
 * Gathers real portfolio data and calls Claude to generate a concise,
 * actionable recommendation. Falls back to rule-based logic if
 * ANTHROPIC_API_KEY is not configured.
 */
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/recommendation', authenticateToken, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.userId;

  try {
    const today = new Date();
    const in60Days = new Date(today); in60Days.setDate(today.getDate() + 60);
    const in30Days = new Date(today); in30Days.setDate(today.getDate() + 30);
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

    const props        = propsRes.rows;
    const tenants      = tenantsRes.rows;
    const openMaint    = maintRes.rows;
    const recentTxns   = txnRes.rows;

    const totalProps   = props.length;
    const occupied     = props.filter(p => (p.status || '').toLowerCase() === 'occupied').length;
    const vacant       = props.filter(p => (p.status || '').toLowerCase() === 'vacant').length;
    const maintenance  = props.filter(p => (p.status || '').toLowerCase() === 'maintenance').length;
    const occupancyPct = totalProps > 0 ? Math.round(occupied / totalProps * 100) : 0;

    const emergencies  = openMaint.filter(r => (r.priority || '').toLowerCase() === 'emergency');
    const openCount    = openMaint.length;

    const expiringIn30 = tenants.filter(t => {
      if (!t.lease_end) return false;
      const d = new Date(t.lease_end);
      return d >= today && d <= in30Days;
    });
    const expiringIn60 = tenants.filter(t => {
      if (!t.lease_end) return false;
      const d = new Date(t.lease_end);
      return d > in30Days && d <= in60Days;
    });
    const overdueBalance = tenants.filter(t => parseFloat(t.balance || 0) < 0);

    const income30d  = recentTxns.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const expense30d = recentTxns.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const netIncome  = income30d - expense30d;

    // ── Build portfolio context summary ────────────────────────────────────────
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

    // ── Try Claude API ────────────────────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client = new Anthropic({ apiKey });

        const message = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 120,
          messages: [{
            role: 'user',
            content: `You are an AI assistant for a property management platform. Based on this portfolio data, give ONE concise, specific, actionable recommendation (2 sentences max). Be direct and practical — no fluff. Return JSON: {"title": "short title (4-6 words)", "description": "your recommendation", "action": "link_key"} where link_key is one of: maintenance, tenants, properties, financials, messages.

Portfolio data: ${JSON.stringify(context)}`,
          }],
        });

        const raw = message.content[0].text.trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return res.json({
            title: parsed.title || 'Portfolio Update',
            description: parsed.description || '',
            action: parsed.action || 'properties',
            source: 'ai',
            context,
          });
        }
      } catch (aiErr) {
        console.error('Claude API error:', aiErr.message);
        // Fall through to rule-based
      }
    }

    // ── Rule-based fallback ───────────────────────────────────────────────────
    let title, description, action;

    if (emergencies.length > 0) {
      title = `${emergencies.length} Emergency Request${emergencies.length > 1 ? 's' : ''} Need Attention`;
      description = `You have ${emergencies.length} emergency maintenance request${emergencies.length > 1 ? 's' : ''} open${emergencies[0]?.subject ? ` including "${emergencies[0].subject}"` : ''}. These should be addressed immediately to protect your property and tenants.`;
      action = 'maintenance';
    } else if (expiringIn30.length > 0) {
      title = `${expiringIn30.length} Lease${expiringIn30.length > 1 ? 's' : ''} Expiring This Month`;
      description = `${expiringIn30.length} tenant lease${expiringIn30.length > 1 ? 's expire' : ' expires'} within 30 days. Reach out now to begin renewal conversations and avoid unexpected vacancies.`;
      action = 'tenants';
    } else if (overdueBalance.length > 0) {
      title = `${overdueBalance.length} Tenant${overdueBalance.length > 1 ? 's' : ''} With Outstanding Balance`;
      description = `${overdueBalance.length} tenant${overdueBalance.length > 1 ? 's have' : ' has'} an outstanding balance. Review their accounts and follow up to keep your cash flow healthy.`;
      action = 'tenants';
    } else if (openCount > 0) {
      title = `${openCount} Open Maintenance Request${openCount > 1 ? 's' : ''}`;
      description = `${openCount} maintenance request${openCount > 1 ? 's are' : ' is'} awaiting action.${vacant > 0 ? ` Also, ${vacant} propert${vacant > 1 ? 'ies are' : 'y is'} vacant and ready to list.` : ' Staying on top of maintenance helps retain tenants and protect property value.'}`;
      action = 'maintenance';
    } else if (vacant > 0) {
      title = `${vacant} Vacant Propert${vacant > 1 ? 'ies' : 'y'} Available`;
      description = `${vacant} of your ${totalProps} propert${totalProps > 1 ? 'ies are' : 'y is'} currently vacant. Consider listing ${vacant > 1 ? 'them' : 'it'} or sharing an application link to find qualified tenants faster.`;
      action = 'properties';
    } else if (expiringIn60.length > 0) {
      title = `${expiringIn60.length} Lease${expiringIn60.length > 1 ? 's' : ''} Expiring in 60 Days`;
      description = `${expiringIn60.length} lease${expiringIn60.length > 1 ? 's expire' : ' expires'} within 60 days. Starting renewal conversations early improves retention and reduces turnover costs.`;
      action = 'tenants';
    } else if (netIncome < 0) {
      title = 'Expenses Exceed Income This Month';
      description = `Your portfolio spent $${Math.abs(netIncome).toLocaleString()} more than it earned in the last 30 days. Review your financials to identify areas to reduce costs or increase revenue.`;
      action = 'financials';
    } else {
      title = 'Portfolio Running Smoothly';
      description = `${occupancyPct}% occupancy, no urgent maintenance, and no expiring leases in the next 30 days. A great time to review your financials or explore adding new properties.`;
      action = 'properties';
    }

    res.json({ title, description, action, source: 'rules', context });
  } catch (err) {
    console.error('AI recommendation error:', err);
    res.status(500).json({ error: 'Failed to generate recommendation' });
  }
});

export default router;
