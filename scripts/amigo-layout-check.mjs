#!/usr/bin/env node
/* Phase 3 — real viewport verification for the chat layout.
 *
 * Measures the rendered page at the device matrix in the report and fails on
 * the faults that matter: horizontal page overflow, a composer that is not
 * visible, a stream that cannot scroll, and a drawer wider than the viewport.
 *
 *   node scripts/amigo-layout-check.mjs [base-url]
 */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const PORT = 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { name: '320x700 narrow phone', width: 320, height: 700 },
  { name: '360x800 small android', width: 360, height: 800 },
  { name: '390x844 common phone', width: 390, height: 844 },
  { name: '768x1024 tablet portrait', width: 768, height: 1024 },
  { name: '1024x768 breakpoint edge', width: 1024, height: 768 },
  { name: '1280x800 desktop', width: 1280, height: 800 },
];

// CI installs Chromium through Playwright, which does not put a `chromium` on
// PATH. Honour CHROME_BIN so the gate runs the browser it actually installed.
const BROWSER = process.env.CHROME_BIN || 'chromium';
const chrome = spawn(BROWSER, ['--headless=new', '--no-sandbox', '--disable-gpu',
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
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  waiting.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && waiting.has(msg.id)) {
    const { res, rej } = waiting.get(msg.id);
    waiting.delete(msg.id);
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

let failures = 0;
for (const vp of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.width < 700,
  });
  await send('Page.navigate', { url: `${BASE}/amigo/` });
  await sleep(2200);

  const m = await evaluate(`(() => {
    const de = document.documentElement;
    const chat = document.querySelector('#chat');
    const composer = document.querySelector('.composer');
    const side = document.querySelector('#side');
    const r = (n) => n ? n.getBoundingClientRect() : null;
    const c = r(composer), s = r(side), ch = r(chat);
    return {
      overflow: de.scrollWidth - de.clientWidth,
      composerVisible: !!c && c.bottom <= window.innerHeight + 1 && c.top >= 0,
      chatScrolls: !!chat && getComputedStyle(chat).overflowY === 'auto',
      chatHasHeight: !!ch && ch.height > 100,
      drawerWithinViewport: !s || s.width <= window.innerWidth,
      bodyPad: getComputedStyle(document.body).paddingBottom,
    };
  })()`);

  const problems = [];
  if (m.overflow > 1) problems.push(`horizontal overflow ${m.overflow}px`);
  if (!m.composerVisible) problems.push('composer not visible');
  if (!m.chatScrolls) problems.push('stream does not scroll');
  if (!m.chatHasHeight) problems.push('stream has no height');
  if (!m.drawerWithinViewport) problems.push('drawer wider than viewport');
  if (m.bodyPad !== '0px') problems.push(`body padding ${m.bodyPad}`);

  if (problems.length) failures += 1;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${vp.name.padEnd(26)} ${problems.join(', ') || 'no problems'}`);
}

ws.close();
chrome.kill();
console.log(failures ? `\n${failures} viewport(s) failed` : '\nall viewports passed');
process.exit(failures ? 1 : 0);
