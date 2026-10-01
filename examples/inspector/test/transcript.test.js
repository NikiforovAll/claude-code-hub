'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse, overview, toolDetail } = require('../lib/transcript');

const raw = fs.readFileSync(path.join(__dirname, 'fixture.jsonl'), 'utf8');
const ID = '11111111-2222-4333-8444-555555555555';

test('splits the transcript into turns at each typed or queued prompt', () => {
  const { turns } = parse(raw);
  assert.deepEqual(
    turns.map((t) => [t.n, t.prompt, t.queued]),
    [
      [1, 'Add a test for the cart total', false],
      [2, 'Fix it', true],
    ],
  );
});

test('counts usage once per message id and keeps the last context size', () => {
  const [first] = parse(raw).turns;
  assert.deepEqual(first.tokens, { input: 18, cacheRead: 3900, cacheWrite: 350, output: 65 });
  assert.equal(first.context, 3 + 1500 + 50);
  assert.equal(first.durationMs, 12000);
  assert.equal(first.reply, 'The test fails because total() returns 0.');
});

test('pairs tool calls with results and marks failures', () => {
  const p = parse(raw);
  const [first, second] = p.turns;
  assert.deepEqual(
    first.tools.map((t) => [t.name, t.summary, t.ok]),
    [
      ['Read', 'C:/dev/shop/cart.js', true],
      ['Bash', 'npm test', false],
    ],
  );
  assert.equal(second.tools[0].ok, null);
  assert.equal(toolDetail(p, 'toolu_test').result, '1 failing');
  assert.equal(toolDetail(p, 'nope'), null);
});

test('marks compaction and interruption, and skips meta, summary and sidechain lines', () => {
  const p = parse(raw);
  const [first, second] = p.turns;
  assert.equal(first.compactedBefore, false);
  assert.equal(second.compactedBefore, true);
  assert.equal(second.interrupted, true);
  assert.equal(p.tools.has('toolu_side'), false);
  assert.equal(second.tokens.output, 12);
});

test('takes the custom title over the AI title, and the session facts', () => {
  const { meta } = parse(raw);
  assert.equal(meta.title, 'cart-tests');
  assert.equal(meta.cwd, 'C:/dev/shop');
  assert.equal(meta.gitBranch, 'main');
  assert.equal(meta.model, 'claude-opus-5-5');
});

test('overview totals the turns and leaves out tool inputs and results', () => {
  const o = overview(parse(raw));
  assert.deepEqual(
    {
      turns: o.totals.turns,
      tools: o.totals.tools,
      failed: o.totals.failed,
      output: o.totals.output,
      peak: o.totals.peak,
    },
    { turns: 2, tools: 3, failed: 1, output: 77, peak: 1553 },
  );
  assert.equal('input' in o.turns[0].tools[0], false);
  assert.equal('result' in o.turns[0].tools[0], false);
});

test('reads slash commands, bash input, pasted markup and images as prompts, and skips Claude Code output', () => {
  const user = (content, extra = {}) => JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra });
  const lines = [
    user(
      '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>the cart</command-args>',
    ),
    user('<local-command-stdout>done</local-command-stdout>'),
    user('<task-notification>agent finished</task-notification>'),
    user('<bash-input> npm test</bash-input>'),
    user('<bash-stdout>ok</bash-stdout>'),
    user('<div>why is this red?</div>'),
    user([{ type: 'image', source: { type: 'base64', data: 'AA==' } }]),
  ];
  assert.deepEqual(
    parse(lines.join('\n')).turns.map((t) => t.prompt),
    ['/review the cart', '! npm test', '<div>why is this red?</div>', '[Image]'],
  );
});

test('clips a large tool input and keeps a small one as an object', () => {
  const big = 'x'.repeat(200 * 1024);
  const call = (id, input) =>
    JSON.stringify({
      type: 'assistant',
      message: { id, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Write', input }] },
    });
  const p = parse(
    [
      JSON.stringify({ type: 'user', message: { content: 'go' } }),
      call('a', { content: big }),
      call('b', { n: 1 }),
    ].join('\n'),
  );
  assert.equal(typeof toolDetail(p, 'a').input, 'string');
  assert.ok(toolDetail(p, 'a').input.length < 70 * 1024);
  assert.deepEqual(toolDetail(p, 'b').input, { n: 1 });
});

test('reads a growing file in steps with the same result as one read', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspector-'));
  process.env.CLAUDE_CONFIG_DIR = dir;
  const proj = path.join(dir, 'projects', 'C--dev-shop');
  fs.mkdirSync(proj, { recursive: true });
  const file = path.join(proj, `${ID}.jsonl`);
  const sessions = require('../lib/sessions');
  const cutAt = raw.indexOf('"msg_2"') + 3;
  fs.writeFileSync(file, raw.slice(0, cutAt));
  const before = await sessions.load(file);
  assert.equal(before.parsed.turns[0].tools.length, 1);
  fs.appendFileSync(file, raw.slice(cutAt));
  const [after, again] = await Promise.all([sessions.load(file), sessions.load(file)]);
  assert.equal(after.etag, again.etag);
  assert.notEqual(after.etag, before.etag);
  assert.deepEqual(overview(after.parsed), overview(parse(raw)));
  assert.equal(sessions.findFile(ID, 'C--dev-shop'), file);
  assert.equal(sessions.findFile(ID), file);
  assert.equal(sessions.findFile('../etc/passwd'), null);
  fs.writeFileSync(path.join(dir, `${ID}.jsonl`), '');
  assert.equal(sessions.findFile(ID, '..'), file);
  fs.writeFileSync(file, raw.slice(0, cutAt));
  assert.equal((await sessions.load(file)).parsed.turns[0].tools.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
