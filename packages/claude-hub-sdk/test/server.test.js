const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');

const FIXTURE = path.join(__dirname, 'fixtures', 'app.js');
const CLIENT_SRC = path.join(__dirname, '..', 'src', 'client.js');

let child;
afterEach(() => child?.kill());

async function start(env = {}) {
  child = fork(FIXTURE, { env: { ...process.env, CLAUDE_HUB: '', HUB_URL: '', HUB_SDK_SRC: '', ...env } });
  const { port } = await new Promise((resolve) => child.once('message', resolve));
  return `http://127.0.0.1:${port}`;
}

const next = (type) =>
  new Promise((resolve) => {
    const on = (m) => {
      if (m?.type !== type) return;
      child.off('message', on);
      resolve(m);
    };
    child.on('message', on);
  });

describe('server mount', () => {
  it('answers a hub ping over IPC with its id', async () => {
    await start();
    const pong = next('hub:pong');
    child.send({ type: 'hub:ping', id: 7 });
    assert.deepEqual(await pong, { type: 'hub:pong', id: 7 });
  });

  it('exits when the hub channel closes', async () => {
    await start();
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.disconnect();
    assert.equal(await exited, 0);
  });

  it('reports the hub from the env on /hub-config', async () => {
    const url = await start({ CLAUDE_HUB: '1', HUB_URL: 'http://localhost:3540' });
    const body = await (await fetch(`${url}/hub-config`)).json();
    assert.deepEqual(body, { enabled: true, url: 'http://localhost:3540' });
  });

  it('reports no hub when the env is empty', async () => {
    const url = await start();
    const body = await (await fetch(`${url}/hub-config`)).json();
    assert.deepEqual(body, { enabled: false, url: null });
  });

  it('serves the vendored client, or HUB_SDK_SRC when set', async () => {
    const vendored = await start();
    assert.equal(await (await fetch(`${vendored}/vendor/claude-hub-sdk.js`)).text(), '// vendored copy\n');
    child.kill();
    const live = await start({ HUB_SDK_SRC: CLIENT_SRC });
    assert.match(await (await fetch(`${live}/vendor/claude-hub-sdk.js`)).text(), /createClaudeHub/);
  });
});
