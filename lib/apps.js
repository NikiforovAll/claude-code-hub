'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isContained } = require('./contain');
const { COMBO_RE } = require('./keymap');
const { bundledVersion } = require('./plugin-status');

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
const isObject = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

// `entries` is the hand-edited `apps` list in config.json. Listed apps come first in list order and
// unlisted ones follow in default order, so an app added in a later release shows up without an edit.
// An entry with a `path` runs the app in that folder: a fork in place of a built-in app, or a new app.
// A relative `path` is resolved against `base`, the folder of config.json.
// `includeOff` keeps the apps with `enabled: false` and gives every app `enabled`.
function selectApps(entries = [], base = process.cwd(), { includeOff = false } = {}) {
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
    .filter((a) => a && (includeOff || !off.has(a.id)))
    .map((a) => {
      const e = entryOf(a.id);
      return {
        ...a,
        ...(includeOff && { enabled: !off.has(a.id) }),
        port: e?.port,
        path: pathOf(a.id),
        hidden: e?.hidden === true,
        deferredStart: e?.deferredStart === true,
        linked: e?.source === 'local',
      };
    });
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
  return (
    providesError(m.provides) ??
    launcherError(m.launcher) ??
    publishesError(m.publishes) ??
    keysError(m.keys) ??
    pluginError(m.plugin, root) ??
    requiresError(m.requires) ??
    listingError(m.listing, root) ??
    settingsError(m.settings)
  );
}

const SETTING_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;
const MAX_SETTINGS = 20;
const plainText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[<>]/.test(v);
const validSettingValue = (s, v) => (s.type === 'boolean' ? typeof v === 'boolean' : s.options.some((o) => o.value === v));

function settingError(s) {
  if (!isObject(s) || typeof s.key !== 'string' || !SETTING_KEY_RE.test(s.key)) return `settings entry has no key matching ${SETTING_KEY_RE}`;
  const at = `settings "${s.key}"`;
  if (!plainText(s.label, 60)) return `${at}: label is not plain text of 60 characters or fewer`;
  if (s.help !== undefined && !plainText(s.help, 200)) return `${at}: help is not plain text of 200 characters or fewer`;
  if (s.type === 'boolean') return validSettingValue(s, s.default) ? null : `${at}: default is not a boolean`;
  if (s.type !== 'choice') return `${at}: type is not boolean or choice`;
  const { options } = s;
  if (!Array.isArray(options) || options.length < 2 || options.length > 6) return `${at}: options is not a list of 2 to 6`;
  for (const o of options) {
    if (!isObject(o) || typeof o.value !== 'string' || !o.value || !plainText(o.label, 30))
      return `${at}: an option has no string value or plain-text label`;
  }
  if (new Set(options.map((o) => o.value)).size !== options.length) return `${at}: two options share a value`;
  if (!validSettingValue(s, s.default)) return `${at}: default is not one of the option values`;
  return null;
}

function settingsError(settings) {
  if (settings === undefined) return null;
  if (!Array.isArray(settings) || settings.length > MAX_SETTINGS) return `settings is not a list of up to ${MAX_SETTINGS}`;
  for (const s of settings) {
    const err = settingError(s);
    if (err) return err;
  }
  if (new Set(settings.map((s) => s.key)).size !== settings.length) return 'two settings share a key';
  return null;
}

const PLUGIN_NAME_RE = /^[\w.-]+$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function pluginError(plugin, root) {
  if (plugin === undefined) return null;
  if (!isObject(plugin)) return 'plugin is not an object';
  if (typeof plugin.marketplace !== 'string') return 'plugin.marketplace is not a path';
  if (!isContained(path.resolve(root, plugin.marketplace), root)) return 'plugin.marketplace is outside the app directory';
  if (typeof plugin.name !== 'string' || !PLUGIN_NAME_RE.test(plugin.name)) return 'plugin.name is not a plugin name';
  if (plugin.install !== undefined && (typeof plugin.install !== 'string' || !plugin.install))
    return 'plugin.install is not a command';
  return null;
}

function requiresError(requires) {
  if (requires === undefined) return null;
  if (!isObject(requires)) return 'requires is not an object';
  for (const key of ['hub', 'node']) {
    const v = requires[key];
    if (v !== undefined && (typeof v !== 'string' || !VERSION_RE.test(v))) return `requires.${key} is not a version x.y.z`;
  }
  const { apps } = requires;
  if (apps !== undefined && (!Array.isArray(apps) || !apps.every((id) => typeof id === 'string' && ID_RE.test(id))))
    return 'requires.apps is not a list of app ids';
  return null;
}

const TAG_RE = /^[a-z0-9-]+$/;
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const SPDX_RE = /^[A-Za-z0-9.+-]+$/;
const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s/]+/.test(u);
const textError = (key, v, max) =>
  v === undefined || plainText(v, max)
    ? null
    : `listing.${key} is not plain text of ${max} characters or fewer`;

function listingError(listing, root) {
  if (listing === undefined) return null;
  if (!isObject(listing)) return 'listing is not an object';
  const err = textError('tagline', listing.tagline, 80) ?? textError('description', listing.description, 500) ?? textError('author', listing.author, 60);
  if (err) return err;
  const { tags, screenshots, homepage, license } = listing;
  if (tags !== undefined && (!Array.isArray(tags) || tags.length > 5 || !tags.every((t) => typeof t === 'string' && TAG_RE.test(t))))
    return 'listing.tags is not a list of up to 5 lowercase tags';
  if (screenshots !== undefined) {
    if (!Array.isArray(screenshots) || screenshots.length > 4) return 'listing.screenshots is not a list of up to 4';
    for (const s of screenshots) {
      if (!isObject(s) || typeof s.alt !== 'string' || !s.alt) return 'listing.screenshots entry has no alt';
      const text = textError('screenshots.title', s.title, 40) ?? textError('screenshots.caption', s.caption, 200);
      if (text) return text;
      if ((s.path === undefined) === (s.url === undefined)) return 'listing.screenshots entry needs one of path or url';
      const file = s.path ?? s.url;
      if (typeof file !== 'string' || !IMAGE_RE.test(file)) return 'listing.screenshots entry is not a PNG, JPEG or WebP file';
      if (s.url !== undefined && !isHttps(s.url)) return 'listing.screenshots url is not https';
      if (s.path !== undefined && !isContained(path.resolve(root, s.path), root)) return 'listing.screenshots path is outside the app directory';
    }
  }
  if (homepage !== undefined && !isHttps(homepage)) return 'listing.homepage is not an https URL';
  if (license !== undefined && (typeof license !== 'string' || !SPDX_RE.test(license))) return 'listing.license is not an SPDX id';
  return null;
}

// The plugin id, its folder, the hub command a user runs to install it, and `custom`, the manifest's own install
// command that the hub command runs. The id and folder come from marketplace.json, so this throws when it does not
// list the plugin as a folder inside the app directory.
function resolvePlugin(plugin, root, appId) {
  const dir = path.resolve(root, plugin.marketplace);
  const file = path.join(dir, '.claude-plugin', 'marketplace.json');
  let market;
  try {
    market = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file}: ${e.code === 'ENOENT' ? 'not found' : e.message}`);
  }
  if (typeof market?.name !== 'string' || !PLUGIN_NAME_RE.test(market.name)) throw new Error(`${file}: name is not a marketplace name`);
  const listed = Array.isArray(market.plugins) ? market.plugins.find((p) => p?.name === plugin.name) : undefined;
  if (!listed) throw new Error(`${file} does not list plugin "${plugin.name}"`);
  if (typeof listed.source !== 'string') throw new Error(`${file}: the source of "${plugin.name}" is not a folder`);
  const pluginDir = path.resolve(dir, listed.source);
  if (!isContained(pluginDir, root)) throw new Error(`${file}: the source of "${plugin.name}" is outside the app directory`);
  return {
    id: `${plugin.name}@${market.name}`,
    dir: pluginDir,
    bundled: bundledVersion(pluginDir),
    marketplace: { dir, name: market.name },
    install: `claude-code-hub ext install ${appId}`,
    custom: plugin.install ?? null,
  };
}

function keysError(keys) {
  if (keys === undefined) return null;
  if (!isObject(keys)) return 'keys is not an object';
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

const isPath = (p) => typeof p === 'string' && p.startsWith('/');

function providesError(provides) {
  if (provides === undefined) return null;
  if (!isObject(provides)) return 'provides is not an object';
  for (const [cap, key] of Object.entries(CAPABILITY_PATHS)) {
    if (provides[cap] === undefined) continue;
    if (!isPath(provides[cap]?.[key])) return `provides.${cap}.${key} is not a path`;
  }
  return null;
}

function launcherError(launcher) {
  if (launcher === undefined) return null;
  return isPath(launcher?.items) ? null : 'launcher.items is not a path';
}

// The manifest at root and its resolved plugin. With no id, the manifest's own id is checked. Throws with the file and the reason.
function readApp(root, id) {
  const file = path.join(root, 'hub-app.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const err = manifestError(manifest, id ?? manifest?.id, root);
    if (err) throw new Error(err);
    return { manifest, plugin: manifest.plugin && resolvePlugin(manifest.plugin, root, manifest.id) };
  } catch (e) {
    throw new Error(`${file}: ${e.code === 'ENOENT' ? 'not found' : e.message}`);
  }
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
  let plugin;
  try {
    ({ manifest, plugin } = readApp(root, app.id));
  } catch (e) {
    log(`${e.message}. ${app.id} is skipped`);
    return null;
  }
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? null;
  } catch {}
  return {
    id: app.id,
    version,
    plugin: plugin && { id: plugin.id, bundled: plugin.bundled, install: plugin.install },
    entry: path.join(root, manifest.run.entry),
    port: userPort(app, flagPort, log) ?? manifest.run.defaultPort ?? 0,
    name: manifest.name ?? app.id,
    hidden: app.hidden === true,
    deferredStart: app.deferredStart === true,
    linked: app.linked === true,
    icon: manifest.icon,
    loading: manifest.loading ?? {},
    actions: manifest.actions ?? {},
    provides: manifest.provides ?? {},
    launcher: manifest.launcher ?? {},
    publishes: manifest.publishes ?? [],
    keeps: manifest.keys?.keeps ?? [],
    settings: manifest.settings ?? [],
  };
}

module.exports = { APPS, HUB_ROOT, ID_RE, selectApps, appRoot, loadApp, manifestError, readApp, resolvePlugin, conflicts, isObject, validSettingValue };
