const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runExt, installBuiltInPlugins } = require('../lib/ext');

const tmp = (prefix) => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};

describe('ext', () => {
  let root;
  let hubDir;
  let configDir;
  let commands;
  let results;
  let marketplaces;
  let out;

  const exec = (cmd) => {
    commands.push(cmd);
    if (cmd === 'claude plugin marketplace list --json') return { ok: true, output: JSON.stringify(marketplaces) };
    return results[cmd] ?? { ok: true, idempotent: false, output: '' };
  };
  const ext = (...argv) => runExt(argv, { hubDir, configDir: () => configDir, hubVersion: '1.11.0', nodeVersion: '22.13.0', exec });
  const configFile = () => path.join(hubDir, 'config.json');
  const config = () => JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  const manifest = (fields) => writeJson(path.join(root, 'hub-app.json'), { manifest: 1, id: 'probe', run: { entry: 'server.js' }, ...fields });
  const marketDir = () => path.join(root, 'plugin');
  const PLUGIN = { marketplace: 'plugin', name: 'probe' };
  const rawConfig = () => (fs.existsSync(configFile()) ? fs.readFileSync(configFile(), 'utf8') : null);
  const registerCmds = () => [`claude plugin marketplace add "${marketDir()}"`, 'claude plugin marketplace update probe-market'];
  const installCmds = () => [
    'claude --version',
    'claude plugin marketplace list --json',
    ...registerCmds(),
    'claude plugin install probe@probe-market',
  ];

  beforeEach(() => {
    root = tmp('hub-ext-src-');
    hubDir = tmp('hub-ext-hub-');
    configDir = tmp('hub-ext-cfg-');
    commands = [];
    results = {};
    marketplaces = [];
    out = [];
    const capture = (...args) => out.push(args.join(' '));
    mock.method(console, 'log', capture);
    mock.method(console, 'error', capture);
    manifest({ plugin: PLUGIN });
    writeJson(path.join(marketDir(), '.claude-plugin', 'marketplace.json'), {
      name: 'probe-market',
      plugins: [{ name: 'probe', source: './plugins/probe' }],
    });
    writeJson(path.join(marketDir(), 'plugins', 'probe', '.claude-plugin', 'plugin.json'), { name: 'probe', version: '0.1.0' });
  });

  afterEach(() => {
    mock.restoreAll();
    for (const dir of [root, hubDir, configDir]) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('links a folder: installs its plugin from there and writes an entry that points at it, with no copy', () => {
    writeJson(configFile(), { configDirs: ['C:/cfg'], keys: { 'hub.palette': null } });
    assert.equal(ext('install', root), true);
    assert.deepEqual(commands, installCmds());
    assert.deepEqual(config(), {
      configDirs: ['C:/cfg'],
      keys: { 'hub.palette': null },
      apps: [{ id: 'probe', path: root.replaceAll('\\', '/'), source: 'local', deferredStart: true }],
    });
    assert.deepEqual(fs.readdirSync(hubDir), ['config.json']);
    assert.match(out.join('\n'), /Restart the hub/);
  });

  it('links an extension with no plugin without calling claude', () => {
    manifest({});
    assert.equal(ext('install', root), true);
    assert.deepEqual(commands, []);
    assert.equal(config().apps[0].id, 'probe');
  });

  it('accepts a marketplace already registered from the same folder', () => {
    marketplaces = [{ name: 'probe-market', source: 'directory', path: marketDir() }];
    assert.equal(ext('install', root), true);
  });

  for (const [what, setup, reason] of [
    ['a manifest that is not valid', () => manifest({ run: {} }), /hub-app.json: run.entry is missing/],
    ['a built-in id', () => manifest({ id: 'kanban' }), /it is the id of a built-in app/],
    ['an id that has an entry', () => writeJson(configFile(), { apps: [{ id: 'probe', path: 'x' }] }), /already has an entry for it/],
    ['a newer hub', () => manifest({ requires: { hub: '99.0.0' } }), /it needs hub 99\.0\.0, this hub is 1\.11\.0/],
    ['a newer Node', () => manifest({ requires: { node: '99.0.0' } }), /it needs Node 99\.0\.0/],
    [
      'an app that is off',
      () => {
        manifest({ requires: { apps: ['kanban', 'cost'] } });
        writeJson(configFile(), { apps: [{ id: 'kanban', enabled: false }] });
      },
      /it needs kanban enabled in the hub/,
    ],
    ['a plugin marketplace.json does not list', () => manifest({ plugin: { marketplace: 'plugin', name: 'other' } }), /does not list plugin "other"/],
  ]) {
    it(`refuses ${what} before it calls claude or writes the config`, () => {
      setup();
      const before = rawConfig();
      assert.equal(ext('install', root), false);
      assert.match(out.join('\n'), reason);
      assert.deepEqual(commands, []);
      assert.equal(rawConfig(), before);
    });
  }

  it('refuses a marketplace name registered from another folder', () => {
    marketplaces = [{ name: 'probe-market', source: 'directory', path: path.join(os.tmpdir(), 'elsewhere') }];
    assert.equal(ext('install', root), false);
    assert.match(out.join('\n'), /marketplace "probe-market" is registered from .*elsewhere\. Remove it with: claude plugin marketplace remove probe-market/);
    assert.deepEqual(commands, ['claude --version', 'claude plugin marketplace list --json']);
    assert.equal(fs.existsSync(configFile()), false);
  });

  it('writes no entry when the plugin install fails', () => {
    results['claude plugin install probe@probe-market'] = { ok: false, error: 'boom' };
    assert.equal(ext('install', root), false);
    assert.match(out.join('\n'), /boom[\s\S]*probe is not added/);
    assert.equal(fs.existsSync(configFile()), false);
  });

  it('refuses a GitHub source for now', () => {
    assert.equal(ext('install', 'github:o/r'), false);
    assert.match(out.join('\n'), /not built yet.*ext install <dir>/);
  });

  it('updates a linked extension by installing its plugin again', () => {
    ext('install', root);
    commands = [];
    assert.equal(ext('update', 'probe'), true);
    assert.deepEqual(commands, [
      'claude --version',
      ...registerCmds(),
      'claude plugin uninstall probe@probe-market',
      'claude plugin install probe@probe-market',
    ]);
  });

  it("runs the manifest's own install command to install and update, and the plugin commands to remove", () => {
    manifest({ plugin: { ...PLUGIN, install: 'probe --install' } });
    assert.equal(ext('install', root), true);
    assert.equal(ext('update', 'probe'), true);
    assert.equal(ext('remove', 'probe'), true);
    assert.deepEqual(commands, [
      'claude --version',
      'probe --install',
      'claude --version',
      'probe --install',
      'claude --version',
      'claude plugin uninstall probe@probe-market',
      'claude plugin marketplace remove probe-market',
    ]);
  });

  it("runs the app's own bin through node, because the bin is not on PATH when the app comes with the hub", () => {
    manifest({ plugin: { ...PLUGIN, install: 'probe --install --yes' } });
    writeJson(path.join(root, 'package.json'), { name: 'probe', bin: { probe: 'cli.js' } });
    assert.equal(ext('install', root), true);
    assert.equal(commands.at(-1), `"${process.execPath}" "${path.join(root, 'cli.js')}" --install --yes`);
  });

  it('installs the plugin of a built-in app, here a fork of kanban', () => {
    manifest({ id: 'kanban', plugin: PLUGIN });
    writeJson(configFile(), { apps: [{ id: 'kanban', path: root }] });
    assert.equal(ext('install', 'kanban'), true);
    assert.deepEqual(commands, installCmds());
  });

  it('--install installs the plugins of the enabled built-in apps and not of extensions', () => {
    manifest({ id: 'kanban', plugin: PLUGIN });
    const swarm = tmp('hub-ext-swarm-');
    writeJson(path.join(swarm, 'hub-app.json'), { manifest: 1, id: 'swarm', run: { entry: 'server.js' }, plugin: PLUGIN });
    writeJson(configFile(), { apps: [{ id: 'kanban', path: root }, { id: 'swarm', path: swarm, source: 'local' }] });
    assert.equal(installBuiltInPlugins({ hubDir, configDir: () => configDir, exec }), true);
    assert.deepEqual(commands, installCmds());
    fs.rmSync(swarm, { recursive: true, force: true });
  });

  it('removes the plugin and the entry of a linked extension and keeps its folder', () => {
    writeJson(configFile(), { apps: [{ id: 'cost', enabled: false }] });
    ext('install', root);
    commands = [];
    assert.equal(ext('remove', 'probe'), true);
    assert.deepEqual(commands, [
      'claude --version',
      'claude plugin uninstall probe@probe-market',
      'claude plugin marketplace remove probe-market',
    ]);
    assert.deepEqual(config().apps, [{ id: 'cost', enabled: false }]);
    assert.ok(fs.existsSync(path.join(root, 'hub-app.json')));
  });

  it('installs only the plugin of an extension the hub has, by id or by its folder', () => {
    ext('install', root);
    const entries = config().apps;
    for (const target of ['probe', root]) {
      commands = [];
      assert.equal(ext('install', target), true);
      assert.deepEqual(commands, installCmds());
    }
    assert.deepEqual(config().apps, entries);
  });

  it('refuses update and remove for an id that ext did not add, and install for an unknown id', () => {
    writeJson(configFile(), { apps: [{ id: 'board', path: 'forks/board' }] });
    for (const cmd of ['update', 'remove']) assert.equal(ext(cmd, 'board'), false);
    assert.match(out.join('\n'), /"board" is not an extension/);
    assert.equal(ext('install', 'nope'), false);
    assert.match(out.join('\n'), /"nope" is not an app the hub runs, and no folder has that name/);
    assert.deepEqual(commands, []);
  });

  it('lists a linked extension as local with its path and plugin state', () => {
    ext('install', root);
    out = [];
    assert.equal(ext('list'), true);
    assert.deepEqual(out, [`  probe  local ${root.replaceAll('\\', '/')}  probe@probe-market missing`]);
  });

  it('prints the usage for an unknown command or option', () => {
    assert.equal(ext('nope'), false);
    assert.match(out.join('\n'), /Usage: claude-code-hub ext/);
    assert.equal(ext('install', root, '--yes'), false);
    assert.match(out.join('\n'), /Unknown option '--yes'/);
  });
});
