/* Phase 4 — streaming and request ownership.
 *
 * Source-level assertions. The endpoint's own SSE behaviour is covered by
 * test/chat-endpoint.test.mjs; this file checks the client contract: one owner
 * for the active request, deltas rendered as they arrive, a Stop control that
 * aborts, and a stopped answer kept rather than discarded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const app = readFileSync(new URL('../amigo/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../amigo/index.html', import.meta.url), 'utf8');
const { document } = new JSDOM(html).window;

test('one object owns the active request', () => {
  assert.match(app, /const REQUEST = \{ state: "idle", id: 0, controller: null/);
  assert.match(app, /function stopActiveRequest\(/);
  assert.match(app, /REQUEST\.controller\.abort\(\)/);
});

test('the request state machine has explicit states', () => {
  for (const state of ['thinking', 'responding', 'stopped', 'error', 'done']) {
    assert.ok(app.includes(`"${state}"`), `${state} is not a request state`);
  }
});

test('the client consumes server-sent events', () => {
  assert.match(app, /Accept": "text\/event-stream"|Accept': 'text\/event-stream|"Accept": "text\/event-stream"/);
  assert.match(app, /text\/event-stream/);
  assert.match(app, /event\.type === "delta"/);
  assert.match(app, /event\.type === "done"/);
});

test('deltas render before the answer is complete', () => {
  assert.match(app, /setRequestState\("responding"\)/);
  assert.match(app, /bub\.innerHTML = mdLite\(text\)/);
});

test('the Stop control exists and is hidden until a request runs', () => {
  const stop = document.getElementById('stop');
  assert.ok(stop, 'no stop button');
  assert.ok(stop.hasAttribute('hidden'), 'the stop button is visible while idle');
  assert.ok(stop.getAttribute('aria-label'), 'the stop button has no name');
  assert.match(app, /getElementById\("stop"\)/);
});

test('a stopped answer is kept, not thrown away', () => {
  assert.match(app, /err\.name === "AbortError"/);
  assert.match(app, /Response stopped\./);
  assert.match(app, /role: "assistant", content: kept/);
});
