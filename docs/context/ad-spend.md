# Feature: Ad spend & ROAS

**Goal:** record what was paid to each platform so the report can show ROAS (revenue ÷ spend) and cost per order.

## Files
- `src/db.js` → `spend` table (`source`, `medium` defaulting to `'cpc'`, `amount`, `spent_on` as YYYY-MM-DD, `note`), `insertSpend()`, `listSpend()`
- `src/app.js` → `GET /api/spend`, `POST /api/spend {source, medium?, amount, spentOn, note?}`
- `src/report.js` → spend section of `buildReport`
- `public/dashboard/index.html` → the "Record ad spend" form

## Rules
- **Keyed by source + medium.** This is deliberate: grouping by source alone merged paid `google/cpc` with free `google/organic` and inflated Google's ROAS from about 1.3× to about 2.5× in the demo data.
- **Normalization:** source and medium are lowercased and spaces become `_`, the same as UTM values.
- **Which groupings get spend:**
  - `source_medium`: spend is matched exactly.
  - `source`: spend across all mediums is summed into the source row.
  - other groupings: no spend.
- **Rows with no visits:** spend on a channel with no visits still creates a row, so wasted spend stays visible.
- **Date range:** spend dates are compared inclusively with `from.slice(0,10)` and `to.slice(0,10)`.

## Gaps / ideas
- **Manual entry only.** Next step: import from the Google Ads and Meta Marketing APIs.
- **No edit or delete endpoints yet.**
- **Granularity:** spend is per source + medium, not per campaign, so campaign-level ROAS would need a `campaign` column.

## Tests
`test/api.test.js`: spend is matched on source + medium, organic has none, and the spend validation cases.
