import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTouch } from './classify.js';
import { MODELS } from './attribution.js';
import { buildReport, GROUPINGS } from './report.js';
import { buildUtmUrl, shortenWithKutt } from './kutt-utm.js';
import { insertTouch, insertConversion, insertSpend, listSpend, insertLink, listLinks } from './db.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const VISITOR_ID = /^[A-Za-z0-9-]{8,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Prices live on the server: the browser only says *what* was bought, never how much it cost.
const DEMO_PRODUCTS = {
  tshirt: { name: 'Classic T-shirt', price: 799 },
  hoodie: { name: 'Everyday Hoodie', price: 1999 },
  sneakers: { name: 'Runner Sneakers', price: 3499 },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);
const str = (v, max) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  // ---- Collection API (called from your website, possibly another origin) ----
  const collect = express.Router();
  collect.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin))) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  collect.post('/touch', (req, res) => {
    const { visitorId, utm, landingPage, referrer } = req.body ?? {};
    if (!VISITOR_ID.test(visitorId ?? '')) throw bad('visitorId is required');
    const page = str(landingPage, 2000);
    const ref = str(referrer, 2000);
    const touch = classifyTouch({ utm: typeof utm === 'object' && utm ? utm : {}, referrer: ref, landingPage: page });
    // Server time, not client time: browser clocks can't be trusted.
    insertTouch(db, { visitorId, ...touch, landingPage: page, referrer: ref });
    res.status(204).end();
  });

  collect.post('/conversion', (req, res) => {
    if (config.conversionSecret && !safeEqual(req.get('x-conversion-secret') ?? '', config.conversionSecret)) {
      throw new HttpError(401, 'invalid conversion secret');
    }
    res.status(201).json(recordConversion(req.body ?? {}));
  });

  function recordConversion({ visitorId, orderId, revenue, currency }) {
    if (!VISITOR_ID.test(visitorId ?? '')) throw bad('visitorId is required');
    const order = str(orderId, 100);
    if (!order) throw bad('orderId is required');
    if (typeof revenue !== 'number' || !Number.isFinite(revenue) || revenue < 0) throw bad('revenue must be a non-negative number');
    const cur = (str(currency, 3) ?? config.currency).toUpperCase();
    if (cur !== config.currency) throw bad(`only ${config.currency} is supported`);
    const { created } = insertConversion(db, { orderId: order, visitorId, revenue, currency: cur });
    return { orderId: order, duplicate: !created };
  }

  app.use('/api/collect', collect);

  // ---- Reporting ----
  app.get('/api/report', (req, res) => {
    const model = req.query.model ?? 'last_touch';
    const groupBy = req.query.groupBy ?? 'source';
    if (!MODELS.includes(model)) throw bad(`model must be one of ${MODELS.join(', ')}`);
    if (!GROUPINGS[groupBy]) throw bad(`groupBy must be one of ${Object.keys(GROUPINGS).join(', ')}`);
    const days = Number(req.query.days ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 730) throw bad('days must be 1-730');
    const now = Date.now();
    const to = new Date(now + 60_000).toISOString();
    const from = new Date(now - days * 86_400_000).toISOString();
    res.json(buildReport(db, { model, groupBy, from, to, lookbackDays: config.lookbackDays, currency: config.currency }));
  });

  // ---- Ad spend (enter what you paid each platform) ----
  app.get('/api/spend', (req, res) => res.json(listSpend(db)));
  app.post('/api/spend', (req, res) => {
    const { source, medium, amount, spentOn, note } = req.body ?? {};
    const src = str(source, 100);
    const med = str(medium, 100) ?? 'cpc';
    if (!src) throw bad('source is required');
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw bad('amount must be a positive number');
    if (!DATE.test(spentOn ?? '')) throw bad('spentOn must be YYYY-MM-DD');
    const slug = (v) => v.toLowerCase().replace(/\s+/g, '_');
    const id = insertSpend(db, { source: slug(src), medium: slug(med), amount, spentOn, note: str(note, 200) });
    res.status(201).json({ id });
  });

  // ---- UTM link builder ----
  app.get('/api/links', (req, res) => res.json(listLinks(db)));
  app.post('/api/links', async (req, res) => {
    const { url, source, medium, campaign, term, content, shorten } = req.body ?? {};
    let longUrl;
    try {
      longUrl = buildUtmUrl(url, { source, medium, campaign, term, content });
    } catch (e) {
      throw bad(e.message);
    }
    let shortUrl = null;
    let warning;
    if (shorten && config.kutt.baseUrl && config.kutt.apiKey) {
      try {
        shortUrl = (await shortenWithKutt(longUrl, config.kutt)).link;
      } catch (e) {
        throw new HttpError(502, `Kutt: ${e.message}`);
      }
    } else if (shorten) {
      warning = 'Kutt is not configured (KUTT_URL / KUTT_API_KEY), so only the long link was created.';
    }
    const u = new URL(longUrl).searchParams;
    insertLink(db, { longUrl, shortUrl, source: u.get('utm_source'), medium: u.get('utm_medium'), campaign: u.get('utm_campaign') });
    res.status(201).json({ longUrl, shortUrl, warning });
  });

  // ---- Demo store backend: shows the right way to report a sale (server side) ----
  if (config.demoStore) {
    app.get('/api/demo/products', (req, res) =>
      res.json(Object.entries(DEMO_PRODUCTS).map(([id, p]) => ({ id, ...p, currency: config.currency }))));
    app.post('/api/demo/checkout', (req, res) => {
      const product = DEMO_PRODUCTS[req.body?.productId];
      if (!product) throw bad('unknown productId');
      const orderId = `demo_${crypto.randomUUID()}`;
      res.status(201).json(recordConversion({ visitorId: req.body.visitorId, orderId, revenue: product.price, currency: config.currency }));
    });
  }

  app.get('/', (req, res) => res.redirect('/dashboard/'));
  app.use(express.static(PUBLIC_DIR));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
  });

  return app;
}
