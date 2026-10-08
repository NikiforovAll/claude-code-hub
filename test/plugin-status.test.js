const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pluginStatus } = require('../lib/plugin-status');

describe('pluginStatus', () => {
  let dir;
  let plugin;
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };
  const install = (...entries) =>
    write(path.join(dir, 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'x@y': entries } });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-plugin-'));
    plugin = { id: 'x@y', manifest: path.join(dir, 'shipped', 'plugin.json'), install: 'x --install' };
    write(plugin.manifest, { version: '1.0.0' });
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('is missing when the config dir has no install of it', () => {
    const s = pluginStatus(dir, plugin);
    assert.equal(s.state, 'missing');
    assert.equal(s.installed, null);
    assert.equal(s.installCommand, `x --install --dir "${dir}"`);
  });

  it('is ok when the user-scope install is the shipped version', () => {
    install({ scope: 'project', version: '0.1.0' }, { scope: 'user', version: '1.0.0' });
    assert.deepEqual(pluginStatus(dir, plugin), {
      id: 'x@y',
      bundled: '1.0.0',
      installed: '1.0.0',
      state: 'ok',
      installCommand: `x --install --dir "${dir}"`,
    });
  });

  it('is a mismatch when another version is installed', () => {
    install({ scope: 'user', version: '0.9.0' });
    assert.equal(pluginStatus(dir, plugin).state, 'mismatch');
  });

  it('is disabled when settings turn it off', () => {
    install({ scope: 'user', version: '0.9.0' });
    write(path.join(dir, 'settings.json'), { enabledPlugins: { 'x@y': false } });
    assert.equal(pluginStatus(dir, plugin).state, 'disabled');
  });

  it('leaves out --dir for ~/.claude', () => {
    assert.equal(pluginStatus(path.join(os.homedir(), '.claude'), plugin).installCommand, 'x --install');
  });
});
