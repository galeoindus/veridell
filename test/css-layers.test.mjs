/* Phase 2 — the cascade contract.
 *
 * Layering only the bundle would reverse the intended order, because normal
 * unlayered rules outrank normal layered ones. So the prelude has to be in the
 * page stylesheet and in every generated bundle, and every local rule has to sit
 * inside a named layer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const PRELUDE = '@layer reset, tokens, base, components, layout, pages, responsive, utilities, overrides;';

test('the page stylesheet opens with the shared layer prelude', () => {
  const css = read('amigo/app.css');
  assert.ok(css.includes(PRELUDE), 'prelude missing from amigo/app.css');
});

test('the page stylesheet has no unlayered local rules', () => {
  const css = read('amigo/app.css').replace(PRELUDE, '');
  // Walk the file with a depth counter: at depth 0 only comments and @layer
  // statements are allowed, so anything else is a rule that escaped a layer.
  let depth = 0;
  let statement = '';
  const outside = [];
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (ch === '{') {
      const head = statement.trim();
      if (depth === 0 && !/^@layer\b/.test(head)) outside.push(head.slice(0, 60));
      statement = '';
      depth += 1;
      continue;
    }
    if (ch === '}') { depth -= 1; statement = ''; continue; }
    if (depth === 0) statement += ch;
  }
  assert.deepEqual(outside, [], 'rules outside any layer');
  assert.equal(depth, 0, 'unbalanced braces');
});

test('every generated bundle carries the same prelude and named layers', () => {
  const dir = new URL('assets/css/', ROOT);
  const bundles = readdirSync(dir).filter((f) => f.startsWith('bundle-') && f.endsWith('.css'));
  assert.ok(bundles.length > 0, 'no bundles generated');
  for (const name of bundles) {
    const css = read(`assets/css/${name}`);
    assert.ok(css.includes(PRELUDE), `${name} is missing the prelude`);
    assert.match(css, /@layer (base|components|layout|pages|responsive|utilities) \{/, `${name} has no layered sheets`);
  }
});

test('the z-index scale is declared once as tokens', () => {
  const css = read('assets/css/design-system.css');
  for (const token of ['--z-scrim', '--z-drawer', '--z-modal', '--z-popover', '--z-bottom-nav', '--z-skip-link']) {
    assert.ok(css.includes(token), `${token} is not declared`);
  }
});

test('mobile bottom space follows the structure, not every route', () => {
  const css = read('assets/css/mobile.css');
  assert.ok(css.includes('body.has-bottom-nav'), 'the reserved space is not scoped');
  assert.ok(css.includes('body.amigo-chat { padding-bottom: 0; }'), 'the chat page still pays the reserve');
});
