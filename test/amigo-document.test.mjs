/* Phase 1A — the Amigo document shell.
 *
 * The page used to close <head> twice and never open <body>, so the browser
 * rebuilt the tree by error recovery. These assertions check the declared
 * structure, not a tag count: jsdom parses the file the way a browser does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../amigo/index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html);
const { document } = dom.window;

test('the document has exactly one head and one body', () => {
  assert.equal(document.querySelectorAll('head').length, 1);
  assert.equal(document.querySelectorAll('body').length, 1);
});

test('the body carries the page class the theme controller looks for', () => {
  assert.ok(document.body.classList.contains('amigo-chat'));
});

test('there is exactly one chat landmark and the skip link reaches it', () => {
  assert.equal(document.querySelectorAll('#chat').length, 1);
  const skip = document.querySelector('a.skip-link');
  assert.ok(skip, 'no skip link');
  assert.equal(skip.getAttribute('href'), '#chat');
  assert.ok(document.querySelector('#chat'), 'the skip target does not exist');
});

test('the existing theme button is marked for the shared controller', () => {
  const button = document.querySelector('#btnTheme');
  assert.ok(button, 'no #btnTheme');
  assert.ok(button.hasAttribute('data-theme-toggle'));
  assert.equal(button.getAttribute('type'), 'button');
  assert.ok(button.getAttribute('aria-label'));
});

test('the shell content lives inside body, not beside it', () => {
  assert.ok(document.body.querySelector('.shell'), '.shell is outside body');
  assert.ok(document.body.querySelector('main#chat'));
});
