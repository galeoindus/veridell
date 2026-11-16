/**
 * Veridellindo — the Amigo chat endpoint, on this site.
 *
 * Why this exists: the chat used to need a separate Cloudflare Worker deployed
 * by hand, with its URL pasted into a settings box. If you had not done that,
 * the page did nothing — which is exactly what "it is not connected" looked
 * like. This Function runs on the same origin as the page and uses the
 * `AI` binding the Pages project already declares, so the chat works the
 * moment the site is deployed, with no Worker to create and no key to paste.
 *
 * Providers, in order:
 *   1. Cloudflare Workers AI — free allocation, no key, the default.
 *   2. OpenRouter `:free` models — only if OPENROUTER_API_KEY_* is set.
 *
 * Contract: POST { messages, model?, max_tokens?, temperature?, stream? }
 *   → JSON { choices: [{ message: { content } }], provider, model }
 *   → or an SSE stream of { type: "delta" | "done" | "error" } frames
 *
 * Nothing about the caller is stored, and no key ever reaches the browser.
 */

const WORKERS_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const WORKERS_SMALL = '@cf/meta/llama-3.2-3b-instruct';
const WORKERS_VISION = '@cf/meta/llama-4-scout-17b-16e-instruct';

const WORKERS_MODELS = new Set([WORKERS_MODEL, WORKERS_SMALL, WORKERS_VISION]);

/* Free OpenRouter ids, tried in order. The router picks whatever is free and
   available; the explicit ids are fallbacks for when it is busy. */
const OPENROUTER_FREE = [
  'openrouter/free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'qwen/qwen-2.5-72b-instruct:free',
];

const MAX_MESSAGES = 40;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_CHARS = 60_000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** A request from this site's own pages, or one with no Origin (curl, tests). */
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function readJsonLimited(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) return { tooLarge: true };
  if (!request.body) return { text: '' };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
}

function normaliseMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) throw new Error('messages must be a non-empty array');
  if (messages.length > MAX_MESSAGES) throw new Error(`messages must contain at most ${MAX_MESSAGES} items`);
  const roles = new Set(['system', 'user', 'assistant']);
  return messages.map((message) => {
    if (!message || !roles.has(message.role)) throw new Error('Each message needs a valid role');
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content.slice(0, MAX_CHARS) };
    }
    if (Array.isArray(message.content)) {
      const parts = message.content.slice(0, 12).map((part) => {
        if (part && part.type === 'image_url' && part.image_url?.url?.startsWith('data:image/')) {
          return { type: 'image_url', image_url: { url: part.image_url.url } };
        }
        return { type: 'text', text: String(part?.text ?? '').slice(0, MAX_CHARS) };
      });
      return { role: message.role, content: parts };
    }
    throw new Error('Each message needs text content');
  });
}

function hasImage(messages) {
  return messages.some((m) => Array.isArray(m.content)
    && m.content.some((p) => p?.type === 'image_url'));
}

function textOf(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  if (typeof result.response === 'string') return result.response;
  if (typeof result.output_text === 'string') return result.output_text;
  const choice = result.choices?.[0];
  if (choice?.message && typeof choice.message.content === 'string') return choice.message.content;
  return '';
}

function openRouterKeys(env) {
  const keys = [];
  for (let i = 1; i <= 6; i += 1) {
    const key = String(env?.[`OPENROUTER_API_KEY_${i}`] || '').trim();
    if (key && !keys.includes(key)) keys.push(key);
  }
  const legacy = String(env?.OPENROUTER_API_KEY || '').trim();
  if (legacy && !keys.includes(legacy)) keys.push(legacy);
  return keys;
}

/* ── Workers AI ─────────────────────────────────────────────────────────── */

async function runWorkersAI(env, messages, model, maxTokens, temperature) {
  if (!env?.AI || typeof env.AI.run !== 'function') {
    throw new Error('Workers AI is not bound to this deployment');
  }
  const vision = hasImage(messages);
  const chosen = vision
    ? WORKERS_VISION
    : (WORKERS_MODELS.has(model) ? model : WORKERS_MODEL);
  const result = await env.AI.run(chosen, {
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: false,
  });
  const text = textOf(result);
  if (!String(text).trim()) throw new Error('Workers AI returned an empty answer');
  return { text: String(text), provider: 'workers-ai', model: chosen };
}

async function streamWorkersAI(env, messages, model, maxTokens, temperature, send) {
  if (!env?.AI || typeof env.AI.run !== 'function') {
    throw new Error('Workers AI is not bound to this deployment');
  }
  const vision = hasImage(messages);
  const chosen = vision ? WORKERS_VISION : (WORKERS_MODELS.has(model) ? model : WORKERS_MODEL);
  const stream = await env.AI.run(chosen, {
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: true,
  });
  let full = '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const event = JSON.parse(payload);
        const piece = event.response ?? event.delta ?? '';
        if (piece) {
          full += piece;
          send({ type: 'delta', text: piece });
        }
      } catch { /* a partial frame; the next read completes it */ }
    }
  }
  if (!full.trim()) throw new Error('Workers AI streamed an empty answer');
  return { text: full, provider: 'workers-ai', model: chosen };
}

/* ── OpenRouter, free models only ───────────────────────────────────────── */

async function runOpenRouter(env, messages, maxTokens, temperature, request) {
  const keys = openRouterKeys(env);
  if (!keys.length) throw new Error('No OpenRouter key is configured');
  const origin = request.headers.get('origin') || `https://${new URL(request.url).host}`;
  let lastError = 'OpenRouter did not answer';

  for (const model of OPENROUTER_FREE) {
    const key = keys[0];
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          // OpenRouter uses these for attribution and rate-limit tiering.
          'HTTP-Referer': origin,
          'X-Title': 'Amigo — Veridellindo',
        },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: false }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(60_000) : undefined,
      });
      if (!response.ok) {
        lastError = `OpenRouter ${response.status} on ${model}`;
        continue; // a retired or busy free id is a reason to try the next one
      }
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text || !String(text).trim()) {
        lastError = `OpenRouter returned an empty answer for ${model}`;
        continue;
      }
      return { text: String(text), provider: 'openrouter', model: data.model || model };
    } catch (error) {
      lastError = error?.message || lastError;
    }
  }
  throw new Error(lastError);
}

/* ── the handler ────────────────────────────────────────────────────────── */

export async function onRequestPost({ request, env = {} }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden_origin' }, 403);

  const type = String(request.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('application/json')) return json({ error: 'unsupported_media_type' }, 415);

  const limited = await readJsonLimited(request, MAX_BODY_BYTES);
  if (limited.tooLarge) return json({ error: 'payload_too_large' }, 413);

  let body;
  try {
    body = JSON.parse(limited.text || '{}');
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  let messages;
  try {
    messages = normaliseMessages(body.messages);
  } catch (error) {
    return json({ error: 'invalid_messages', message: error.message }, 400);
  }

  const maxTokens = Math.max(64, Math.min(Number(body.max_tokens) || 1024, 4096));
  const temperature = Math.max(0, Math.min(Number(body.temperature) ?? 0.6, 1.5));
  const model = String(body.model || '').slice(0, 120);
  const wantsStream = Boolean(body.stream);

  /* Auto: Workers AI first, OpenRouter only if Workers AI is unavailable. That
     order is deliberate — Workers AI is the free allocation this project
     already pays for, and a key should be a fallback, not a requirement. */
  const runOnce = async (send) => {
    try {
      return wantsStream && send
        ? await streamWorkersAI(env, messages, model, maxTokens, temperature, send)
        : await runWorkersAI(env, messages, model, maxTokens, temperature);
    } catch (workersError) {
      if (!openRouterKeys(env).length) throw workersError;
      return runOpenRouter(env, messages, maxTokens, temperature, request);
    }
  };

  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        try {
          const result = await runOnce(send);
          send({ type: 'done', answer: result.text, provider: result.provider, model: result.model });
        } catch (error) {
          send({ type: 'error', message: error?.message || 'The assistant could not answer.' });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      },
    });
  }

  try {
    const result = await runOnce(null);
    return json({
      choices: [{ message: { role: 'assistant', content: result.text } }],
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    return json({ error: 'assistant_unavailable', message: error?.message || 'The assistant could not answer.' }, 503);
  }
}

export async function onRequestGet({ env = {} }) {
  return json({
    ok: true,
    workersAI: Boolean(env?.AI && typeof env.AI.run === 'function'),
    openRouter: openRouterKeys(env).length > 0,
    models: [...WORKERS_MODELS],
  });
}

export async function onRequest({ request, env = {} }) {
  if (request.method === 'POST') return onRequestPost({ request, env });
  if (request.method === 'GET') return onRequestGet({ env });
  return json({ error: 'method_not_allowed' }, 405);
}
