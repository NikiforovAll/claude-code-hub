const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createClaudeHub, comboOf } = require('../src/client');
const stub = require('../src/stub');

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
  const sheets = [];
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
      createElement: (tag) => ({ tag, textContent: '' }),
      head: { appendChild: (el) => sheets.push(el) },
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
    sheets,
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
const themeEvent = (payload) => ({ type: 'hub:event', topic: 'theme.changed', payload });

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

describe('no welcome', () => {
  it('stops waiting 2 s after hello and calls no hub', async () => {
    const standalone = { 'session.cost': () => 'http://localhost:3543/' };
    const { env, hub } = await connected({ standalone });
    const result = hub.invoke('session.cost', { session: 's1' });
    await settle();
    env.endWait();
    assert.equal(hub.status, 'unanswered');
    assert.deepEqual(await result, { ok: false, reason: 'unhandled' });
    assert.equal(hub.can('session.cost'), false);
    assert.deepEqual(env.sent().slice(1), []);
    assert.deepEqual(env.opened, []);
  });

  it('forwards no key before welcome', async () => {
    const { env, hub } = await connected();
    assert.equal(env.key(ctrlAlt('p', 'KeyP')).prevented, false);
    assert.equal(hub.forwards(ctrlAlt('p', 'KeyP')), false);
  });

  it('ignores the v0 messages hub:keys, hub:project and hub:theme', async () => {
    const env = fakeEnv();
    const hub = createClaudeHub(env.win).connect();
    const got = [];
    hub.subscribe('project.changed', (p) => got.push(p));
    hub.subscribe('theme.changed', (p) => got.push(p));
    await settle();
    const v0 = () => {
      env.fromHub({ type: 'hub:keys', keys: ['ctrl+alt+p'] });
      env.fromHub({ type: 'hub:project', project: 'C:/p', encoded: 'C--p', name: 'p' });
      env.fromHub({ type: 'hub:theme', theme: 'light', colorTheme: 'ember', vars: VARS });
    };
    v0();
    env.fromHub(welcome({ forward: ['alt+1'] }));
    v0();
    assert.equal(env.key(ctrlAlt('p', 'KeyP')).prevented, false);
    assert.equal(env.style.size, 0);
    assert.deepEqual(got, []);
    const payload = { project: 'C:/q', encoded: 'C--q', name: 'q' };
    env.fromHub({ type: 'hub:event', topic: 'project.changed', payload });
    assert.deepEqual(got, [payload]);
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
    env.fromHub(themeEvent({ theme: 'dark', colorTheme: 'ember', vars: VARS }));
    env.fromHub(themeEvent({ theme: 'dark', colorTheme: 'ember', vars: { ...VARS } }));
    assert.equal(env.style.get('--accent'), '#e86f33');
    assert.equal(env.styleCalls.length, 2);
    assert.deepEqual(JSON.parse(env.storage['claude-hub:vars']), VARS);
    env.fromHub(themeEvent({ theme: 'dark', colorTheme: 'ember', vars: { '--accent': '#000' } }));
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

  it('keeps the cached set while it waits, then drops it when no welcome comes', async () => {
    const { env } = await connected({}, { storage: { ...CACHED } });
    assert.equal(env.style.get('--accent'), '#e86f33');
    env.endWait();
    assert.equal(env.style.size, 0);
    assert.equal(env.storage['claude-hub:vars'], undefined);
  });

  it('removes the vars on a theme.changed with no vars from a hub with no registry', async () => {
    const { env } = await connected();
    env.fromHub(themeEvent({ theme: 'dark', colorTheme: 'ember', vars: VARS }));
    env.fromHub(welcome());
    env.fromHub(themeEvent({ theme: 'dark', colorTheme: 'ember' }));
    assert.equal(env.style.size, 0);
  });

  it('reports a user change once and does not echo a hub change', async () => {
    const { env, hub } = await connected();
    const b = binding();
    const report = hub.bindTheme(b);
    env.fromHub(themeEvent({ theme: 'light', colorTheme: 'ember' }));
    assert.deepEqual(b.sets, [{ theme: 'light', colorTheme: 'ember' }]);
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
    env.fromHub(themeEvent({ theme: 'dark', colorTheme: 'ember', vars: VARS }));
    b.state.theme = 'light';
    report();
    assert.equal(env.style.size, 0);
    env.fromHub(themeEvent({ theme: 'light', colorTheme: 'ember', vars: { '--accent': '#c85a1f' } }));
    assert.equal(env.style.get('--accent'), '#c85a1f');
  });

  it('subscribes theme.changed in hello when bound before load', async () => {
    const env = fakeEnv();
    const hub = createClaudeHub(env.win).connect();
    hub.bindTheme(binding());
    await settle();
    assert.deepEqual(env.sent()[0].subscribes, ['theme.changed']);
  });

  it('applies a theme that came before bindTheme', async () => {
    const { env, hub } = await connected();
    env.fromHub(themeEvent({ theme: 'light', colorTheme: 'ocean' }));
    const b = binding();
    hub.bindTheme(b);
    assert.deepEqual(b.state, { theme: 'light', colorTheme: 'ocean' });
  });

  it('hands the picker the hub themes once, after one sheet of swatch rules', async () => {
    const swatch = (accent) => ({ bg: '#111', accent, ink: '#eee', border: '#333' });
    const themes = [{ id: 'mine', label: 'Mine', swatch: { dark: swatch('#f0a'), light: swatch('#0af') } }];
    const { env, hub } = await connected();
    const before = [];
    hub.onThemes((list) => before.push(list));
    env.fromHub(welcome({ themes }));
    env.fromHub(welcome({ themes }));
    const after = [];
    hub.onThemes((list) => after.push(list));
    assert.deepEqual(before, [[{ id: 'mine', label: 'Mine' }]]);
    assert.deepEqual(after, before);
    assert.equal(env.sheets.length, 1);
    assert.equal(
      env.sheets[0].textContent,
      '.theme-swatch-mine { --sw-bg: #111; --sw-accent: #f0a; --sw-ink: #eee; --sw-border: #333; }\n' +
        'body.light .theme-swatch-mine { --sw-bg: #111; --sw-accent: #0af; --sw-ink: #eee; --sw-border: #333; }',
    );
  });

  it('never calls onThemes when the hub lists no themes or no welcome comes', async () => {
    for (const end of [(env) => env.fromHub(welcome()), (env) => env.endWait()]) {
      const { env, hub } = await connected();
      const calls = [];
      hub.onThemes((list) => calls.push(list));
      end(env);
      hub.onThemes((list) => calls.push(list));
      assert.deepEqual(calls, []);
      assert.equal(env.sheets.length, 0);
    }
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
    const standalone = { 'project.memory': () => 'http://localhost:3544/' };
    const { env, hub } = await connected({ standalone });
    assert.equal(hub.can('session.cost'), false);
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

describe('events', () => {
  it('publishes when live, and sends only the latest payload per topic that waited for welcome', async () => {
    const { env, hub } = await connected();
    hub.publish('session.changed', { sessionId: 'a' });
    hub.publish('session.changed', { sessionId: 'b' });
    assert.equal(env.sent().length, 1);
    env.fromHub(welcome());
    hub.publish('session.changed', { sessionId: 'c' });
    assert.deepEqual(env.sent().slice(1), [
      { type: 'hub:publish', topic: 'session.changed', payload: { sessionId: 'b' } },
      { type: 'hub:publish', topic: 'session.changed', payload: { sessionId: 'c' } },
    ]);
  });

  it('drops a publish when no welcome comes', async () => {
    const { env, hub } = await connected();
    hub.publish('session.changed', { sessionId: 'a' });
    env.endWait();
    env.fromHub(welcome());
    hub.publish('session.changed', null);
    assert.deepEqual(env.sent().slice(1), [{ type: 'hub:publish', topic: 'session.changed', payload: null }]);
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

  it('gives the same comboOf from the client, the stub and the global', () => {
    const env = fakeEnv({ framed: false });
    const events = [ctrlAlt('π', 'KeyP'), ctrlAlt('ArrowLeft', 'ArrowLeft'), { ...NO_MODS, key: '?', code: 'Slash' }];
    for (const e of events) {
      assert.equal(stub.comboOf(e), comboOf(e), JSON.stringify(e));
      assert.equal(stub.createClaudeHub(env.win).comboOf(e), comboOf(e));
      assert.equal(createClaudeHub(env.win).comboOf(e), comboOf(e));
    }
  });

  it('forwards only welcome.forward, as a hub:keydown', async () => {
    const { env } = await connected();
    env.fromHub(welcome({ forward: ['ctrl+alt+p'] }));
    assert.equal(env.key(ctrlAlt('p', 'KeyP')).prevented, true);
    const keydown = { type: 'hub:keydown', key: 'p', code: 'KeyP', ctrl: true, alt: true, shift: false, meta: false };
    assert.deepEqual(env.sent()[1], keydown);
    assert.equal(env.key(ctrlAlt('n', 'KeyN')).prevented, false);
    assert.equal(env.key({ key: 'j', code: 'KeyJ' }).prevented, false);
  });

  it('tells a key-eating element which keys it forwards', async () => {
    const { env, hub } = await connected();
    env.fromHub(welcome({ forward: ['ctrl+alt+k'] }));
    assert.equal(hub.forwards(ctrlAlt('k', 'KeyK')), true);
    assert.equal(hub.forwards(ctrlAlt('p', 'KeyP')), false);
    assert.deepEqual(hub.forwardCombos(), ['ctrl+alt+k']);
    const alone = await connected({}, { config: { enabled: false } });
    assert.equal(alone.hub.forwards(ctrlAlt('k', 'KeyK')), false);
    assert.deepEqual(alone.hub.forwardCombos(), []);
  });
});

describe('key matrix, app to hub', () => {
  const { MATRIX, loadHubKeys, eventOf } = require('../../../test/helpers/hub-keys');
  const hubs = { win: loadHubKeys(), mac: loadHubKeys({ platform: 'mac' }) };

  for (const row of MATRIX.rows) {
    it(row.name, { todo: row.todo }, async () => {
      const hubKeys = hubs[row.platform];
      const { env } = await connected();
      env.fromHub(welcome({ forward: Object.keys(hubKeys.bindings()) }));
      const press = env.key(eventOf(row));
      const forwarded = env.sent().slice(1);
      assert.equal(press.prevented, row.expect !== 'text', 'the app keeps the press');
      assert.equal(forwarded.length, row.expect === 'text' ? 0 : 1);
      if (forwarded.length) assert.equal(hubKeys.actionOfForwarded(forwarded[0]), row.expect);
    });
  }
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

// An app run alone serves the stub, so it must answer like the client does with no hub.
describe('stub', () => {
  const standalone = { 'session.cost': ({ id }) => `http://localhost:3543/?session=${id}` };
  const both = async () => {
    const real = await connected({ standalone }, { framed: false, config: {} });
    const env = fakeEnv({ framed: false });
    return { real, fake: { env, hub: stub.createClaudeHub(env.win).connect({ standalone }) } };
  };

  it('has the same API as the client', async () => {
    const { real, fake } = await both();
    assert.deepEqual(Object.keys(fake.hub).sort(), Object.keys(real.hub).sort());
    for (const k of Object.keys(real.hub)) assert.equal(typeof fake.hub[k], typeof real.hub[k], k);
  });

  it('answers like the client with no hub', async () => {
    const { real, fake } = await both();
    for (const { env, hub } of [real, fake]) {
      const e = ctrlAlt('p', 'KeyP');
      assert.deepEqual(
        {
          status: hub.status,
          inHub: hub.inHub,
          themes: hub.themes,
          can: [hub.can('session.cost'), hub.can('project.plugins')],
          forwards: hub.forwards(e),
          forwardCombos: hub.forwardCombos(),
          token: await hub.terminalToken(),
          cost: await hub.invoke('session.cost', { id: 's1' }),
          plugins: await hub.invoke('project.plugins', {}),
        },
        {
          status: 'standalone',
          inHub: false,
          themes: [],
          can: [true, false],
          forwards: false,
          forwardCombos: [],
          token: null,
          cost: { ok: true, handledBy: 'standalone' },
          plugins: { ok: false, reason: 'unhandled' },
        },
      );
      hub.openExternal('https://example.com/');
      assert.deepEqual(env.opened, [
        ['http://localhost:3543/?session=s1', '_blank', 'noopener'],
        ['https://example.com/', '_blank', 'noopener'],
      ]);
      assert.equal(typeof hub.bindTheme({ get: () => ({}), set() {} }), 'function');
      assert.deepEqual(env.sent(), []);
    }
  });
});
