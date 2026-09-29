const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { themeConfig } = require('../lib/themes');

const CORE = [
  '--accent',
  '--accent-text',
  '--accent-dim',
  '--accent-glow',
  '--bg-deep',
  '--bg-surface',
  '--bg-elevated',
  '--bg-hover',
  '--border',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--text-muted',
];

describe('themeConfig', () => {
  const config = themeConfig();
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'themes.json'), 'utf8'));

  it('lists every theme with a swatch per mode, Ember first', () => {
    assert.deepEqual(
      config.themes.map((t) => t.id),
      registry.map((t) => t.id),
    );
    assert.equal(config.themes[0].id, 'ember');
    const ember = registry[0];
    assert.deepEqual(config.themes[0].swatch.dark, {
      bg: ember.dark.surface,
      accent: ember.dark.ember,
      ink: ember.dark.ink1,
      border: ember.dark.border,
    });
  });

  it('gives every theme and mode the core variables', () => {
    for (const t of registry) {
      for (const mode of ['dark', 'light']) {
        const vars = config.themeVars[t.id][mode];
        for (const name of CORE) assert.equal(typeof vars[name], 'string', `${t.id}/${mode} ${name}`);
        assert.equal(vars['--sidebar-bg'], t[mode].sidebar);
      }
    }
    assert.equal(config.themeVars.ember.dark['--accent-glow'], 'rgba(232, 111, 51, 0.55)');
  });

  it('gives empty maps for a missing or bad registry', () => {
    const empty = { themes: [], themeVars: {} };
    assert.deepEqual(themeConfig(path.join(os.tmpdir(), 'no-such-themes.json')), empty);
    const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'themes-')), 'themes.json');
    fs.writeFileSync(bad, '{not json');
    assert.deepEqual(themeConfig(bad), empty);
  });
});
