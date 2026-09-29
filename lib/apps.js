'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isContained } = require('./contain');

// Built-in apps in their default tab order. The rest of each app comes from its manifest.
const APPS = [
  { id: 'kanban', dir: 'cck', pkg: 'claude-code-kanban' },
  { id: 'marketplace', dir: 'marketplace', pkg: 'claude-code-marketplace' },
  { id: 'cost', dir: 'cost', pkg: 'claude-code-cost' },
  { id: 'memory', dir: 'memory', pkg: 'claude-code-memory-explorer' },
];

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const HUB_ROOT = path.join(__dirname, '..');

// `entries` is the hand-edited `apps` list in config.json. Listed apps come first in list order and
// unlisted ones follow in default order, so an app added in a later release shows up without an edit.
function selectApps(entries = []) {
  const listed = entries.filter((e) => typeof e?.id === 'string');
  const byId = (id) => APPS.find((a) => a.id === id);
  const unknown = listed.map((e) => e.id).filter((id) => !byId(id));
  const off = new Set(listed.filter((e) => e.enabled === false).map((e) => e.id));
  const order = new Set([...listed.map((e) => e.id), ...APPS.map((a) => a.id)]);
  const apps = [...order].map(byId).filter((a) => a && !off.has(a.id));
  return { apps, unknown };
}

function manifestError(m, id, root) {
  if (m?.manifest !== 1) return `unknown manifest version ${JSON.stringify(m?.manifest)}`;
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return `id ${JSON.stringify(m.id)} does not match ${ID_RE}`;
  if (m.id !== id) return `id "${m.id}" is not "${id}"`;
  if (typeof m.run?.entry !== 'string') return 'run.entry is missing';
  const entry = path.resolve(root, m.run.entry);
  if (entry === path.resolve(root) || !isContained(entry, root)) return 'run.entry is outside the app directory';
  return null;
}

// Null when the app ships no hub-app.json. Throws when the file is there but not valid.
function readManifest(root, id) {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(path.join(root, 'hub-app.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const err = manifestError(m, id, root);
  if (err) throw new Error(err);
  return m;
}

function builtInManifest(id) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'manifests', `${id}.json`), 'utf8'));
}

// The submodule when it is checked out, else the installed package.
function appRoot(app, hubRoot, resolve) {
  const local = path.join(hubRoot, app.dir);
  if (fs.existsSync(path.join(local, 'package.json'))) return local;
  return path.dirname(resolve(`${app.pkg}/package.json`));
}

// A released package may not ship hub-app.json yet, and a bad one must not take a built-in app
// down, so both fall back to the copy in lib/manifests.
function loadApp(app, { hubRoot = HUB_ROOT, resolve = require.resolve, log = console.log } = {}) {
  const root = appRoot(app, hubRoot, resolve);
  let manifest = null;
  try {
    manifest = readManifest(root, app.id);
  } catch (e) {
    log(`${path.join(root, 'hub-app.json')}: ${e.message}. Using the built-in manifest`);
  }
  manifest ??= builtInManifest(app.id);
  return {
    id: app.id,
    entry: path.join(root, manifest.run.entry),
    port: manifest.run.defaultPort ?? 0,
    name: manifest.name ?? app.id,
    icon: manifest.icon,
    loading: manifest.loading ?? {},
    actions: manifest.actions ?? {},
  };
}

module.exports = { APPS, selectApps, loadApp, manifestError, builtInManifest };
