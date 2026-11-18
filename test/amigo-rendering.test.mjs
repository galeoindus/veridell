/* Phase 1C — untrusted text must stay text.
 *
 * The escape helper did not escape quotes, so a CSV cell could break out of a
 * quoted attribute; links accepted any scheme; and a saved data card was
 * restored by assigning a stored string to innerHTML.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../amigo/app.js', import.meta.url), 'utf8');

test('the escape helper covers quotes as well as angle brackets', () => {
  const body = app.slice(app.indexOf('function esc('), app.indexOf('function esc(') + 400);
  assert.match(body, /quot;/, 'double quotes are not escaped');
  assert.match(body, /#39;/, 'single quotes are not escaped');
});

test('link targets are validated by scheme', () => {
  assert.match(app, /function safeExternalHref/);
  assert.match(app, /protocol !== "https:" && url\.protocol !== "http:"/);
  assert.match(app, /url\.username \|\| url\.password/);
});

test('a stored data card is rebuilt from values, never from stored HTML', () => {
  assert.ok(!/card\.innerHTML = m\.html/.test(app), 'a stored HTML blob is still injected');
  assert.match(app, /function renderDataCard/);
  assert.match(app, /schemaVersion/);
  assert.match(app, /cannot be safely restored/);
});

test('the data card is persisted as values rather than markup', () => {
  assert.ok(!/kind: "data", content: text, html/.test(app), 'the card is still saved as HTML');
  assert.match(app, /data:\s*\{\s*schemaVersion: 1/);
});
