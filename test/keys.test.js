const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MATRIX, loadHubKeys, eventOf, payloadOf } = require('./helpers/hub-keys');

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
      assert.deepEqual(combos, Array.from({ length: 9 }, (_, i) => hub.tabCombo(i)), platform);
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

describe('key matrix', () => {
  const hubs = { win: loadHubKeys(), mac: loadHubKeys({ platform: 'mac' }) };
  for (const row of MATRIX.rows) {
    it(row.name, { todo: row.todo }, () => {
      const hub = hubs[row.platform];
      assert.equal(hub.actionOf(eventOf(row)), row.expect, 'press on the hub page');
      assert.equal(hub.actionOfForwarded(payloadOf(row)), row.expect, 'press forwarded from an app');
    });
  }
});
