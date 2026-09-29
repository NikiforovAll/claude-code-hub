'use strict';

const fs = require('node:fs');
const path = require('node:path');

const THEMES_FILE = path.join(__dirname, 'themes.json');

const readThemes = (file = THEMES_FILE) => JSON.parse(fs.readFileSync(file, 'utf8'));

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

// Palette role → shared CSS variable. --accent-glow is mechanical (rgba of the accent), mirroring
// how each app's :root derives it from --accent.
const coreVars = (p, mode) => ({
  '--accent': p.ember,
  '--accent-text': p.emberGlow,
  '--accent-dim': p.emberDim,
  '--accent-glow': `rgba(${hexToRgb(p.ember)}, ${mode === 'dark' ? '0.55' : '0.5'})`,
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

// What /api/config carries. An unreadable registry gives empty maps: the hub keeps index.html's
// colors and sends no vars, so each app uses its own theme CSS.
function themeConfig(file = THEMES_FILE) {
  let themes;
  try {
    themes = readThemes(file);
  } catch {
    return { themes: [], themeVars: {} };
  }
  return {
    themes: themes.map((t) => ({ id: t.id, label: t.label, swatch: modes(t, swatch) })),
    themeVars: Object.fromEntries(themes.map((t) => [t.id, modes(t, coreVars)])),
  };
}

module.exports = { readThemes, hexToRgb, coreVars, swatch, themeConfig };
