'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isContained } = require('./contain');
const { COMBO_RE } = require('./keymap');

// Built-in apps in their default tab order. The rest of each app comes from its manifest.
const APPS = [
  { id: 'kanban', dir: 'cck', pkg: 'claude-code-kanban' },
  { id: 'marketplace', dir: 'marketplace', pkg: 'claude-code-marketplace' },
  { id: 'cost', dir: 'cost', pkg: 'claude-code-cost' },
  { id: 'memory', dir: 'memory', pkg: 'claude-code-memory-explorer' },
];

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const HUB_ROOT = path.join(__dirname, '..');

const validPort = (p) => Number.isInteger(p) && p > 0 && p < 65536;

// `entries` is the hand-edited `apps` list in config.json. Listed apps come first in list order and
// unlisted ones follow in default order, so an app added in a later release shows up without an edit.
// An entry with a `path` runs the app in that folder: a fork in place of a built-in app, or a new app.
// A relative `path` is resolved against `base`, the folder of config.json.
function selectApps(entries = [], base = process.cwd()) {
  const listed = entries.filter((e) => typeof e?.id === 'string');
  const entryOf = (id) => listed.find((e) => e.id === id);
  const pathOf = (id) => {
    const p = entryOf(id)?.path;
    return typeof p === 'string' && p ? path.resolve(base, p) : undefined;
  };
  const byId = (id) => APPS.find((a) => a.id === id) ?? (pathOf(id) ? { id } : undefined);
  const unknown = listed.map((e) => e.id).filter((id) => !byId(id));
  const off = new Set(listed.filter((e) => e.enabled === false).map((e) => e.id));
  const order = new Set([...listed.map((e) => e.id), ...APPS.map((a) => a.id)]);
  const apps = [...order]
    .map(byId)
    .filter((a) => a && !off.has(a.id))
    .map((a) => ({ ...a, port: entryOf(a.id)?.port, path: pathOf(a.id) }));
  return { apps, unknown };
}

// Two enabled apps that claim the same capability, action or default port. The first in tab order
// wins each one, so a fork listed next to the app it replaces loses silently without these lines.
function conflicts(apps) {
  const lines = [];
  const seen = new Map();
  const claim = (kind, key, id) => {
    const first = seen.get(`${kind}\n${key}`);
    if (first === undefined) seen.set(`${kind}\n${key}`, id);
    else lines.push(`${id} and ${first} both declare ${kind} "${key}"; ${first} has it. Disable one of them.`);
  };
  for (const a of apps) {
    for (const cap of Object.keys(a.provides ?? {})) claim('capability', cap, a.id);
    for (const name of Object.keys(a.actions?.handles ?? {})) claim('action', name, a.id);
    if (a.port) claim('port', String(a.port), a.id);
  }
  return lines;
}

function manifestError(m, id, root) {
  if (m?.manifest !== 1) return `unknown manifest version ${JSON.stringify(m?.manifest)}`;
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return `id ${JSON.stringify(m.id)} does not match ${ID_RE}`;
  if (m.id !== id) return `id "${m.id}" is not "${id}"`;
  if (typeof m.run?.entry !== 'string') return 'run.entry is missing';
  const entry = path.resolve(root, m.run.entry);
  if (entry === path.resolve(root) || !isContained(entry, root)) return 'run.entry is outside the app directory';
  return providesError(m.provides) ?? publishesError(m.publishes) ?? keysError(m.keys) ?? pluginError(m.plugin, root);
}

const PLUGIN_ID_RE = /^[\w.-]+@[\w.-]+$/;

function pluginError(plugin, root) {
  if (plugin === undefined) return null;
  if (typeof plugin?.id !== 'string' || !PLUGIN_ID_RE.test(plugin.id)) return 'plugin.id is not <name>@<marketplace>';
  if (typeof plugin.path !== 'string') return 'plugin.path is missing';
  const dir = path.resolve(root, plugin.path);
  if (dir === path.resolve(root) || !isContained(dir, root)) return 'plugin.path is outside the app directory';
  if (typeof plugin.install !== 'string' || !plugin.install) return 'plugin.install is missing';
  return null;
}

function keysError(keys) {
  if (keys === undefined) return null;
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) return 'keys is not an object';
  if (keys.keeps === undefined) return null;
  if (!Array.isArray(keys.keeps)) return 'keys.keeps is not an array';
  for (const c of keys.keeps) {
    if (typeof c !== 'string' || !COMBO_RE.test(c)) return `keys.keeps combo ${JSON.stringify(c)} is not a combo name`;
  }
  return null;
}

const TOPIC_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
// The hub publishes these itself.
const HUB_TOPICS = new Set(['theme.changed', 'project.changed']);

function publishesError(publishes) {
  if (publishes === undefined) return null;
  if (!Array.isArray(publishes)) return 'publishes is not an array';
  for (const t of publishes) {
    if (typeof t !== 'string' || !TOPIC_RE.test(t)) return `publishes topic ${JSON.stringify(t)} does not match ${TOPIC_RE}`;
    if (HUB_TOPICS.has(t) || t.startsWith('hub.')) return `publishes topic "${t}" is the hub's`;
  }
  return null;
}

// The hub fetches each path from the provider's own server.
const CAPABILITY_PATHS = { projects: 'path', terminal: 'liveWork' };

function providesError(provides) {
  if (provides === undefined) return null;
  if (typeof provides !== 'object' || provides === null || Array.isArray(provides)) return 'provides is not an object';
  for (const [cap, key] of Object.entries(CAPABILITY_PATHS)) {
    if (provides[cap] === undefined) continue;
    const p = provides[cap]?.[key];
    if (typeof p !== 'string' || !p.startsWith('/')) return `provides.${cap}.${key} is not a path`;
  }
  return null;
}

function readManifest(root, id) {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'hub-app.json'), 'utf8'));
  const err = manifestError(m, id, root);
  if (err) throw new Error(err);
  return m;
}

// The entry's path, else the submodule when it is checked out, else the installed package.
function appRoot(app, hubRoot, resolve) {
  if (app.path) return app.path;
  const local = path.join(hubRoot, app.dir);
  if (fs.existsSync(path.join(local, 'package.json'))) return local;
  return path.dirname(resolve(`${app.pkg}/package.json`));
}

// The --<id>-port flag, then the config entry's port. Undefined when neither is set and valid.
function userPort(app, flagPort, log) {
  const sources = [
    [`--${app.id}-port`, flagPort == null ? undefined : Number(flagPort)],
    [`"port" of "${app.id}" in config.json`, app.port],
  ];
  for (const [source, port] of sources) {
    if (port === undefined) continue;
    if (validPort(port)) return port;
    log(`${source} is not a valid port, ignored`);
  }
}

// Null, with a log line, when the app's hub-app.json is missing or not valid.
function loadApp(app, { flagPort, hubRoot = HUB_ROOT, resolve = require.resolve, log = console.log } = {}) {
  const root = appRoot(app, hubRoot, resolve);
  let manifest;
  try {
    manifest = readManifest(root, app.id);
  } catch (e) {
    const reason = e.code === 'ENOENT' ? 'not found' : e.message;
    log(`${path.join(root, 'hub-app.json')}: ${reason}. ${app.id} is skipped`);
    return null;
  }
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? null;
  } catch {}
  const { plugin } = manifest;
  return {
    id: app.id,
    version,
    plugin: plugin && {
      id: plugin.id,
      manifest: path.join(root, plugin.path, '.claude-plugin', 'plugin.json'),
      install: plugin.install,
    },
    entry: path.join(root, manifest.run.entry),
    port: userPort(app, flagPort, log) ?? manifest.run.defaultPort ?? 0,
    name: manifest.name ?? app.id,
    icon: manifest.icon,
    loading: manifest.loading ?? {},
    actions: manifest.actions ?? {},
    provides: manifest.provides ?? {},
    publishes: manifest.publishes ?? [],
    keeps: manifest.keys?.keeps ?? [],
  };
}

module.exports = { APPS, selectApps, loadApp, manifestError, conflicts };
