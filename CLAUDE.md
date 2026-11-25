# UTM Attribution — project context

Marketing attribution app: records where visitors come from (UTM / referrer), ties that to sales, and shows revenue and ROAS per platform so you can decide where to market more. It's a learning side project, built to industry-standard practice.

## Commands
- `./start-local.sh [--seed] [--dev] [--port N]`: one-step local run. It checks Node ≥ 22.13, loads `.env`, runs `npm ci` when deps are missing or stale, seeds when the DB file doesn't exist, then starts the server.
- `npm start`: run the server (`.env` is loaded if present). The default port is 3000.
- `npm run dev`: run with file watching.
- `npm run seed`: wipe the DB and add 60 days of fake data.
- `npm test`: run all tests (`node:test`, no extra test dependencies).

## Stack
- Node.js ≥ 22.13, ESM.
- Express 5, the only dependency.
- Built-in `node:sqlite` (`DatabaseSync`).
- Vanilla HTML/JS frontend in `public/`, with no build step.

## Architecture map
| Layer | File | Role |
|---|---|---|
| Entry | `src/server.js` | Loads config, opens the DB, listens, shuts down gracefully |
| HTTP | `src/app.js` | `createApp({db, config})`: all routes, validation, CORS, error handler |
| Config | `src/config.js` | `loadConfig(env)`: every setting comes from env vars |
| Data | `src/db.js` | Schema (created on open) and insert/list helpers |
| Domain | `src/classify.js` | UTM/referrer → `{source, medium, campaign}` |
| Domain | `src/attribution.js` | `creditTouches()`: last_touch / first_touch / linear |
| Domain | `src/report.js` | `buildReport()`: per-channel metrics |
| Domain | `src/kutt-utm.js` | `buildUtmUrl`, `shortenWithKutt`, `createUtmLink`, `normalize` |
| UI | `public/{dashboard,builder,store}/index.html`, `public/tracker.js`, `public/styles.css` | Pages and the tracking snippet |

## Feature context (read the relevant file before changing a feature)
- [Visit tracking](docs/context/tracking.md): `tracker.js`, `/api/collect/touch`, classification
- [Conversions](docs/context/conversions.md): reporting sales, idempotency, secret
- [Attribution & reporting](docs/context/attribution-reporting.md): models, metrics, dashboard, insights
- [Ad spend](docs/context/ad-spend.md): spend per source + medium, ROAS
- [Link builder & Kutt](docs/context/link-builder.md): UTM URLs, Kutt shortener
- [Demo store & seed data](docs/context/demo-and-seed.md): the demo shop and `scripts/seed.js`

**When you change a feature, update its context file in the same commit.** Add a new file for a new feature and link it here.

## Conventions
- **Normalize UTM values everywhere** with `normalize()`: lowercase, trimmed, spaces → `_`.
- **Use GA-style placeholders:** `(direct)`, `(none)`, `(not set)`.
- **Timestamps:**
  - Server-generated ISO-8601 UTC strings, never client time.
  - String comparison works because the format is fixed.
  - Spend dates are `YYYY-MM-DD`.
- **Validation:** validate at the HTTP boundary in `app.js` and throw `bad(msg)`, which becomes a 400 JSON `{error}`. 5xx errors are logged and return a generic message.
- **Frontend:** build the DOM with `textContent` only. Data such as source names comes from visitors, so never use `innerHTML` with it (XSS).
- **SQL:** positional `?` parameters only.
- **Tests:** API tests start `createApp` on port 0 with an in-memory DB and stub `globalThis.fetch` for Kutt. Every route or rule change needs a test.

## Key decisions (don't undo without a reason)
- **Server-side sales:** sales are reported server to server (`X-Conversion-Secret`), and prices are looked up on the server.
- **Spend key:** spend is keyed by **source + medium**. Grouping by source alone mixes paid `google/cpc` with free `google/organic` and inflates ROAS. The dashboard defaults to `source_medium`.
- **Live reports:** reports are computed live from SQLite. Pre-aggregation or Postgres only becomes necessary at large scale.

## Known gaps / roadmap
- No auth on the dashboard or the spend/links APIs.
- No consent banner.
- No cross-device identity.
- Single currency.
- Ideas: spend import from the Ads APIs, a time-series chart, CSV export.
