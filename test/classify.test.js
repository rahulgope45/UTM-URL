import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTouch } from '../src/classify.js';

const pick = (t) => `${t.source} / ${t.medium} / ${t.campaign}`;

test('UTM parameters win and are normalized', () => {
  const t = classifyTouch({ utm: { source: 'Instagram', medium: 'Social', campaign: 'Diwali Sale' }, referrer: 'https://google.com/' });
  assert.equal(pick(t), 'instagram / social / diwali_sale');
});

test('UTM source without medium/campaign gets (not set)', () => {
  assert.equal(pick(classifyTouch({ utm: { source: 'newsletter' } })), 'newsletter / (not set) / (not set)');
});

test('search engines are organic', () => {
  assert.equal(pick(classifyTouch({ referrer: 'https://www.google.co.in/' })), 'google / organic / (not set)');
  assert.equal(pick(classifyTouch({ referrer: 'https://duckduckgo.com/' })), 'duckduckgo / organic / (not set)');
});

test('social networks are social', () => {
  assert.equal(classifyTouch({ referrer: 'https://l.instagram.com/?u=x' }).source, 'instagram');
  assert.equal(classifyTouch({ referrer: 'https://t.co/abc' }).source, 'twitter');
  assert.equal(classifyTouch({ referrer: 'https://lnkd.in/abc' }).medium, 'social');
});

test('other sites are referrals; lookalike hosts are not misclassified', () => {
  assert.equal(pick(classifyTouch({ referrer: 'https://blog.example.org/post' })), 'blog.example.org / referral / (not set)');
  assert.equal(classifyTouch({ referrer: 'https://notx.com/' }).medium, 'referral');
});

test('no referrer or own-site referrer is direct', () => {
  assert.equal(pick(classifyTouch({})), '(direct) / (none) / (not set)');
  assert.equal(classifyTouch({ referrer: 'https://shop.com/a', landingPage: 'https://shop.com/b' }).source, '(direct)');
  assert.equal(classifyTouch({ referrer: 'not a url' }).source, '(direct)');
});
