// Build UTM-tagged URLs and (optionally) shorten them with a Kutt instance.
// Kutt API: POST {KUTT_URL}/api/v2/links, header X-API-KEY, body { target, ... }.

const UTM_KEYS = {
  source: 'utm_source',
  medium: 'utm_medium',
  campaign: 'utm_campaign',
  term: 'utm_term',
  content: 'utm_content',
  id: 'utm_id',
};

const REQUIRED = ['source', 'medium', 'campaign'];

// Lowercase, trim, and turn whitespace into underscores so "Black Friday"
// and "black_friday" don't show up as two campaigns in analytics.
export function normalize(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Add UTM parameters to a URL. Existing query params and #hash are kept;
 * existing utm_* params are overwritten.
 *
 * @param {string} url  Absolute http(s) URL.
 * @param {{source:string, medium:string, campaign:string, term?:string, content?:string, id?:string}} utm
 * @returns {string}
 */
export function buildUtmUrl(url, utm = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(`URL must be http or https: ${url}`);
  }

  for (const key of REQUIRED) {
    if (utm[key] == null || String(utm[key]).trim() === '') {
      throw new TypeError(`Missing required UTM field: ${key}`);
    }
  }

  for (const [key, param] of Object.entries(UTM_KEYS)) {
    const value = utm[key];
    if (value != null && String(value).trim() !== '') {
      parsed.searchParams.set(param, normalize(value));
    }
  }

  return parsed.toString();
}

/**
 * Shorten a URL with Kutt.
 *
 * @param {string} target  The long URL.
 * @param {object} [options]
 * @param {string} [options.baseUrl]   Kutt instance, e.g. https://s.example.com (default: env KUTT_URL)
 * @param {string} [options.apiKey]    Kutt API key (default: env KUTT_API_KEY)
 * @param {string} [options.customurl] Custom slug
 * @param {string} [options.description]
 * @param {string} [options.expireIn]  e.g. "30 days"
 * @param {string} [options.password]
 * @param {string} [options.domain]    Custom domain registered in Kutt
 * @param {boolean} [options.reuse]    Return an existing short link for the same target
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<object>} Kutt link object ({ id, address, link, target, ... })
 */
export async function shortenWithKutt(target, options = {}) {
  const {
    baseUrl = process.env.KUTT_URL,
    apiKey = process.env.KUTT_API_KEY,
    customurl,
    description,
    expireIn,
    password,
    domain,
    reuse,
    timeoutMs = 10_000,
  } = options;

  if (!baseUrl) throw new Error('Kutt base URL missing (set KUTT_URL or pass baseUrl)');
  if (!apiKey) throw new Error('Kutt API key missing (set KUTT_API_KEY or pass apiKey)');

  const body = { target };
  if (customurl) body.customurl = customurl;
  if (description) body.description = description;
  if (expireIn) body.expire_in = expireIn;
  if (password) body.password = password;
  if (domain) body.domain = domain;
  if (reuse != null) body.reuse = reuse;

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/v2/links`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }

  if (!res.ok) {
    const msg = data.error || data.message || res.statusText;
    const err = new Error(`Kutt API error ${res.status}: ${msg}`);
    err.status = res.status;
    err.response = data;
    throw err;
  }
  if (!data.link) {
    throw new Error('Kutt API response did not include a "link" field');
  }
  return data;
}

/**
 * Take a URL, add UTM parameters, and return a short Kutt link for it.
 *
 * @param {string} url
 * @param {object} utm          See buildUtmUrl.
 * @param {object} [kuttOptions] See shortenWithKutt. Pass { shorten: false } to skip Kutt.
 * @returns {Promise<{longUrl:string, shortUrl:string|null, id:string|null}>}
 */
export async function createUtmLink(url, utm, kuttOptions = {}) {
  const { shorten = true, ...rest } = kuttOptions;
  const longUrl = buildUtmUrl(url, utm);
  if (!shorten) return { longUrl, shortUrl: null, id: null };

  const link = await shortenWithKutt(longUrl, rest);
  return { longUrl, shortUrl: link.link, id: link.id ?? null };
}
