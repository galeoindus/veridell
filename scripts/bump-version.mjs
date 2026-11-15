#!/usr/bin/env node
/**
 * Veridell — bump the version in every place that carries it, at once.
 *
 * The CI failure this exists to prevent: `package.json` said 6.6.0 and
 * `package-lock.json` still said 6.5.1, because a release edited one file by
 * hand. The `version` workflow checks that they agree, so every release since
 * the lockfile drifted failed its own verification.
 *
 *   node scripts/bump-version.mjs 6.7.0
 *   node scripts/bump-version.mjs minor
 *
 * It writes package.json and package-lock.json together and then runs the
 * stamp, so the pages, config.js and version.json move in the same step. If
 * anything disagrees afterwards it exits non-zero.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(ROOT, 'package.json');
const lockPath = join(ROOT, 'package-lock.json');

const SEMVER = /^\d+\.\d+\.\d+$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const arg = String(process.argv[2] || '').trim();
const pkg = readJson(pkgPath);
const current = String(pkg.version || '');

function nextVersion(from, how) {
  const [major, minor, patch] = from.split('.').map(Number);
  if (how === 'major') return `${major + 1}.0.0`;
  if (how === 'minor') return `${major}.${minor + 1}.0`;
  if (how === 'patch') return `${major}.${minor}.${patch + 1}`;
  return how;
}

const target = nextVersion(current, arg);
if (!SEMVER.test(target)) {
  console.error(`Not a version: "${arg}". Use 1.2.3, major, minor or patch.`);
  process.exit(2);
}
if (target === current) {
  console.log(`Already on ${current}; nothing to bump.`);
  process.exit(0);
}

// ── package.json ──────────────────────────────────────────────────────────
pkg.version = target;
writeJson(pkgPath, pkg);

// ── package-lock.json: both the root version and the root package entry ───
const lock = readJson(lockPath);
lock.version = target;
if (lock.packages && lock.packages['']) lock.packages[''].version = target;
writeJson(lockPath, lock);

// ── everything else: pages, config.js, version.json, sitemap ──────────────
execFileSync(process.execPath, [join(ROOT, 'scripts', 'stamp-build.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});

// ── prove it, rather than assume it ───────────────────────────────────────
const after = readJson(pkgPath);
const lockAfter = readJson(lockPath);
const stamp = readJson(join(ROOT, 'assets/version.json'));
const config = readFileSync(join(ROOT, 'assets/js/config.js'), 'utf8');
const problems = [];
if (after.version !== target) problems.push(`package.json is ${after.version}`);
if (lockAfter.version !== target) problems.push(`package-lock.json is ${lockAfter.version}`);
if (lockAfter.packages?.['']?.version !== target) problems.push('package-lock.json root package entry is stale');
if (stamp.version !== target) problems.push(`assets/version.json is ${stamp.version}`);
if (!config.includes(`version: '${target}'`)) problems.push('assets/js/config.js is stale');

if (problems.length) {
  console.error(`Version bump to ${target} did not settle:`);
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`Version ${current} → ${target}, everywhere.`);
