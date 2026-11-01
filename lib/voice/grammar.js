'use strict';

// Decider: a few fixed phrases, no network. Gives null for anything else, so the next decider can
// try it. A command starts with the reserved word "hub", so a prompt never turns into one.
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Speech services often hear "hub" as these.
const PREFIX = /^\s*(?:hub|hob|hab)\b[\s,.:;!?-]*/i;

const TAIL = '\\b[\\s,.:;!?-]*([\\s\\S]*?)\\s*$';
const phrase = (verbs, noun) =>
  new RegExp(`^(?:(?:${verbs})\\s+(?:(?:a|the)\\s+)?(?:new\\s+)?)?${noun}${TAIL}`, 'i');
const dropEndPunct = (s) => s.replace(/[.!?]+$/, '');

// `param` takes the words after the phrase; `tidy` cleans them. `say` and `help` feed the page's help panel.
// `live` names the app's dialog action that the page fills as the user speaks, and the param that takes
// the words so far.
const COMMANDS = [
  {
    action: 'session.new',
    label: 'New session',
    phrase: phrase('start|create|new', 'session'),
    param: 'prompt',
    say: 'new session',
    help: 'Opens New session with your prompt',
  },
  {
    action: 'session.find',
    label: 'Open session',
    phrase: new RegExp(`^(?:open|switch\\s+to|go\\s+to|show)\\s+(?:(?:the|my)\\s+)?session${TAIL}`, 'i'),
    param: 'name',
    tidy: dropEndPunct,
    say: 'open session',
    help: 'Opens the session that matches',
  },
  {
    action: 'task.add',
    label: 'Add task',
    phrase: phrase('add|create|new', 'task'),
    param: 'subject',
    tidy: dropEndPunct,
    say: 'add a task',
    help: 'Opens Add task with your words',
    live: { action: 'task.live', param: 'description' },
  },
];

const commandList = () =>
  COMMANDS.map(({ action, label, param, say, help, live }) => ({ action, label, param, say, help, live }));

// {action, label, param, rest} for the first command an app handles, else null. After the prefix
// with no such command yet, action is null: the words are still not a prompt.
function matchCommand(text, can = () => true) {
  const said = String(text ?? '');
  const prefix = PREFIX.exec(said);
  if (!prefix) return null;
  const body = said.slice(prefix[0].length);
  for (const c of COMMANDS) {
    const m = c.phrase.exec(body);
    if (!m || !can(c.action)) continue;
    return { action: c.action, label: c.label, param: c.param, live: c.live, rest: c.tidy ? c.tidy(m[1]) : m[1] };
  }
  return { action: null, label: 'Hub', rest: body.trim() };
}

async function grammar(ctx) {
  const m = matchCommand(ctx.text, ctx.can);
  if (!m) return null;
  if (!m.action) return { kind: 'unknown' };
  return { kind: 'invoke', action: m.action, params: m.rest ? { [m.param]: m.rest } : {}, label: m.label };
}

module.exports = { grammar, matchCommand, norm, commandList };
