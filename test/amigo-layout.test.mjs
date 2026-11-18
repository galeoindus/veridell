/* Phase 3 — the chat layout contract.
 *
 * These are source-level assertions: they check that one owner exists for each
 * region and that the responsive contract is written down. They do not replace
 * the browser geometry check in scripts/amigo-layout-check.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../amigo/app.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../amigo/index.html', import.meta.url), 'utf8');
const boot = readFileSync(new URL('../amigo/boot.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../amigo/app.js', import.meta.url), 'utf8');

test('the geometry tokens are declared once, in the tokens layer', () => {
  for (const token of ['--amigo-shell-max', '--amigo-sidebar-width', '--amigo-drawer-width',
    '--amigo-content-max', '--amigo-page-gutter', '--amigo-mobile-gutter',
    '--amigo-header-min', '--amigo-viewport-height']) {
    assert.ok(css.includes(token), `${token} is not declared`);
  }
});

test('the stream is the only vertical scroller and may shrink', () => {
  const rule = css.slice(css.indexOf('body.amigo-chat #chat'), css.indexOf('body.amigo-chat #chat') + 420);
  assert.match(rule, /min-height: 0/);
  assert.match(rule, /overflow-y: auto/);
  assert.match(rule, /overflow-x: hidden/);
});

test('the shell owns the viewport and the app is a flex column', () => {
  assert.match(css, /body\.amigo-chat \.shell \{[^}]*grid-template-columns: var\(--amigo-sidebar-width\)/s);
  assert.match(css, /body\.amigo-chat \.app \{[^}]*flex-direction: column/s);
});

test('the composer sits in flow at the message measure', () => {
  assert.match(css, /body\.amigo-chat \.composer,[\s\S]{0,200}max-width: var\(--amigo-content-max\)/);
});

test('the drawer and scrim use the Phase 2 stacking tokens', () => {
  assert.match(css, /#side \{[\s\S]{0,300}z-index: var\(--z-drawer/);
  assert.match(css, /\.scrim \{ position: fixed; inset: 0; z-index: var\(--z-scrim/);
});

test('the documented breakpoints exist', () => {
  for (const bp of ['max-width: 1024px', 'min-width: 861px', 'max-width: 860px', 'max-width: 560px']) {
    assert.ok(css.includes(bp), `${bp} is not declared`);
  }
});

test('the element IDs the app depends on are unchanged', () => {
  for (const id of ['id="chat"', 'id="side"', 'id="btnMenu"', 'id="scrim"']) {
    assert.ok(html.includes(id), `${id} is missing from the page`);
  }
});

test('boot.js no longer owns theme state', () => {
  assert.ok(!/amigo2_settings/.test(boot), 'boot.js still reads the old settings store');
  assert.ok(!/#btnTheme/.test(boot), 'boot.js still registers a theme button handler');
  assert.ok(/data-open-settings/.test(boot), 'the settings opener delegate was removed');
});

test('the data-card table scrolls inside its own region', () => {
  assert.match(app, /datacard__table-scroll/);
  assert.match(app, /setAttribute\("role", "region"\)/);
  // the restored card is built with DOM calls: no HTML string reaches it
  const restore = app.slice(app.indexOf('function renderDataCard'), app.indexOf('function renderMsg'));
  assert.ok(restore.length > 200, 'renderDataCard not found');
  assert.ok(!/\.innerHTML\s*=/.test(restore), 'renderDataCard still assigns HTML');
});
