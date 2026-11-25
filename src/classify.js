// Turn a landing (UTM params + referrer) into source / medium / campaign,
// following the same conventions Google Analytics uses:
//   UTM present        -> use UTM values
//   search engine      -> <engine> / organic
//   social site        -> <network> / social
//   other website      -> <host> / referral
//   nothing            -> (direct) / (none)
import { normalize } from './kutt-utm.js';

const NOT_SET = '(not set)';
export const DIRECT = Object.freeze({ source: '(direct)', medium: '(none)', campaign: NOT_SET });

const SEARCH = [
  ['google.', 'google'], ['bing.com', 'bing'], ['duckduckgo.com', 'duckduckgo'],
  ['search.yahoo.', 'yahoo'], ['yandex.', 'yandex'], ['baidu.com', 'baidu'], ['ecosia.org', 'ecosia'],
];
const SOCIAL = [
  ['facebook.com', 'facebook'], ['fb.me', 'facebook'], ['instagram.com', 'instagram'],
  ['t.co', 'twitter'], ['twitter.com', 'twitter'], ['x.com', 'twitter'],
  ['linkedin.com', 'linkedin'], ['lnkd.in', 'linkedin'], ['reddit.com', 'reddit'],
  ['youtube.com', 'youtube'], ['pinterest.', 'pinterest'], ['tiktok.com', 'tiktok'],
  ['whatsapp.com', 'whatsapp'], ['wa.me', 'whatsapp'], ['quora.com', 'quora'],
];

function matchHost(host, table) {
  for (const [pattern, name] of table) {
    if (pattern.endsWith('.')) {
      if (host.startsWith(pattern) || host.includes(`.${pattern}`)) return name;
    } else if (host === pattern || host.endsWith(`.${pattern}`)) {
      return name;
    }
  }
  return null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

const clean = (v) => (v == null || String(v).trim() === '' ? null : normalize(v).slice(0, 100));

/**
 * @param {{utm?: object, referrer?: string, landingPage?: string}} input
 * @returns {{source:string, medium:string, campaign:string, term:string|null, content:string|null}}
 */
export function classifyTouch({ utm = {}, referrer, landingPage } = {}) {
  const source = clean(utm.source);
  if (source) {
    return {
      source,
      medium: clean(utm.medium) ?? NOT_SET,
      campaign: clean(utm.campaign) ?? NOT_SET,
      term: clean(utm.term),
      content: clean(utm.content),
    };
  }

  const refHost = referrer ? hostOf(referrer) : null;
  const siteHost = landingPage ? hostOf(landingPage) : null;
  // A referrer from our own site means the visitor was already here: treat as direct.
  if (!refHost || (siteHost && refHost === siteHost)) return { ...DIRECT, term: null, content: null };

  const search = matchHost(refHost, SEARCH);
  if (search) return { source: search, medium: 'organic', campaign: NOT_SET, term: null, content: null };
  const social = matchHost(refHost, SOCIAL);
  if (social) return { source: social, medium: 'social', campaign: NOT_SET, term: null, content: null };
  return { source: refHost.slice(0, 100), medium: 'referral', campaign: NOT_SET, term: null, content: null };
}
