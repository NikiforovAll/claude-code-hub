const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
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
  const registry = () => path.join(configDir, 'registry.json');
  const ctx = (more) => ({ hubDir, configDir: () => configDir, hubVersion: '1.11.0', nodeVersion: '22.13.0', exec, registry: registry(), ...more });
  const ext = (...argv) => runExt(argv, ctx());
  const configFile = () => path.join(hubDir, 'config.json');
  const config = () => JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  const manifest = (fields) => writeJson(path.join(root, 'hub-app.json'), { manifest: 1, id: 'probe', run: { entry: 'server.js' }, ...fields });
  const marketDir = (dir = root) => path.join(dir, 'plugin');
  const PLUGIN = { marketplace: 'plugin', name: 'probe' };
  const rawConfig = () => (fs.existsSync(configFile()) ? fs.readFileSync(configFile(), 'utf8') : null);
  const registerCmds = (dir) => [`claude plugin marketplace add "${marketDir(dir)}"`, 'claude plugin marketplace update probe-market'];
  const installCmds = (dir) => [
    'claude --version',
    'claude plugin marketplace list --json',
    ...registerCmds(dir),
    'claude plugin install probe@probe-market',
  ];
  const kanbanDir = () => path.join(configDir, 'kanban');
  const addonManifest = (fields) => {
    fs.rmSync(path.join(root, 'hub-app.json'), { force: true });
    writeJson(path.join(root, 'addon.json'), { manifest: 1, kind: 'addon', id: 'probe', url: 'http://localhost:4117/?cwd={cwd}', run: 'node server.js', requires: { apps: ['kanban'] }, ...fields });
    writeJson(path.join(kanbanDir(), 'package.json'), { name: 'claude-code-kanban', bin: { 'claude-code-kanban': 'server.js' } });
    writeJson(configFile(), { apps: [{ id: 'kanban', path: kanbanDir() }] });
  };
  const kanbanCmd = (args) => `"${process.execPath}" "${path.join(kanbanDir(), 'server.js')}" ${args}`;
  const dockAdd = (dir = root) => kanbanCmd(`addon add --manifest "${dir}" --offline`);
  const dockRm = () => kanbanCmd('addon rm --key probe --offline');

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

  describe('feature', () => {
    const feature = (more) => runExt(['install', 'voice'], ctx({ platform: 'win32', toolChecks: { 'voice.hex': () => true }, ...more }));

    it('turns voice on, keeps the other keys, and turns it off again', () => {
      writeJson(configFile(), { apps: [{ id: 'kanban' }], voice: { autoSubmit: false } });
      assert.equal(feature(), true);
      assert.deepEqual(config().voice, { autoSubmit: false, enabled: true });
      assert.equal(ext('remove', 'voice'), true);
      assert.deepEqual(config().voice, { autoSubmit: false, enabled: false });
      assert.deepEqual(config().apps, [{ id: 'kanban' }]);
      assert.deepEqual(commands, []);
    });

    it('turns voice on without Hex, on any OS, and says what that means', () => {
      writeJson(configFile(), { apps: [{ id: 'kanban' }] });
      assert.equal(feature({ platform: 'linux', toolChecks: { 'voice.hex': () => false } }), true);
      assert.match(out.join('\n'), /Hex \(https:\/\/anoma\.ly\/hex\) is not installed\. Voice uses the browser's speech recognition/);
      assert.equal(config().voice.enabled, true);
    });

    it('refuses when a required tool is missing or Kanban is off, and writes nothing', () => {
      writeJson(configFile(), { apps: [{ id: 'kanban' }] });
      const features = path.join(root, 'features');
      const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'features', 'voice', 'feature.json'), 'utf8'));
      const tools = [{ name: 'Probe', check: 'probe', url: 'https://example.test' }];
      fs.mkdirSync(path.join(features, 'voice'), { recursive: true });
      writeJson(path.join(features, 'voice', 'feature.json'), { ...real, requires: { ...real.requires, os: ['win32'], tools } });
      assert.equal(feature({ features, toolChecks: { probe: () => false } }), false);
      assert.match(out.join('\n'), /install Probe \(https:\/\/example\.test\) first/);
      assert.equal(feature({ features, platform: 'linux', toolChecks: { probe: () => true } }), false);
      assert.match(out.join('\n'), /runs on Windows only/);
      writeJson(configFile(), { apps: [{ id: 'kanban', enabled: false }] });
      assert.equal(feature(), false);
      assert.match(out.join('\n'), /needs kanban enabled/);
      assert.equal(config().voice, undefined);
    });
  });

  it('links a folder: installs its plugin from there and writes an entry that points at it, with no copy', () => {
    writeJson(configFile(), { configDirs: ['C:/cfg'], keys: { 'hub.palette': null } });
    assert.equal(ext('install', root), true);
    assert.deepEqual(commands, installCmds());
    assert.deepEqual(config(), {
      configDirs: ['C:/cfg'],
      keys: { 'hub.palette': null },
      apps: [{ id: 'probe', path: root.replaceAll('\\', '/'), source: 'local' }],
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

  it('refuses an npm or URL source', () => {
    for (const target of ['npm:probe', 'https://github.com/o/r']) assert.equal(ext('install', target), false);
    assert.match(out.join('\n'), /Only a registry name, a github: source or a local folder installs/);
    assert.deepEqual(commands, []);
  });

  describe('from GitHub', () => {
    let remote;
    let repo;
    const gitIn = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
    const commit = (message) => {
      fs.cpSync(root, path.join(repo, 'ext'), { recursive: true });
      gitIn(repo, 'add', '-A');
      gitIn(repo, 'commit', '--quiet', '-m', message);
      return gitIn(repo, 'rev-parse', 'HEAD');
    };
    const extensions = () => path.join(hubDir, 'extensions');
    const clone = () => path.join(extensions(), 'probe');
    const extRoot = () => path.join(clone(), 'ext');
    const gh = (...argv) => runExt(argv, ctx({ githubBase: remote }));

    beforeEach(() => {
      remote = tmp('hub-ext-gh-');
      repo = path.join(remote, 'o', 'r');
      fs.mkdirSync(repo, { recursive: true });
      gitIn(repo, 'init', '--quiet', '-b', 'main');
      writeJson(path.join(repo, 'other', 'big.json'), {});
    });

    afterEach(() => fs.rmSync(remote, { recursive: true, force: true }));

    it('clones only the folder into the hub dir and writes an entry with a path relative to it', () => {
      const sha = commit('one');
      assert.equal(gh('install', 'github:o/r/ext'), true);
      assert.deepEqual(commands, installCmds(extRoot()));
      assert.deepEqual(config().apps, [{ id: 'probe', path: 'extensions/probe/ext', source: 'github:o/r/ext', sha }]);
      assert.ok(fs.existsSync(path.join(extRoot(), 'hub-app.json')));
      assert.equal(fs.existsSync(path.join(clone(), 'other')), false);
      assert.deepEqual(fs.readdirSync(extensions()), ['probe']);
      assert.match(out.join('\n'), new RegExp(`Installed probe from github:o/r/ext at ${sha.slice(0, 7)}`));
    });

    it('pins a commit, and update keeps it there', () => {
      const first = commit('one');
      manifest({ plugin: PLUGIN, name: 'Two' });
      commit('two');
      assert.equal(gh('install', `github:o/r/ext@${first}`), true);
      assert.deepEqual(config().apps[0], { id: 'probe', path: 'extensions/probe/ext', source: 'github:o/r/ext', ref: first, sha: first });
      assert.equal(JSON.parse(fs.readFileSync(path.join(extRoot(), 'hub-app.json'), 'utf8')).name, undefined);
      assert.equal(gh('update', 'probe'), true);
      assert.equal(config().apps[0].sha, first);
    });

    it('follows a branch', () => {
      commit('one');
      gitIn(repo, 'checkout', '--quiet', '-b', 'dev');
      manifest({ plugin: PLUGIN, name: 'Dev' });
      const dev = commit('dev');
      assert.equal(gh('install', 'github:o/r/ext@dev'), true);
      assert.deepEqual(config().apps[0], { id: 'probe', path: 'extensions/probe/ext', source: 'github:o/r/ext', ref: 'dev', sha: dev });
    });

    it('updates to the latest commit and installs the plugin again', () => {
      commit('one');
      gh('install', 'github:o/r/ext');
      manifest({ plugin: PLUGIN, name: 'Two' });
      const two = commit('two');
      commands = [];
      assert.equal(gh('update', 'probe'), true);
      assert.equal(config().apps[0].sha, two);
      assert.equal(JSON.parse(fs.readFileSync(path.join(extRoot(), 'hub-app.json'), 'utf8')).name, 'Two');
      assert.deepEqual(commands, ['claude --version', ...registerCmds(extRoot()), 'claude plugin uninstall probe@probe-market', 'claude plugin install probe@probe-market']);
    });

    it('goes back to the installed commit when the new code needs a newer hub', () => {
      const one = commit('one');
      gh('install', 'github:o/r/ext');
      manifest({ plugin: PLUGIN, requires: { hub: '99.0.0' } });
      commit('two');
      commands = [];
      assert.equal(gh('update', 'probe'), false);
      assert.match(out.join('\n'), /it needs hub 99\.0\.0/);
      assert.equal(config().apps[0].sha, one);
      assert.equal(gitIn(clone(), 'rev-parse', 'HEAD'), one);
      assert.deepEqual(commands, []);
    });

    it('removes the plugin, the entry and the clone', () => {
      commit('one');
      gh('install', 'github:o/r/ext');
      assert.equal(gh('remove', 'probe'), true);
      assert.deepEqual(config().apps, []);
      assert.equal(fs.existsSync(clone()), false);
      assert.match(out.join('\n'), /Removed probe and its clone/);
    });

    it('installs only the plugin when the hub has the extension from the same source', () => {
      const sha = commit('one');
      gh('install', 'github:o/r/ext');
      const entries = config().apps;
      commands = [];
      assert.equal(gh('install', 'github:o/r/ext'), true);
      assert.deepEqual(commands, installCmds(extRoot()));
      assert.deepEqual(config().apps, entries);
      assert.deepEqual(fs.readdirSync(extensions()), ['probe']);
      assert.match(out.join('\n'), new RegExp(`already in the hub, at ${sha.slice(0, 7)}`));
    });

    it('installs npm dependencies with install scripts off before the plugin', () => {
      writeJson(path.join(root, 'package.json'), { name: 'probe', dependencies: { express: '^4.0.0' } });
      commit('one');
      assert.equal(gh('install', 'github:o/r/ext'), true);
      assert.equal(commands[0], `npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefix "${extRoot()}"`);
    });

    it('deletes the clone and writes no entry when the plugin install fails', () => {
      commit('one');
      results['claude plugin install probe@probe-market'] = { ok: false, error: 'boom' };
      assert.equal(gh('install', 'github:o/r/ext'), false);
      assert.equal(fs.existsSync(configFile()), false);
      assert.deepEqual(fs.readdirSync(extensions()), []);
    });

    for (const [target, reason] of [
      ['github:o', /not a GitHub source/],
      ['github:o/nope', /git clone failed/],
      ['github:o/r/ext@nope', /nope is not a branch or a commit/],
      ['github:o/r/missing', /hub-app\.json/],
    ]) {
      it(`refuses ${target} and leaves no clone`, () => {
        commit('one');
        assert.equal(gh('install', target), false);
        assert.match(out.join('\n'), reason);
        assert.deepEqual(commands, []);
        assert.equal(fs.existsSync(configFile()), false);
        assert.deepEqual(fs.existsSync(extensions()) ? fs.readdirSync(extensions()) : [], []);
      });
    }

    it('installs a Kanban add-on by its registry name into the hub dir, and removes it with its clone', () => {
      addonManifest();
      const sha = commit('one');
      writeJson(registry(), { extensions: [{ id: 'probe', kind: 'addon', source: 'github:o/r/ext', sha, pinned: false }] });
      assert.equal(gh('install', 'probe'), true);
      assert.deepEqual(commands, [dockAdd(extRoot())]);
      assert.deepEqual(config().addons, [{ id: 'probe', path: 'extensions/probe/ext', source: 'github:o/r/ext', sha }]);
      assert.equal(gh('remove', 'probe'), true);
      assert.deepEqual(commands, [dockAdd(extRoot()), dockRm()]);
      assert.deepEqual(config().addons, []);
      assert.equal(fs.existsSync(clone()), false);
    });

    describe('by a registry name', () => {
      const listing = (...extensions) => writeJson(registry(), { extensions });

      it('installs the source the registry lists and keeps that source in the entry', () => {
        const sha = commit('one');
        listing({ id: 'other', source: 'github:o/nope', pinned: false }, { id: 'probe', source: 'github:o/r/ext', sha, pinned: false });
        assert.equal(gh('install', 'probe'), true);
        assert.deepEqual(commands, installCmds(extRoot()));
        assert.deepEqual(config().apps, [{ id: 'probe', path: 'extensions/probe/ext', source: 'github:o/r/ext', sha }]);
        assert.match(out.join('\n'), /probe: github:o\/r\/ext, from the registry/);
      });

      it('installs a pinned entry at its commit', () => {
        const first = commit('one');
        manifest({ plugin: PLUGIN, name: 'Two' });
        commit('two');
        listing({ id: 'probe', source: 'github:o/r/ext', sha: first, pinned: true });
        assert.equal(gh('install', 'probe'), true);
        assert.deepEqual(config().apps[0], { id: 'probe', path: 'extensions/probe/ext', source: 'github:o/r/ext', ref: first, sha: first });
      });

      it('installs a folder of that name, not the registry entry', () => {
        commit('one');
        listing({ id: 'probe', source: 'github:o/r/ext', pinned: false });
        fs.cpSync(root, path.join(remote, 'probe'), { recursive: true });
        const cwd = process.cwd();
        process.chdir(remote);
        try {
          assert.equal(gh('install', 'probe'), true);
        } finally {
          process.chdir(cwd);
        }
        assert.deepEqual(config().apps, [{ id: 'probe', path: path.join(remote, 'probe').replaceAll('\\', '/'), source: 'local' }]);
      });

      for (const [why, list, reason] of [
        ['a name the registry does not list', [], /"probe" is not an app the hub runs, a folder, or an extension in the registry/],
        ['an entry whose manifest has another id', [{ id: 'other', source: 'github:o/r/ext', pinned: false }], /lists other at github:o\/r\/ext, but its hub-app\.json has the id probe/],
        ['an entry that is not a GitHub source', [{ id: 'probe', source: 'https://example.com/x', pinned: false }], /not a GitHub source/],
      ]) {
        it(`refuses ${why} and leaves no clone`, () => {
          commit('one');
          listing(...list);
          const name = list[0]?.id ?? 'probe';
          assert.equal(gh('install', name), false);
          assert.match(out.join('\n'), reason);
          assert.equal(fs.existsSync(configFile()), false);
          assert.deepEqual(fs.existsSync(extensions()) ? fs.readdirSync(extensions()) : [], []);
        });
      }

      it('names the registry when it cannot read it', () => {
        assert.equal(gh('install', 'probe'), false);
        assert.match(out.join('\n'), /Cannot read the registry .*registry\.json/);
        fs.writeFileSync(registry(), '{"items":[]}');
        assert.equal(gh('install', 'probe'), false);
        assert.match(out.join('\n'), /has no extensions list/);
      });
    });
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
    writeJson(registry(), { extensions: [] });
    assert.equal(ext('install', 'nope'), false);
    assert.match(out.join('\n'), /"nope" is not an app the hub runs, a folder, or an extension in the registry/);
    assert.equal(ext('install', 'No/Such'), false);
    assert.match(out.join('\n'), /"No\/Such" is not an app the hub runs, and no folder has that name/);
    assert.deepEqual(commands, []);
  });

  it('lists a linked extension as local with its path and plugin state', () => {
    ext('install', root);
    out = [];
    assert.equal(ext('list'), true);
    assert.deepEqual(out, [`  probe  local ${root.replaceAll('\\', '/')}  probe@probe-market missing`]);
  });

  describe('a Kanban dock add-on', () => {
    beforeEach(() => addonManifest());

    it('links a folder: puts it on the dock of the config dir and keeps it in addons, not apps', () => {
      assert.equal(ext('install', root), true);
      assert.deepEqual(commands, [dockAdd()]);
      assert.deepEqual(config(), {
        apps: [{ id: 'kanban', path: kanbanDir() }],
        addons: [{ id: 'probe', path: root.replaceAll('\\', '/'), source: 'local' }],
      });
      assert.match(out.join('\n'), /on the Kanban dock of every session/);
    });

    it('puts an installed add-on on the dock again by its id or folder, updates, lists and removes it', () => {
      ext('install', root);
      for (const target of ['probe', root]) assert.equal(ext('install', target), true);
      assert.equal(ext('update', 'probe'), true);
      assert.match(out.join('\n'), /Ctrl\+R on its row/);
      out = [];
      assert.equal(ext('list'), true);
      assert.deepEqual(out, [`  probe  local ${root.replaceAll('\\', '/')}  dock add-on`]);
      assert.equal(ext('remove', 'probe'), true);
      assert.deepEqual(commands, [dockAdd(), dockAdd(), dockAdd(), dockAdd(), dockRm()]);
      assert.match(out.at(-1), /off the Kanban dock/);
      assert.deepEqual(config().addons, []);
      assert.ok(fs.existsSync(path.join(root, 'addon.json')));
    });

    it('writes no entry when the dock step fails, and refuses with Kanban off', () => {
      results[dockAdd()] = { ok: false, error: 'boom' };
      assert.equal(ext('install', root), false);
      assert.match(out.join('\n'), /boom[\s\S]*Putting it on the dock failed, so probe is not added/);
      assert.equal(config().addons, undefined);
      writeJson(configFile(), { apps: [{ id: 'kanban', enabled: false }] });
      assert.equal(ext('install', root), false);
      assert.match(out.join('\n'), /it needs kanban enabled in the hub/);
    });

    it('refuses an id an app has, and a manifest with a bad id', () => {
      writeJson(configFile(), { apps: [{ id: 'kanban', path: kanbanDir() }, { id: 'probe', path: 'x' }] });
      assert.equal(ext('install', root), false);
      assert.match(out.join('\n'), /already has an entry for it/);
      addonManifest({ id: 'Probe_1' });
      assert.equal(ext('install', root), false);
      assert.match(out.join('\n'), /addon\.json: an add-on manifest needs "kind": "addon" and an id/);
      assert.deepEqual(commands, []);
    });
  });

  it('prints the usage for an unknown command or option', () => {
    assert.equal(ext('nope'), false);
    assert.match(out.join('\n'), /Usage: claude-code-hub ext/);
    assert.equal(ext('install', root, '--yes'), false);
    assert.match(out.join('\n'), /Unknown option '--yes'/);
  });
});
