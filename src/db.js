import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS touches (
  id           INTEGER PRIMARY KEY,
  visitor_id   TEXT NOT NULL,
  source       TEXT NOT NULL,
  medium       TEXT NOT NULL,
  campaign     TEXT NOT NULL,
  term         TEXT,
  content      TEXT,
  landing_page TEXT,
  referrer     TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_touches_visitor ON touches(visitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_touches_created ON touches(created_at);

CREATE TABLE IF NOT EXISTS conversions (
  id         INTEGER PRIMARY KEY,
  order_id   TEXT NOT NULL UNIQUE,
  visitor_id TEXT NOT NULL,
  revenue    REAL NOT NULL,
  currency   TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversions_created ON conversions(created_at);

CREATE TABLE IF NOT EXISTS spend (
  id       INTEGER PRIMARY KEY,
  source   TEXT NOT NULL,
  medium   TEXT NOT NULL DEFAULT 'cpc',
  amount   REAL NOT NULL,
  spent_on TEXT NOT NULL,
  note     TEXT
);
CREATE INDEX IF NOT EXISTS idx_spend_date ON spend(spent_on);

CREATE TABLE IF NOT EXISTS links (
  id         INTEGER PRIMARY KEY,
  long_url   TEXT NOT NULL,
  short_url  TEXT,
  source     TEXT NOT NULL,
  medium     TEXT NOT NULL,
  campaign   TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function insertTouch(db, t) {
  db.prepare(
    `INSERT INTO touches (visitor_id, source, medium, campaign, term, content, landing_page, referrer, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    t.visitorId, t.source, t.medium, t.campaign, t.term ?? null, t.content ?? null,
    t.landingPage ?? null, t.referrer ?? null, t.createdAt ?? new Date().toISOString(),
  );
}

// Idempotent on order_id: a retried webhook or page refresh can't double count a sale.
export function insertConversion(db, c) {
  const r = db.prepare(
    `INSERT INTO conversions (order_id, visitor_id, revenue, currency, created_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(order_id) DO NOTHING`,
  ).run(c.orderId, c.visitorId, c.revenue, c.currency, c.createdAt ?? new Date().toISOString());
  return { created: r.changes > 0 };
}

export function insertSpend(db, s) {
  const r = db.prepare('INSERT INTO spend (source, medium, amount, spent_on, note) VALUES (?, ?, ?, ?, ?)')
    .run(s.source, s.medium ?? 'cpc', s.amount, s.spentOn, s.note ?? null);
  return Number(r.lastInsertRowid);
}

export function listSpend(db, limit = 100) {
  return db.prepare('SELECT * FROM spend ORDER BY spent_on DESC, id DESC LIMIT ?').all(limit);
}

export function insertLink(db, l) {
  db.prepare(
    `INSERT INTO links (long_url, short_url, source, medium, campaign, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(l.longUrl, l.shortUrl ?? null, l.source, l.medium, l.campaign, new Date().toISOString());
}

export function listLinks(db, limit = 50) {
  return db.prepare('SELECT * FROM links ORDER BY id DESC LIMIT ?').all(limit);
}

export function resetAll(db) {
  db.exec('DELETE FROM touches; DELETE FROM conversions; DELETE FROM spend; DELETE FROM links;');
}
