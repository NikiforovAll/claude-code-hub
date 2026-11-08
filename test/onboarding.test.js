const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findConfigDirs, pluginsToInstall, setupStatus } = require('../lib/onboarding');

describe('onboarding', () => {
  let home;
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };
  const real = (p) => fs.realpathSync.native(p);
  const plugin = { id: 'x@y', name: 'X', bundled: '1.0.0', install: 'x --install', args: ['--install'] };
  const install = (dir, version, enabled = true) => {
    write(path.join(dir, 'plugins', 'installed_plugins.json'), { plugins: { 'x@y': [{ scope: 'user', version }] } });
    write(path.join(dir, 'settings.json'), { enabledPlugins: { 'x@y': enabled } });
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-onboarding-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('finds .claude* dirs with settings or projects that the hub does not list', () => {
    write(path.join(home, '.claude', 'settings.json'), {});
    write(path.join(home, '.claude-work', 'projects', 'a', 'x.jsonl'), {});
    write(path.join(home, '.claude-cache', 'blob'), {});
    write(path.join(home, '.claude-hub', 'settings.json'), {});
    write(path.join(home, 'other', 'settings.json'), {});
    const found = findConfigDirs({ home, known: [path.join(home, '.claude')], hubDir: path.join(home, '.claude-hub') });
    assert.deepEqual(found, [real(path.join(home, '.claude-work'))]);
  });

  it('finds nothing when the home folder cannot be read', () => {
    assert.deepEqual(findConfigDirs({ home: path.join(home, 'none'), known: [], hubDir: home }), []);
  });

  it('installs only plugins that are missing or old, never a turned-off one', () => {
    const a = path.join(home, 'a');
    assert.deepEqual(pluginsToInstall(a, [plugin]), [plugin]);
    install(a, '0.9.0');
    assert.deepEqual(pluginsToInstall(a, [plugin]), [plugin]);
    install(a, '0.9.0', false);
    assert.deepEqual(pluginsToInstall(a, [plugin]), []);
    install(a, '1.0.0');
    assert.deepEqual(pluginsToInstall(a, [plugin]), []);
  });

  it('reports plugins done only when every dir is settled', () => {
    const a = path.join(home, 'a');
    const b = path.join(home, 'b');
    install(a, '1.0.0');
    const base = { tray: { supported: false }, configDirs: [a, b], activeConfigDir: a, candidates: [], plugins: [plugin] };
    const s = setupStatus(base);
    assert.equal(s.pluginsDone, false);
    assert.deepEqual(
      s.dirs.map((d) => [d.active, d.plugins[0].state, d.pending]),
      [
        [true, 'ok', false],
        [false, 'missing', true],
      ],
    );
    install(b, '1.0.0', false);
    assert.equal(setupStatus(base).pluginsDone, true);
  });
});
