'use strict';

// Voice control: a speech provider gives text, deciders turn it into a command for the hub page.
// A command is {kind: 'invoke', action, params, label?} | {kind: 'none'} | {kind: 'unknown'}.
// The local grammar runs first; a decider named in voice.decider gets only what the grammar did not
// know. Text no decider takes is a prompt: pasted into the session on screen as a draft. The page
// sends it when the user pressed Enter during the hold.
// The browser provider runs the browser's speech recognition on the hub page, which posts the text
// to text(); the server only decides. auto picks Hex when it is installed, else the browser.
const { createHex, hexExe } = require('./hex');
const { createHexStream } = require('./hex-stream');
const { grammar, newSessionPrompt, norm } = require('./grammar');

const SPEECH = { hex: createHex };
const STREAMS = { hex: () => createHexStream() };
const DECIDERS = { grammar: () => grammar };
const PROVIDERS = ['auto', 'hex', 'browser'];
const IN_BROWSER = async () => ({ ok: false, error: 'speech runs in the browser' });

function resolveProvider(name = 'auto', hasHex = () => !!hexExe()) {
  if (!PROVIDERS.includes(name)) throw new Error(`unknown voice provider ${name}`);
  return name === 'auto' ? (hasHex() ? 'hex' : 'browser') : name;
}

// cfg: config.json `voice`. ctx(): {apps, actions} for one decision, read per call.
function createVoice(cfg = {}, ctx = () => ({}), deps = {}) {
  const provider = resolveProvider(cfg.provider, deps.hasHex);
  const inBrowser = provider === 'browser';
  const speech = inBrowser ? null : (deps.speech ?? SPEECH[provider])(cfg);
  const named = cfg.decider && cfg.decider !== 'grammar' ? cfg.decider : null;
  if (named && !DECIDERS[named]) throw new Error(`unknown voice decider ${named}`);
  const deciders = [grammar, ...(named ? [DECIDERS[named](cfg)] : [])];

  const canIn = (c) => (action) => Object.hasOwn(c.actions ?? {}, action);

  async function decide(text) {
    if (!norm(text)) return { kind: 'none' };
    const c = ctx();
    const input = { text, apps: c.apps ?? {}, can: canIn(c) };
    for (const d of deciders) {
      const command = await d(input);
      if (command) return command;
    }
    if (!input.can('session.paste')) return { kind: 'unknown' };
    return { kind: 'invoke', action: 'session.paste', params: { text: text.trim() } };
  }

  async function stop() {
    const r = await speech.stop();
    if (!r.ok) return r;
    return { ...r, command: await decide(r.text) };
  }

  // Live text while the key is held: {text, newSession}. With newSession, text is the prompt after
  // "new session", so the page opens the dialog at once and types the rest into it.
  function live(text) {
    const prompt = newSessionPrompt(text);
    return prompt !== null && canIn(ctx())('session.new') ?{ text: prompt, newSession: true } : { text, newSession: false };
  }

  // The browser provider's text so far, and its final text with the command.
  async function text(said, final) {
    const t = String(said ?? '').trim();
    if (!final) return { ok: true, ...live(t) };
    return { ok: true, ...live(t), command: await decide(t) };
  }

  const stream = inBrowser ? null : ((deps.stream ?? STREAMS[provider])?.(cfg) ?? null);
  const streamOps = stream && {
    start: () => stream.start(),
    audio: async (buf) => {
      const r = await stream.audio(buf);
      return r.ok ? { ...r, ...live(r.text) } : r;
    },
    finish: async () => {
      const r = await stream.finish();
      return r.ok ? { ...r, ...live(r.text), command: await decide(r.text) } : r;
    },
    cancel: () => stream.cancel(),
  };

  const base = { provider, auto: (cfg.provider ?? 'auto') === 'auto', decide, live, text, stream: streamOps };
  if (inBrowser) return { ...base, start: IN_BROWSER, stop: IN_BROWSER, dictate: IN_BROWSER, cancel: IN_BROWSER };
  return { ...base, start: () => speech.start(), stop, dictate: () => speech.stop(), cancel: () => speech.cancel() };
}

module.exports = { createVoice };
