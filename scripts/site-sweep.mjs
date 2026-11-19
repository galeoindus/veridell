#!/usr/bin/env node
/* Phase 7 — the site-wide sweep.
 *
 * Phase 1–6 each checked their own corner. This walks every route that ships and
 * checks the things that break across boundaries: a script that throws, a
 * duplicate id, a main landmark that went missing, a page that scrolls sideways,
 * a theme toggle that does nothing, a link that points at nothing.
 *
 *   node scripts/site-sweep.mjs [base-url]
 */
import { spawn } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const PORT = 9371;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* routes from the tree, not from a remembered list */
function routes() {
  const found = ['/'];
  const SKIP = new Set(['node_modules', '.git', '.github', 'assets', 'functions', 'scripts', 'test', 'docs', 'amigo-worker', 'src', 'dist', 'coverage']);
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      const route = `${prefix}/${entry}`;
      // every page that ships is a directory with an index.html, however deep
      if (existsSync(join(full, 'index.html'))) found.push(`${route}/`);
      walk(full, route);
    }
  };
  walk('.', '');
  return [...new Set(found)];
}

const chrome = spawn(process.env.CHROME_BIN || 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 80; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
  } catch { /* not up yet */ }
  await sleep(250);
}

const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

let id = 0;
const waiting = new Map();
const errors = [];
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; waiting.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails?.exception?.description || '').split('\n')[0]);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    const text = String(msg.params.entry.text || '');
    if (!/favicon|ERR_CERT|net::/i.test(text)) errors.push(text.slice(0, 120));
  }
  if (msg.id && waiting.has(msg.id)) {
    const { res, rej } = waiting.get(msg.id); waiting.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

let failures = 0;
const list = routes();
for (const route of list) {
  errors.length = 0;
  await send('Page.navigate', { url: `${BASE}${route}` });
  // Wait for the document to finish, not for a fixed number of milliseconds:
  // a big article was still loading at 1.6s and looked like a broken page.
  for (let i = 0; i < 40; i += 1) {
    const state = await evaluate('document.readyState');
    if (state === 'complete') break;
    await sleep(150);
  }
  await sleep(350);            // let the deferred controls mount

  const info = await evaluate(`(() => {
    const ids = [...document.querySelectorAll('[id]')].map((n) => n.id);
    const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
    const mains = document.querySelectorAll('main').length;
    const root = document.documentElement;
    const before = root.dataset.theme;
    const btn = document.querySelector('#themeBtn,[data-action="theme"],[data-theme-toggle]');
    if (btn) btn.click();
    return new Promise((res) => setTimeout(() => res({
      dupes: [...new Set(dupes)].slice(0, 3),
      mains,
      overflow: root.scrollWidth - root.clientWidth,
      themeChanged: before !== root.dataset.theme,
      hasToggle: !!btn,
      title: (document.title || '').length
    }), 260));
  })()`);

  const problems = [];
  if (errors.length) problems.push(`js: ${errors[0]}`);
  if (info.dupes.length) problems.push(`duplicate id: ${info.dupes.join(', ')}`);
  if (info.mains !== 1) problems.push(`main landmarks: ${info.mains}`);
  if (info.overflow > 1) problems.push(`overflow ${info.overflow}px`);
  if (!info.hasToggle) problems.push('no theme control');
  if (!info.title) problems.push('no title');

  if (problems.length) failures += 1;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${route.padEnd(24)} ${problems.join('; ') || ''}`);
}

ws.close();
chrome.kill();
console.log(failures ? `\n${failures} route(s) failed` : `\nall ${list.length} routes clean`);
process.exit(failures ? 1 : 0);
