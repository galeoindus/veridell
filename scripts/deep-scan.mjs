#!/usr/bin/env node
/* A deeper pass than the existing audits.
 *
 * deep-audit.mjs answers "is every file internally consistent" and health-check
 * answers "does every page have its metadata". Neither looks inside the code for
 * the mistakes that actually bite: a swallowed error, an `==` that compares the
 * wrong thing, an unawaited promise, a dead file, a button that submits a form
 * by accident, an aria attribute pointing at an id that does not exist.
 *
 *   node scripts/deep-scan.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', '.wrangler', 'dist', 'coverage', 'amigo-worker']);
const problems = [];
const notes = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const read = (p) => readFileSync(p, 'utf8');
const isTooling = (name) => name.startsWith('scripts/') || name.startsWith('test/');

const html = files.filter((f) => extname(f) === '.html');
const css = files.filter((f) => extname(f) === '.css' && !rel(f).includes('bundle-'));
const js = files.filter((f) => ['.js', '.mjs'].includes(extname(f)));

/* ── JavaScript ─────────────────────────────────────────────────────────── */
for (const file of js) {
  const name = rel(file);
  if (isTooling(name) || name.startsWith('assets/js/vendor')) continue;
  const source = read(file);
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    const at = `${name}:${index + 1}`;

    // a swallowed error is a bug you cannot see later
    if (/\}\s*catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(line)) {
      problems.push(`${at} empty catch swallows the error`);
    }

    if (/[^=!<>]==[^=]/.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
      const m = line.match(/(\S+)\s*==\s*(\S+)/);
      if (m && !/null|undefined/.test(m[2])) notes.push(`${at} loose equality: ${m[1].trim()} == ${m[2].trim()}`);
    }

    if (/\beval\s*\(/.test(line)) problems.push(`${at} eval()`);
    if (/\bdocument\.write\s*\(/.test(line)) problems.push(`${at} document.write()`);
    if (/\bvar\s+\w/.test(line) && !/^\s*(\/\/|\*)/.test(line)) notes.push(`${at} var instead of let/const`);

    // an async call whose result is used without await, .then or .catch
    if (/(?<!await\s)(?<!return\s)\b(idbPut|idbGet|loadSkillPrompt|historyRefresh|streamAmigoAI)\s*\(/.test(line)
        && !/\.then\(|\.catch\(|await |async |function /.test(line)) {
      problems.push(`${at} async call without await or .then`);
    }
  });

  if (/innerHTML\s*=\s*[^'"`]/.test(source) && !/innerHTML\s*=\s*["'`]/.test(source)) {
    notes.push(`${name} assigns a non-literal to innerHTML — check the value is escaped`);
  }
}

/* ── CSS ────────────────────────────────────────────────────────────────── */
for (const file of css) {
  const name = rel(file);
  const source = read(file);
  const decls = [...source.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]);
  const seen = new Map();
  for (const [prop, value] of decls) {
    const key = `${prop}:${value}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 3 && !/^transition|^animation|^background/.test(key)) {
      notes.push(`${name} repeats \`${key}\` ${count} times`);
    }
  }
  const hardcoded = (source.match(/#[0-9a-fA-F]{6}\b/g) || []).length;
  if (hardcoded > 40) notes.push(`${name} uses ${hardcoded} hard-coded hex colours`);
  if (/position:\s*fixed/.test(source) && !/z-index/.test(source)) {
    notes.push(`${name} has a fixed element with no z-index`);
  }
}

/* ── HTML ───────────────────────────────────────────────────────────────── */
for (const file of html) {
  const name = rel(file);
  const source = read(file);

  for (const m of source.matchAll(/<button\b([^>]*)>/g)) {
    if (!/type=/.test(m[1])) problems.push(`${name} <button> without type (defaults to submit)`);
  }

  for (const m of source.matchAll(/href="(#[^"]*)"/g)) {
    if (m[1] === '#') problems.push(`${name} has href="#" which jumps to the top`);
  }

  for (const m of source.matchAll(/aria-(labelledby|describedby|controls)="([^"]+)"/g)) {
    for (const id of m[2].split(/\s+/)) {
      if (id && !source.includes(`id="${id}"`)) {
        problems.push(`${name} aria-${m[1]} points at #${id}, which does not exist`);
      }
    }
  }

  for (const m of source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    if (/<(div|section|ul|ol|table|h[1-6]|p)\b/i.test(m[1])) {
      problems.push(`${name} has block content inside <p>`);
      break;
    }
  }

  for (const m of source.matchAll(/<a\b([^>]*)target="_blank"([^>]*)>/g)) {
    if (!/rel="[^"]*noopener/.test(m[1] + m[2])) problems.push(`${name} target=_blank without rel=noopener`);
  }
}

/* ── dead files: nothing references them ───────────────────────────────── */
const referenced = new Set();
for (const file of [...html, ...js, ...css]) {
  const source = read(file);
  for (const m of source.matchAll(/["'(](\/?(?:assets|amigo)\/[A-Za-z0-9._\/-]+\.(?:js|css|png|webp|svg|json))["')]/g)) {
    referenced.add(m[1].replace(/^\//, ''));
  }
}
for (const file of files) {
  const name = rel(file);
  if (!/^(assets|amigo)\//.test(name)) continue;
  if (!/\.(js|css|png|webp|svg|json|ico)$/.test(name)) continue;
  if (name.includes('/vendor/')) continue;
  if (name.startsWith('assets/css/bundle-')) continue;
  const base = name.split('/').pop();
  if (referenced.has(name) || referenced.has(`assets/${name}`)) continue;
  if ([...referenced].some((r) => r.endsWith(base))) continue;
  notes.push(`${name} is not referenced by any page, script or stylesheet`);
}

/* ── report ─────────────────────────────────────────────────────────────── */
console.log(`deep scan — ${html.length} HTML, ${js.length} JS, ${css.length} CSS, ${files.length} files`);
const uniqueNotes = [...new Set(notes)];
for (const note of uniqueNotes.slice(0, 14)) console.log(`  note · ${note}`);
if (uniqueNotes.length > 14) console.log(`  note · …and ${uniqueNotes.length - 14} more`);
for (const problem of [...new Set(problems)]) console.log(`  FAIL · ${problem}`);
console.log(problems.length ? `\n${new Set(problems).size} problem(s)` : '\nno problems found');
process.exit(problems.length ? 1 : 0);
