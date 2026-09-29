const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createClaudeHub, comboOf } = require('../src/client');

const HUB = 'http://localhost:3540';
const VARS = { '--accent': '#e86f33', '--bg-deep': '#111' };
const CACHED = { 'claude-hub:vars': JSON.stringify(VARS) };
const NO_MODS = { key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
const ctrlAlt = (key, code) => ({ ...NO_MODS, key, code, ctrlKey: true, altKey: true });

function fakeEnv({ framed = true, config = { enabled: true, url: HUB }, readyState = 'complete', storage = {} } = {}) {
  const listeners = {};
  const on = (type, fn) => {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
  };
  const fire = (type, e) => {
    for (const fn of listeners[type] || []) fn(e);
  };
  const parent = { sent: [], postMessage: (msg, origin) => parent.sent.push({ msg, origin }) };
  const style = new Map();
  const styleCalls = [];
  const timers = [];
  const opened = [];
  const win = {
    addEventListener: on,
    fetch: async () => ({ json: async () => config }),
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => {
        storage[k] = String(v);
      },
      removeItem: (k) => {
        delete storage[k];
      },
    },
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: (id) => {
      if (id) timers[id - 1] = null;
    },
    open: (...args) => opened.push(args),
    document: {
      readyState,
      addEventListener: on,
      body: {
        style: {
          setProperty: (k, v) => {
            styleCalls.push(k);
            style.set(k, v);
          },
          removeProperty: (k) => style.delete(k),
        },
      },
    },
  };
  win.parent = framed ? parent : win;
  win.top = framed ? parent : win;
  return {
    win,
    style,
    styleCalls,
    storage,
    opened,
    sent: () => parent.sent.map((s) => s.msg),
    posts: () => parent.sent,
    fromHub: (data, { source = parent, origin = HUB } = {}) => fire('message', { data, source, origin }),
    load: () => fire('load'),
    key: (init) => {
      const e = { ...NO_MODS, ...init };
      e.prevented = false;
      e.preventDefault = () => {
        e.prevented = true;
      };
      fire('keydown', e);
      return e;
    },
    endWait: () => {
      for (const fn of timers.splice(0)) fn?.();
    },
  };
}

const settle = () => new Promise((r) => setImmediate(r));

async function connected(opts = {}, envOpts = {}) {
  const env = fakeEnv(envOpts);
  const hub = createClaudeHub(env.win).connect(opts);
  await settle();
  return { env, hub };
}

const welcome = (extra = {}) => ({ type: 'hub:welcome', protocol: 1, forward: [], themes: [], actions: [], ...extra });

describe('handshake', () => {
  it('sends hello once, after load and /hub-config, to the hub origin', async () => {
    const env = fakeEnv({ readyState: 'loading' });
    const hub = createClaudeHub(env.win).connect();
    hub.subscribe('project.changed', () => {});
    await settle();
    assert.deepEqual(env.sent(), []);
    env.load();
    await settle();
    assert.deepEqual(env.posts(), [
      { msg: { type: 'hub:hello', protocol: [1], subscribes: ['project.changed'] }, origin: HUB },
    ]);
    assert.equal(hub.status, 'waiting');
  });

  it('goes live on welcome', async () => {
    const { env, hub } = await connected();
    const seen = [];
    hub.onStatus((s) => seen.push(s));
    env.fromHub(welcome());
    assert.equal(hub.status, 'live');
    env.endWait();
    assert.deepEqual(seen, ['live']);
  });

  it('ignores a welcome with another protocol', async () => {
    const { env, hub } = await connected();
    env.fromHub(welcome({ protocol: 2 }));
    assert.equal(hub.status, 'waiting');
  });

  it('drops messages from a wrong source or origin', async () => {
    const { env, hub } = await connected();
    const seen = [];
    hub.onActive((a) => seen.push(a));
    env.fromHub({ type: 'hub:active', active: true }, { source: {} });
    env.fromHub({ type: 'hub:active', active: true }, { origin: 'http://localhost:9999' });
    assert.deepEqual(seen, []);
    env.fromHub({ type: 'hub:active', active: true });
    assert.deepEqual(seen, [true]);
  });

  it('sends hello again from a new document', async () => {
    const first = await connected();
    const second = await connected();
    assert.equal(first.env.sent()[0].type, 'hub:hello');
    assert.equal(second.env.sent()[0].type, 'hub:hello');
  });

  it('returns the same hub on a second connect', () => {
    const client = createClaudeHub(fakeEnv().win);
    assert.equal(client.connect(), client.connect());
  });
});

describe('legacy hub', () => {
  it('falls back 2 s after hello with no welcome', async () => {
    const { env, hub } = await connected();
    env.endWait();
    assert.equal(hub.status, 'legacy');
  });

  it('maps hub:project and hub:theme to the topics', async () => {
    const { env, hub } = await connected();
    const got = [];
    hub.subscribe('project.changed', (p) => got.push(['project', p]));
    hub.subscribe('theme.changed', (p) => got.push(['theme', p]));
    env.fromHub({ type: 'hub:project', project: 'C:/p', encoded: 'C--p', name: 'p' });
    env.fromHub({ type: 'hub:theme', theme: 'light', colorTheme: 'ember' });
    assert.deepEqual(got, [
      ['project', { project: 'C:/p', encoded: 'C--p', name: 'p' }],
      ['theme', { theme: 'light', colorTheme: 'ember' }],
    ]);
  });

  it('sends hub:navigate for invoke once the wait ends', async () => {
    const legacy = { 'session.cost': (p) => ({ app: 'cost', url: `?view=detail&session=${p.session}` }) };
    const { env, hub } = await connected({ legacy });
    assert.equal(hub.can('session.cost'), true);
    const result = hub.invoke('session.cost', { session: 's1' });
    await settle();
    assert.equal(env.sent().length, 1);
    env.endWait();
    assert.deepEqual(await result, { ok: true, handledBy: 'cost' });
    assert.deepEqual(env.sent()[1], { type: 'hub:navigate', app: 'cost', url: '?view=detail&session=s1' });
    assert.deepEqual(await hub.invoke('project.memory'), { ok: false, reason: 'unhandled' });
    assert.equal(hub.can('project.memory'), false);
  });

  it('forwards by hub:keys when the list comes', async () => {
    const { env } = await connected();
    env.fromHub({ type: 'hub:keys', keys: ['ctrl+alt+p'] });
    assert.equal(env.key(ctrlAlt('p', 'KeyP')).prevented, true);
    assert.equal(env.key(ctrlAlt('q', 'KeyQ')).prevented, false);
  });

  it('ignores the legacy forms after welcome', async () => {
    const env = fakeEnv();
    const hub = createClaudeHub(env.win).connect();
    const got = [];
    hub.subscribe('project.changed', (p) => got.push(p));
    await settle();
    env.fromHub(welcome({ forward: ['alt+1'] }));
    env.fromHub({ type: 'hub:keys', keys: ['ctrl+alt+p'] });
    env.fromHub({ type: 'hub:project', project: 'C:/p', encoded: 'C--p', name: 'p' });
    assert.equal(env.key(ctrlAlt('p', 'KeyP')).prevented, false);
    assert.deepEqual(got, []);
    const payload = { project: 'C:/q', encoded: 'C--q', name: 'q' };
    env.fromHub({ type: 'hub:event', topic: 'project.changed', payload });
    assert.deepEqual(got, [payload]);
  });
});

describe('late subscribe', () => {
  it('keeps legacy messages for a topic not in hello', async () => {
    const env = fakeEnv();
    const hub = createClaudeHub(env.win).connect();
    await settle();
    const got = [];
    hub.subscribe('project.changed', (p) => got.push(p.encoded));
    env.fromHub(welcome());
    env.fromHub({ type: 'hub:project', project: 'C:/p', encoded: 'C--p', name: 'p' });
    assert.deepEqual(got, ['C--p']);
  });
});

describe('theme', () => {
  const binding = () => {
    const state = { theme: 'dark', colorTheme: 'ember' };
    const sets = [];
    return {
      state,
      sets,
      get: () => ({ ...state }),
      set: (t) => {
        sets.push(t);
        Object.assign(state, t);
      },
    };
  };

  it('puts vars on body, caches them and applies only a change', async () => {
    const { env } = await connected();
    env.fromHub({ type: 'hub:theme', theme: 'dark', colorTheme: 'ember', vars: VARS });
    env.fromHub({ type: 'hub:theme', theme: 'dark', colorTheme: 'ember', vars: { ...VARS } });
    assert.equal(env.style.get('--accent'), '#e86f33');
    assert.equal(env.styleCalls.length, 2);
    assert.deepEqual(JSON.parse(env.storage['claude-hub:vars']), VARS);
    env.fromHub({ type: 'hub:theme', theme: 'dark', colorTheme: 'ember', vars: { '--accent': '#000' } });
    assert.deepEqual([...env.style.keys()], ['--accent']);
  });

  it('paints the cached set when the script runs, framed only', () => {
    const framed = fakeEnv({ storage: { ...CACHED } });
    createClaudeHub(framed.win);
    assert.equal(framed.style.get('--accent'), '#e86f33');
    const top = fakeEnv({ framed: false, storage: { ...CACHED } });
    createClaudeHub(top.win);
    assert.equal(top.style.size, 0);
  });

  it('keeps the cached set through a legacy hub:theme, then drops it when no welcome comes', async () => {
    const env = fakeEnv({ storage: { ...CACHED } });
    const hub = createClaudeHub(env.win).connect();
    const b = binding();
    hub.bindTheme(b);
    await settle();
    env.fromHub({ type: 'hub:theme', theme: 'light', colorTheme: 'ember' });
    assert.equal(env.style.get('--accent'), '#e86f33');
    assert.deepEqual(b.sets, [{ theme: 'light', colorTheme: 'ember' }]);
    env.endWait();
    assert.equal(env.style.size, 0);
    assert.equal(env.storage['claude-hub:vars'], undefined);
  });

  it('removes the vars on a hub:theme with no vars from a legacy hub', async () => {
    const { env } = await connected();
    env.fromHub({ type: 'hub:theme', theme: 'dark', colorTheme: 'ember', vars: VARS });
    env.endWait();
    env.fromHub({ type: 'hub:theme', theme: 'dark', colorTheme: 'ember' });
    assert.equal(env.style.size, 0);
  });

  it('ignores a hub:theme with no vars after a welcome with themes', async () => {
    const { env } = await connected();
    env.fromHub(welcome({ themes: [{ id: 'ember' }] }));
    env.fromHub({ type: 'hub:theme', theme: 'dark', colorTheme: 'ember', vars: VARS });
    env.fromHub({ type: 'hub:theme', theme: 'light', colorTheme: 'ember' });
    assert.equal(env.style.get('--accent'), '#e86f33');
  });

  it('applies theme.changed events', async () => {
    const env = fakeEnv();
    const hub = createClaudeHub(env.win).connect();
    hub.subscribe('theme.changed', () => {});
    await settle();
    env.fromHub(welcome({ themes: [{ id: 'ember' }] }));
    const payload = { theme: 'dark', colorTheme: 'ember', vars: VARS };
    env.fromHub({ type: 'hub:event', topic: 'theme.changed', payload });
    assert.equal(env.style.get('--accent'), '#e86f33');
  });

  it('reports a user change once and does not echo a hub change', async () => {
    const { env, hub } = await connected();
    const b = binding();
    const report = hub.bindTheme(b);
    env.fromHub({ type: 'hub:theme', theme: 'light', colorTheme: 'ember' });
    report();
    assert.deepEqual(env.sent().slice(1), []);
    b.state.colorTheme = 'ocean';
    report();
    report();
    assert.deepEqual(env.sent().slice(1), [{ type: 'hub:theme', theme: 'light', colorTheme: 'ocean' }]);
  });

  it('drops the old vars on a user change until the hub echoes the new ones', async () => {
    const { env, hub } = await connected();
    const b = binding();
    const report = hub.bindTheme(b);
    env.fromHub({ type: 'hub:theme', theme: 'dark', colorTheme: 'ember', vars: VARS });
    b.state.theme = 'light';
    report();
    assert.equal(env.style.size, 0);
    env.fromHub({ type: 'hub:theme', theme: 'light', colorTheme: 'ember', vars: { '--accent': '#c85a1f' } });
    assert.equal(env.style.get('--accent'), '#c85a1f');
  });

  it('subscribes theme.changed in hello when bound before load', async () => {
    const env = fakeEnv();
    const hub = createClaudeHub(env.win).connect();
    hub.bindTheme(binding());
    await settle();
    assert.deepEqual(env.sent()[0].subscribes, ['theme.changed']);
    env.fromHub(welcome({ themes: [{ id: 'ember' }] }));
    env.fromHub({ type: 'hub:theme', theme: 'light', colorTheme: 'ember', vars: VARS });
    assert.equal(env.style.size, 0);
    env.fromHub({
      type: 'hub:event',
      topic: 'theme.changed',
      payload: { theme: 'dark', colorTheme: 'ember', vars: VARS },
    });
    assert.equal(env.style.get('--accent'), '#e86f33');
  });

  it('applies a theme that came before bindTheme', async () => {
    const { env, hub } = await connected();
    env.fromHub({ type: 'hub:theme', theme: 'light', colorTheme: 'ocean' });
    const b = binding();
    hub.bindTheme(b);
    assert.deepEqual(b.state, { theme: 'light', colorTheme: 'ocean' });
  });
});

describe('actions', () => {
  it('resolves invoke on the result with the same id', async () => {
    const { env, hub } = await connected();
    env.fromHub(welcome({ actions: ['session.cost'] }));
    const result = hub.invoke('session.cost', { session: 's1' });
    const call = env.sent()[1];
    assert.deepEqual(call, { type: 'hub:invoke', id: call.id, action: 'session.cost', params: { session: 's1' } });
    env.fromHub({ type: 'hub:result', id: 'other', ok: false, reason: 'unhandled' });
    env.fromHub({ type: 'hub:result', id: call.id, ok: true, handledBy: 'cost' });
    assert.deepEqual(await result, { id: call.id, ok: true, handledBy: 'cost' });
  });

  it('waits for welcome before it sends an invoke', async () => {
    const { env, hub } = await connected();
    hub.invoke('session.cost');
    assert.equal(env.sent().length, 1);
    env.fromHub(welcome({ actions: ['session.cost'] }));
    assert.equal(env.sent()[1].type, 'hub:invoke');
  });

  it('answers can from welcome.actions', async () => {
    const legacy = { 'project.memory': () => ({ app: 'memory' }) };
    const { env, hub } = await connected({ legacy });
    env.fromHub(welcome({ actions: ['session.cost'] }));
    assert.equal(hub.can('session.cost'), true);
    assert.equal(hub.can('project.memory'), false);
  });

  it('passes hub:action to its handler', async () => {
    const { env, hub } = await connected();
    const got = [];
    hub.handle('session.cost', (params, meta) => got.push([params, meta]));
    env.fromHub({ type: 'hub:action', id: '7', action: 'session.cost', params: { session: 's1' } });
    assert.deepEqual(got, [[{ session: 's1' }, { id: '7' }]]);
  });
});

describe('keys', () => {
  it('names combos like the hub', () => {
    assert.equal(comboOf(ctrlAlt('P', 'KeyP')), 'ctrl+alt+p');
    assert.equal(comboOf(ctrlAlt('π', 'KeyP')), 'ctrl+alt+p');
    assert.equal(comboOf({ ...NO_MODS, key: '¡', code: 'Digit1', altKey: true }), 'alt+1');
    assert.equal(comboOf(ctrlAlt('ArrowLeft', 'ArrowLeft')), 'ctrl+alt+ArrowLeft');
    assert.equal(comboOf({ ...ctrlAlt('K', 'KeyK'), shiftKey: true, metaKey: true }), 'ctrl+alt+shift+meta+k');
  });

  it('names combos the same as the hub page', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../public/app.js'), 'utf8');
    const fn = (name) => new RegExp(`^function ${name}\\(e\\) \\{[\\s\\S]*?^\\}`, 'm').exec(src)[0];
    const hub = vm.runInNewContext(`${fn('bindingKey')}\n${fn('comboOf')}\ncomboOf`);
    const events = [
      ctrlAlt('P', 'KeyP'),
      ctrlAlt('π', 'KeyP'),
      ctrlAlt('ArrowRight', 'ArrowRight'),
      { ...NO_MODS, key: '¡', code: 'Digit1', altKey: true },
      { ...NO_MODS, key: '?', code: 'Slash', shiftKey: true },
      { ...ctrlAlt('K', 'KeyK'), shiftKey: true, metaKey: true },
    ];
    for (const e of events) assert.equal(comboOf(e), hub(e), JSON.stringify(e));
  });

  it('forwards Ctrl+Alt+Arrow with Shift or Meta, and no other shifted combo', async () => {
    const { env } = await connected();
    assert.equal(env.key({ ...ctrlAlt('ArrowLeft', 'ArrowLeft'), shiftKey: true, metaKey: true }).prevented, true);
    assert.equal(env.key({ ...ctrlAlt('P', 'KeyP'), shiftKey: true }).prevented, false);
    assert.equal(env.key({ ...NO_MODS, key: '1', code: 'Digit1', altKey: true, ctrlKey: true }).prevented, false);
  });

  it('uses the legacy filter with the reserved combos left out', async () => {
    const { env } = await connected({ reserved: ['ctrl+alt+n'] });
    assert.equal(env.key(ctrlAlt('n', 'KeyN')).prevented, false);
    const p = env.key(ctrlAlt('p', 'KeyP'));
    assert.equal(p.prevented, true);
    const keydown = { type: 'hub:keydown', key: 'p', code: 'KeyP', ctrl: true, alt: true, shift: false, meta: false };
    assert.deepEqual(env.sent()[1], keydown);
    assert.equal(env.key({ key: '2', code: 'Digit2', altKey: true }).prevented, true);
    assert.equal(env.key({ key: 'j', code: 'KeyJ' }).prevented, false);
  });

  it('forwards only welcome.forward after welcome', async () => {
    const { env } = await connected({ reserved: ['ctrl+alt+n'] });
    env.fromHub(welcome({ forward: ['ctrl+alt+k'] }));
    assert.equal(env.key(ctrlAlt('k', 'KeyK')).prevented, true);
    assert.equal(env.key(ctrlAlt('p', 'KeyP')).prevented, false);
  });

  it('tells a key-eating element which keys it forwards', async () => {
    const { env, hub } = await connected({ reserved: ['ctrl+alt+n'] });
    assert.equal(hub.forwards(ctrlAlt('p', 'KeyP')), true);
    assert.equal(hub.forwards(ctrlAlt('n', 'KeyN')), false);
    env.fromHub(welcome({ forward: ['ctrl+alt+k'] }));
    assert.equal(hub.forwards(ctrlAlt('k', 'KeyK')), true);
    assert.equal(hub.forwards(ctrlAlt('p', 'KeyP')), false);
    const alone = await connected({}, { config: { enabled: false } });
    assert.equal(alone.hub.forwards(ctrlAlt('p', 'KeyP')), false);
  });
});

describe('other messages', () => {
  it('sends closeGuard and openExternal to the hub, and opens a window standalone', async () => {
    const { env, hub } = await connected();
    assert.equal(hub.inHub, true);
    hub.closeGuard(true);
    hub.openExternal('https://example.com/');
    assert.deepEqual(env.sent().slice(1), [
      { type: 'hub:closeGuard', on: true },
      { type: 'hub:openExternal', url: 'https://example.com/' },
    ]);
    const alone = await connected({}, { config: { enabled: false } });
    assert.equal(alone.hub.inHub, false);
    alone.hub.closeGuard(true);
    alone.hub.openExternal('https://example.com/');
    assert.deepEqual(alone.env.sent(), []);
    assert.deepEqual(alone.env.opened, [['https://example.com/', '_blank', 'noopener']]);
  });

  it('resolves terminalToken with the answer, null on timeout, and null standalone', async () => {
    const { env, hub } = await connected();
    const first = hub.terminalToken();
    const second = hub.terminalToken();
    await settle();
    assert.deepEqual(env.sent().slice(1), [{ type: 'hub:terminalToken' }, { type: 'hub:terminalToken' }]);
    env.fromHub({ type: 'hub:terminalToken', token: 'abc' });
    assert.deepEqual(await Promise.all([first, second]), ['abc', 'abc']);
    const late = hub.terminalToken();
    await settle();
    env.endWait();
    assert.equal(await late, null);
    const alone = await connected({}, { config: { enabled: false } });
    assert.equal(await alone.hub.terminalToken(), null);
  });

  it('asks for the terminal token once /hub-config answers, not before', async () => {
    const env = fakeEnv();
    const hub = createClaudeHub(env.win).connect();
    const token = hub.terminalToken();
    await settle();
    assert.ok(env.sent().some((m) => m.type === 'hub:terminalToken'));
    env.fromHub({ type: 'hub:terminalToken', token: 'abc' });
    assert.equal(await token, 'abc');
  });
});

describe('standalone', () => {
  for (const [name, envOpts] of [
    ['enabled: false', { config: { enabled: false } }],
    ['top window', { framed: false }],
  ]) {
    it(`sends nothing and uses the standalone map (${name})`, async () => {
      const standalone = { 'session.cost': (p) => `http://localhost:3543/?session=${p.session}` };
      const { env, hub } = await connected({ standalone }, envOpts);
      assert.equal(hub.status, 'standalone');
      assert.equal(env.key(ctrlAlt('p', 'KeyP')).prevented, false);
      assert.deepEqual(await hub.invoke('session.cost', { session: 's1' }), { ok: true, handledBy: 'standalone' });
      assert.deepEqual(env.opened, [['http://localhost:3543/?session=s1', '_blank', 'noopener']]);
      assert.equal(hub.can('session.cost'), true);
      assert.equal(hub.can('project.memory'), false);
      assert.deepEqual(env.sent(), []);
    });
  }

  it('reads a standalone function at call time', async () => {
    const urls = {};
    const standalone = () => (urls.cost ? { 'session.cost': () => urls.cost } : {});
    const { env, hub } = await connected({ standalone }, { config: { enabled: false } });
    assert.equal(hub.can('session.cost'), false);
    urls.cost = 'http://localhost:3543/';
    assert.equal(hub.can('session.cost'), true);
    await hub.invoke('session.cost', {});
    assert.deepEqual(env.opened, [['http://localhost:3543/', '_blank', 'noopener']]);
  });

  it('removes the cached set when framed by a page that is not the hub', async () => {
    const { env } = await connected({}, { config: { enabled: false }, storage: { ...CACHED } });
    assert.equal(env.style.size, 0);
  });
});
