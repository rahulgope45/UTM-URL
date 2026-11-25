import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditTouches } from '../src/attribution.js';

const DAY = 86_400_000;
const at = (d) => new Date(Date.UTC(2026, 0, 1) + d * DAY).toISOString();
const touch = (source, d) => ({ source, medium: 'x', campaign: 'y', created_at: at(d) });
const journey = [touch('instagram', 0), touch('newsletter', 3), touch('(direct)', 5)];
const sale = at(6);
const LOOKBACK = 30 * DAY;
const sources = (credits) => credits.map((c) => `${c.touch.source}:${c.credit.toFixed(2)}`);

test('last_touch skips direct visits', () => {
  assert.deepEqual(sources(creditTouches(journey, sale, 'last_touch', LOOKBACK)), ['newsletter:1.00']);
});

test('last_touch falls back to direct when there is nothing else', () => {
  assert.deepEqual(sources(creditTouches([touch('(direct)', 1)], sale, 'last_touch', LOOKBACK)), ['(direct):1.00']);
});

test('first_touch credits discovery', () => {
  assert.deepEqual(sources(creditTouches(journey, sale, 'first_touch', LOOKBACK)), ['instagram:1.00']);
});

test('linear splits credit equally', () => {
  assert.deepEqual(sources(creditTouches(journey, sale, 'linear', LOOKBACK)), ['instagram:0.33', 'newsletter:0.33', '(direct):0.33']);
});

test('visits outside the lookback window or after the sale get nothing', () => {
  const credits = creditTouches([touch('instagram', 0), touch('google', 10)], at(5), 'first_touch', 2 * DAY);
  assert.deepEqual(sources(credits), ['(direct):1.00']);
});

test('no visits at all counts as direct', () => {
  assert.deepEqual(sources(creditTouches([], sale, 'linear', LOOKBACK)), ['(direct):1.00']);
});

test('unknown model throws', () => {
  assert.throws(() => creditTouches(journey, sale, 'magic', LOOKBACK), /Unknown attribution model/);
});
