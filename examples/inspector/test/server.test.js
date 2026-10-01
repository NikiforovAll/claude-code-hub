'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ID = '11111111-2222-4333-8444-555555555555';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspector-srv-'));
fs.mkdirSync(path.join(dir, 'projects', 'C--dev-shop'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'fixture.jsonl'), path.join(dir, 'projects', 'C--dev-shop', `${ID}.jsonl`));
process.env.CLAUDE_CONFIG_DIR = dir;

const app = require('../server');
let base;
let server;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('returns the overview, then 304 for the same ETag', async () => {
  const r = await fetch(`${base}/api/sessions/${ID}`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.encoded, 'C--dev-shop');
  assert.equal(body.totals.turns, 2);
  const again = await fetch(`${base}/api/sessions/${ID}`, { headers: { 'If-None-Match': r.headers.get('etag') } });
  assert.equal(again.status, 304);
});

test('returns one tool call with its input and result', async () => {
  const r = await fetch(`${base}/api/sessions/${ID}/tools/toolu_test?encoded=C--dev-shop`);
  const t = await r.json();
  assert.deepEqual([t.name, t.ok, t.input.command, t.result], ['Bash', false, 'npm test', '1 failing']);
});

test('returns the reply of one turn', async () => {
  const r = await fetch(`${base}/api/sessions/${ID}/turns/1/reply?encoded=C--dev-shop`);
  assert.deepEqual(await r.json(), { n: 1, reply: 'The test fails because total() returns 0.' });
  assert.equal((await fetch(`${base}/api/sessions/${ID}/turns/9/reply`)).status, 404);
});

test('returns the prompt of one turn', async () => {
  const r = await fetch(`${base}/api/sessions/${ID}/turns/1/prompt?encoded=C--dev-shop`);
  assert.deepEqual(await r.json(), { n: 1, prompt: 'Add a test for the cart total' });
  assert.equal((await fetch(`${base}/api/sessions/${ID}/turns/9/prompt`)).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/${ID}/turns/1/tools`)).status, 404);
});

test('answers 404 for an unknown session or tool call', async () => {
  assert.equal((await fetch(`${base}/api/sessions/00000000-0000-4000-8000-000000000000`)).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/not-an-id`)).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/${ID}/tools/nope`)).status, 404);
});

test('refuses a Host header from another site', async () => {
  const http = require('node:http');
  const status = await new Promise((resolve, reject) => {
    http
      .get(`${base}/api/sessions`, { headers: { Host: 'attacker.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on('error', reject);
  });
  assert.equal(status, 403);
});
