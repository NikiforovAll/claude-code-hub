'use strict';

// Decider: a few fixed phrases, no network. Gives null for anything else, so the next decider can
// try it. A command starts with the reserved word "hub", so a prompt never turns into one; `bare`
// (the page's tab has no session to type into) also takes a command without it.
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Speech services often hear "hub" as these.
const PREFIX = /^\s*(?:hub|hob|hab)\b[\s,.:;!?-]*/i;

const phrase = (verbs, noun) =>
  new RegExp(`^(?:(?:${verbs})\\s+(?:(?:a|the)\\s+)?(?:new\\s+)?)?${noun}\\b[\\s,.:;!?-]*([\\s\\S]*?)\\s*$`, 'i');

// `param` takes the words after the phrase; `tidy` cleans them.
const COMMANDS = [
  { action: 'session.new', label: 'New session', phrase: phrase('start|create|new', 'session'), param: 'prompt' },
  {
    action: 'task.add',
    label: 'Add task',
    phrase: phrase('add|create|new', 'task'),
    param: 'subject',
    tidy: (s) => s.replace(/[.!?]+$/, ''),
  },
];

// {action, label, param, rest} for the first command an app handles, else null. After the prefix
// with no such command yet, action is null: the words are still not a prompt.
function matchCommand(text, can = () => true, bare = false) {
  const said = String(text ?? '');
  const prefix = PREFIX.exec(said);
  if (!prefix && !bare) return null;
  const body = prefix ? said.slice(prefix[0].length) : said;
  for (const c of COMMANDS) {
    const m = c.phrase.exec(body);
    if (!m || !can(c.action)) continue;
    return { action: c.action, label: c.label, param: c.param, rest: c.tidy ? c.tidy(m[1]) : m[1] };
  }
  return prefix ? { action: null, label: 'Hub', rest: body.trim() } : null;
}

async function grammar(ctx) {
  const m = matchCommand(ctx.text, ctx.can, ctx.bare);
  if (!m) return null;
  if (!m.action) return { kind: 'unknown' };
  return { kind: 'invoke', action: m.action, params: m.rest ? { [m.param]: m.rest } : {}, label: m.label };
}

module.exports = { grammar, matchCommand, norm };
