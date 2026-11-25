# Feature: UTM link builder & Kutt shortener

**Goal:** generate consistent UTM-tagged links, optionally shortened through a self-hosted Kutt instance, and keep a history of them.

## Files
- `src/kutt-utm.js`:
  - `buildUtmUrl(url, {source, medium, campaign, term?, content?, id?})`. `source`, `medium` and `campaign` are required; the URL must be http(s); existing query params and the hash are kept; existing `utm_*` values are overwritten.
  - `normalize(v)`: lowercase, trim, whitespace → `_`. It's shared with `classify.js` and the spend route.
  - `shortenWithKutt(target, {baseUrl, apiKey, customurl, description, expireIn, password, domain, reuse, timeoutMs})`
  - `createUtmLink(url, utm, {shorten?, ...kuttOptions})` → `{longUrl, shortUrl, id}`
- `src/app.js` → `GET /api/links` (each link includes `visits`, `orders`, `revenue`: the last-touch results of its source/medium/campaign over 730 days; links with the same three values share numbers), `POST /api/links {url, source, medium, campaign, term?, content?, shorten?}`
- `src/db.js` → `links` table
- `public/builder/index.html` → form with a live preview, copy buttons and a history table

## Kutt API facts (Kutt v3.x, MIT)
- **Create a link:** `POST {KUTT_URL}/api/v2/links` with header `X-API-KEY`.
- **Body:** `target` (required), plus optional `customurl`, `expire_in`, `password`, `domain`, `reuse`, `description`.
- **Response:** the short URL is the `link` field (verified: a full URL such as `https://go.<host>/bZPS3S`, https unless Kutt runs in dev mode) and the slug is `address`.
- **Instance defaults:** `DISALLOW_REGISTRATION=true`, `DISALLOW_ANONYMOUS_LINKS=true`, `ENABLE_RATE_LIMIT=false`.
- **Gaps:** there's no bulk-create endpoint, and HTTPS for custom domains has to be set up manually.
- **Warning:** `kutt.it` is not owned by the project. The official host is `kutt.to`.

## Behaviour
- **Kutt not configured** (`KUTT_URL` or `KUTT_API_KEY` missing) with `shorten: true` → 201 with the long URL only and a `warning`.
- **Kutt errors** → 502 `Kutt: <Kutt's message>`. `HttpError` messages are passed to the client even for 5xx; unexpected errors stay `internal error`.
- **Kutt rejects `localhost` targets** (`URL is not valid.`), so local tests need a public-looking target URL.
- **Kutt auth for scripts:** the JWT is read only from the `token` cookie, not the Authorization header. `POST /api/auth/login` returns `{token}`; send it as `Cookie: token=...` to `POST /api/auth/apikey`.
- **Saved values:** the stored link's source, medium and campaign are the normalized values taken from the final URL.

## Tests
- `test/kutt-utm.test.js`: stubbed fetch
- `test/api.test.js`: the builder without Kutt
