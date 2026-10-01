'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse, overview, toolDetail, fullTextOf } = require('../lib/transcript');

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

test('reads the /compact that Claude Code writes again after a compaction as part of the first one', () => {
  const user = (content, extra = {}) => JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra });
  const compact =
    '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>';
  const { turns } = parse(
    [
      user('Fix the cart'),
      user(compact),
      JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
      user('This session is being continued from a previous conversation.', { isCompactSummary: true }),
      user('<local-command-caveat>Caveat</local-command-caveat>', { isMeta: true }),
      user(compact),
      user('<local-command-stdout>Compacted</local-command-stdout>'),
      user('Now the tests'),
      user(compact),
    ].join('\n'),
  );
  assert.deepEqual(
    turns.map((t) => [t.prompt, t.compactedBefore]),
    [
      ['Fix the cart', false],
      ['/compact', false],
      ['Now the tests', true],
      ['/compact', false],
    ],
  );
});

test('clips a long reply in the overview and keeps it whole for fullTextOf', () => {
  const long = `${'word '.repeat(200)}end`;
  const p = parse(
    [
      JSON.stringify({ type: 'user', message: { content: 'go' } }),
      JSON.stringify({
        type: 'assistant',
        message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: long }] },
      }),
    ].join('\n'),
  );
  const [t] = overview(p).turns;
  assert.equal(t.replyLong, true);
  assert.ok(t.reply.length <= 400);
  assert.equal(fullTextOf(p, 'reply', 1).reply, long);
  assert.equal(fullTextOf(p, 'reply', 2), null);
});

test('clips a long prompt in the overview and keeps it whole for fullTextOf', () => {
  const long = `${'line of a pasted log\n'.repeat(200)}end`;
  const p = parse(
    [
      JSON.stringify({ type: 'user', message: { content: long } }),
      JSON.stringify({ type: 'user', message: { content: 'short' } }),
    ].join('\n'),
  );
  const [a, b] = overview(p).turns;
  assert.equal(a.promptLong, true);
  assert.ok(a.prompt.length <= 2000);
  assert.equal(fullTextOf(p, 'prompt', 1).prompt, long);
  assert.equal(b.promptLong, false);
  assert.equal(fullTextOf(p, 'prompt', 2).prompt, 'short');
  assert.equal(fullTextOf(p, 'prompt', 3), null);
});

test('overview counts skills, built-in tools and MCP tools by server, with failures, most used first', () => {
  const lines = [JSON.stringify({ type: 'user', message: { content: 'go' } })];
  const call = (id, name, input, isError) =>
    lines.push(
      JSON.stringify({
        type: 'assistant',
        message: { id, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'x', is_error: isError }] },
      }),
    );
  call('a', 'Skill', { skill: 'tmux' });
  call('b', 'Skill', { skill: 'simplify' });
  call('c', 'Skill', { skill: 'simplify' }, true);
  call('d', 'mcp__claude-in-chrome__navigate', {});
  call('e', 'mcp__claude-in-chrome__navigate', {}, true);
  call('f', 'mcp__claude-in-chrome__computer', {});
  call('g', 'mcp__plugin_redline_redline__get_review', {});
  call('h', 'Bash', { command: 'ls' });
  call('i', 'Artifact', { action: 'publish' });
  call('j', 'Artifact', { action: 'read' }, true);
  assert.deepEqual(overview(parse(lines.join('\n'))).usage, {
    skills: [
      { name: 'simplify', count: 2, failed: 1 },
      { name: 'tmux', count: 1, failed: 0 },
    ],
    builtin: [
      { name: 'Artifact', count: 2, failed: 1 },
      { name: 'Bash', count: 1, failed: 0 },
    ],
    mcp: [
      {
        name: 'claude-in-chrome',
        count: 3,
        tools: [
          { name: 'navigate', count: 2, failed: 1 },
          { name: 'computer', count: 1, failed: 0 },
        ],
      },
      { name: 'plugin_redline_redline', count: 1, tools: [{ name: 'get_review', count: 1, failed: 0 }] },
    ],
  });
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
