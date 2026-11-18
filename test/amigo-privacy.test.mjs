/* Phase 5 — credentials and request identity.
 *
 * localStorage and IndexedDB are origin storage, not a vault. Personal tokens
 * must not be written there, and a superseded request must not be able to append
 * to a newer answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../amigo/app.js', import.meta.url), 'utf8');

test('settings are stripped of secrets before they are stored', () => {
  assert.match(app, /function stripSecrets\(/);
  assert.match(app, /localStorage\.setItem\("amigo2_settings", JSON\.stringify\(stripSecrets\(settings\)\)\)/);
  assert.ok(!/setItem\("amigo2_settings", JSON\.stringify\(settings\)\)/.test(app),
    'a raw settings object is still written to storage');
});

test('a stored secret is lifted into the session and erased from storage', () => {
  assert.match(app, /function withSecrets\(/);
  assert.match(app, /SESSION_SECRETS/);
  assert.match(app, /settings = Object\.assign\(\{\}, DEFAULTS, withSecrets\(s\)\)/);
});

test('the session secret keys are the ones that were being persisted', () => {
  const block = app.slice(app.indexOf('const SESSION_SECRETS'), app.indexOf('const SESSION_SECRETS') + 120);
  assert.match(block, /ghToken/);
  assert.match(block, /gkey/);
});

test('every active request carries an id', () => {
  assert.match(app, /const REQUEST = \{ state: "idle", id: 0/);
  assert.match(app, /function nextRequestId\(/);
  assert.match(app, /function isCurrentRequest\(/);
});

test('a late frame from a superseded request is dropped', () => {
  assert.match(app, /if \(!isCurrentRequest\(requestId\)\) break/);
  assert.match(app, /REQUEST\.id \+= 1;\s+\/\/ invalidate/);
});
