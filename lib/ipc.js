'use strict';

let seq = 0;

// Resolves with the child's answer to a `type` message over its IPC channel, or null after timeoutMs.
// The channel does not use TCP, so a loopback connect failure does not stop the answer.
function ask(child, type, timeoutMs, answerType = type) {
  if (!child?.connected) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve) => {
    const done = (m) => {
      clearTimeout(timer);
      child.off('message', onMessage);
      resolve(m);
    };
    const onMessage = (m) => m?.type === answerType && m.id === id && done(m);
    const timer = setTimeout(() => done(null), timeoutMs);
    child.on('message', onMessage);
    child.send({ type, id }, (err) => err && done(null));
  });
}

// Resolves true when the child answers hub:ping within timeoutMs.
async function ping(child, timeoutMs) {
  return !!(await ask(child, 'hub:ping', timeoutMs, 'hub:pong'));
}

// An app that does not mount the SDK server does not answer, so it resolves null.
async function stats(child, timeoutMs) {
  const m = await ask(child, 'hub:stats', timeoutMs);
  return m && { rss: m.rss, cpu: m.cpu };
}

module.exports = { ping, stats };
