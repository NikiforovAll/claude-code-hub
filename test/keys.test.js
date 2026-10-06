const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MATRIX, ROW_SETS, loadHubKeys, eventOf, payloadOf } = require('./helpers/hub-keys');
const { HUB_ACTIONS } = require('../lib/keymap');

const PALETTE_AND_ARROWS = ['ctrl+alt+p', 'ctrl+alt+w', 'ctrl+alt+a', 'ctrl+alt+ArrowLeft', 'ctrl+alt+ArrowRight'];

describe('hub keymap', () => {
  it('forwards the default combos, in this order', () => {
    assert.deepEqual(Object.keys(loadHubKeys().bindings()), [...PALETTE_AND_ARROWS, 'alt+1', 'alt+2', 'alt+3', 'alt+4']);
    assert.deepEqual(Object.keys(loadHubKeys({ platform: 'mac' }).bindings()), [
      ...PALETTE_AND_ARROWS,
      'ctrl+alt+1',
      'ctrl+alt+2',
      'ctrl+alt+3',
      'ctrl+alt+4',
    ]);
  });

  it('binds a number key per app, up to 9', () => {
    const numbers = (apps) => Object.keys(loadHubKeys({ apps }).bindings()).filter((c) => c.startsWith('alt+'));
    assert.deepEqual(numbers(1), ['alt+1']);
    assert.equal(numbers(12).length, 9);
    assert.equal(loadHubKeys({ apps: 3 }).actionOf(eventOf({ key: '4', code: 'Digit4', mods: ['alt'] })), 'text');
  });

  it('labels each tab number in the launcher with the key it is bound to', () => {
    for (const [platform, labels] of [['win', ['Alt+1', 'Alt+9']], ['mac', ['⌃⌥1', '⌃⌥9']]]) {
      const hub = loadHubKeys({ apps: 9, platform });
      const combos = Object.keys(hub.bindings()).slice(-9);
      assert.deepEqual(combos, Array.from({ length: 9 }, (_, i) => hub.appNumberCombo(i)), platform);
      assert.deepEqual([hub.comboLabel(combos[0]), hub.comboLabel(combos[8])], labels, platform);
    }
  });

  it('binds each hub action to its default combo', () => {
    const ids = (platform) =>
      Object.entries(loadHubKeys({ apps: 2, platform }).bindings()).map(([combo, b]) => [b.id, combo]);
    const fixed = [
      ['hub.projectPicker', 'ctrl+alt+p'],
      ['hub.configDirPicker', 'ctrl+alt+w'],
      ['hub.appLauncher', 'ctrl+alt+a'],
      ['hub.prevApp', 'ctrl+alt+ArrowLeft'],
      ['hub.nextApp', 'ctrl+alt+ArrowRight'],
    ];
    assert.deepEqual(ids('win'), [...fixed, ['hub.appByNumber', 'alt+1'], ['hub.appByNumber', 'alt+2']]);
    assert.deepEqual(ids('mac'), [...fixed, ['hub.appByNumber', 'ctrl+alt+1'], ['hub.appByNumber', 'ctrl+alt+2']]);
  });

  it('builds the keymap once and again after the app list changes', () => {
    const hub = loadHubKeys({ apps: 4 });
    assert.equal(hub.bindings(), hub.bindings());
    hub.setApps({ a: {}, b: {} });
    assert.deepEqual(Object.keys(hub.bindings()).slice(-2), ['alt+1', 'alt+2']);
    assert.equal(hub.actionOf(eventOf({ key: '3', code: 'Digit3', mods: ['alt'] })), 'text');
    assert.equal(hub.actionOf(eventOf({ key: '2', code: 'Digit2', mods: ['alt'] })), 'hub.appByNumber:2');
  });

  it('keeps the palette keys working while the palette is open', () => {
    const map = loadHubKeys().bindings();
    const inPalette = Object.keys(map).filter((c) => map[c].inPalette);
    assert.deepEqual(inPalette, ['ctrl+alt+p', 'ctrl+alt+w', 'ctrl+alt+a']);
  });
});

describe('user keymap', () => {
  it('forwards a user combo and drops the default it replaces', () => {
    const hub = loadHubKeys({ apps: 2, keys: { 'hub.projectPicker': 'ctrl+alt+o', 'hub.appByNumber': 'ctrl+{n}' } });
    assert.deepEqual(Object.keys(hub.bindings()), [
      'ctrl+alt+o',
      'ctrl+alt+w',
      'ctrl+alt+a',
      'ctrl+alt+ArrowLeft',
      'ctrl+alt+ArrowRight',
      'ctrl+1',
      'ctrl+2',
    ]);
    assert.equal(hub.bindings()['ctrl+alt+o'].inPalette, true);
  });

  it('takes a combo from the action that has it by default', () => {
    const map = loadHubKeys({ keys: { 'hub.nextApp': 'ctrl+alt+p' } }).bindings();
    assert.equal(map['ctrl+alt+p'].id, 'hub.nextApp');
    assert.equal(Object.values(map).some((b) => b.id === 'hub.projectPicker'), false);
    assert.equal(map['ctrl+alt+ArrowRight'], undefined);
  });

  it('unbinds an action set to null', () => {
    const map = loadHubKeys({ keys: { 'hub.appByNumber': null, 'hub.appLauncher': null } }).bindings();
    assert.deepEqual(Object.keys(map), PALETTE_AND_ARROWS.filter((c) => c !== 'ctrl+alt+a'));
  });

  it('labels each tab number in the launcher with its user combo', () => {
    const hub = loadHubKeys({ keys: { 'hub.appByNumber': 'ctrl+shift+{n}' } });
    assert.equal(hub.comboLabel(hub.appNumberCombo(1)), 'Ctrl+Shift+2');
    assert.equal(hub.appNumberCombo(4), undefined);
    assert.equal(loadHubKeys({ keys: { 'hub.appByNumber': null } }).appNumberCombo(0), undefined);
  });

  it('lists the same action ids as lib/keymap.js', () => {
    assert.deepEqual(Array.from(loadHubKeys().hubActions(), (a) => a.id), HUB_ACTIONS);
  });
});

for (const set of ROW_SETS) {
  describe(set.rows === MATRIX.rows ? 'key matrix' : 'key matrix, remapped', () => {
    const hubs = { win: loadHubKeys({ keys: set.keys }), mac: loadHubKeys({ platform: 'mac', keys: set.keys }) };
    for (const row of set.rows) {
      it(row.name, { todo: row.todo }, () => {
        const hub = hubs[row.platform];
        assert.equal(hub.actionOf(eventOf(row)), row.expect, 'press on the hub page');
        // The SDK never forwards an AltGr character; the SDK's own matrix test covers that path.
        if (!row.altGraph) assert.equal(hub.actionOfForwarded(payloadOf(row)), row.expect, 'press forwarded from an app');
      });
    }
  });
}
