'use strict';

// Decider: a few fixed phrases, no network. Gives null for anything else, so the next decider can
// try it. Each phrase starts with words a prompt rarely starts with, because a match keeps the text
// from the session.
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const NEW_SESSION = /^\s*(?:start\s+(?:a\s+)?)?new\s+session\b[\s,.:;-]*([\s\S]*?)\s*$/i;

// The words after "new session", or null when the text does not start with it.
function newSessionPrompt(text) {
  const fresh = NEW_SESSION.exec(text);
  return fresh ? fresh[1].replace(/^[.,;:!?\s-]+/, '') : null;
}

async function grammar(ctx) {
  const prompt = newSessionPrompt(ctx.text);
  if (prompt === null || !ctx.can('session.new')) return null;
  return { kind: 'invoke', action: 'session.new', params: prompt ? { prompt } : {}, label: 'New session' };
}

module.exports = { grammar, newSessionPrompt, norm };
