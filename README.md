# UTM Attribution

Answers one question: **which marketing platform should we spend more on?**

It records where each visitor came from (UTM links, search engines, social sites), connects that to what they bought, and compares the revenue with what you paid each platform.

```
UTM link ──► visitor lands ──► tracker.js records the visit ──┐
                                                               ├──► dashboard: revenue, ROAS per platform
your backend reports the sale ─────────────────────────────────┘
```

## Quick start

```bash
npm install
npm run seed     # 60 days of fake data, so the dashboard has something to show
npm start        # http://localhost:3000
```

| Page | What it's for |
|---|---|
| `/dashboard/` | Revenue, orders, ROAS per channel, plus plain-language recommendations |
| `/builder/` | Create consistent UTM links (optionally shortened with Kutt) |
| `/store/` | A demo shop: arrive from a campaign link, buy something, then watch the dashboard |

Requires Node.js 22.13+ (uses the built-in `node:sqlite`). `npm test` runs the test suite.

## Using it on a real site

**1. Tag every link** you post, advertise or email with the link builder.

**2. Add the tracker** to every page:

```html
<script src="https://tracker.yourshop.com/tracker.js" defer></script>
```

Set `ALLOWED_ORIGINS=https://yourshop.com` so the browser may send events to the tracker.

**3. Report sales from your backend, not the browser.** In the browser, `UTMTracker.visitorId()` is sent along with the order. When your backend confirms the order (for example after a payment webhook), it calls:

```bash
curl -X POST https://tracker.yourshop.com/api/collect/conversion \
  -H 'Content-Type: application/json' \
  -H 'X-Conversion-Secret: <CONVERSION_SECRET>' \
  -d '{"visitorId":"<from the browser>","orderId":"ORD-1042","revenue":1999,"currency":"INR"}'
```

Reporting from the server means people can't fake sales, and the amount comes from your real order. `orderId` is unique, so retries never count a sale twice.

**4. Enter ad spend** on the dashboard, using the same source and medium as your links (e.g. `google` + `cpc`).

## How it decides who gets credit

**Visit classification** (same rules as Google Analytics):

| The visitor arrived… | Recorded as |
|---|---|
| with `utm_*` parameters | the UTM values (lowercased, spaces → `_`) |
| from Google, Bing, DuckDuckGo… | `google / organic` |
| from Instagram, Facebook, LinkedIn, X… | `instagram / social` |
| from any other site | `blog.example.com / referral` |
| with no referrer | `(direct) / (none)` |

A visit is recorded once per browser session, or again if the visitor clicks a *different* campaign link during the session.

**Attribution models**, the "Credit the sale to" option on the dashboard:

- **Last marketing click** (default): the latest non-direct visit before the sale gets 100%. A customer who comes back by typing your URL still credits the campaign that brought them back.
- **First click**: the visit that discovered you gets 100%. Use it to see which platforms find new customers.
- **All clicks equally** (linear): every visit in the journey shares the credit.

Only visits within `LOOKBACK_DAYS` (default 30) before the sale count.

**Group by "Platform + channel type".** Grouping by platform alone mixes paid `google / cpc` with free `google / organic`, which makes the ads look better than they are.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/collect/touch` | Record a visit (sent by `tracker.js`) |
| POST | `/api/collect/conversion` | Record a sale (from your backend; needs `X-Conversion-Secret` when one is configured) |
| GET | `/api/report?days=30&groupBy=source_medium&model=last_touch` | The dashboard data |
| GET, POST | `/api/spend` | List or add ad spend `{source, medium, amount, spentOn}` |
| GET, POST | `/api/links` | List or create UTM links `{url, source, medium, campaign, content?, shorten?}` |

`groupBy` can be `source`, `medium`, `source_medium` or `campaign`. `model` can be `last_touch`, `first_touch` or `linear`.

## Project layout

```
src/
  server.js       start-up and graceful shutdown
  app.js          HTTP routes, validation, CORS
  config.js       settings from environment variables
  db.js           SQLite schema and queries
  classify.js     UTM / referrer → source, medium, campaign
  attribution.js  last-touch, first-touch, linear models
  report.js       per-channel metrics (visits, revenue, ROAS…)
  kutt-utm.js     UTM link builder + Kutt shortener client
public/           tracker.js, dashboard, link builder, demo store
scripts/seed.js   demo data
test/             node:test suites
```

## Known limits and next steps

- **Privacy:** the tracker stores an anonymous ID in `localStorage`. Under GDPR, ePrivacy or India's DPDP Act, load it only after the visitor consents. No personal data is collected.
- **No login on the dashboard or the spend/links APIs.** Put it behind a VPN or a reverse proxy with authentication before exposing it.
- **One device = one visitor.** Someone who clicks an ad on their phone and buys on their laptop shows up as two people. Fixing that needs logged-in user IDs.
- **Ad blockers** may block `tracker.js`. Serving it from your own domain (e.g. `/t.js`) helps.
- **Single currency** (`CURRENCY`).
- **Scale:** reports are computed live from SQLite. That's fine for hundreds of thousands of visits. Past that, switch to Postgres and pre-aggregate daily.
- **Ideas:** import spend from the Google/Meta Ads APIs, a time-series chart per channel, CSV export, position-based or data-driven attribution.
