import { creditTouches } from './attribution.js';

export const GROUPINGS = {
  source: ['source'],
  medium: ['medium'],
  source_medium: ['source', 'medium'],
  campaign: ['source', 'medium', 'campaign'],
};

const DAY_MS = 86_400_000;

/**
 * Per-channel performance for conversions in [from, to).
 * Visits = landings in the range. Conversions/revenue = credited by the chosen model.
 * Spend is recorded per source + medium (google/cpc), so ROAS shows when grouping by source or source_medium.
 * Prefer source_medium: grouping by source alone mixes paid google/cpc with free google/organic.
 */
export function buildReport(db, { model, groupBy, from, to, lookbackDays, currency }) {
  const fields = GROUPINGS[groupBy];
  const rows = new Map();
  const rowFor = (t) => {
    const key = fields.map((f) => t[f]).join(' / ');
    let r = rows.get(key);
    if (!r) {
      r = { key, ...Object.fromEntries(fields.map((f) => [f, t[f]])), visits: 0, conversions: 0, revenue: 0, spend: null };
      rows.set(key, r);
    }
    return r;
  };

  // 1. Visits per channel
  for (const t of db.prepare('SELECT source, medium, campaign FROM touches WHERE created_at >= ? AND created_at < ?').all(from, to)) {
    rowFor(t).visits += 1;
  }

  // 2. Attribute each sale to the visits that led to it
  const lookbackMs = lookbackDays * DAY_MS;
  const touchFrom = new Date(Date.parse(from) - lookbackMs).toISOString();
  const conversions = db.prepare('SELECT visitor_id, revenue, created_at FROM conversions WHERE created_at >= ? AND created_at < ?').all(from, to);
  const touchesByVisitor = new Map();
  const journeyRows = db.prepare(
    `SELECT visitor_id, source, medium, campaign, created_at FROM touches
     WHERE created_at >= ? AND created_at < ?
       AND visitor_id IN (SELECT visitor_id FROM conversions WHERE created_at >= ? AND created_at < ?)
     ORDER BY created_at, id`,
  ).all(touchFrom, to, from, to);
  for (const t of journeyRows) {
    if (!touchesByVisitor.has(t.visitor_id)) touchesByVisitor.set(t.visitor_id, []);
    touchesByVisitor.get(t.visitor_id).push(t);
  }
  for (const c of conversions) {
    for (const { touch, credit } of creditTouches(touchesByVisitor.get(c.visitor_id) ?? [], c.created_at, model, lookbackMs)) {
      const r = rowFor(touch);
      r.conversions += credit;
      r.revenue += c.revenue * credit;
    }
  }

  // 3. Ad spend
  const fromDay = from.slice(0, 10);
  const toDay = to.slice(0, 10);
  const spendRows = db.prepare('SELECT source, medium, SUM(amount) AS amount FROM spend WHERE spent_on >= ? AND spent_on <= ? GROUP BY source, medium').all(fromDay, toDay);
  if (groupBy === 'source' || groupBy === 'source_medium') {
    for (const s of spendRows) {
      const r = rowFor(s);
      r.spend = (r.spend ?? 0) + s.amount;
    }
  }

  const list = [...rows.values()].map(derive).sort((a, b) => b.revenue - a.revenue || b.visits - a.visits);
  const totals = derive({
    key: 'Total',
    visits: list.reduce((n, r) => n + r.visits, 0),
    conversions: conversions.length,
    revenue: conversions.reduce((n, c) => n + c.revenue, 0),
    spend: spendRows.reduce((n, s) => n + s.amount, 0),
  });

  return { model, groupBy, from, to, lookbackDays, currency, rows: list, totals };
}

function derive(r) {
  return {
    ...r,
    conversionRate: r.visits ? r.conversions / r.visits : null,
    revenuePerVisit: r.visits ? r.revenue / r.visits : null,
    avgOrderValue: r.conversions ? r.revenue / r.conversions : null,
    roas: r.spend ? r.revenue / r.spend : null, // return on ad spend: revenue earned per 1 spent
    costPerOrder: r.spend && r.conversions ? r.spend / r.conversions : null,
  };
}
