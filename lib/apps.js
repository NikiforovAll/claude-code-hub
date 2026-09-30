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

const validPort = (p) => Number.isInteger(p) && p > 0 && p < 65536;

// `entries` is the hand-edited `apps` list in config.json. Listed apps come first in list order and
// unlisted ones follow in default order, so an app added in a later release shows up without an edit.
function selectApps(entries = []) {
  const listed = entries.filter((e) => typeof e?.id === 'string');
  const byId = (id) => APPS.find((a) => a.id === id);
  const unknown = listed.map((e) => e.id).filter((id) => !byId(id));
  const off = new Set(listed.filter((e) => e.enabled === false).map((e) => e.id));
  const order = new Set([...listed.map((e) => e.id), ...APPS.map((a) => a.id)]);
  const apps = [...order]
    .map(byId)
    .filter((a) => a && !off.has(a.id))
    .map((a) => ({ ...a, port: listed.find((e) => e.id === a.id)?.port }));
  return { apps, unknown };
}

function manifestError(m, id, root) {
  if (m?.manifest !== 1) return `unknown manifest version ${JSON.stringify(m?.manifest)}`;
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return `id ${JSON.stringify(m.id)} does not match ${ID_RE}`;
  if (m.id !== id) return `id "${m.id}" is not "${id}"`;
  if (typeof m.run?.entry !== 'string') return 'run.entry is missing';
  const entry = path.resolve(root, m.run.entry);
  if (entry === path.resolve(root) || !isContained(entry, root)) return 'run.entry is outside the app directory';
  return providesError(m.provides) ?? publishesError(m.publishes);
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

// The submodule when it is checked out, else the installed package.
function appRoot(app, hubRoot, resolve) {
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
  return {
    id: app.id,
    entry: path.join(root, manifest.run.entry),
    port: userPort(app, flagPort, log) ?? manifest.run.defaultPort ?? 0,
    name: manifest.name ?? app.id,
    icon: manifest.icon,
    loading: manifest.loading ?? {},
    actions: manifest.actions ?? {},
    provides: manifest.provides ?? {},
    publishes: manifest.publishes ?? [],
  };
}

module.exports = { APPS, selectApps, loadApp, manifestError };
