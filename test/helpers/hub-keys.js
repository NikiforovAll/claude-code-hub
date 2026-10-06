const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const MATRIX = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/key-matrix.json'), 'utf8'));
const FUNCTIONS = ['hubActions', 'bindings', 'setApps', 'tabCombo', 'comboLabel', 'handleForwardedKey'];
const { comboOf } = require('../../packages/claude-hub-sdk/src/keys');

function source(name) {
  const m = new RegExp(`^function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm').exec(SRC);
  if (!m) throw new Error(`public/app.js has no top-level function ${name}`);
  return m[0];
}

// The hub page's keymap, run with its UI calls replaced by a log of the action they stand for.
function loadHubKeys({ apps: appCount = MATRIX.apps, platform = 'win' } = {}) {
  const ids = Array.from({ length: appCount }, (_, i) => `app${i + 1}`);
  const ran = [];
  const ctx = {
    IS_MAC: platform === 'mac',
    comboOf,
    keymap: null,
    apps: Object.fromEntries(ids.map((id) => [id, {}])),
    togglePalette: (mode) => ran.push({ project: 'hub.projectPicker', configDir: 'hub.configDirPicker', app: 'hub.appLauncher' }[mode]),
    cycleTab: (delta) => ran.push(delta < 0 ? 'hub.prevApp' : 'hub.nextApp'),
    switchTab: (id) => ran.push(`hub.appByNumber:${Object.keys(ctx.apps).indexOf(id) + 1}`),
  };
  vm.runInNewContext(`${FUNCTIONS.map(source).join('\n')}\nthis.k = { ${FUNCTIONS.join(', ')} };`, ctx);
  const run = (fn) => {
    ran.length = 0;
    fn();
    return ran.length ? ran.join(',') : 'text';
  };
  return {
    ...ctx.k,
    actionOf: (e) => run(() => ctx.k.bindings()[comboOf(e)]?.run()),
    actionOfForwarded: (payload) => run(() => ctx.k.handleForwardedKey(payload)),
  };
}

// The forwarded hub:keydown payload of a matrix row.
function payloadOf(row) {
  return {
    key: row.key,
    code: row.code,
    ctrl: row.mods.includes('ctrl'),
    alt: row.mods.includes('alt'),
    shift: row.mods.includes('shift'),
    meta: row.mods.includes('meta'),
  };
}

function eventOf(row) {
  const { ctrl, alt, shift, meta, ...rest } = payloadOf(row);
  const getModifierState = (m) => m === 'AltGraph' && row.altGraph === true;
  return { ...rest, ctrlKey: ctrl, altKey: alt, shiftKey: shift, metaKey: meta, getModifierState };
}

module.exports = { MATRIX, source, loadHubKeys, eventOf, payloadOf };
