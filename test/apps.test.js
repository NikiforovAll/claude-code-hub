const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { APPS, selectApps, loadApp, manifestError, resolvePlugin, conflicts } = require('../lib/apps');

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

  it('carries hidden and deferredStart only when the entry sets them to true', () => {
    const { apps } = selectApps([
      { id: 'cost', hidden: true, deferredStart: true },
      { id: 'memory', hidden: 'yes', deferredStart: 1 },
    ]);
    assert.deepEqual(
      apps.map((a) => [a.id, a.hidden, a.deferredStart]),
      [
        ['cost', true, true],
        ['memory', false, false],
        ['kanban', false, false],
        ['marketplace', false, false],
      ],
    );
  });

  it('adds an unknown id that has a path, resolved against the base', () => {
    const base = path.resolve('/hub');
    const { apps, unknown } = selectApps([{ id: 'kanban' }, { id: 'board', path: 'forks/board', port: 4545 }], base);
    assert.deepEqual(
      apps.map((a) => a.id),
      ['kanban', 'board', 'marketplace', 'cost', 'memory'],
    );
    assert.deepEqual(apps[1], {
      id: 'board',
      port: 4545,
      path: path.join(base, 'forks', 'board'),
      hidden: false,
      deferredStart: false,
      linked: false,
    });
    assert.deepEqual(unknown, []);
  });

  it('marks an entry with source "local" as linked', () => {
    const { apps } = selectApps([{ id: 'swarm', path: '/dev/swarm', source: 'local' }, { id: 'board', path: 'b', source: 'github:o/r' }]);
    assert.deepEqual(
      apps.slice(0, 2).map((a) => [a.id, a.linked]),
      [
        ['swarm', true],
        ['board', false],
      ],
    );
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
    assert.match(plugin.bundled, /^\d+\.\d+\.\d+/);
  });

  it('kanban keeps its session keys', () => {
    assert.deepEqual(loadApp(KANBAN, { log: () => {} }).keeps, ['ctrl+alt+n', 'ctrl+alt+r', 'ctrl+alt+s', 'ctrl+shift+k', 'ctrl+shift+p', 'ctrl+shift+z']);
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

  it('accepts a plugin named by marketplace and name, and rejects a bad one', () => {
    const err = (p) => manifestError({ ...ok, plugin: { marketplace: 'plugin', name: 'x', ...p } }, 'cost', root);
    assert.equal(err({}), null);
    assert.equal(err({ install: 'x --install' }), null);
    assert.match(manifestError({ ...ok, plugin: 'x' }, 'cost', root), /plugin is not an object/);
    assert.match(manifestError({ ...ok, plugin: { id: 'x@y', path: 'plugin/x', install: 'x' } }, 'cost', root), /plugin.marketplace/);
    assert.match(err({ marketplace: '../plugin' }), /plugin.marketplace is outside/);
    assert.match(err({ marketplace: 5 }), /plugin.marketplace is not a path/);
    assert.match(err({ name: 'a b' }), /plugin.name/);
    assert.match(err({ name: undefined }), /plugin.name/);
    assert.match(err({ install: '' }), /plugin.install is not a command/);
  });

  it('accepts minimum versions and app ids in requires, and rejects anything else', () => {
    const err = (requires) => manifestError({ ...ok, requires }, 'cost', root);
    assert.equal(err({ hub: '1.12.0', node: '22.13.0', apps: ['kanban'] }), null);
    assert.equal(err({}), null);
    assert.match(err([]), /requires is not an object/);
    assert.match(err({ hub: '1.12' }), /requires.hub is not a version/);
    assert.match(err({ node: ['22.13.0'] }), /requires.node is not a version/);
    assert.match(err({ apps: 'kanban' }), /requires.apps/);
    assert.match(err({ apps: ['Kanban'] }), /requires.apps/);
  });

  it('accepts a plain-text listing, and rejects markup, long text and bad fields', () => {
    const err = (listing) => manifestError({ ...ok, listing }, 'cost', root);
    const full = {
      tagline: 'One session, turn by turn',
      description: 'Shows each prompt and its tool calls.',
      tags: ['sessions', 'debugging'],
      screenshots: [
        { path: 'docs/shots/turns.png', alt: 'The turns' },
        { url: 'https://example.com/shot.webp', alt: 'A shot' },
      ],
      author: 'NikiforovAll',
      homepage: 'https://example.com/inspector/',
      license: 'MIT',
    };
    assert.equal(err(full), null);
    assert.equal(err({}), null);
    assert.match(err([]), /listing is not an object/);
    assert.match(err({ tagline: 'x'.repeat(81) }), /listing.tagline/);
    assert.match(err({ tagline: '' }), /listing.tagline/);
    assert.match(err({ description: '<b>bold</b>' }), /listing.description is not plain text/);
    assert.match(err({ author: 'x'.repeat(61) }), /listing.author/);
    assert.match(err({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), /listing.tags/);
    assert.match(err({ tags: ['Sessions'] }), /listing.tags/);
    assert.match(err({ screenshots: Array(5).fill(full.screenshots[0]) }), /up to 4/);
    assert.match(err({ screenshots: [{ path: 'a.png' }] }), /no alt/);
    assert.match(err({ screenshots: [{ alt: 'x' }] }), /one of path or url/);
    assert.match(err({ screenshots: [{ path: 'a.png', url: 'https://x/a.png', alt: 'x' }] }), /one of path or url/);
    assert.match(err({ screenshots: [{ path: 'a.gif', alt: 'x' }] }), /PNG, JPEG or WebP/);
    assert.match(err({ screenshots: [{ path: '../a.png', alt: 'x' }] }), /outside the app directory/);
    assert.match(err({ screenshots: [{ url: 'http://x/a.png', alt: 'x' }] }), /not https/);
    assert.match(err({ homepage: 'javascript:alert(1)' }), /listing.homepage/);
    assert.match(err({ license: 'MIT License' }), /SPDX/);
  });
});

describe('resolvePlugin', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-plugin-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const market = (json) => {
    fs.mkdirSync(path.join(root, 'plugin', '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugin', '.claude-plugin', 'marketplace.json'), JSON.stringify(json));
  };

  it('derives the id and folder from marketplace.json, and the hub install command from the app id', () => {
    market({ name: 'claude-code-swarm', plugins: [{ name: 'kanban-delm-swarm', source: './plugins/kanban-delm-swarm' }] });
    assert.deepEqual(resolvePlugin({ marketplace: 'plugin', name: 'kanban-delm-swarm' }, root, 'swarm'), {
      id: 'kanban-delm-swarm@claude-code-swarm',
      dir: path.join(root, 'plugin', 'plugins', 'kanban-delm-swarm'),
      bundled: null,
      marketplace: { dir: path.join(root, 'plugin'), name: 'claude-code-swarm' },
      install: 'claude-code-hub ext install swarm',
      custom: null,
    });
    const own = resolvePlugin({ marketplace: 'plugin', name: 'kanban-delm-swarm', install: 'swarm --install' }, root, 'swarm');
    assert.equal(own.install, 'claude-code-hub ext install swarm');
    assert.equal(own.custom, 'swarm --install');
  });

  it('throws when marketplace.json is missing, does not list the plugin or points outside the root', () => {
    const resolve = () => resolvePlugin({ marketplace: 'plugin', name: 'x' }, root, 'cost');
    assert.throws(resolve, /marketplace.json: not found/);
    market({ name: 'm', plugins: [{ name: 'y', source: './plugins/y' }] });
    assert.throws(resolve, /does not list plugin "x"/);
    market({ name: 'm', plugins: [{ name: 'x', source: { source: 'github', repo: 'o/r' } }] });
    assert.throws(resolve, /is not a folder/);
    market({ name: 'm', plugins: [{ name: 'x', source: '../../elsewhere' }] });
    assert.throws(resolve, /outside the app directory/);
    market({ plugins: [] });
    assert.throws(resolve, /name is not a marketplace name/);
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
      hidden: false,
      deferredStart: false,
      linked: false,
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

  it("reads the app's version and the plugin that marketplace.json lists, and skips the app when it lists none", () => {
    const root = submodule({ ...COST_MANIFEST, plugin: { marketplace: 'plugin', name: 'cost' } });
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.3.0"}');
    assert.equal(loadApp(COST, { hubRoot, resolve: noPackage, log }), null);
    assert.match(logs[0], /marketplace.json: not found\. cost is skipped/);
    fs.mkdirSync(path.join(root, 'plugin', '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugin', 'plugins', 'cost', '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugin', 'plugins', 'cost', '.claude-plugin', 'plugin.json'), '{"version":"0.5.0"}');
    const marketFile = path.join(root, 'plugin', '.claude-plugin', 'marketplace.json');
    fs.writeFileSync(marketFile, JSON.stringify({ name: 'cost-market', plugins: [{ name: 'cost', source: './plugins/cost' }] }));
    const app = loadApp(COST, { hubRoot, resolve: noPackage, log });
    assert.equal(app.version, '1.3.0');
    assert.deepEqual(app.plugin, { id: 'cost@cost-market', bundled: '0.5.0', install: 'claude-code-hub ext install cost' });
    fs.writeFileSync(marketFile, JSON.stringify({ name: 'cost-market', plugins: [] }));
    assert.equal(loadApp(COST, { hubRoot, resolve: noPackage, log }), null);
    assert.match(logs[1], /does not list plugin "cost"\. cost is skipped/);
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
