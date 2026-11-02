'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { HUB_ROOT, ID_RE } = require('./apps');
const { isContained } = require('./contain');

// Extensions the hub ships. `ext install <id>` finds them before the registry.
const BUNDLED = path.join(HUB_ROOT, 'extensions');

// A mod file is served at /mods/<id>/<file>, so its name must be a plain relative URL path.
const FILE_RE = /^[\w-][\w.-]*(\/[\w-][\w.-]*)*$/;
const TYPES = { css: '.css', js: '.js' };

function modProblem(m, root) {
  if (m?.kind !== 'mod' || !ID_RE.test(m.id ?? '')) return 'a mod manifest needs "kind": "mod" and an id of lowercase letters, digits and dashes';
  if (m.themes !== undefined && !Array.isArray(m.themes)) return 'themes must be a list of themes';
  if (!m.targets || typeof m.targets !== 'object' || Array.isArray(m.targets)) return 'targets must be an object keyed by "hub" or an app id';
  for (const [target, parts] of Object.entries(m.targets)) {
    if (!ID_RE.test(target)) return `targets.${target} is not "hub" or an app id`;
    if (!parts || typeof parts !== 'object') return `targets.${target} must be an object of css and js lists`;
    if (!Number.isInteger(parts.surface) || parts.surface < 1) {
      return `targets.${target}.surface must be the version of the ${target} mod surface its files are written for`;
    }
    for (const [type, files] of Object.entries(parts)) {
      if (type === 'surface') continue;
      const where = `targets.${target}.${type}`;
      if (!TYPES[type]) return `${where}: a target takes css and js only`;
      if (!Array.isArray(files)) return `${where} must be a list of files`;
      for (const f of files) {
        if (typeof f !== 'string' || !FILE_RE.test(f) || !f.endsWith(TYPES[type])) return `${where}: "${f}" is not a relative ${TYPES[type]} path`;
        const abs = path.join(root, f);
        if (!isContained(abs, root)) return `${where}: ${f} is outside the mod folder`;
        if (!fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) return `${where}: ${f} is not found`;
      }
    }
  }
  return null;
}

function readMod(root, id) {
  const file = path.join(root, 'mod.json');
  let raw;
  let manifest;
  try {
    raw = fs.readFileSync(file, 'utf8');
    manifest = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file}: ${e.code === 'ENOENT' ? 'not found' : e.message}`);
  }
  const problem = modProblem(manifest, root);
  if (problem) throw new Error(`${file}: ${problem}`);
  if (id && manifest.id !== id) throw new Error(`${file}: its id is ${manifest.id}, not ${id}`);
  return { manifest, raw };
}

// A bundled entry has no path: it follows the hub's own copy, so it moves with each hub upgrade.
const entryRoot = (entry, hubDir, bundled = BUNDLED) =>
  entry.source === 'bundled' ? path.join(bundled, entry.id) : path.resolve(hubDir, entry.path);

const bundledRoot = (id, bundled = BUNDLED) => {
  if (!ID_RE.test(id ?? '')) return null;
  const root = path.join(bundled, id);
  return fs.existsSync(root) ? root : null;
};

// The `surface` number in <root>/mod-surface.json: the version of the names a mod may use on that
// page. Null when the file is missing or has none.
function readSurface(root) {
  try {
    const { surface } = JSON.parse(fs.readFileSync(path.join(root, 'mod-surface.json'), 'utf8'));
    return Number.isInteger(surface) ? surface : null;
  } catch {
    return null;
  }
}

// Changes with any JS file of the mod, and with the page each one runs in. `ext update` asks again when it does.
function modJsHash(root, manifest) {
  const hash = crypto.createHash('sha1');
  for (const [target, parts] of Object.entries(manifest.targets))
    for (const f of parts.js ?? []) hash.update(`${target}\0${f}\0`).update(fs.readFileSync(path.join(root, f))).update('\0');
  return hash.digest('hex');
}

// The mods of `config.mods`, read once at hub start. `version` changes with any file of the mod,
// so the browser fetches the new files after a hub restart and caches them until then.
// `surfaces` maps "hub" and each enabled app id to its surface version, or null when it has none.
// A target whose page is not running is left out; one written for another surface is left out with a log line.
function resolveMods(config, hubDir, { warn, surfaces, bundled = BUNDLED, off = false }) {
  if (off) return [];
  const out = [];
  for (const entry of config.mods ?? []) {
    if (typeof entry?.id !== 'string' || entry.enabled === false) continue;
    const root = entryRoot(entry, hubDir, bundled);
    let manifest;
    let raw;
    try {
      ({ manifest, raw } = readMod(root, entry.id));
    } catch (e) {
      warn(`[mods] skipped ${entry.id}: ${e.message}`);
      continue;
    }
    const hash = crypto.createHash('sha1').update(raw);
    const targets = {};
    for (const [target, parts] of Object.entries(manifest.targets)) {
      const have = surfaces[target];
      if (have === undefined) continue;
      if (have !== parts.surface) {
        const why = have === null ? `${target} has no mod surface` : `${target} has surface ${have}`;
        warn(`[mods] ${entry.id}: skipped its ${target} files: they are written for surface ${parts.surface}, and ${why}`);
        continue;
      }
      targets[target] = { css: parts.css ?? [], js: parts.js ?? [] };
      for (const f of [...targets[target].css, ...targets[target].js]) hash.update(f).update(fs.readFileSync(path.join(root, f)));
    }
    out.push({ id: manifest.id, root, version: hash.digest('hex').slice(0, 10), themes: manifest.themes ?? [], targets });
  }
  return out;
}

// What one page loads: its mods, the URLs of their CSS and JS in mod order then file order, and the
// `/<id>/<file>` → path map of the only files its /mods route serves.
function modAssets(mods, target) {
  const mine = mods.filter((m) => m.targets[target]);
  const pick = (type) => mine.flatMap((m) => (m.targets[target][type] ?? []).map((f) => [m, f]));
  const url = ([m, f]) => `/mods/${m.id}/${f}?v=${m.version}`;
  const css = pick('css');
  const js = pick('js');
  const files = new Map([...css, ...js].map(([m, f]) => [`/${m.id}/${f}`, path.join(m.root, f)]));
  return { mods: mine.map((m) => ({ id: m.id, version: m.version })), css: css.map(url), js: js.map(url), files };
}

// HUB_MODS for an app: the page's list as the client reads it, and the files the SDK's mount()
// serves. The SDK uses both as given, so the URL format lives only here. Null when the app has no mod.
function appModEnv(mods, app) {
  const { files, ...assets } = modAssets(mods, app);
  return assets.mods.length ? JSON.stringify({ assets, files: Object.fromEntries(files) }) : null;
}

const MOD_KIT = path.join(HUB_ROOT, 'packages', 'claude-hub-sdk', 'src', 'mods.js');

// /mods/hub.js: the SDK's mod runtime as ClaudeHub.mod on the hub page, which then loads the mod
// scripts. Empty when no mod has JS for the hub page.
function hubModScript(assets) {
  if (!assets.js.length) return '';
  return [
    `self.ClaudeHubMods = ${JSON.stringify({ mods: assets.mods, js: assets.js })};`,
    fs.readFileSync(MOD_KIT, 'utf8'),
    'self.ClaudeHub = { mod: ClaudeHubModKit.createMods(self).mod };',
    '',
  ].join('\n');
}

module.exports = { BUNDLED, readMod, readSurface, modJsHash, entryRoot, bundledRoot, resolveMods, modAssets, appModEnv, hubModScript };
