'use strict';

// Voice control: a speech provider gives text, deciders turn it into a command for the hub page.
// A command is {kind: 'invoke', action, params, label?} | {kind: 'none'} | {kind: 'unknown'}.
// The local grammar runs first; a decider named in voice.decider gets only what the grammar did not
// know. Text no decider takes is a prompt: pasted into the session on screen and submitted.
const { createHex } = require('./hex');
const { createHexStream } = require('./hex-stream');
const { grammar, newSessionPrompt, norm } = require('./grammar');

const SPEECH = { hex: createHex };
const STREAMS = { hex: () => createHexStream() };
const DECIDERS = { grammar: () => grammar };

// cfg: config.json `voice`. ctx(): {apps, actions} for one decision, read per call.
function createVoice(cfg = {}, ctx = () => ({}), deps = {}) {
  const speech = (deps.speech ?? SPEECH[cfg.provider ?? 'hex'])?.(cfg);
  if (!speech) throw new Error(`unknown voice provider ${cfg.provider}`);
  const named = cfg.decider && cfg.decider !== 'grammar' ? cfg.decider : null;
  if (named && !DECIDERS[named]) throw new Error(`unknown voice decider ${named}`);
  const deciders = [grammar, ...(named ? [DECIDERS[named](cfg)] : [])];

  const submit = String(cfg.autoSubmit !== false);
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
    return { kind: 'invoke', action: 'session.paste', params: { text: text.trim(), submit } };
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

  const stream = (deps.stream ?? STREAMS[cfg.provider ?? 'hex'])?.(cfg) ?? null;
  const streamOps = stream && {
    start: () => stream.start(),
    audio: async (buf) => {
      const r = await stream.audio(buf);
      return r.ok ? { ...r, ...live(r.text) } : r;
    },
    finish: async () => {
      const r = await stream.finish();
      return r.ok ? { ...r, ...live(r.text), submit, command: await decide(r.text) } : r;
    },
    cancel: () => stream.cancel(),
  };

  return { start: () => speech.start(), stop, dictate: () => speech.stop(), cancel: () => speech.cancel(), decide, live, stream: streamOps };
}

module.exports = { createVoice };
