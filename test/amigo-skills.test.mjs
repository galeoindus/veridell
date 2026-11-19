/* Phase 6 — the prompt corpus loads on demand.
 *
 * The catalogue in app.js is a manifest; the prompt text is a separate asset per
 * skill, fetched the first time that skill is used. This test protects the two
 * things that would quietly undo the win: putting the text back into app.js, and
 * losing the loader that fetches it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const app = readFileSync(new URL('../amigo/app.js', import.meta.url), 'utf8');
const headers = readFileSync(new URL('../_headers', import.meta.url), 'utf8');

const start = app.indexOf('const SKILLS = {');
let depth = 0;
let end = start;
for (let i = app.indexOf('{', start); i < app.length; i += 1) {
  if (app[i] === '{') depth += 1;
  if (app[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
}
const manifest = JSON.parse(app.slice(app.indexOf('{', start), end));
const ids = Object.keys(manifest);

test('the catalogue carries no prompt text', () => {
  assert.ok(ids.length > 10, 'the manifest looks empty');
  for (const id of ids) {
    assert.equal(manifest[id].sys, undefined, `${id} still carries its prompt in app.js`);
  }
});

test('the application no longer holds the whole corpus', () => {
  // 75% of the old file was prompt text; anything near that is a regression
  assert.ok(app.length < 250000, `app.js is ${app.length} bytes, the corpus is back`);
});

test('every skill has its own prompt asset', () => {
  const dir = new URL('../assets/amigo/skills/', import.meta.url);
  const files = new Set(readdirSync(dir));
  for (const id of ids) {
    assert.ok(files.has(`${id}.json`), `no prompt asset for ${id}`);
  }
});

test('the loader fetches on demand and caches', () => {
  assert.match(app, /async function loadSkillPrompt\(/);
  assert.match(app, /SKILL_PROMPT_CACHE/);
  assert.match(app, /fetch\("\/assets\/amigo\/skills\//);
  assert.match(app, /await buildSystemPrompt\(\)/);
});

test('the prompt assets are cacheable', () => {
  assert.match(headers, /\/assets\/amigo\/skills\/\*/);
  assert.match(headers, /max-age=86400/);
});
