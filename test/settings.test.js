const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { appSettings, appsShape, applySettings, configDirSwitch, poolSize } = require('../lib/settings');

const ids = (apps) => apps.map((a) => a.id);

describe('settings', () => {
  it('reads defaults and refuses bad saved values', () => {
    assert.equal(configDirSwitch({}), 'palette');
    assert.equal(configDirSwitch({ configDirSwitch: 'nope' }), 'palette');
    assert.equal(configDirSwitch({ configDirSwitch: 'swap' }), 'swap');
    assert.equal(poolSize({}), 3);
    assert.equal(poolSize({ poolSize: 0 }), 3);
    assert.equal(poolSize({ poolSize: 5 }), 5);
    assert.equal(poolSize({ poolSize: 5 }, '2'), 2);
  });

  it('lists every app with its state, the off ones too', () => {
    const apps = appSettings([{ id: 'cost', enabled: false }, { id: 'memory', hidden: true, deferredStart: true }]);
    assert.deepEqual(ids(apps), ['cost', 'memory', 'kanban', 'marketplace']);
    const shape = ({ id, state, deferredStart }) => ({ id, state, deferredStart });
    assert.deepEqual(shape(apps[0]), { id: 'cost', state: 'off', deferredStart: false });
    assert.deepEqual(shape(apps[1]), { id: 'memory', state: 'hidden', deferredStart: true });
  });

  it('saves the config-dir switch and the pool size', () => {
    const { config } = applySettings({ configDirs: ['a'] }, { configDirSwitch: 'swap', poolSize: 2 });
    assert.deepEqual(config, { configDirs: ['a'], configDirSwitch: 'swap', poolSize: 2 });
    assert.match(applySettings({}, { configDirSwitch: 'x' }).error, /configDirSwitch/);
    assert.match(applySettings({}, { poolSize: 99 }).error, /poolSize/);
  });

  it('keeps the tab order when it adds an app entry', () => {
    const { config } = applySettings({}, { app: { id: 'cost', state: 'hidden' } });
    assert.deepEqual(ids(config.apps), ['kanban', 'marketplace', 'cost', 'memory']);
    assert.deepEqual(config.apps[2], { id: 'cost', enabled: true, hidden: true });
    assert.deepEqual(ids(appSettings(config.apps)), ['kanban', 'marketplace', 'cost', 'memory']);
  });

  it('keeps the other fields of an entry', () => {
    const saved = { apps: [{ id: 'kanban', port: 4000 }] };
    const { config } = applySettings(saved, { app: { id: 'kanban', deferredStart: true } });
    assert.deepEqual(config.apps, [{ id: 'kanban', port: 4000, deferredStart: true }]);
    assert.deepEqual(saved.apps, [{ id: 'kanban', port: 4000 }]);
  });

  it('refuses to turn off the last app and unknown apps', () => {
    const saved = { apps: ['kanban', 'marketplace', 'cost'].map((id) => ({ id, enabled: false })) };
    assert.match(applySettings(saved, { app: { id: 'memory', state: 'off' } }).error, /stay on/);
    assert.match(applySettings({}, { app: { id: 'nope', state: 'off' } }).error, /Unknown app/);
  });

  it('changes the apps shape only for what a restart changes', () => {
    const before = appsShape(appSettings([]));
    assert.equal(appsShape(appSettings([{ id: 'kanban', port: 1 }])), before);
    assert.notEqual(appsShape(appSettings([{ id: 'cost', enabled: false }])), before);
  });
});
