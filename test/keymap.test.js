const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCombo, userKeys } = require('../lib/keymap');

const KANBAN = { id: 'kanban', keeps: ['ctrl+alt+n', 'ctrl+alt+r', 'ctrl+alt+s'] };

describe('normalizeCombo', () => {
  it('gives the form comboOf() gives', () => {
    assert.equal(normalizeCombo('Ctrl+Alt+O'), 'ctrl+alt+o');
    assert.equal(normalizeCombo('alt + ctrl + O'), 'ctrl+alt+o');
    assert.equal(normalizeCombo('Shift+Ctrl+ArrowUp'), 'ctrl+shift+ArrowUp');
    assert.equal(normalizeCombo('Meta+Alt+{n}'), 'alt+meta+{n}');
  });

  it('refuses text that is not a combo', () => {
    for (const bad of ['', 'o', 'ctrl+', 'ctrl+ctrl+o', 'hyper+o', 'ctrl+alt+0', 'ctrl+alt+arrowleft', 'ctrl+{n}x', 3, null]) {
      assert.equal(normalizeCombo(bad), null, String(bad));
    }
  });
});

describe('userKeys', () => {
  it('keeps valid entries and null', () => {
    const { keys, lines } = userKeys(
      { 'hub.projectPicker': 'Ctrl+Alt+O', 'hub.appByNumber': 'ctrl+{n}', 'hub.appLauncher': null },
      [KANBAN],
    );
    assert.deepEqual(keys, { 'hub.projectPicker': 'ctrl+alt+o', 'hub.appByNumber': 'ctrl+{n}', 'hub.appLauncher': null });
    assert.deepEqual(lines, []);
  });

  it('gives nothing for no keys', () => {
    assert.deepEqual(userKeys(undefined, [KANBAN]), { keys: {}, lines: [] });
    assert.deepEqual(userKeys(['ctrl+alt+o'], [KANBAN]), { keys: {}, lines: ['keys is not an object, ignored'] });
  });

  it('drops a bad entry with a line, so the action keeps its default', () => {
    const { keys, lines } = userKeys(
      {
        'hub.nope': 'ctrl+alt+o',
        'hub.projectPicker': 'ctrl+alt+N',
        'hub.prevApp': 'ctrl+o',
        'hub.nextApp': 'Ctrl+O',
        'hub.appLauncher': 'ctrl+alt+{n}',
        'hub.appByNumber': 'alt+shift+1',
        'hub.configDirPicker': 'p',
      },
      [KANBAN],
    );
    assert.deepEqual(keys, { 'hub.prevApp': 'ctrl+o' });
    assert.deepEqual(lines, [
      'keys "hub.nope" is not a hub action, ignored',
      'keys "hub.projectPicker": ctrl+alt+n is kept by kanban. It keeps its default',
      'keys "hub.nextApp": ctrl+o is already set for "hub.prevApp". It keeps its default',
      'keys "hub.appLauncher": "ctrl+alt+{n}" is not a combo. It keeps its default',
      'keys "hub.appByNumber": "alt+shift+1" is not a combo that ends in +{n}. It keeps its default',
      'keys "hub.configDirPicker": "p" is not a combo. It keeps its default',
    ]);
  });

  it('checks every tab number of a pattern', () => {
    const keeper = { id: 'cost', keeps: ['ctrl+7'] };
    assert.deepEqual(userKeys({ 'hub.appByNumber': 'ctrl+{n}' }, [keeper]).lines, [
      'keys "hub.appByNumber": ctrl+7 is kept by cost. It keeps its default',
    ]);
    assert.deepEqual(userKeys({ 'hub.appByNumber': 'ctrl+{n}', 'hub.nextApp': 'ctrl+3' }, []).lines, [
      'keys "hub.nextApp": ctrl+3 is already set for "hub.appByNumber". It keeps its default',
    ]);
  });
});
