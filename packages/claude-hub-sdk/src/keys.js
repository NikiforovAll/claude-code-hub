// Claude Code Hub SDK: the one rule that names a key press, shared by the hub page, client.js and
// stub.js. The hub serves it to its page as /sdk/keys.js; mount() and sdk:sync put it in front of
// client.js and stub.js, so an app still loads one file.
// var, not const: the hub page and an app page each load it as a classic script, and a second
// const declaration in the same page would throw.
var ClaudeHubKeys = (() => {
  'use strict';

  // Modifiers in ctrl, alt, shift, meta order, joined by '+' to the key. macOS composes
  // Option+<key> into a character (Option+1 is '¡', Option+P is 'π') and holding Control does not
  // undo it, so e.key alone cannot name these presses there. e.code is the physical key, which is
  // wrong for non-US layouts, hence only as a fallback. No fallback under AltGraph: Chromium sets it
  // when AltGr types a character, and that press is text. Takes a real KeyboardEvent or a forwarded
  // {key, code} payload; a payload without code degrades to key. A payload needs no AltGraph: the
  // SDK forwards only a press whose key already names a bound combo.
  // Self-contained on purpose: cck puts its source text into a sandboxed frame.
  function comboOf(e) {
    const lower = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    const m = !e.getModifierState?.('AltGraph') && /^(?:Key|Digit)([A-Z1-9])$/.exec(e.code || '');
    const key = /^[a-z1-9]$/.test(lower) ? lower : m ? m[1].toLowerCase() : e.key;
    const mods = [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.metaKey && 'meta'];
    return [...mods, key].filter(Boolean).join('+');
  }

  // The keys of a combo as a help row shows them: ['Ctrl', 'Alt', 'P'], or ['⌃', '⌥', 'P'] on macOS.
  // The {n} of a numbered combo reads 1…9.
  function keyParts(combo, mac) {
    const mods = mac
      ? { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
      : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };
    const named = { '{n}': '1…9', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
    return combo.split('+').map((k) => mods[k] ?? named[k] ?? (k.length === 1 ? k.toUpperCase() : k));
  }

  return { comboOf, keyParts };
})();

if (typeof module === 'object' && module.exports) module.exports = ClaudeHubKeys;
