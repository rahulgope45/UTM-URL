# Feature: Conversions (sales)

**Goal:** record each sale against the visitor who made it, so revenue can be attributed to marketing channels.

## Files
- `src/app.js` → `collect.post('/conversion')` and the shared `recordConversion()`
- `src/db.js` → `conversions` table, `insertConversion()`

## Contract
`POST /api/collect/conversion`, header `X-Conversion-Secret: <CONVERSION_SECRET>` (only required when the env var is set):
```json
{ "visitorId": "<from UTMTracker.visitorId()>", "orderId": "ORD-1", "revenue": 1999, "currency": "INR" }
```
- **201** → `{orderId, duplicate}`. `duplicate: true` means the order was already recorded and nothing changed.
- **400** → missing or invalid `visitorId` or `orderId`, negative or non-number revenue, or a currency other than `CURRENCY`.
- **401** → wrong secret. The comparison is constant-time (`safeEqual` hashes both values, then uses `timingSafeEqual`).

## Rules
- **Report sales from the shop's backend**, after payment is confirmed, never from the browser. The browser only passes `visitorId` along with the order.
- **Idempotency:** `order_id` is UNIQUE and inserts use `ON CONFLICT DO NOTHING`, so webhook retries are safe.
- **Timestamp:** `created_at` is server time. Attribution uses touches at or before it.
- **Currency:** a single currency (`CURRENCY`, default INR). Multi-currency would need FX conversion when reports are built.

## Tests
`test/api.test.js` covers the end-to-end flow, idempotency, secret enforcement and validation.
