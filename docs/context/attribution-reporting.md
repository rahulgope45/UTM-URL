# Feature: Attribution & reporting (dashboard)

**Goal:** answer "which platform should we market more on?" with revenue, conversion rate and ROAS per channel, plus plain-language advice.

## Files
- `src/attribution.js` → `creditTouches(touches, conversionTime, model, lookbackMs)`, `MODELS`
- `src/report.js` → `buildReport(db, {model, groupBy, from, to, lookbackDays, currency})`, `GROUPINGS`
- `src/app.js` → `GET /api/report?days=&groupBy=&model=`
- `public/dashboard/index.html` → cards, insights, table, spend form

## Models (`creditTouches`)
- **Eligible touches:** `conversionTime - lookback ≤ touch ≤ conversionTime`. The input must be sorted oldest first.
- **No eligible touches:** the full credit goes to `DIRECT`.
- **`last_touch`:** the last *non-direct* touch, falling back to the last touch. This is GA's "last non-direct click".
- **`first_touch`:** the first eligible touch.
- **`linear`:** each eligible touch gets `1/n` credit, so order counts can be fractional.

## Report
- **Time window:** `/api/report` uses `from = now - days` and `to = now + 60s` (a buffer for clock edges). `days` is 1–730.
- **`GROUPINGS`:**
  - `source`
  - `medium`
  - `source_medium` (the dashboard default)
  - `campaign`, which groups by source + medium + campaign
- **Visits:** touches with `created_at` in `[from, to)`.
- **Conversions:** sales in `[from, to)`, credited using each visitor's touches from `from - lookback` onward.
- **Spend:** attached only for `source` or `source_medium`. See [ad-spend.md](ad-spend.md).
- **Derived metrics** (null when the denominator is 0 or missing): `conversionRate`, `revenuePerVisit`, `avgOrderValue`, `roas`, `costPerOrder`.
- **Totals:** use the raw conversion count and revenue, plus the sum of all spend in the range.
- **Sort order:** revenue descending, then visits.

## Dashboard insights (client side, in `renderInsights`)
- **Minimum data:** `MIN_ORDERS = 3` before ROAS is judged.
- **Advice rules:**
  - The best ROAS ≥ 1 → "Scale up".
  - ROAS < 1 → "losing money".
  - Spend with no sales → flagged.
  - Fewer than 3 orders with ROAS < 0.5 → "not paying off", otherwise "too early".
  - The free channel with the most revenue → "put more effort here".
  - A channel with at least 50 visits and a conversion rate under 1% → "check the landing page".

## Gotchas
- **Conversion rate is approximate:** it's attributed orders ÷ visits.
- **Linear and grouping:** with `linear`, one sale can credit several rows, but the totals still count it once.
- **Scale:** computed live. To scale, pre-aggregate daily rows or move to Postgres.

## Tests
- `test/attribution.test.js`: all models, lookback, fallback
- `test/api.test.js`: report numbers under the different models and groupings
