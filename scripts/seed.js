// Fill the database with 60 days of realistic-looking fake traffic, sales and ad spend.
// Usage: npm run seed   (wipes existing data first)
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { openDb, insertTouch, insertConversion, insertSpend, resetAll } from '../src/db.js';

const DAYS = 60;
const VISITORS = 4000;
const DAY = 86_400_000;

// Each channel behaves differently — that's the story the dashboard should reveal.
const CHANNELS = [
  { source: 'instagram', medium: 'social', campaign: 'diwali_sale', weight: 30, conv: 0.006, prices: [799, 799, 1999], spendPerDay: 1800 },
  { source: 'google', medium: 'cpc', campaign: 'brand_search', weight: 16, conv: 0.05, prices: [1999, 3499], spendPerDay: 1500 },
  { source: 'facebook', medium: 'cpc', campaign: 'retargeting', weight: 12, conv: 0.03, prices: [799, 1999], spendPerDay: 900 },
  { source: 'linkedin', medium: 'social', campaign: 'b2b_launch', weight: 7, conv: 0.012, prices: [3499], spendPerDay: 1600 },
  { source: 'newsletter', medium: 'email', campaign: 'weekly_digest', weight: 10, conv: 0.07, prices: [1999, 3499], spendPerDay: 0 },
  { source: 'google', medium: 'organic', campaign: '(not set)', weight: 14, conv: 0.035, prices: [799, 1999, 3499], spendPerDay: 0 },
  { source: '(direct)', medium: '(none)', campaign: '(not set)', weight: 11, conv: 0.04, prices: [799, 1999], spendPerDay: 0 },
];
const totalWeight = CHANNELS.reduce((n, c) => n + c.weight, 0);
const pickChannel = () => {
  let r = Math.random() * totalWeight;
  for (const c of CHANNELS) if ((r -= c.weight) < 0) return c;
  return CHANNELS[0];
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const config = loadConfig();
const db = openDb(config.dbFile);
const now = Date.now();
let touches = 0;
let orders = 0;

db.exec('BEGIN');
try {
  resetAll(db);
  for (let i = 0; i < VISITORS; i++) {
    const visitorId = crypto.randomUUID();
    let t = now - Math.random() * DAYS * DAY;
    // 1-3 visits: people often discover you on one platform and buy after another
    const journey = [pickChannel()];
    const extra = Math.random() < 0.35 ? (Math.random() < 0.4 ? 2 : 1) : 0;
    for (let k = 0; k < extra; k++) journey.push(pickChannel());

    for (const ch of journey) {
      if (t > now) break;
      insertTouch(db, {
        visitorId, source: ch.source, medium: ch.medium, campaign: ch.campaign,
        landingPage: 'https://shop.example.com/', createdAt: new Date(t).toISOString(),
      });
      touches++;
      t += Math.random() * 5 * DAY;
    }

    const closer = [...journey].reverse().find((c) => c.source !== '(direct)') ?? journey.at(-1);
    const boost = journey.length > 1 ? 1.6 : 1; // returning visitors buy more often
    const saleAt = Math.min(t, now - 60_000);
    if (Math.random() < closer.conv * boost && saleAt > now - DAYS * DAY) {
      insertConversion(db, { orderId: `seed_${crypto.randomUUID()}`, visitorId, revenue: pick(closer.prices), currency: config.currency, createdAt: new Date(saleAt).toISOString() });
      orders++;
    }
  }

  for (let d = 0; d < DAYS; d++) {
    const day = new Date(now - d * DAY).toISOString().slice(0, 10);
    for (const ch of CHANNELS.filter((c) => c.spendPerDay)) {
      insertSpend(db, { source: ch.source, medium: ch.medium, amount: Math.round(ch.spendPerDay * (0.8 + Math.random() * 0.4)), spentOn: day });
    }
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
db.close();
console.log(`Seeded ${touches} visits, ${orders} orders and ${DAYS} days of ad spend into ${config.dbFile}`);
