const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { APPS, selectApps, loadApp, manifestError } = require('../lib/apps');

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
      entry: path.join(pkgRoot, 'server.js'),
      port: 3543,
      name: 'Cost',
      icon: 'coins',
      loading: COST_MANIFEST.loading,
      actions: COST_MANIFEST.actions,
      provides: {},
    });
    assert.deepEqual(logs, []);
  });

  it('skips an app that ships no hub-app.json', () => {
    submodule();
    assert.equal(loadApp(COST, { hubRoot, resolve: noPackage, log }), null);
    assert.match(logs[0], /hub-app.json: not found\. cost is skipped/);
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

  it('throws when neither the submodule nor the package is there', () => {
    assert.throws(() => loadApp(COST, { hubRoot, resolve: noPackage, log }), /not installed/);
  });
});
