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
const { grammar, matchCommand, norm, commandList } = require('./grammar');
const { splitTask, askClaude } = require('./split');

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
  const splitModel = cfg.taskSplitModel;
  const ask = splitModel ? (deps.ask ?? ((text, c) => askClaude(text, splitModel, c.configDir))) : null;

  async function withSplit(command, c) {
    if (command.action !== 'task.add' || !command.params.subject) return command;
    const params = await splitTask(command.params.subject, ask && ((text) => ask(text, c)));
    return { ...command, params };
  }

  // bare: the page's tab has no session to type into, so a command needs no "hub" prefix and other
  // words are not a draft.
  async function decide(text, bare = false) {
    if (!norm(text)) return { kind: 'none' };
    const c = ctx();
    const input = { text, bare, apps: c.apps ?? {}, can: canIn(c) };
    for (const d of deciders) {
      const command = await d(input);
      if (command) return command.kind === 'invoke' ? withSplit(command, c) : command;
    }
    if (bare || !input.can('session.paste')) return { kind: 'unknown' };
    return { kind: 'invoke', action: 'session.paste', params: { text: text.trim() } };
  }

  async function stop(bare) {
    const r = await speech.stop();
    if (!r.ok) return r;
    return { ...r, command: await decide(r.text, bare) };
  }

  // Live text while the key is held: {text, newSession, command?}. With newSession, text is the prompt
  // after "new session", so the page opens the dialog at once and types the rest into it. With
  // command (its label), text is the rest after the prefix or phrase, which the page shows but never types.
  function live(text, bare = false) {
    const m = matchCommand(text, canIn(ctx()), bare);
    if (!m) return { text, newSession: false };
    if (m.action === 'session.new') return { text: m.rest, newSession: true };
    return { text: m.rest, newSession: false, command: m.label };
  }

  // The browser provider's text so far, and its final text with the command.
  async function text(said, final, bare) {
    const t = String(said ?? '').trim();
    if (!final) return { ok: true, ...live(t, bare) };
    return { ok: true, ...live(t, bare), command: await decide(t, bare) };
  }

  const stream = inBrowser ? null : ((deps.stream ?? STREAMS[provider])?.(cfg) ?? null);
  const streamOps = stream && {
    start: () => stream.start(),
    audio: async (buf, bare) => {
      const r = await stream.audio(buf);
      return r.ok ? { ...r, ...live(r.text, bare) } : r;
    },
    finish: async (_body, bare) => {
      const r = await stream.finish();
      return r.ok ? { ...r, ...live(r.text, bare), command: await decide(r.text, bare) } : r;
    },
    cancel: () => stream.cancel(),
  };

  const base = {
    provider,
    auto: (cfg.provider ?? 'auto') === 'auto',
    commands: commandList(),
    decide,
    live,
    text,
    stream: streamOps,
  };
  if (inBrowser) return { ...base, start: IN_BROWSER, stop: IN_BROWSER, dictate: IN_BROWSER, cancel: IN_BROWSER };
  return { ...base, start: () => speech.start(), stop, dictate: () => speech.stop(), cancel: () => speech.cancel() };
}

module.exports = { createVoice };
