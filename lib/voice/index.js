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
const { titleTask, askClaude } = require('./title');

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

  // app: the page's tab. Voice runs only the actions that app handles, so a hold never switches tabs.
  const canIn = (c, app) => (action) => Object.hasOwn(c.actions ?? {}, action) && (!app || c.actions[action].app === app);
  const titleModel = cfg.taskTitleModel;
  const ask = titleModel ? (deps.ask ?? ((text, c) => askClaude(text, titleModel, c.configDir))) : null;

  async function withTitle(command, c) {
    if (command.action !== 'task.add' || !command.params.subject) return command;
    const params = await titleTask(command.params.subject, ask && ((text) => ask(text, c)));
    return { ...command, params };
  }

  async function decide(text, app) {
    if (!norm(text)) return { kind: 'none' };
    const c = ctx();
    const input = { text, apps: c.apps ?? {}, can: canIn(c, app) };
    for (const d of deciders) {
      const command = await d(input);
      if (command) return command.kind === 'invoke' ? withTitle(command, c) : command;
    }
    if (!input.can('session.paste')) return { kind: 'unknown' };
    return { kind: 'invoke', action: 'session.paste', params: { text: text.trim() } };
  }

  async function stop(app) {
    const r = await speech.stop();
    if (!r.ok) return r;
    return { ...r, command: await decide(r.text, app) };
  }

  // Live text while the key is held: {text, newSession, command?}. With newSession, text is the prompt
  // after "new session", so the page opens the dialog at once and types the rest into it. With
  // command (its label), text is the rest after the prefix or phrase, which the page shows but never types.
  // action names the matched row; a row with a live dialog carries the words so far as its params.
  function live(text, app) {
    const m = matchCommand(text, canIn(ctx(), app));
    if (!m) return { text, newSession: false };
    if (m.action === 'session.new') return { text: m.rest, newSession: true };
    const r = { text: m.rest, newSession: false, command: m.label };
    if (!m.action) return r;
    return { ...r, action: m.action, ...(m.live && { params: { [m.live.param]: m.rest } }) };
  }

  // The browser provider's text so far, and its final text with the command.
  async function text(said, final, app) {
    const t = String(said ?? '').trim();
    if (!final) return { ok: true, ...live(t, app) };
    return { ok: true, ...live(t, app), command: await decide(t, app) };
  }

  const stream = inBrowser ? null : ((deps.stream ?? STREAMS[provider])?.(cfg) ?? null);
  const streamOps = stream && {
    start: () => stream.start(),
    audio: async (buf, app) => {
      const r = await stream.audio(buf);
      return r.ok ? { ...r, ...live(r.text, app) } : r;
    },
    finish: async (_body, app) => {
      const r = await stream.finish();
      return r.ok ? { ...r, ...live(r.text, app), command: await decide(r.text, app) } : r;
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
