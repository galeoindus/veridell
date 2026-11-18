/* Phase 4 — accessibility contract for the chat page.
 *
 * These are source assertions on the parsed document and the app code. They do
 * not replace a screen-reader pass, but they stop the regressions that are
 * cheapest to introduce: a missing label, a nameless icon button, a message log
 * that replaced the main landmark, or a status region that went missing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../amigo/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../amigo/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../amigo/app.css', import.meta.url), 'utf8');
const { document } = new JSDOM(html).window;

test('the main landmark stays a main landmark', () => {
  const main = document.querySelector('main#chat');
  assert.ok(main, 'no main#chat');
  assert.notEqual(main.getAttribute('role'), 'log', 'the main landmark was turned into a log');
  assert.ok(main.getAttribute('aria-label'), 'the main landmark has no name');
});

test('messages live in a log and status lives somewhere else', () => {
  const log = document.querySelector('#chatMessages');
  assert.ok(log, 'no message log');
  assert.equal(log.getAttribute('role'), 'log');
  assert.equal(log.getAttribute('aria-live'), 'off', 'streaming would be announced token by token');
  const status = document.querySelector('#chatStatus');
  assert.ok(status, 'no status region');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
});

test('the composer has a label and a description', () => {
  const input = document.querySelector('#input');
  assert.ok(input, 'no composer');
  const label = document.querySelector(`label[for="input"]`);
  assert.ok(label, 'the composer has no label element');
  assert.ok(label.textContent.trim().length > 0, 'the label is empty');
  assert.equal(input.getAttribute('aria-describedby'), 'inputHelp');
  assert.ok(document.querySelector('#inputHelp'), 'the described-by target is missing');
});

test('every icon-only control has an accessible name', () => {
  const ids = ['btnMenu', 'btnNew', 'btnDel', 'btnTheme', 'send'];
  for (const id of ids) {
    const el = document.getElementById(id);
    assert.ok(el, `#${id} is missing`);
    const name = el.getAttribute('aria-label') || el.getAttribute('title');
    assert.ok(name && name.trim(), `#${id} has no accessible name`);
  }
});

test('the drawer trigger reports its state', () => {
  const menu = document.getElementById('btnMenu');
  assert.equal(menu.getAttribute('aria-controls'), 'side');
  assert.ok(menu.hasAttribute('aria-expanded'), 'aria-expanded is missing');
});

test('the app writes into the log and announces transitions', () => {
  assert.match(app, /chatMessages/);
  assert.match(app, /function announce\(/);
  assert.match(app, /role="status"|#chatStatus/);
});

test('a visually hidden utility exists for the status and labels', () => {
  assert.match(css, /\.sr-only/);
  assert.match(css, /clip-path: inset\(50%\)/);
});
