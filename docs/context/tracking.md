# Feature: Visit tracking

**Goal:** record each landing on the website as a "touch" (visit) with its source, medium and campaign.

## Files
- `public/tracker.js`: browser snippet, ES5-safe IIFE, exposes `window.UTMTracker.visitorId()`
- `src/app.js` → `collect.post('/touch')`
- `src/classify.js` → `classifyTouch({utm, referrer, landingPage})`
- `src/db.js` → `touches` table, `insertTouch()`

## Flow
1. The tracker reads or creates the visitor ID. It's a UUID in `localStorage['utm_vid']`; if storage is blocked, an in-memory ID is used instead.
2. It reads the `utm_*` params from the URL.
3. It sends a touch **once per session** (`sessionStorage['utm_session']`), **or** when the URL carries a *different* UTM set mid-session. The session value is the JSON of the UTM set, or `'no-utm'`.
4. The POST goes to `{endpoint}/api/collect/touch` with `{visitorId, utm, landingPage, referrer}`, using `keepalive` and no credentials. Errors are swallowed so tracking can never break the site.
5. The server validates `visitorId` (`/^[A-Za-z0-9-]{8,64}$/`), classifies the touch, and stores it with the server timestamp. It returns 204.

The endpoint is set by the `data-endpoint` attribute on the script tag, falling back to the script's own origin.

## Classification rules (`classify.js`)
Rules are checked in order:
1. **UTM source present** → the UTM values, normalized. A missing medium or campaign becomes `(not set)`.
2. **Referrer host = landing host** → `(direct)/(none)`. This covers internal navigation.
3. **Search table match** → `<engine>/organic`.
4. **Social table match** → `<network>/social`.
5. **Any other referrer** → `<host>/referral`.
6. **No referrer, or an invalid one** → `(direct)/(none)`.

Host matching:
- A pattern ending in `.` (e.g. `google.`) matches as a host prefix or as a label anywhere in the host. This covers `google.co.in`.
- Any other pattern matches the exact host or a subdomain of it, so `x.com` does not match `notx.com`.

## CORS
- `ALLOWED_ORIGINS` (comma list, or `*`) applies to `/api/collect/*` only.
- Same-origin requests always work.
- OPTIONS → 204.

## Gotchas
- **Consent:** a persistent visitor ID needs consent under GDPR/DPDP, so the snippet should load only after consent.
- **Ad blockers:** they may block `tracker.js`. Serving it from your own domain or path helps.
- **Device identity:** each browser gets its own ID, so there's no cross-device identity.

## Tests
- `test/classify.test.js`
- `test/api.test.js`: touches, validation and CORS cases
- Manual check: open `/store/?utm_source=...` in a browser and check the `touches` table.
