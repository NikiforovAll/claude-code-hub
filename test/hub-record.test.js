'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { liveHub, removeRecord, writeRecord } = require('../lib/hub-record');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-record-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a hub removes only its own record', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'hub.json');
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid + 1, port: 1 }));
  removeRecord(dir);
  assert.ok(fs.existsSync(file));
  writeRecord(dir, 4000);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { pid: process.pid, port: 4000 });
  removeRecord(dir);
  assert.ok(!fs.existsSync(file));
});

test('a record counts as live only when its port accepts the token', async (t) => {
  const dir = tempDir(t);
  assert.strictEqual(await liveHub(dir, 'secret'), null);
  const server = http.createServer((req, res) => {
    res.statusCode = req.url === '/api/config?token=secret' ? 200 : 401;
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  writeRecord(dir, server.address().port);
  assert.deepStrictEqual(await liveHub(dir, 'secret'), { pid: process.pid, port: server.address().port });
  assert.strictEqual(await liveHub(dir, 'other'), null);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.strictEqual(await liveHub(dir, 'secret'), null);
});
