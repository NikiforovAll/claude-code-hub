'use strict';

const fs = require('node:fs');
const path = require('node:path');

const THEMES_FILE = path.join(__dirname, 'themes.json');

const readThemes = (file = THEMES_FILE) => JSON.parse(fs.readFileSync(file, 'utf8'));

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

const glow = (color, mode) =>
  /^#[0-9a-f]{6}$/i.test(color)
    ? `rgba(${hexToRgb(color)}, ${mode === 'dark' ? '0.55' : '0.5'})`
    : `color-mix(in srgb, ${color} ${mode === 'dark' ? '55%' : '50%'}, transparent)`;

// Palette role → shared CSS variable. --accent-glow is mechanical (rgba of the accent), mirroring
// how each app's :root derives it from --accent.
const coreVars = (p, mode) => ({
  '--accent': p.ember,
  '--accent-text': p.emberGlow,
  '--accent-dim': p.emberDim,
  '--accent-glow': glow(p.ember, mode),
  '--bg-deep': p.field,
  '--bg-surface': p.surface,
  '--bg-elevated': p.elevated,
  '--bg-hover': p.hover,
  '--border': p.border,
  '--text-primary': p.ink1,
  '--text-secondary': p.ink2,
  '--text-tertiary': p.ink3,
  '--text-muted': p.inkMuted,
  ...(p.sidebar && { '--sidebar-bg': p.sidebar }),
  ...(p.sidebarItem && { '--sidebar-item-bg': p.sidebarItem }),
});

const swatch = (p) => ({ bg: p.surface, accent: p.ember, ink: p.ink1, border: p.border });

const modes = (t, fn) => ({ dark: fn(t.dark, 'dark'), light: fn(t.light, 'light') });

const MODES = ['dark', 'light'];
const ROLES = ['ember', 'emberGlow', 'emberDim', 'field', 'surface', 'elevated', 'hover', 'border', 'ink1', 'ink2', 'ink3', 'inkMuted'];
const OPTIONAL_ROLES = ['sidebar', 'sidebarItem'];
const THEME_ID = /^[a-z0-9-]{1,32}$/;
// The SDK writes these values into inline styles and a style sheet, so no url(), quotes, semicolons or nested parens.
const COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgba?|hsla?|oklch)\([\w\s.,%/+-]*\))$/i;

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Why a user theme cannot be used, or null. `builtins` maps id → built-in theme.
function themeProblem(e, builtins, seen) {
  if (!isObject(e)) return 'not an object';
  if (typeof e.id !== 'string' || !THEME_ID.test(e.id)) return 'id must match ^[a-z0-9-]{1,32}$';
  if (seen.has(e.id)) return 'an earlier theme in the file has this id';
  if (e.label !== undefined && typeof e.label !== 'string') return 'label must be a string';
  if (e.extends !== undefined) {
    if (builtins.has(e.id)) return 'a built-in id cannot take extends';
    if (!builtins.has(e.extends)) return `extends names no built-in theme: ${e.extends}`;
  }
  const based = builtins.has(e.id) || e.extends !== undefined;
  for (const mode of MODES) {
    if (e[mode] === undefined && based) continue;
    if (!isObject(e[mode])) return `${mode} must be an object of colors`;
    for (const [role, value] of Object.entries(e[mode])) {
      if (!ROLES.includes(role) && !OPTIONAL_ROLES.includes(role)) return `${mode}.${role} is not a color role`;
      if (typeof value !== 'string' || !COLOR.test(value)) return `${mode}.${role} is not a color: ${value}`;
    }
    const missing = based ? [] : ROLES.filter((r) => !(r in e[mode]));
    if (missing.length) return `${mode} is missing ${missing.join(', ')}`;
  }
  return null;
}

// The built-in list with the user's themes applied: a built-in id changes that theme in place, a
// new id is added at the end. A theme that breaks a rule is skipped, and `warn` says why.
function withUserThemes(themes, entries, warn) {
  const builtins = new Map(themes.map((t) => [t.id, t]));
  const out = new Map(builtins);
  const seen = new Set();
  entries.forEach((e, i) => {
    const problem = themeProblem(e, builtins, seen);
    if (problem) {
      warn(`[themes] skipped ${typeof e?.id === 'string' ? `"${e.id}"` : `entry ${i + 1}`}: ${problem}`);
      return;
    }
    seen.add(e.id);
    const base = builtins.get(e.id) ?? builtins.get(e.extends);
    out.set(e.id, {
      id: e.id,
      label: e.label ?? base?.label ?? e.id,
      dark: { ...base?.dark, ...e.dark },
      light: { ...base?.light, ...e.light },
    });
  });
  return [...out.values()];
}

function readUserThemes(file, warn) {
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') warn(`[themes] skipped ${file}: ${err.message}`);
    return [];
  }
  if (Array.isArray(entries)) return entries;
  warn(`[themes] skipped ${file}: it must hold a JSON array of themes`);
  return [];
}

function readRegistry(file = THEMES_FILE) {
  try {
    return readThemes(file);
  } catch {
    return null;
  }
}

// What /api/config carries. An unreadable registry gives empty maps: the hub keeps index.html's
// colors and sends no vars, so each app uses its own theme CSS. `userFile` is the user's
// <hub-dir>/themes.json, read on each call.
function themeConfig(registry = readRegistry(), { userFile, warn = console.warn } = {}) {
  if (!registry) return { themes: [], themeVars: {} };
  const themes = userFile ? withUserThemes(registry, readUserThemes(userFile, warn), warn) : registry;
  return {
    themes: themes.map((t) => ({ id: t.id, label: t.label, swatch: modes(t, swatch) })),
    themeVars: Object.fromEntries(themes.map((t) => [t.id, modes(t, coreVars)])),
  };
}

module.exports = { readThemes, readRegistry, coreVars, swatch, themeConfig, ROLES };
