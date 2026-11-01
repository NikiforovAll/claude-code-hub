const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVoice } = require('../lib/voice');
const { createHexStream } = require('../lib/voice/hex-stream');

const ALL = { 'session.paste': {}, 'session.new': {} };

function voiceWith({ actions = ALL, said = '', cfg = {} } = {}) {
  const speech = () => ({ start: async () => ({ ok: true }), stop: async () => ({ ok: true, text: said }) });
  return createVoice({ provider: 'hex', ...cfg }, () => ({ actions }), { speech });
}

describe('voice', () => {
  it('starts a new session, with the rest as its prompt', async () => {
    const v = voiceWith();
    assert.deepEqual(await v.decide('New session.'), {
      kind: 'invoke',
      action: 'session.new',
      params: {},
      label: 'New session',
    });
    assert.deepEqual((await v.decide('Start a new session, fix the flaky login test.')).params, {
      prompt: 'fix the flaky login test.',
    });
  });

  it('pastes anything else as a draft, with no Enter', async () => {
    const v = voiceWith();
    for (const text of ['Fix the failing test.', 'open session auth refactor', 'a new session is what I need']) {
      assert.deepEqual(await v.decide(` ${text} `), {
        kind: 'invoke',
        action: 'session.paste',
        params: { text },
      });
    }
  });

  it('pastes "new session" when no app starts sessions', async () => {
    const v = voiceWith({ actions: { 'session.paste': {} } });
    assert.equal((await v.decide('new session')).action, 'session.paste');
  });

  it('gives unknown without a paste action, and none for silence', async () => {
    const v = voiceWith({ actions: {} });
    assert.deepEqual(await v.decide('fix it'), { kind: 'unknown' });
    assert.deepEqual(await v.decide('  .  '), { kind: 'none' });
  });

  it('decides on stop', async () => {
    const v = voiceWith({ said: 'New session' });
    assert.deepEqual(await v.stop(), {
      ok: true,
      text: 'New session',
      command: { kind: 'invoke', action: 'session.new', params: {}, label: 'New session' },
    });
  });

  it('splits live text at "new session"', async () => {
    const stream = () => ({
      audio: async () => ({ ok: true, text: 'New session. Fix the' }),
      finish: async () => ({ ok: true, text: 'New session. Fix the test' }),
    });
    const v = createVoice({ provider: 'hex' }, () => ({ actions: ALL }), { speech: () => ({}), stream });
    assert.deepEqual(v.live('fix the test'), { text: 'fix the test', newSession: false });
    assert.deepEqual(await v.stream.audio(Buffer.alloc(4)), { ok: true, text: 'Fix the', newSession: true });
    const done = await v.stream.finish();
    assert.equal(done.text, 'Fix the test');
    assert.equal(done.command.action, 'session.new');
    const plain = createVoice({ provider: 'hex' }, () => ({ actions: { 'session.paste': {} } }), { speech: () => ({}), stream });
    assert.deepEqual(plain.live('New session. Fix'), { text: 'New session. Fix', newSession: false });
  });

  it('folds Hex stream events into the text so far', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hex-'));
    const apiFile = path.join(dir, 'local-api.json');
    fs.writeFileSync(apiFile, JSON.stringify({ port: 1, token: 't' }));
    const events = [
      { type: 'partial', segment: 0, stable: 'New session', tentative: '' },
      { type: 'segment', segment: 0, text: 'New session.' },
      { type: 'partial', segment: 1, stable: 'Fix the', tentative: ' test' },
    ];
    const sent = [];
    const json = (body, status = 200) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
    const fetchImpl = async (url, opts) => {
      sent.push(`${opts.method} ${url.replace(/^http:\/\/[^/]+/, '')}`);
      if (url.endsWith('/streams')) return json({ id: 7, ownerToken: 'o' });
      if (url.endsWith('/events')) {
        const enc = new TextEncoder();
        return { body: (async function* () { for (const e of events) yield enc.encode(`data: ${JSON.stringify(e)}\n\n`); })() };
      }
      if (url.endsWith('/finish')) return json({ text: ' New session. Fix the test ' });
      return json({}, 204);
    };
    const s = createHexStream({ apiFile, fetchImpl });
    assert.deepEqual(await s.start(), { ok: true, sampleRate: 16000 });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(await s.audio(Buffer.alloc(4)), { ok: true, text: 'New session. Fix the test' });
    assert.deepEqual(await s.finish(), { ok: true, text: 'New session. Fix the test' });
    assert.deepEqual(await s.audio(Buffer.alloc(4)), { ok: false, error: 'no live stream' });
    assert.ok(sent.includes('POST /streams/7/audio'));
    const missing = createHexStream({ apiFile: path.join(dir, 'none.json'), fetchImpl });
    assert.equal((await missing.start()).unsupported, true);
  });

  it('picks Hex for auto when it is installed, else the browser', () => {
    const speech = () => ({});
    assert.equal(createVoice({}, () => ({}), { speech, hasHex: () => true }).provider, 'hex');
    const auto = createVoice({}, () => ({}), { hasHex: () => false });
    assert.deepEqual([auto.provider, auto.auto, auto.stream], ['browser', true, null]);
    const chosen = createVoice({ provider: 'browser' }, () => ({}), { hasHex: () => true });
    assert.deepEqual([chosen.provider, chosen.auto], ['browser', false]);
  });

  it('decides on the text the browser heard', async () => {
    const v = createVoice({ provider: 'browser' }, () => ({ actions: ALL }));
    assert.deepEqual(await v.text('New session, fix the'), { ok: true, text: 'fix the', newSession: true });
    const done = await v.text(' Fix the test ', true);
    assert.deepEqual(done, {
      ok: true,
      text: 'Fix the test',
      newSession: false,
      command: { kind: 'invoke', action: 'session.paste', params: { text: 'Fix the test' } },
    });
    assert.deepEqual((await v.text('', true)).command, { kind: 'none' });
    assert.equal((await v.start()).ok, false);
  });

  it('refuses an unknown provider or decider', () => {
    assert.throws(() => createVoice({ provider: 'nope' }), /provider/);
    assert.throws(() => createVoice({ decider: 'nope' }, () => ({}), { speech: () => ({}) }), /decider/);
  });
});
