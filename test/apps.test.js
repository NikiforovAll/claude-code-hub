const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { APPS, selectApps, loadApp, manifestError, builtInManifest } = require('../lib/apps');

const COST = APPS.find((a) => a.id === 'cost');

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

describe('built-in manifests', () => {
  for (const app of APPS) {
    it(`${app.id} is valid`, () => {
      assert.equal(manifestError(builtInManifest(app.id), app.id, '/root'), null);
    });
  }
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

  it('uses the built-in manifest when the package ships none', () => {
    const pkgRoot = makeApp(path.join(hubRoot, 'pkg'));
    const app = loadApp(COST, { hubRoot, resolve: () => path.join(pkgRoot, 'package.json'), log });
    const m = builtInManifest('cost');
    assert.deepEqual(app, {
      id: 'cost',
      entry: path.join(pkgRoot, 'server.js'),
      port: m.run.defaultPort,
      name: m.name,
      icon: m.icon,
      loading: m.loading,
      actions: m.actions,
    });
    assert.deepEqual(logs, []);
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
      submodule();
      return loadApp({ ...COST, port }, { flagPort, hubRoot, resolve: noPackage, log }).port;
    };
    const defaultPort = builtInManifest('cost').run.defaultPort;

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

  it('falls back to the built-in manifest when the file is invalid', () => {
    submodule({ manifest: 1, id: 'other', run: { entry: 'server.js' } });
    assert.equal(loadApp(COST, { hubRoot, resolve: noPackage, log }).name, 'Cost');
    assert.match(logs[0], /is not "cost"\. Using the built-in manifest/);
  });

  it('falls back to the built-in manifest when the file is not JSON', () => {
    submodule('{ nope');
    assert.equal(loadApp(COST, { hubRoot, resolve: noPackage, log }).name, 'Cost');
    assert.match(logs[0], /Using the built-in manifest/);
  });

  it('throws when neither the submodule nor the package is there', () => {
    assert.throws(() => loadApp(COST, { hubRoot, resolve: noPackage, log }), /not installed/);
  });
});
