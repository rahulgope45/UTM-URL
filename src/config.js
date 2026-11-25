// All runtime settings come from environment variables (12-factor style).
export function loadConfig(env = process.env) {
  const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    port: Number(env.PORT ?? 3000),
    dbFile: env.DB_FILE ?? 'data/utm.db',
    // Origins allowed to send tracking events (your website). Same-origin always works.
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    // If set, POST /api/collect/conversion requires header X-Conversion-Secret.
    // Conversions should be reported by your backend, not the browser.
    conversionSecret: env.CONVERSION_SECRET || null,
    // How far back before a sale a visit can still get credit for it.
    lookbackDays: Number(env.LOOKBACK_DAYS ?? 30),
    currency: env.CURRENCY ?? 'INR',
    demoStore: env.DEMO_STORE !== 'false',
    kutt: {
      baseUrl: env.KUTT_URL || null,
      apiKey: env.KUTT_API_KEY || null,
    },
  };
}
