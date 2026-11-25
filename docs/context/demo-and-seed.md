# Feature: Demo store & seed data

**Goal:** let someone learn or demo the whole flow without a real website or real traffic.

## Demo store
- **Files:** `public/store/index.html`, plus in `src/app.js` the `GET /api/demo/products` and `POST /api/demo/checkout {productId, visitorId}` routes and the `DEMO_PRODUCTS` price list.
- **Switch:** enabled unless `DEMO_STORE=false`. Disable it in production.
- **Campaign chips:** simulate arriving from Instagram, Email, Google Ads, Facebook Ads and LinkedIn.
- **"Become a new visitor":** clears `utm_vid` and `utm_session`.
- **Checkout:** mimics a real shop backend. The server looks up the price, creates the order ID (`demo_<uuid>`), and calls `recordConversion()`. This shows the correct server-side pattern.

## Seed script (`scripts/seed.js`, `npm run seed`)
- **Wipes all tables** (`resetAll`), then inserts data inside a single transaction.
- **Visitors:** 4,000 over 60 days, each with 1–3 touches (35% get extra touches).
- **Conversion:** decided by the closing (last non-direct) channel's `conv` rate, with a ×1.6 boost for multi-touch journeys.
- **Daily spend:** for each paid channel, about ±20% around `spendPerDay`.
- **The story the data tells:**
  - google/cpc is profitable.
  - The newsletter is free and strong.
  - facebook/cpc is below 1×.
  - instagram/social and linkedin/social are big losers.
  - instagram/social brings many visits but few buyers.

  Keep this story if you change `CHANNELS`, so the dashboard insights still have something to show.
- **Target DB:** respects `DB_FILE`. Note that the existing DB schema isn't migrated: delete the DB file after schema changes.
