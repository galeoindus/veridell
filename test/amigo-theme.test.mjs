/* Phase 1B — one owner for appearance.
 *
 * The shared controller stores auto/light/dark under veridell:theme, resolves
 * auto, and paints html[data-theme]. Amigo's own stylesheet reads body.dark, so
 * the page gets a compatibility class; the site keeps its tri-state contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const theme = readFileSync(new URL('../assets/js/global-theme.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../amigo/app.js', import.meta.url), 'utf8');

test('the resolved theme is mirrored onto body.dark for the chat page only', () => {
  assert.match(theme, /classList\.contains\('amigo-chat'\)/);
  assert.match(theme, /classList\.toggle\('dark',\s*theme === 'dark'\)/);
});

test('the tri-state store is untouched', () => {
  assert.match(theme, /veridell:theme/);
  for (const mode of ['auto', 'light', 'dark']) assert.ok(theme.includes(`'${mode}'`), mode);
});

test('the page button is discovered through the shared attribute contract', () => {
  const html = readFileSync(new URL('../amigo/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btnTheme"[^>]*data-theme-toggle/);
  assert.ok(theme.includes('[data-theme-toggle]'), 'the controller does not look for the marker');
});

test('the stale settings mirror is gone from the chat app', () => {
  assert.ok(!/theme:\s*"light"/.test(app), 'DEFAULTS still carries theme');
  assert.ok(!/settings\.theme\s*=/.test(app), 'the app still writes settings.theme');
});
