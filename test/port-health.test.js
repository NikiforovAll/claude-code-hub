const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createPortHealth, STRIKES, WINDOW_MS } = require('../lib/port-health');

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms) => (t += ms) };
}

const slowPort = { httpMs: 920, ipcMs: 2 };

describe('createPortHealth', () => {
  it('flags an app after enough slow HTTP answers with fast pongs', () => {
    const h = createPortHealth();
    const child = {};
    for (let i = 0; i < STRIKES - 1; i++) h.record(child, slowPort);
    assert.equal(h.flagged(child), null);
    h.record(child, { httpMs: 4500, ipcMs: 3 });
    assert.deepEqual(h.flagged(child), { worstMs: 4500 });
  });

  it('ignores slow HTTP when the pong is slow or missing: the app is busy', () => {
    const h = createPortHealth();
    const child = {};
    for (let i = 0; i < STRIKES; i++) h.record(child, { httpMs: 900, ipcMs: 800 });
    for (let i = 0; i < STRIKES; i++) h.record(child, { httpMs: 900, ipcMs: null });
    assert.equal(h.flagged(child), null);
  });

  it('ignores fast HTTP answers', () => {
    const h = createPortHealth();
    const child = {};
    for (let i = 0; i < 10; i++) h.record(child, { httpMs: 20, ipcMs: 1 });
    assert.equal(h.flagged(child), null);
  });

  it('drops strikes older than the window', () => {
    const c = clock();
    const h = createPortHealth({ now: c.now });
    const child = {};
    for (let i = 0; i < STRIKES - 1; i++) h.record(child, slowPort);
    c.advance(WINDOW_MS + 1);
    h.record(child, slowPort);
    assert.equal(h.flagged(child), null);
  });

  it('keeps children apart, so a restarted app starts over', () => {
    const h = createPortHealth();
    const old = {};
    for (let i = 0; i < STRIKES; i++) h.record(old, slowPort);
    assert.ok(h.flagged(old));
    assert.equal(h.flagged({}), null);
  });
});
