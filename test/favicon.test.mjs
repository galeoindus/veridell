/* The favicon is read at 16px, so it is judged as a silhouette, not a drawing.
 *
 * The old icon reused the detailed brand mark: thin overlapping curves in pale
 * gold, blush and green on a light centre. At search-result size the linework
 * merged into the background and the icon read as a smudge. This test guards the
 * replacement: a separate micro-mark, declared identically on every page, with
 * every referenced file actually present.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const pages = [];
const walk = (dir, prefix = '') => {
  for (const entry of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    if (['node_modules', '.git', 'docs', 'assets', 'functions', 'scripts', 'test'].includes(entry.name)) continue;
    const next = `${dir}${entry.name}`;
    if (entry.isDirectory()) walk(`${next}/`, `${prefix}${entry.name}/`);
    else if (entry.name.endsWith('.html')) pages.push(next);
  }
};
walk('');

test('the micro-mark exists at every declared size', () => {
  for (const size of [48, 96, 192]) {
    const file = `assets/img/brand/favicon-mark-${size}.png`;
    assert.ok(existsSync(new URL(file, ROOT)), `${file} is missing`);
    assert.ok(readFileSync(new URL(file, ROOT)).length > 500, `${file} looks empty`);
  }
  assert.ok(existsSync(new URL('assets/img/brand/favicon-mark.svg', ROOT)));
  assert.ok(existsSync(new URL('favicon.ico', ROOT)));
});

test('the micro-mark is a separate asset, not the detailed logo', () => {
  const svg = read('assets/img/brand/favicon-mark.svg');
  assert.match(svg, /viewBox="0 0 64 64"/, 'the vector source is not square');
  // one ground, one bold stroke path, one accent dot: no thin linework
  assert.ok((svg.match(/<path/g) || []).length <= 2, 'the mark carries too many paths to read at 16px');
  assert.match(svg, /stroke-width="10"/, 'the stroke is too thin for a favicon');
});

test('every page declares the same favicon set', () => {
  assert.ok(pages.length > 10, 'no pages found');
  for (const page of pages) {
    const html = read(page);
    for (const size of [48, 96, 192]) {
      assert.ok(html.includes(`favicon-mark-${size}.png`), `${page} does not declare the ${size}px favicon`);
    }
    assert.ok(!/rel="icon"[^>]*favicon\.ico/.test(html), `${page} still links the .ico, which competes with the PNGs`);
  }
});

test('every favicon href resolves to a real file', () => {
  for (const page of pages) {
    const html = read(page);
    for (const m of html.matchAll(/rel="(?:icon|apple-touch-icon)"[^>]*href="(\/[^"]+)"/g)) {
      const target = m[1].replace(/^\//, '').split('?')[0];
      assert.ok(existsSync(new URL(target, ROOT)), `${page} points at ${m[1]}, which does not exist`);
    }
  }
});

test('the generator emits the same set, not the retired names', () => {
  const gen = read('scripts/gen_articles.py');
  for (const dead of ['facet.svg', 'facet-48.png', 'facet-192.png', 'facet-180.png']) {
    assert.ok(!gen.includes(dead), `the generator still references ${dead}`);
  }
  assert.match(gen, /favicon-mark-48\.png/);
});
