/* One component, one owner.
 *
 * The search card used to be declared from nine source stylesheets — 92 rules
 * between them — so whichever loaded last won and the card changed shape by
 * page. This test asserts the opposite now: exactly one source sheet may declare
 * the card's rules. A second owner fails the build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../assets/css/', import.meta.url);
const OWNER = 'mobile.css';

const sheets = readdirSync(DIR).filter((f) => f.endsWith('.css') && !f.startsWith('bundle-'));

function declaresCard(file) {
  const css = readFileSync(new URL(file, DIR), 'utf8');
  return /\.searchbar\b/.test(css);
}

test('exactly one stylesheet declares the search card', () => {
  const owners = sheets.filter(declaresCard);
  assert.deepEqual(owners, [OWNER], `the card must be owned by ${OWNER} alone, found: ${owners.join(', ')}`);
});

test('the owner still carries the unified card rules', () => {
  const css = readFileSync(new URL(OWNER, DIR), 'utf8');
  assert.match(css, /THE search card/, 'the canonical block is missing');
  assert.match(css, /\.searchbar[\s\S]{0,400}border-radius: 28px/);
});

test('no sheet styles the card through a pseudo-element', () => {
  for (const sheet of sheets) {
    const css = readFileSync(new URL(sheet, DIR), 'utf8');
    assert.ok(!/\.dash-hero::before\s*\{[^}]*box-shadow[^}]*#000/.test(css),
      `${sheet} still draws the dark ornament behind the search panel`);
  }
});
