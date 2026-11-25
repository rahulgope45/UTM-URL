/*
 * UTM tracker — add to every page of your website:
 *   <script src="https://YOUR-TRACKER-HOST/tracker.js" defer></script>
 *
 * - Gives each browser an anonymous visitor ID (localStorage).
 * - Records one "touch" per visit: at the start of a session, or whenever the
 *   visitor arrives through a new campaign link mid-session.
 * - The server works out source/medium from UTM params or the referrer.
 *
 * At checkout, send UTMTracker.visitorId() to YOUR backend with the order,
 * and have your backend report the sale to POST /api/collect/conversion.
 *
 * Note: a persistent visitor ID is tracking. In the EU/UK (GDPR/ePrivacy) and
 * similar regimes, load this only after the visitor consents.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var endpoint = (script && script.getAttribute('data-endpoint')) || (script ? new URL(script.src).origin : location.origin);
  var VID_KEY = 'utm_vid';
  var SESSION_KEY = 'utm_session';
  var UTM_FIELDS = ['source', 'medium', 'campaign', 'term', 'content'];

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  var memoryId = null;
  function visitorId() {
    try {
      var id = localStorage.getItem(VID_KEY);
      if (!id) {
        id = uuid();
        localStorage.setItem(VID_KEY, id);
      }
      return id;
    } catch (e) {
      return memoryId || (memoryId = uuid()); // storage blocked: track this page view only
    }
  }

  function session(value) {
    try {
      if (value === undefined) return sessionStorage.getItem(SESSION_KEY);
      sessionStorage.setItem(SESSION_KEY, value);
    } catch (e) {
      return null;
    }
  }

  var params = new URLSearchParams(location.search);
  var utm = {};
  UTM_FIELDS.forEach(function (f) {
    var v = params.get('utm_' + f);
    if (v) utm[f] = v;
  });
  var signature = utm.source ? JSON.stringify(utm) : 'no-utm';
  var current = session();

  // New session, or a new campaign click within the session -> record a touch.
  if (current === null || (utm.source && current !== signature)) {
    session(signature);
    fetch(endpoint + '/api/collect/touch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: visitorId(), utm: utm, landingPage: location.href, referrer: document.referrer }),
      keepalive: true,
      credentials: 'omit',
    }).catch(function () { /* tracking must never break the site */ });
  }

  window.UTMTracker = { visitorId: visitorId };
})();
