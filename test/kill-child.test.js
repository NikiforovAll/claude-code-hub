const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { killChild } = require('../lib/kill-child');

// Obeys the signals in `obeys`, like a process whose SIGTERM handler runs or not.
function fakeChild(obeys) {
  const child = new EventEmitter();
  Object.assign(child, { pid: 42, exitCode: null, signalCode: null, signals: [] });
  child.kill = (signal) => {
    child.signals.push(signal);
    if (!obeys.includes(signal)) return;
    setImmediate(() => {
      child.signalCode = signal;
      child.emit('exit', null, signal);
    });
  };
  return child;
}

describe('killChild', () => {
  it('sends only SIGTERM on POSIX when the child exits on it', async () => {
    const child = fakeChild(['SIGTERM', 'SIGKILL']);
    await killChild(child, { platform: 'linux', graceMs: 200 });
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(child.signals, ['SIGTERM']);
  });

  it('sends SIGKILL on POSIX when the child ignores SIGTERM', async () => {
    const child = fakeChild(['SIGKILL']);
    const t0 = Date.now();
    await killChild(child, { platform: 'linux', graceMs: 100 });
    assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
    assert.ok(Date.now() - t0 >= 90);
  });

  it('uses taskkill /f /t on Windows and sends no signal', async () => {
    const child = fakeChild([]);
    const calls = [];
    const spawn = (cmd, args) => {
      calls.push([cmd, ...args]);
      setImmediate(() => {
        child.exitCode = 1;
        child.emit('exit', 1, null);
      });
    };
    await killChild(child, { platform: 'win32', spawn, graceMs: 1000 });
    assert.deepEqual(calls, [['taskkill', '/pid', '42', '/f', '/t']]);
    assert.deepEqual(child.signals, []);
  });

  it('does nothing for a child that already exited', async () => {
    const child = fakeChild([]);
    child.exitCode = 0;
    await killChild(child, { platform: 'linux', graceMs: 50 });
    assert.deepEqual(child.signals, []);
  });

  it('sends SIGTERM once when called twice', async () => {
    const child = fakeChild(['SIGTERM']);
    await Promise.all([
      killChild(child, { platform: 'linux', graceMs: 200 }),
      killChild(child, { platform: 'linux', graceMs: 200 }),
    ]);
    assert.deepEqual(child.signals, ['SIGTERM']);
  });
});
