'use strict';

// The actions a user can rebind in config.json `keys`. Their defaults are in hubActions() in
// public/app.js; test/keys.test.js checks that the two lists match.
const HUB_ACTIONS = [
  'hub.projectPicker',
  'hub.configDirPicker',
  'hub.appLauncher',
  'hub.prevApp',
  'hub.nextApp',
  'hub.appByNumber',
];
// {n} stands for the tab number, 1 to 9.
const PATTERN_ACTIONS = new Set(['hub.appByNumber']);
const MODS = ['ctrl', 'alt', 'shift', 'meta'];

// A combo name as the SDK's comboOf() gives it (protocol section 8), with one modifier at least.
const COMBO_RE = /^(?=(?:ctrl|alt|shift|meta)\+)(?:ctrl\+)?(?:alt\+)?(?:shift\+)?(?:meta\+)?(?:[a-z1-9]|[A-Z][A-Za-z0-9]+)$/;

// "Ctrl+Alt+O" → "ctrl+alt+o", the form comboOf() gives. Null when the text cannot name a combo.
function normalizeCombo(text) {
  if (typeof text !== 'string') return null;
  const parts = text.split('+').map((p) => p.trim());
  let key = parts.pop();
  const mods = parts.map((p) => p.toLowerCase());
  if (mods.some((m) => !MODS.includes(m)) || new Set(mods).size !== mods.length) return null;
  if (key.length === 1) key = key.toLowerCase();
  const combo = [...MODS.filter((m) => mods.includes(m)), key].join('+');
  return COMBO_RE.test(combo.replace(/\+\{n\}$/, '+1')) ? combo : null;
}

// The `keys` of config.json, checked, as {actionId: combo | null}; null unbinds the action. An
// entry that is not valid, takes a combo an app keeps or repeats an earlier entry's combo is left
// out with a line that says why, so that action keeps its default.
function userKeys(saved, apps) {
  const keys = {};
  const lines = [];
  if (saved === undefined) return { keys, lines };
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    lines.push('keys is not an object, ignored');
    return { keys, lines };
  }
  const kept = new Map(apps.flatMap((a) => a.keeps.map((c) => [c, a.id])));
  const owner = new Map();
  for (const [id, value] of Object.entries(saved)) {
    const drop = (why) => lines.push(`keys "${id}": ${why}. It keeps its default`);
    if (!HUB_ACTIONS.includes(id)) {
      lines.push(`keys "${id}" is not a hub action, ignored`);
      continue;
    }
    if (value === null) {
      keys[id] = null;
      continue;
    }
    const combo = normalizeCombo(value);
    const pattern = PATTERN_ACTIONS.has(id);
    if (!combo || pattern !== combo.endsWith('+{n}')) {
      drop(`${JSON.stringify(value)} is not a combo${pattern ? ' that ends in +{n}' : ''}`);
      continue;
    }
    const combos = pattern ? Array.from({ length: 9 }, (_, i) => combo.replace('{n}', i + 1)) : [combo];
    const keptCombo = combos.find((c) => kept.has(c));
    if (keptCombo) {
      drop(`${keptCombo} is kept by ${kept.get(keptCombo)}`);
      continue;
    }
    const taken = combos.find((c) => owner.has(c));
    if (taken) {
      drop(`${taken} is already set for "${owner.get(taken)}"`);
      continue;
    }
    for (const c of combos) owner.set(c, id);
    keys[id] = combo;
  }
  return { keys, lines };
}

module.exports = { HUB_ACTIONS, COMBO_RE, normalizeCombo, userKeys };
