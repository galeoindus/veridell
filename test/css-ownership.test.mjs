/* One component, one owner.
 *
 * The search card was styled from nine source sheets — 63 declarations in
 * app.css, 21 in system.css, 20 in styles.css, 13 in mobile.css and four more.
 * That is why the same card looked different on different pages: nothing owned
 * it, so the last stylesheet to load won.
 *
 * This test does not pretend the cleanup is finished. It records the sheets that
 * still carry rules for the card and fails when a tenth appears, so the mess
 * cannot grow while it is being unwound.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../assets/css/', import.meta.url);

// Sheets still carrying search-card rules, in the order they are bundled.
// Removing a sheet from this list is progress; adding one is a regression.
const KNOWN_OWNERS = new Set([
  'app.css', 'system.css', 'styles.css', 'mobile.css',
  'polish.css', 'refine.css', 'design-system.css', 'preferences.css', 'home-morph.css',
]);

const sheets = readdirSync(DIR).filter((f) => f.endsWith('.css') && !f.startsWith('bundle-'));

function mentions(file, selector) {
  const css = readFileSync(new URL(file, DIR), 'utf8');
  return new RegExp(`\\${selector}\\b`).test(css);
}

test('the search card does not gain a tenth owner', () => {
  const owners = sheets.filter((f) => mentions(f, '.searchbar'));
  const extra = owners.filter((f) => !KNOWN_OWNERS.has(f));
  assert.deepEqual(extra, [], `new stylesheet(s) styling .searchbar: ${extra.join(', ')}`);
});

test('the recorded owner list does not describe files that no longer exist', () => {
  const owners = new Set(sheets.filter((f) => mentions(f, '.searchbar')));
  for (const known of KNOWN_OWNERS) {
    if (!sheets.includes(known)) continue;   // the sheet was deleted: fine
    assert.ok(owners.has(known), `${known} no longer styles the card — remove it from KNOWN_OWNERS`);
  }
});

test('the page stylesheet keeps the authoritative card rules', () => {
  const css = readFileSync(new URL('app.css', DIR), 'utf8');
  assert.match(css, /AI-mode shape|\.searchbar \{[\s\S]{0,400}border-radius: 26px/);
});
