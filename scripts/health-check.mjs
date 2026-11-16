#!/usr/bin/env node
/* A whole-repository health check.
 *
 * The existing scripts answer narrow questions (does every import resolve, is
 * the version consistent). This one looks at the things a reader would notice
 * and a scripted audit usually misses: duplicate ids, images without alt text,
 * heading order, anchor links that point at nothing, meta text that is too long
 * or missing, unbalanced CSS, leftover debug and dead references.
 *
 *   node scripts/health-check.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', '.wrangler', 'amigo-worker']);
const problems = [];
const notes = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const read = (p) => readFileSync(p, 'utf8');

const html = files.filter((f) => extname(f) === '.html');
const css = files.filter((f) => extname(f) === '.css' && !rel(f).includes('/bundle-'));
const js = files.filter((f) => ['.js', '.mjs'].includes(extname(f)) && !rel(f).startsWith('assets/js/vendor'));

/* ── HTML ────────────────────────────────────────────────────────────────── */
for (const file of html) {
  const name = rel(file);
  const source = read(file);

  const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) problems.push(`${name}: duplicate id(s) ${[...new Set(dupes)].join(', ')}`);

  for (const tag of source.match(/<img\b[^>]*>/g) || []) {
    if (!/\salt=/.test(tag)) problems.push(`${name}: <img> without alt — ${tag.slice(0, 70)}`);
  }

  const headings = [...source.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  let last = 0;
  for (const level of headings) {
    if (last && level > last + 1) {
      problems.push(`${name}: heading jumps from h${last} to h${level}`);
      break;
    }
    last = level;
  }

  // anchors that point at an id on the same page, but the id is missing
  for (const m of source.matchAll(/href="#([A-Za-z][\w-]*)"/g)) {
    const id = m[1];
    if (!ids.includes(id) && !source.includes(`id="${id}"`)) {
      problems.push(`${name}: link to #${id}, which does not exist on the page`);
    }
  }

  if (name !== '404.html') {
    if (!/<title>[^<]{10,70}<\/title>/.test(source)) {
      problems.push(`${name}: title missing or not between 10 and 70 characters`);
    }
    // attributes appear in either order, and this tree uses both quote styles
    const desc = source.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/)
      || source.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/);
    if (!desc) problems.push(`${name}: no meta description`);
    else if (desc[1].length < 50 || desc[1].length > 165) {
      notes.push(`${name}: meta description is ${desc[1].length} characters (aim 50–160)`);
    }
    if (!/rel="canonical"/.test(source)) problems.push(`${name}: no canonical`);
    if (!/property="og:image"/.test(source)) problems.push(`${name}: no og:image`);
    if (!/name="twitter:image"/.test(source)) problems.push(`${name}: no twitter:image`);
  }

  if (/<html[^>]*lang=""/.test(source)) problems.push(`${name}: empty lang attribute`);
  if (!/<html[^>]*lang="[a-z-]+"/i.test(source)) problems.push(`${name}: <html> has no lang`);

  // every local src/href must exist on disk
  for (const m of source.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) {
    const path = m[1];
    if (path.startsWith('//')) continue;
    const target = join(ROOT, path);
    if (existsSync(target)) continue;
    if (path.endsWith('/') && existsSync(join(ROOT, path, 'index.html'))) continue;
    if (existsSync(`${target}.html`)) continue;
    problems.push(`${name}: points at ${path}, which does not exist`);
  }
}

/* ── CSS ─────────────────────────────────────────────────────────────────── */
for (const file of css) {
  const name = rel(file);
  const source = read(file);
  const open = (source.match(/{/g) || []).length;
  const close = (source.match(/}/g) || []).length;
  if (open !== close) problems.push(`${name}: ${open} { but ${close} }`);
  if (/!\s*important/.test(source)) {
    const count = (source.match(/!\s*important/g) || []).length;
    notes.push(`${name}: ${count} !important declaration(s)`);
  }
}

/* ── JS ──────────────────────────────────────────────────────────────────── */
for (const file of js) {
  const name = rel(file);
  const source = read(file);
  const tooling = name.startsWith('scripts/') || name.startsWith('test/');
  const codeLines = source.split('\n').filter((line) => line.length < 2000);
  if (codeLines.some((line) => /console\.log\(/.test(line)) && !tooling) {
    problems.push(`${name}: console.log left in shipped code`);
  }
  if (/^\s*debugger\s*;?\s*$/m.test(source)) problems.push(`${name}: debugger statement`);
  for (const m of source.matchAll(/from '(\.[^']+)'/g)) {
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target)) problems.push(`${name}: imports ${m[1]}, which does not exist`);
  }
}

/* ── repository shape ───────────────────────────────────────────────────── */
for (const required of ['index.html', '404.html', 'robots.txt', 'sitemap.xml', '_headers', '_redirects', 'manifest.webmanifest']) {
  if (!existsSync(join(ROOT, required))) problems.push(`missing ${required} at the root`);
}
const stray = files.filter((f) => /\.(bak|orig|rej|tmp|swp)$/.test(f));
if (stray.length) problems.push(`stray files: ${stray.map(rel).join(', ')}`);

/* ── report ──────────────────────────────────────────────────────────────── */
console.log(`health check — ${html.length} HTML, ${css.length} CSS, ${js.length} JS, ${files.length} files`);
for (const note of notes.slice(0, 12)) console.log(`  note · ${note}`);
if (!problems.length) {
  console.log('no problems found');
} else {
  for (const problem of problems) console.log(`  FAIL · ${problem}`);
  console.log(`\n${problems.length} problem(s)`);
}
process.exit(problems.length ? 1 : 0);
