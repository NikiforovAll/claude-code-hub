const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRegistry, themeConfig, ROLES } = require('../lib/themes');

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
    assert.deepEqual(themeConfig(readRegistry(path.join(os.tmpdir(), 'no-such-themes.json'))), empty);
    const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'themes-')), 'themes.json');
    fs.writeFileSync(bad, '{not json');
    assert.deepEqual(themeConfig(readRegistry(bad)), empty);
  });
});

describe('themeConfig with user themes', () => {
  const registry = readRegistry();
  const ember = registry[0];
  const scratch = (overrides = {}) => Object.fromEntries(ROLES.map((r) => [r, overrides[r] ?? '#123456']));

  function run(entries, raw) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'user-themes-')), 'themes.json');
    fs.writeFileSync(file, raw ?? JSON.stringify(entries));
    const warnings = [];
    return { ...themeConfig(registry, { userFile: file, warn: (w) => warnings.push(w) }), warnings };
  }

  it('changes a built-in theme in place with only the colors given', () => {
    const { themes, themeVars, warnings } = run([{ id: 'ember', dark: { ember: '#3b82f6' } }]);
    assert.deepEqual(warnings, []);
    assert.equal(themes.length, registry.length);
    assert.deepEqual([themes[0].id, themes[0].label], ['ember', 'Ember']);
    assert.equal(themeVars.ember.dark['--accent'], '#3b82f6');
    assert.equal(themeVars.ember.dark['--bg-deep'], ember.dark.field);
    assert.equal(themeVars.ember.light['--accent'], ember.light.ember);
  });

  it('adds a theme that extends a built-in one, and one from scratch', () => {
    const { themes, themeVars, warnings } = run([
      { id: 'deep-sea', label: 'Deep Sea', extends: 'nord', dark: { field: '#0b1220' } },
      { id: 'mine', dark: scratch(), light: scratch({ ember: 'oklch(0.7 0.15 250)' }) },
    ]);
    assert.deepEqual(warnings, []);
    assert.deepEqual(
      themes.slice(-2).map((t) => [t.id, t.label]),
      [
        ['deep-sea', 'Deep Sea'],
        ['mine', 'mine'],
      ],
    );
    const nord = registry.find((t) => t.id === 'nord');
    assert.equal(themeVars['deep-sea'].dark['--bg-deep'], '#0b1220');
    assert.equal(themeVars['deep-sea'].light['--accent'], nord.light.ember);
    assert.equal(themeVars.mine.light['--accent-glow'], 'color-mix(in srgb, oklch(0.7 0.15 250) 50%, transparent)');
  });

  it('skips a theme that breaks a rule and says why', () => {
    const { themes, warnings } = run([
      { id: 'Bad Id', dark: scratch(), light: scratch() },
      { id: 'half', dark: scratch() },
      { id: 'gap', dark: scratch(), light: { ember: '#fff' } },
      { id: 'evil', extends: 'ember', dark: { ember: 'url(https://x.test/a.png)' } },
      { id: 'typo', extends: 'ember', dark: { accent: '#fff' } },
      { id: 'orphan', extends: 'no-such' },
      { id: 'ember', extends: 'nord' },
      { id: 'twice', extends: 'ember' },
      { id: 'twice', extends: 'nord' },
    ]);
    assert.deepEqual(
      themes.slice(registry.length).map((t) => t.id),
      ['twice'],
    );
    assert.equal(themes.find((t) => t.id === 'twice').swatch.dark.accent, ember.dark.ember);
    assert.deepEqual(warnings, [
      '[themes] skipped "Bad Id": id must match ^[a-z0-9-]{1,32}$',
      '[themes] skipped "half": light must be an object of colors',
      `[themes] skipped "gap": light is missing ${ROLES.filter((r) => r !== 'ember').join(', ')}`,
      '[themes] skipped "evil": dark.ember is not a color: url(https://x.test/a.png)',
      '[themes] skipped "typo": dark.accent is not a color role',
      '[themes] skipped "orphan": extends names no built-in theme: no-such',
      '[themes] skipped "ember": a built-in id cannot take extends',
      '[themes] skipped "twice": an earlier theme in the file has this id',
    ]);
  });

  it('keeps the built-in themes when the file is missing, not an array or not JSON', () => {
    const missing = themeConfig(registry, { userFile: path.join(os.tmpdir(), 'no-such-user-themes.json'), warn: assert.fail });
    assert.equal(missing.themes.length, registry.length);
    for (const raw of ['{"id": "x"}', '[{']) {
      const { themes, warnings } = run(null, raw);
      assert.equal(themes.length, registry.length);
      assert.equal(warnings.length, 1);
    }
  });
});
