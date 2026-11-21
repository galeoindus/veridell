import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../amigo/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../amigo/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../amigo/redesign.css', import.meta.url), 'utf8');

test('voice input exposes language selection and accessible microphone state', () => {
  assert.match(html, /id="inVoiceLang"/);
  assert.match(html, /value="hi-IN"/);
  assert.match(html, /value="en-IN"/);
  assert.match(html, /id="micBtn"[^>]*aria-pressed="false"/);
  assert.match(app, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(app, /rec\.lang = speechLanguageFor/);
  assert.match(app, /audio-capture/);
  assert.match(app, /not-allowed/);
});

test('assistant replies have read-aloud support with a capability fallback', () => {
  assert.match(app, /function speakAnswer\(/);
  assert.match(app, /window\.speechSynthesis/);
  assert.match(app, /SpeechSynthesisUtterance/);
  assert.match(app, /speak\.disabled = !supported/);
  assert.match(app, /settings\.voiceLang =/);
});

test('chat redesign preserves mobile and reduced-motion behaviour', () => {
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /env\(safe-area-inset-bottom/);
});
