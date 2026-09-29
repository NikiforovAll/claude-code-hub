'use strict';

let seq = 0;

// Resolves true when the child answers hub:ping over its IPC channel within timeoutMs. The channel
// does not use TCP, so a loopback connect failure does not stop the answer.
function ping(child, timeoutMs) {
  if (!child?.connected) return Promise.resolve(false);
  const id = ++seq;
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer);
      child.off('message', onMessage);
      resolve(ok);
    };
    const onMessage = (m) => m?.type === 'hub:pong' && m.id === id && done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    child.on('message', onMessage);
    child.send({ type: 'hub:ping', id }, (err) => err && done(false));
  });
}

module.exports = { ping };
