const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
const { ping } = require('../lib/ping');

const SDK_APP = path.join(__dirname, '..', 'packages', 'claude-hub-sdk', 'test', 'fixtures', 'app.js');

let child;
afterEach(() => child?.kill());

async function startSdkApp() {
  child = fork(SDK_APP);
  await new Promise((resolve) => child.once('message', resolve));
}

describe('ping', () => {
  it('is true for an app on the server SDK', async () => {
    await startSdkApp();
    assert.equal(await ping(child, 1000), true);
  });

  it('is false for an app that does not answer', async () => {
    child = fork(path.join(__dirname, 'fixtures', 'silent.js'));
    await new Promise((resolve) => child.once('spawn', resolve));
    assert.equal(await ping(child, 200), false);
  });

  it('is false for an app that exited', async () => {
    await startSdkApp();
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
    assert.equal(await ping(child, 1000), false);
  });

  it('is false with no child', async () => {
    assert.equal(await ping(undefined, 1000), false);
  });
});
