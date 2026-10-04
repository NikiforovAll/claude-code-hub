'use strict';

// Some loopback ports on Windows answer with TCP retransmit delays (0.3 s, 0.9 s, 2 s, 4.5 s ...)
// while the app behind them is idle; a restart moves the app to a fresh port and the delays go.
// A probe pairs an HTTP request with an IPC ping sent at the same moment: a slow HTTP answer with a
// fast pong is the port, both slow is a busy app.
const SLOW_HTTP_MS = 300;
const FAST_IPC_MS = 100;
const STRIKES = 3;
const WINDOW_MS = 5 * 60_000;

// Keyed by the child process: a restart brings a new child on a new port, so its strikes start over.
function createPortHealth({ now = Date.now } = {}) {
  const strikesOf = new WeakMap();

  function recent(child) {
    const since = now() - WINDOW_MS;
    return (strikesOf.get(child) ?? []).filter((s) => s.at >= since);
  }

  function record(child, { httpMs, ipcMs }) {
    if (httpMs < SLOW_HTTP_MS || ipcMs == null || ipcMs >= FAST_IPC_MS) return;
    strikesOf.set(child, [...recent(child), { at: now(), ms: Math.round(httpMs) }]);
  }

  function flagged(child) {
    const strikes = recent(child);
    return strikes.length < STRIKES ? null : { worstMs: Math.max(...strikes.map((s) => s.ms)) };
  }

  return { record, flagged };
}

module.exports = { createPortHealth, STRIKES, WINDOW_MS };
