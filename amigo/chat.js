/* Amigo — the chat client.
 *
 * One job: put a message on screen, stream the answer from this site's own
 * /api/chat, and keep the thread in the browser. No framework, no build step,
 * and no key anywhere near the page: the endpoint holds the binding.
 */

const API = {
  chat: '/api/chat',
  image: '/api/image',
};

const STORE = 'veridellindo:amigo:v1';
const THEME = 'veridellindo:theme';

const $ = (selector) => document.querySelector(selector);

/* ── state ─────────────────────────────────────────────────────────────── */
let messages = [];            // [{ role, content }]
let busy = false;
let controller = null;
let startedAt = 0;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (Array.isArray(saved.messages)) messages = saved.messages.slice(-40);
    if (saved.model) $('#model').value = saved.model;
  } catch { /* private browsing, or a corrupt entry */ }
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      messages: messages.slice(-40),
      model: $('#model').value,
    }));
  } catch { /* storage blocked: the thread still works for this visit */ }
}

/* ── markdown, safely ──────────────────────────────────────────────────────
 * The model writes markdown, so the page has to render it. Everything is
 * escaped first and only a fixed set of patterns is turned back into HTML, so
 * a model that emits a <script> gets text, not an execution. */
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
}

function markdown(source) {
  const lines = escapeHtml(source).split('\n');
  const out = [];
  let list = null;
  let code = false;
  let buffer = [];

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushCode = () => { out.push(`<pre><code>${buffer.join('\n')}</code></pre>`); buffer = []; };

  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      if (code) { flushCode(); code = false; } else { closeList(); code = true; }
      continue;
    }
    if (code) { buffer.push(raw); continue; }

    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      continue;
    }

    if (line.startsWith('&gt; ')) { closeList(); out.push(`<blockquote>${inline(line.slice(5))}</blockquote>`); continue; }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  if (code && buffer.length) flushCode();
  closeList();
  return out.join('');
}

/* ── rendering ─────────────────────────────────────────────────────────── */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderWelcome(show) {
  const welcome = $('#welcome');
  if (welcome) welcome.hidden = !show;
}

function renderThread() {
  const thread = $('#thread');
  [...thread.querySelectorAll('.msg')].forEach((n) => n.remove());
  renderWelcome(messages.length === 0);
  for (const message of messages) {
    if (message.role === 'user') thread.append(userBubble(message.content));
    else thread.append(botBubble(message.content));
  }
  scrollToEnd();
}

function userBubble(text) {
  const row = el('div', 'msg user');
  row.append(el('div', 'bubble', text));
  return row;
}

function botBubble(text) {
  const row = el('div', 'msg bot');
  const body = el('div', 'body');
  body.innerHTML = markdown(text);
  const meta = el('div', 'meta');
  meta.append(el('span', 'dot'), el('span', null, 'Amigo'));
  row.append(meta, body);
  row.append(actionsFor(text, row));
  return row;
}

function actionsFor(text, row) {
  const bar = el('div', 'actions');
  const copy = el('button', null, 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    } catch { copy.textContent = 'Press Ctrl+C'; }
  });
  const again = el('button', null, 'Regenerate');
  again.type = 'button';
  again.addEventListener('click', () => {
    const index = [...$('#thread').querySelectorAll('.msg.bot')].indexOf(row);
    if (index >= 0) regenerate(index);
  });
  bar.append(copy, again);
  return bar;
}

function scrollToEnd(force = true) {
  const wrap = $('.wrap');
  if (!wrap) return;
  const away = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight;
  if (force || away < 140) wrap.scrollTop = wrap.scrollHeight;
}

/* ── sending ───────────────────────────────────────────────────────────── */
function setBusy(state) {
  busy = state;
  $('#send').disabled = state;
  $('#stop').hidden = !state;
  $('#prompt').disabled = state;
}

function autoGrow() {
  const input = $('#prompt');
  input.style.height = 'auto';
  input.style.height = `${Math.min(180, input.scrollHeight)}px`;
}

function systemPrompt() {
  return {
    role: 'system',
    content: [
      'You are Amigo, the assistant on Veridellindo, a small knowledge site.',
      'Answer the question in the first sentence, then explain. Be warm and plain, never effusive.',
      'Use short paragraphs. Use a heading or a few bullets only when they genuinely help.',
      'If you are unsure, say so plainly instead of inventing a fact.',
      'Reply in the language the reader writes in, including Hinglish.',
      'Never output HTML.',
    ].join(' '),
  };
}

async function send(text) {
  const value = String(text || '').trim();
  if (!value || busy) return;

  messages.push({ role: 'user', content: value });
  save();
  renderThread();

  const row = el('div', 'msg bot');
  const body = el('div', 'body');
  const meta = el('div', 'meta');
  meta.append(el('span', 'dot'), el('span', null, 'Amigo · thinking'));
  const caret = el('span', 'caret');
  body.append(caret);
  row.append(meta, body);
  $('#thread').append(row);
  renderWelcome(false);
  scrollToEnd();

  controller = new AbortController();
  startedAt = Date.now();
  setBusy(true);

  let answer = '';
  try {
    const response = await fetch(API.chat, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [systemPrompt(), ...messages.slice(-20)],
        model: $('#model').value,
        max_tokens: 1400,
        temperature: 0.6,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.message || detail.error || `The assistant answered with ${response.status}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      buffer += decoder.decode(chunk, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let event;
        try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (event.type === 'delta' && event.text) {
          answer += event.text;
          body.innerHTML = markdown(answer);
          body.append(el('span', 'caret'));
          scrollToEnd(false);
        } else if (event.type === 'done' && event.answer) {
          answer = event.answer;
          meta.replaceChildren(el('span', 'dot'),
            el('span', null, `Amigo · ${event.provider || 'workers-ai'}${event.model ? ` · ${event.model.split('/').pop()}` : ''}`));
        } else if (event.type === 'error') {
          throw new Error(event.message || 'The assistant could not answer.');
        }
      }
    }

    if (!answer.trim()) throw new Error('The assistant returned an empty answer.');
    body.innerHTML = markdown(answer);
    row.append(actionsFor(answer, row));
    messages.push({ role: 'assistant', content: answer });
    save();
    scrollToEnd(false);
  } catch (error) {
    body.innerHTML = '';
    if (error?.name === 'AbortError') {
      body.append(el('p', 'notice', 'Stopped.'));
      if (answer.trim()) messages.push({ role: 'assistant', content: answer });
    } else {
      body.append(el('p', 'notice', `Amigo could not answer: ${error.message}`));
    }
  } finally {
    controller = null;
    setBusy(false);
    $('#prompt').focus();
  }
}

async function regenerate(index) {
  if (busy) return;
  const bots = [...$('#thread').querySelectorAll('.msg.bot')];
  const target = bots[index];
  if (!target) return;
  const position = messages.map((m) => m.role).lastIndexOf('assistant');
  const drop = position >= 0 ? position : messages.length;
  messages = messages.slice(0, drop);
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return;
  messages = messages.filter((m) => m !== lastUser);
  save();
  renderThread();
  await send(lastUser.content);
}

/* ── pictures ──────────────────────────────────────────────────────────── */
async function draw(prompt) {
  const value = String(prompt || '').trim();
  if (!value || busy) return;
  messages.push({ role: 'user', content: `Draw: ${value}` });
  save();
  renderThread();

  const row = el('div', 'msg bot');
  const meta = el('div', 'meta');
  meta.append(el('span', 'dot'), el('span', null, 'Amigo · drawing'));
  const body = el('div', 'body');
  body.append(el('p', 'notice', 'Drawing…'));
  row.append(meta, body);
  $('#thread').append(row);
  renderWelcome(false);
  setBusy(true);

  try {
    const response = await fetch(API.image, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: value.slice(0, 400) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.image) throw new Error(data.message || data.error || 'The picture could not be drawn.');
    body.replaceChildren();
    const img = el('img');
    img.src = data.image;
    img.alt = value;
    body.append(img);
    meta.replaceChildren(el('span', 'dot'), el('span', null, `Amigo · ${data.model || 'flux'}`));
    messages.push({ role: 'assistant', content: `Here is the picture you asked for: “${value}”.` });
    save();
  } catch (error) {
    body.replaceChildren(el('p', 'notice', `The picture could not be drawn: ${error.message}`));
  } finally {
    setBusy(false);
  }
}

/* ── wiring ────────────────────────────────────────────────────────────── */
function submit() {
  const input = $('#prompt');
  const value = input.value.trim();
  if (!value) return;
  input.value = '';
  autoGrow();
  send(value);
}

$('#composer').addEventListener('submit', (event) => { event.preventDefault(); submit(); });
$('#prompt').addEventListener('input', autoGrow);
$('#prompt').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
});
$('#stop').addEventListener('click', () => { if (controller) controller.abort(); });
$('#imageBtn').addEventListener('click', () => {
  const input = $('#prompt');
  const value = input.value.trim();
  if (!value) { input.focus(); $('#hint').textContent = 'Describe the picture first, then press this.'; return; }
  input.value = '';
  autoGrow();
  draw(value);
});
$('#newChat').addEventListener('click', () => {
  if (busy) return;
  messages = [];
  save();
  renderThread();
  $('#prompt').focus();
});
$('#model').addEventListener('change', save);

document.querySelectorAll('.starter').forEach((button) => {
  button.addEventListener('click', () => {
    const prompt = button.dataset.prompt || button.textContent;
    if (button.dataset.image) draw(prompt.replace(/^Draw:\s*/i, ''));
    else send(prompt);
  });
});

/* the theme follows the site's stored preference, and can be toggled here */
function applyTheme(value) {
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem(THEME, value); } catch { /* blocked */ }
}
$('#theme').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

try {
  const stored = localStorage.getItem(THEME);
  applyTheme(stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
} catch {
  applyTheme('light');
}

/* what this deployment can actually do, said plainly */
async function checkStatus() {
  const status = $('#status');
  try {
    const response = await fetch(API.chat, { headers: { accept: 'application/json' } });
    const data = await response.json();
    if (data.workersAI) {
      status.textContent = data.openRouter
        ? 'Workers AI is connected, with OpenRouter free models as a fallback.'
        : 'Workers AI is connected. No key is needed, and nothing leaves Cloudflare.';
    } else {
      status.textContent = 'The AI binding is not attached to this deployment yet, so answers will not arrive.';
    }
  } catch {
    status.textContent = 'Could not reach the assistant endpoint from this page.';
  }
}

load();
renderThread();
autoGrow();
checkStatus();
$('#prompt').focus();
