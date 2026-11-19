/* Error reporting — off unless this deployment is given a DSN.
 *
 * Sentry was connected but had never received anything from this site, which is
 * why it could not help find the bugs readers were reporting. This module makes
 * errors visible without turning the site into a tracking surface:
 *
 *   - no DSN means no network request at all; the module is inert
 *   - only the message, stack, page path and build id are sent
 *   - no cookies, no storage contents, no input values, no user identity
 *   - a bounded queue, so a page in an error loop cannot flood the network
 *
 * Set the DSN at build time (SENTRY_DSN in the Pages environment) and the build
 * writes it into the page as a meta tag. Without it, nothing is reported.
 */
(function () {
  'use strict';

  var meta = document.querySelector('meta[name="sentry-dsn"]');
  var dsn = (meta && meta.getAttribute('content')) || window.SENTRY_DSN || '';
  if (!dsn || dsn.indexOf('https://') !== 0) return;

  // DSN shape: https://<publicKey>@<host>/<projectId>
  var match = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!match) return;
  var publicKey = match[1];
  var host = match[2];
  var projectId = match[3];
  var endpoint = 'https://' + host + '/api/' + projectId + '/store/';

  var sent = 0;
  var MAX = 8;                 // per page load
  var seen = Object.create(null);

  function buildId() {
    var node = document.querySelector('meta[name="veridell-build"]');
    return node ? node.getAttribute('content') : '';
  }

  function report(payload) {
    if (sent >= MAX) return;
    var key = String(payload.message || '').slice(0, 120);
    if (seen[key]) return;     // one report per distinct message per page
    seen[key] = true;
    sent += 1;
    try {
      var body = JSON.stringify({
        event_id: (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now())),
        timestamp: new Date().toISOString(),
        platform: 'javascript',
        level: payload.level || 'error',
        logger: 'veridellindo',
        release: buildId(),
        environment: 'production',
        message: { formatted: String(payload.message || 'Unknown error').slice(0, 500) },
        exception: payload.stack ? {
          values: [{ type: payload.type || 'Error', value: String(payload.message).slice(0, 500) }],
        } : undefined,
        request: { url: location.origin + location.pathname },
        tags: { source: payload.source || 'window' },
        extra: payload.stack ? { stack: String(payload.stack).slice(0, 2000) } : undefined,
      });
      // sendBeacon survives a page that is unloading, which is when many errors
      // actually surface
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint + '?sentry_key=' + encodeURIComponent(publicKey), body);
      } else {
        fetch(endpoint + '?sentry_key=' + encodeURIComponent(publicKey), {
          method: 'POST', body: body, keepalive: true,
          headers: { 'content-type': 'application/json' },
        }).catch(function () {});
      }
    } catch (e) { /* reporting must never throw */ }
  }

  window.addEventListener('error', function (event) {
    if (!event) return;
    report({
      message: event.message || 'Script error',
      stack: event.error && event.error.stack,
      type: event.error && event.error.name,
      source: 'window.error',
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    report({
      message: (reason && (reason.message || String(reason))) || 'Unhandled rejection',
      stack: reason && reason.stack,
      type: reason && reason.name,
      source: 'unhandledrejection',
    });
  });

  // the app's own diagnostic sink can forward the errors it records
  window.reportError = function (message, detail) {
    report({ message: message, stack: detail && detail.stack, source: 'app' });
  };
})();
