/* Phase 6 — durable storage.
 *
 * Histories move to IndexedDB with a non-destructive migration from the old
 * localStorage records, and a storage failure is shown rather than swallowed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../amigo/app.js', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('histories are written to IndexedDB, not localStorage', () => {
  assert.match(app, /indexedDB\.open\(IDB_NAME/);
  assert.match(app, /async function idbPut\(/);
  assert.match(app, /idbPut\(hKey\(curSkill\), h\)/);
});

test('the migration is non-destructive', () => {
  assert.match(app, /async function migrateHistory\(/);
  // the local record is removed only after the database write succeeded
  const fn = app.slice(app.indexOf('async function migrateHistory'), app.indexOf('async function historyRefresh'));
  const putIndex = fn.indexOf('await idbPut');
  const removeIndex = fn.indexOf('localStorage.removeItem');
  assert.ok(putIndex > -1 && removeIndex > putIndex, 'the local copy is deleted before the write lands');
});

test('a storage failure is visible', () => {
  assert.match(app, /function storageProblem\(/);
  assert.match(app, /could not be saved on this device/);
  assert.match(app, /\.catch\(\(err\) =>/);
});

test('test:core cannot drift again', () => {
  const core = pkg.scripts['test:core'];
  assert.ok(core.includes('test/*.test.mjs'), 'the core command is a fixed list that will drift');
});
