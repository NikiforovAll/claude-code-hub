const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { APPS, selectApps, loadApp, manifestError, conflicts } = require('../lib/apps');

const COST = APPS.find((a) => a.id === 'cost');
const KANBAN = APPS.find((a) => a.id === 'kanban');

describe('selectApps', () => {
  it('keeps the default order with no entries', () => {
    assert.deepEqual(
      selectApps().apps.map((a) => a.id),
      ['kanban', 'marketplace', 'cost', 'memory'],
    );
  });

  it('puts listed apps first, drops disabled ones and reports unknown ids', () => {
    const { apps, unknown } = selectApps([{ id: 'cost' }, { id: 'kanban', enabled: false }, { id: 'nope' }]);
    assert.deepEqual(
      apps.map((a) => a.id),
      ['cost', 'marketplace', 'memory'],
    );
    assert.deepEqual(unknown, ['nope']);
  });

  it('carries the port of the entry', () => {
    const { apps } = selectApps([{ id: 'cost', port: 4643 }]);
    assert.equal(apps.find((a) => a.id === 'cost').port, 4643);
    assert.equal(apps.find((a) => a.id === 'memory').port, undefined);
  });

  it('adds an unknown id that has a path, resolved against the base', () => {
    const base = path.resolve('/hub');
    const { apps, unknown } = selectApps([{ id: 'kanban' }, { id: 'board', path: 'forks/board', port: 4545 }], base);
    assert.deepEqual(
      apps.map((a) => a.id),
      ['kanban', 'board', 'marketplace', 'cost', 'memory'],
    );
    assert.deepEqual(apps[1], { id: 'board', port: 4545, path: path.join(base, 'forks', 'board') });
    assert.deepEqual(unknown, []);
  });

  it('runs a built-in app from its path and keeps an absolute path as is', () => {
    const fork = path.resolve('/forks/cck');
    const { apps } = selectApps([{ id: 'kanban', path: fork }], path.resolve('/hub'));
    assert.equal(apps[0].path, fork);
    assert.equal(apps[0].dir, 'cck');
    assert.equal(apps.find((a) => a.id === 'cost').path, undefined);
  });

  it('drops a disabled app with a path and ignores a path that is not a string', () => {
    const { apps, unknown } = selectApps([
      { id: 'board', path: '/x', enabled: false },
      { id: 'other', path: 42 },
    ]);
    assert.ok(!apps.some((a) => a.id === 'board'));
    assert.deepEqual(unknown, ['other']);
  });
});

describe('conflicts', () => {
  const app = (id, { provides = {}, handles = {}, port = 0 } = {}) => ({ id, provides, actions: { handles }, port });

  it('is empty when no two apps claim the same thing', () => {
    assert.deepEqual(conflicts([app('a', { provides: { projects: {} }, port: 1 }), app('b', { port: 2 })]), []);
  });

  it('names the winner of each shared capability, action and port', () => {
    const kanban = app('kanban', { provides: { terminal: {} }, handles: { 'session.open': {} }, port: 3541 });
    const fork = app('kanban-next', { provides: { terminal: {} }, handles: { 'session.open': {} }, port: 3541 });
    const lines = conflicts([kanban, fork]);
    assert.equal(lines.length, 3);
    assert.match(lines[0], /kanban-next and kanban both declare capability "terminal"; kanban has it/);
    assert.match(lines[1], /action "session.open"/);
    assert.match(lines[2], /port "3541"/);
  });
});

// The submodule when it is checked out, else the installed package: in the release run this checks
// the packages the hub pins.
describe('app manifests', () => {
  for (const app of APPS) {
    it(`${app.id} ships a valid hub-app.json`, () => {
      const logs = [];
      assert.ok(loadApp(app, { log: (line) => logs.push(line) }));
      assert.deepEqual(logs, []);
    });
  }

  it('kanban provides projects and the terminal', () => {
    const kanban = loadApp(KANBAN, { log: () => {} });
    assert.deepEqual(Object.keys(kanban.provides).sort(), ['projects', 'terminal']);
  });

  it('kanban names its plugin, and the plugin manifest is where it says', () => {
    const { plugin } = loadApp(KANBAN, { log: () => {} });
    assert.equal(plugin.id, 'claude-code-kanban@claude-code-kanban');
    assert.ok(fs.existsSync(plugin.manifest), plugin.manifest);
  });

  it('kanban keeps its session keys', () => {
    assert.deepEqual(loadApp(KANBAN, { log: () => {} }).keeps, ['ctrl+alt+n', 'ctrl+alt+r', 'ctrl+alt+s']);
  });
});

describe('manifestError', () => {
  const ok = { manifest: 1, id: 'cost', run: { entry: 'server.js' } };
  const root = path.resolve('/apps/cost');

  it('accepts a valid manifest', () => {
    assert.equal(manifestError(ok, 'cost', root), null);
  });

  it('rejects an unknown format version', () => {
    assert.match(manifestError({ ...ok, manifest: 2 }, 'cost', root), /manifest version 2/);
  });

  it('rejects an id that breaks the rule or differs from the entry', () => {
    assert.match(manifestError({ ...ok, id: 'Cost' }, 'Cost', root), /does not match/);
    assert.match(manifestError(ok, 'kanban', root), /is not "kanban"/);
  });

  it('rejects a missing entry or one outside the app directory', () => {
    assert.match(manifestError({ ...ok, run: {} }, 'cost', root), /missing/);
    assert.match(manifestError({ ...ok, run: { entry: '../evil.js' } }, 'cost', root), /outside/);
    assert.match(manifestError({ ...ok, run: { entry: path.resolve('/elsewhere/x.js') } }, 'cost', root), /outside/);
    assert.match(manifestError({ ...ok, run: { entry: '.' } }, 'cost', root), /outside/);
  });

  it('accepts capability paths and rejects ones that are not paths', () => {
    const provides = { projects: { path: '/api/projects' }, terminal: { liveWork: '/api/terminals' } };
    assert.equal(manifestError({ ...ok, provides }, 'cost', root), null);
    assert.match(manifestError({ ...ok, provides: [] }, 'cost', root), /not an object/);
    assert.match(manifestError({ ...ok, provides: 'x' }, 'cost', root), /not an object/);
    assert.match(manifestError({ ...ok, provides: { projects: {} } }, 'cost', root), /provides.projects.path/);
    assert.match(
      manifestError({ ...ok, provides: { terminal: { liveWork: 'http://x/' } } }, 'cost', root),
      /provides.terminal.liveWork/,
    );
  });

  it('accepts kept combo names and rejects anything else', () => {
    const keeps = ['ctrl+alt+n', 'ctrl+shift+z', 'alt+1', 'ctrl+alt+ArrowLeft', 'ctrl+alt+shift+meta+k'];
    assert.equal(manifestError({ ...ok, keys: { keeps } }, 'cost', root), null);
    assert.equal(manifestError({ ...ok, keys: {} }, 'cost', root), null);
    assert.match(manifestError({ ...ok, keys: [] }, 'cost', root), /keys is not an object/);
    assert.match(manifestError({ ...ok, keys: { keeps: 'ctrl+alt+n' } }, 'cost', root), /not an array/);
    for (const bad of ['n', 'alt+ctrl+n', 'ctrl+alt+N', 'Ctrl+Alt+N', 'ctrl+alt+', 'ctrl+alt+no', 5]) {
      assert.match(manifestError({ ...ok, keys: { keeps: [bad] } }, 'cost', root), /not a combo name/, String(bad));
    }
  });

  it("accepts published topics and rejects a bad name or the hub's own", () => {
    assert.equal(manifestError({ ...ok, publishes: ['session.changed'] }, 'cost', root), null);
    assert.match(manifestError({ ...ok, publishes: 'session.changed' }, 'cost', root), /not an array/);
    assert.match(manifestError({ ...ok, publishes: ['Session'] }, 'cost', root), /does not match/);
    assert.match(manifestError({ ...ok, publishes: ['project.changed'] }, 'cost', root), /the hub's/);
    assert.match(manifestError({ ...ok, publishes: ['hub.trace'] }, 'cost', root), /the hub's/);
  });

  it('accepts a plugin and rejects a bad id, path or install command', () => {
    const plugin = { id: 'x@y', path: 'plugin/x', install: 'x --install' };
    const err = (p) => manifestError({ ...ok, plugin: { ...plugin, ...p } }, 'cost', root);
    assert.equal(err({}), null);
    assert.match(err({ id: 'x' }), /plugin.id/);
    assert.match(err({ path: undefined }), /plugin.path is missing/);
    assert.match(err({ path: '../x' }), /outside/);
    assert.match(err({ path: '.' }), /outside/);
    assert.match(err({ install: '' }), /plugin.install/);
    assert.match(manifestError({ ...ok, plugin: 'x' }, 'cost', root), /plugin.id/);
  });
});

describe('loadApp', () => {
  let hubRoot;
  let logs;
  const log = (line) => logs.push(line);
  const noPackage = () => {
    throw new Error('not installed');
  };

  beforeEach(() => {
    hubRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-apps-'));
    logs = [];
  });

  afterEach(() => fs.rmSync(hubRoot, { recursive: true, force: true }));

  // An app folder with a package.json and, when given, a hub-app.json (a string is written as is).
  const makeApp = (dir, manifest) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    if (manifest !== undefined)
      fs.writeFileSync(path.join(dir, 'hub-app.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    return dir;
  };
  const submodule = (manifest) => makeApp(path.join(hubRoot, COST.dir), manifest);

  const COST_MANIFEST = {
    manifest: 1,
    id: 'cost',
    name: 'Cost',
    icon: 'coins',
    run: { entry: 'server.js', defaultPort: 3543 },
    loading: { verbs: ['Counting…'] },
    actions: { handles: {} },
  };

  it('reads the installed package when there is no submodule', () => {
    const pkgRoot = makeApp(path.join(hubRoot, 'pkg'), COST_MANIFEST);
    const app = loadApp(COST, { hubRoot, resolve: () => path.join(pkgRoot, 'package.json'), log });
    assert.deepEqual(app, {
      id: 'cost',
      version: null,
      plugin: undefined,
      entry: path.join(pkgRoot, 'server.js'),
      port: 3543,
      name: 'Cost',
      icon: 'coins',
      loading: COST_MANIFEST.loading,
      actions: COST_MANIFEST.actions,
      provides: {},
      publishes: [],
      keeps: [],
    });
    assert.deepEqual(logs, []);
  });

  it('skips an app that ships no hub-app.json', () => {
    submodule();
    assert.equal(loadApp(COST, { hubRoot, resolve: noPackage, log }), null);
    assert.match(logs[0], /hub-app.json: not found\. cost is skipped/);
  });

  it("reads the app's version and where its plugin manifest is", () => {
    const plugin = { id: 'cost@cost', path: 'plugin/cost', install: 'claude-code-cost --install' };
    const root = submodule({ ...COST_MANIFEST, plugin });
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.3.0"}');
    const app = loadApp(COST, { hubRoot, resolve: noPackage, log });
    assert.equal(app.version, '1.3.0');
    assert.deepEqual(app.plugin, {
      id: 'cost@cost',
      manifest: path.join(root, 'plugin', 'cost', '.claude-plugin', 'plugin.json'),
      install: 'claude-code-cost --install',
    });
  });

  it('prefers a checked-out submodule and reads its manifest', () => {
    const root = submodule({ manifest: 1, id: 'cost', name: 'Spend', icon: 'coins', run: { entry: 'bin/start.js' } });
    const app = loadApp(COST, { hubRoot, resolve: noPackage, log });
    assert.equal(app.entry, path.join(root, 'bin', 'start.js'));
    assert.equal(app.name, 'Spend');
    assert.equal(app.port, 0);
    assert.deepEqual(app.loading, {});
  });

  describe('port', () => {
    const portOf = (port, flagPort) => {
      submodule(COST_MANIFEST);
      return loadApp({ ...COST, port }, { flagPort, hubRoot, resolve: noPackage, log }).port;
    };
    const defaultPort = COST_MANIFEST.run.defaultPort;

    it('takes the flag, then the config entry, then the manifest', () => {
      assert.equal(portOf(4643, '4743'), 4743);
      assert.equal(portOf(4643), 4643);
      assert.equal(portOf(undefined), defaultPort);
      assert.deepEqual(logs, []);
    });

    it('logs and skips a value that is not a port', () => {
      assert.equal(portOf('4643', 'abc'), defaultPort);
      assert.equal(logs.length, 2);
      assert.match(logs[0], /--cost-port is not a valid port/);
      assert.match(logs[1], /"port" of "cost" in config.json is not a valid port/);
    });
  });

  it('skips an app whose manifest is invalid', () => {
    submodule({ manifest: 1, id: 'other', run: { entry: 'server.js' } });
    assert.equal(loadApp(COST, { hubRoot, resolve: noPackage, log }), null);
    assert.match(logs[0], /is not "cost"\. cost is skipped/);
  });

  it('skips an app whose manifest is not JSON', () => {
    submodule('{ nope');
    assert.equal(loadApp(COST, { hubRoot, resolve: noPackage, log }), null);
    assert.match(logs[0], /cost is skipped/);
  });

  it('prefers the entry path over the submodule and the package', () => {
    submodule(COST_MANIFEST);
    const fork = makeApp(path.join(hubRoot, 'fork'), { ...COST_MANIFEST, name: 'Fork' });
    const app = loadApp({ ...COST, path: fork }, { hubRoot, resolve: noPackage, log });
    assert.equal(app.entry, path.join(fork, 'server.js'));
    assert.equal(app.name, 'Fork');
  });

  it('loads a new app from its path', () => {
    const root = makeApp(path.join(hubRoot, 'board'), { manifest: 1, id: 'board', run: { entry: 'server.js' } });
    const app = loadApp({ id: 'board', path: root }, { hubRoot, resolve: noPackage, log });
    assert.equal(app.entry, path.join(root, 'server.js'));
    assert.equal(app.name, 'board');
  });

  it('skips an app whose path has no manifest', () => {
    const root = makeApp(path.join(hubRoot, 'empty'));
    assert.equal(loadApp({ id: 'board', path: root }, { hubRoot, resolve: noPackage, log }), null);
    assert.match(logs[0], /not found\. board is skipped/);
  });

  it('throws when neither the submodule nor the package is there', () => {
    assert.throws(() => loadApp(COST, { hubRoot, resolve: noPackage, log }), /not installed/);
  });
});
