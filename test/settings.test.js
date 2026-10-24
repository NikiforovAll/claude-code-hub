const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { appSettings, appsShape, applySettings, configDirSwitch, poolSize, settingValues } = require('../lib/settings');

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

  const schemas = {
    kanban: [
      { key: 'zenCentered', type: 'boolean', default: false },
      { key: 'density', type: 'choice', options: [{ value: 'cozy' }, { value: 'compact' }], default: 'cozy' },
    ],
  };

  it('gives app setting values with defaults for missing and stale ones', () => {
    assert.deepEqual(settingValues(schemas.kanban), { zenCentered: false, density: 'cozy' });
    assert.deepEqual(settingValues(schemas.kanban, { zenCentered: true, density: 'tight', gone: 1 }), {
      zenCentered: true,
      density: 'cozy',
    });
  });

  it('writes an app setting only while it differs from the default', () => {
    const saved = { apps: [{ id: 'kanban', port: 4000 }] };
    const on = applySettings(saved, { app: { id: 'kanban', settings: { zenCentered: true } } }, undefined, schemas);
    assert.deepEqual(on.config.apps, [{ id: 'kanban', port: 4000, settings: { zenCentered: true } }]);
    const off = applySettings(on.config, { app: { id: 'kanban', settings: { zenCentered: false } } }, undefined, schemas);
    assert.deepEqual(off.config.apps, [{ id: 'kanban', port: 4000 }]);
  });

  it('keeps the tab order when an app setting adds an entry', () => {
    const { config } = applySettings({}, { app: { id: 'kanban', settings: { density: 'compact' } } }, undefined, schemas);
    assert.deepEqual(ids(config.apps), ['kanban', 'marketplace', 'cost', 'memory']);
    assert.deepEqual(config.apps[0], { id: 'kanban', settings: { density: 'compact' } });
  });

  it('refuses an unknown app setting or a value the manifest does not allow', () => {
    const set = (id, settings) => applySettings({}, { app: { id, settings } }, undefined, schemas).error;
    assert.match(set('cost', { zenCentered: true }), /no setting/);
    assert.match(set('kanban', { nope: true }), /no setting/);
    assert.match(set('kanban', { zenCentered: 'yes' }), /boolean/);
    assert.match(set('kanban', { density: 'tight' }), /one of cozy, compact/);
    assert.match(set('kanban', 'on'), /must be an object/);
  });

  it('changes the apps shape only for what a restart changes', () => {
    const before = appsShape(appSettings([]));
    assert.equal(appsShape(appSettings([{ id: 'kanban', port: 1 }])), before);
    assert.notEqual(appsShape(appSettings([{ id: 'cost', enabled: false }])), before);
  });
});
