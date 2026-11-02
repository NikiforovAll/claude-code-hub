const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { APPS, HUB_ROOT, appRoot } = require('../lib/apps');
const { BUNDLED, readMod, resolveMods, modAssets, hubModScript } = require('../lib/mods');
const { coreVars } = require('../lib/themes');

describe('resolveMods', () => {
  let bundled;
  let logs;
  const write = (f, s) => fs.writeFileSync(path.join(bundled, 'probe', f), s);
  const resolve = (surfaces) => resolveMods({ mods: [{ id: 'probe', source: 'bundled' }] }, os.tmpdir(), { warn: (l) => logs.push(l), surfaces, bundled });

  beforeEach(() => {
    logs = [];
    bundled = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-mods-'));
    fs.mkdirSync(path.join(bundled, 'probe'));
    write('hub.css', 'body{}');
    write('hub.js', '1');
    write('kanban.css', 'a{}');
    const targets = { hub: { surface: 1, css: ['hub.css'], js: ['hub.js'] }, kanban: { surface: 2, css: ['kanban.css'] }, cost: { surface: 1, css: ['kanban.css'] } };
    write('mod.json', JSON.stringify({ manifest: 1, kind: 'mod', id: 'probe', targets }));
  });
  afterEach(() => fs.rmSync(bundled, { recursive: true, force: true }));

  it('keeps a target whose surface matches, and skips the others with a reason', () => {
    const [m] = resolve({ hub: 1, kanban: 1, cost: null });
    assert.deepEqual(Object.keys(m.targets), ['hub']);
    assert.deepEqual(logs, [
      '[mods] probe: skipped its kanban files: they are written for surface 2, and kanban has surface 1',
      '[mods] probe: skipped its cost files: they are written for surface 1, and cost has no mod surface',
    ]);
  });

  it('skips a target whose app is not enabled without a log line', () => {
    const [m] = resolve({ hub: 1 });
    assert.deepEqual(Object.keys(m.targets), ['hub']);
    assert.deepEqual(logs, []);
  });

  it('loads no mod when mods are off', () => {
    const mods = resolveMods({ mods: [{ id: 'probe', source: 'bundled' }] }, os.tmpdir(), { warn: (l) => logs.push(l), surfaces: { hub: 1 }, bundled, off: true });
    assert.deepEqual(mods, []);
    assert.equal(hubModScript(modAssets(mods, 'hub')), '');
  });

  it('serves the hub page the mod runtime and its scripts, and nothing for CSS alone', () => {
    const mods = resolve({ hub: 1 });
    const script = hubModScript(modAssets(mods, 'hub'));
    assert.match(script, /^self\.ClaudeHubMods = \{"mods":\[\{"id":"probe","version":"\w+"\}\],"js":\["\/mods\/probe\/hub\.js\?v=\w+"\]\};\n/);
    assert.match(script, /var ClaudeHubModKit/);
    assert.match(script, /self\.ClaudeHub = \{ mod: ClaudeHubModKit\.createMods\(self\)\.mod \};\n$/);
    const cssOnly = [{ ...mods[0], targets: { hub: { css: ['hub.css'], js: [] } } }];
    assert.equal(hubModScript(modAssets(cssOnly, 'hub')), '');
  });
});

// server.js strips these exact tags from the page when no mod is on; a reworded tag would stay.
it('the hub page holds the mod tags server.js strips', () => {
  const page = fs.readFileSync(path.join(HUB_ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(page.includes('<link rel="stylesheet" href="/mods/hub.css">'));
  assert.ok(page.includes('<script src="/mods/hub.js"></script>'));
});

// A bundled mod may use only the names its targets' surfaces list. A rename on either side fails here.
describe('bundled mods keep to the mod surface', () => {
  const surfaceOf = (target) => {
    const app = APPS.find((a) => a.id === target);
    const root = target === 'hub' ? HUB_ROOT : appRoot(app, HUB_ROOT, require.resolve);
    return JSON.parse(fs.readFileSync(path.join(root, 'mod-surface.json'), 'utf8'));
  };
  const themeVars = new Set(Object.keys(coreVars({ sidebar: 1, sidebarItem: 1 }, 'dark')));
  const all = (text, re) => [...text.matchAll(re)].map((m) => m[1]);
  const ids = fs.readdirSync(BUNDLED).filter((id) => fs.existsSync(path.join(BUNDLED, id, 'mod.json')));

  it('ships at least one mod', () => assert.ok(ids.length));

  for (const id of ids) {
    const root = path.join(BUNDLED, id);
    const { manifest } = readMod(root, id);
    for (const [target, parts] of Object.entries(manifest.targets)) {
      it(`${id} for ${target}`, () => {
        const surface = surfaceOf(target);
        assert.equal(parts.surface, surface.surface, 'surface version');
        const states = new Set(Object.values(surface.states ?? {}).flatMap(Object.keys));
        const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
        const css = (parts.css ?? []).map(read).join('\n');
        const js = (parts.js ?? []).map(read).join('\n');
        const own = (name) => name.startsWith(`${id}-`);
        const topic = (name) => name.startsWith(`${id}:`);
        for (const part of all(css + js, /data-hub-part="([^"]+)"/g)) assert.ok(surface.parts[part], `part ${part}`);
        for (const fn of all(js, /mod\.wrap\('([^']+)'/g)) assert.ok(surface.functions[fn], `function ${fn}`);
        for (const event of all(js, /mod\.on\('([^']+)'/g)) assert.ok(surface.events[event] || (target === 'hub' && topic(event)), `event ${event}`);
        for (const t of all(js, /mod\.send\('([^']+)'/g)) assert.ok(topic(t), `topic ${t}`);
        const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)|"[^"]*"/g, '');
        for (const v of all(rules, /var\((--[\w-]+)/g)) assert.ok(own(v.slice(2)) || themeVars.has(v), `var ${v}`);
        for (const selector of all(rules, /([^{};]+)\{/g).filter((s) => !s.trim().startsWith('@') && !/^\s*(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*\s*$/.test(s))) {
          for (const cls of all(selector, /\.([a-zA-Z][\w-]*)/g)) assert.ok(own(cls) || states.has(cls), `class .${cls} in "${selector.trim()}"`);
        }
      });
    }
  }
});
