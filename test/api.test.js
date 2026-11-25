import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

let server;
let base;
let db;
const config = loadConfig({ CONVERSION_SECRET: 's3cret', ALLOWED_ORIGINS: 'https://shop.example.com' });

before(async () => {
  db = openDb(':memory:');
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

const post = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const report = async (q = '') => (await fetch(`${base}/api/report?${q}`)).json();
const VID_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const VID_B = 'bbbbbbbb-2222-4222-8222-222222222222';

test('end to end: visits + sales show up per platform', async () => {
  // Visitor A: Instagram, then newsletter, buys hoodie through the demo store
  assert.equal((await post('/api/collect/touch', { visitorId: VID_A, utm: { source: 'Instagram', medium: 'social', campaign: 'diwali' }, landingPage: 'https://shop.example.com/' })).status, 204);
  await new Promise((r) => setTimeout(r, 5));
  await post('/api/collect/touch', { visitorId: VID_A, utm: { source: 'newsletter', medium: 'email', campaign: 'weekly' }, landingPage: 'https://shop.example.com/' });
  assert.equal((await post('/api/demo/checkout', { visitorId: VID_A, productId: 'hoodie' })).status, 201);

  // Visitor B: Google organic, buys via server-to-server conversion
  await post('/api/collect/touch', { visitorId: VID_B, referrer: 'https://www.google.com/', landingPage: 'https://shop.example.com/' });
  const conv = await post('/api/collect/conversion', { visitorId: VID_B, orderId: 'ord-1', revenue: 500 }, { 'X-Conversion-Secret': 's3cret' });
  assert.equal(conv.status, 201);

  await post('/api/spend', { source: 'Instagram', medium: 'social', amount: 1000, spentOn: new Date().toISOString().slice(0, 10) });

  const last = await report('model=last_touch');
  const by = Object.fromEntries(last.rows.map((r) => [r.key, r]));
  assert.equal(by.newsletter.revenue, 1999);
  assert.equal(by.google.revenue, 500);
  assert.equal(by.instagram.revenue, 0);
  assert.equal(by.instagram.spend, 1000);
  assert.equal(by.instagram.visits, 1);
  assert.equal(last.totals.revenue, 2499);
  assert.equal(last.totals.conversions, 2);

  const first = await report('model=first_touch');
  assert.equal(first.rows.find((r) => r.key === 'instagram').revenue, 1999);
  assert.equal(first.rows.find((r) => r.key === 'instagram').roas, 1.999);

  // Spend is matched on source + medium, so paid and free traffic from one platform stay apart
  const sm = await report('model=first_touch&groupBy=source_medium');
  assert.equal(sm.rows.find((r) => r.key === 'instagram / social').spend, 1000);
  assert.equal(sm.rows.find((r) => r.key === 'google / organic').spend, null);

  const linear = await report('model=linear&groupBy=campaign');
  assert.equal(linear.rows.find((r) => r.key === 'instagram / social / diwali').revenue, 999.5);
});

test('conversions are idempotent on orderId', async () => {
  const body = { visitorId: VID_B, orderId: 'ord-dup', revenue: 100 };
  const h = { 'X-Conversion-Secret': 's3cret' };
  assert.deepEqual(await (await post('/api/collect/conversion', body, h)).json(), { orderId: 'ord-dup', duplicate: false });
  assert.deepEqual(await (await post('/api/collect/conversion', body, h)).json(), { orderId: 'ord-dup', duplicate: true });
});

test('conversion endpoint requires the secret', async () => {
  const res = await post('/api/collect/conversion', { visitorId: VID_B, orderId: 'x', revenue: 1 }, { 'X-Conversion-Secret': 'wrong' });
  assert.equal(res.status, 401);
});

test('validation errors are 400 with a message', async () => {
  for (const [path, body] of [
    ['/api/collect/touch', { visitorId: 'bad id!' }],
    ['/api/collect/conversion', { visitorId: VID_A, orderId: 'o', revenue: -5 }],
    ['/api/spend', { source: 'x', amount: 10, spentOn: 'yesterday' }],
    ['/api/links', { url: 'ftp://x', source: 'a', medium: 'b', campaign: 'c' }],
    ['/api/demo/checkout', { visitorId: VID_A, productId: 'free-car' }],
  ]) {
    const res = await post(path, body, { 'X-Conversion-Secret': 's3cret' });
    assert.equal(res.status, 400, path);
    assert.ok((await res.json()).error, path);
  }
  assert.equal((await fetch(`${base}/api/report?model=magic`)).status, 400);
});

test('malformed JSON is a 400, not a crash', async () => {
  const res = await fetch(`${base}/api/collect/touch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
});

test('CORS only for allowed origins', async () => {
  const ok = await fetch(`${base}/api/collect/touch`, { method: 'OPTIONS', headers: { Origin: 'https://shop.example.com' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://shop.example.com');
  const no = await fetch(`${base}/api/collect/touch`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});

test('link builder works without Kutt and warns', async () => {
  const res = await post('/api/links', { url: 'https://shop.example.com/sale', source: 'Instagram', medium: 'social', campaign: 'Diwali Sale', shorten: true });
  const data = await res.json();
  assert.equal(res.status, 201);
  assert.match(data.longUrl, /utm_campaign=diwali_sale/);
  assert.equal(data.shortUrl, null);
  assert.match(data.warning, /Kutt is not configured/);
  const links = await (await fetch(`${base}/api/links`)).json();
  assert.equal(links[0].source, 'instagram');
  assert.deepEqual([links[0].visits, links[0].orders], [0, 0]);
});

test('links report their own visits and orders', async () => {
  await post('/api/links', { url: 'https://shop.example.com/', source: 'whatsapp', medium: 'social', campaign: 'link stats' });
  const vid = 'cccccccc-3333-4333-8333-333333333333';
  await post('/api/collect/touch', { visitorId: vid, utm: { source: 'whatsapp', medium: 'social', campaign: 'link_stats' } });
  await post('/api/demo/checkout', { visitorId: vid, productId: 'tshirt' });
  const link = (await (await fetch(`${base}/api/links`)).json()).find((l) => l.campaign === 'link_stats');
  assert.deepEqual([link.visits, link.orders, link.revenue], [1, 1, 799]);
});

test('Kutt errors come back as 502 with Kutt\'s message', async () => {
  const kuttApp = createApp({ db, config: { ...config, kutt: { baseUrl: 'https://kutt.test', apiKey: 'k' } } });
  const srv = kuttApp.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://kutt.test')
    ? new Response(JSON.stringify({ error: 'URL is not valid.' }), { status: 400 })
    : realFetch(url, init));
  try {
    const res = await realFetch(`http://127.0.0.1:${srv.address().port}/api/links`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://shop.example.com/', source: 'a', medium: 'b', campaign: 'c', shorten: true }),
    });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /URL is not valid/);
  } finally {
    globalThis.fetch = realFetch;
    srv.close();
  }
});

test('health check', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.deepEqual([res.status, await res.json()], [200, { ok: true }]);
});
