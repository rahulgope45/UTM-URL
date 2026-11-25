import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildUtmUrl, shortenWithKutt, createUtmLink } from '../src/kutt-utm.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const utm = { source: 'Newsletter', medium: 'email', campaign: 'Black Friday 2026' };

test('adds and normalizes UTM params', () => {
  const out = new URL(buildUtmUrl('https://example.com/pricing', utm));
  assert.equal(out.searchParams.get('utm_source'), 'newsletter');
  assert.equal(out.searchParams.get('utm_medium'), 'email');
  assert.equal(out.searchParams.get('utm_campaign'), 'black_friday_2026');
  assert.equal(out.searchParams.has('utm_term'), false);
});

test('keeps existing query and hash, overrides old utm values', () => {
  const out = buildUtmUrl('https://example.com/p?ref=1&utm_source=old#top', utm);
  const u = new URL(out);
  assert.equal(u.searchParams.get('ref'), '1');
  assert.equal(u.searchParams.getAll('utm_source').length, 1);
  assert.equal(u.searchParams.get('utm_source'), 'newsletter');
  assert.equal(u.hash, '#top');
});

test('rejects bad input', () => {
  assert.throws(() => buildUtmUrl('not a url', utm), /Invalid URL/);
  assert.throws(() => buildUtmUrl('ftp://x.com', utm), /http or https/);
  assert.throws(() => buildUtmUrl('https://x.com', { source: 'a', medium: 'b' }), /campaign/);
});

test('shortenWithKutt sends the right request and returns link', async () => {
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url, init };
    return new Response(JSON.stringify({ id: 'abc', link: 'https://s.example.com/xY3k9a' }), { status: 200 });
  };
  const res = await shortenWithKutt('https://example.com/?utm_source=a', {
    baseUrl: 'https://s.example.com/', apiKey: 'KEY', customurl: 'bf26', expireIn: '30 days',
  });
  assert.equal(call.url, 'https://s.example.com/api/v2/links');
  assert.equal(call.init.headers['X-API-KEY'], 'KEY');
  assert.deepEqual(JSON.parse(call.init.body), {
    target: 'https://example.com/?utm_source=a', customurl: 'bf26', expire_in: '30 days',
  });
  assert.equal(res.link, 'https://s.example.com/xY3k9a');
});

test('shortenWithKutt surfaces API errors', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Custom URL is already in use.' }), { status: 400 });
  await assert.rejects(
    shortenWithKutt('https://example.com', { baseUrl: 'https://s.example.com', apiKey: 'K' }),
    /400: Custom URL is already in use/,
  );
});

test('createUtmLink returns long and short URLs', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'id1', link: 'https://s.example.com/q' }), { status: 200 });
  const res = await createUtmLink('https://example.com', utm, { baseUrl: 'https://s.example.com', apiKey: 'K' });
  assert.match(res.longUrl, /utm_campaign=black_friday_2026/);
  assert.equal(res.shortUrl, 'https://s.example.com/q');
  assert.equal(res.id, 'id1');
});

test('createUtmLink can skip shortening', async () => {
  const res = await createUtmLink('https://example.com', utm, { shorten: false });
  assert.equal(res.shortUrl, null);
});
