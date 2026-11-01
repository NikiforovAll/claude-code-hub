'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { APPS, HUB_ROOT, ID_RE, selectApps, appRoot, readApp } = require('./apps');
const { isContained } = require('./contain');
const { readConfig, writeConfigFile } = require('./hub-config');
const { claudeEnv, hasClaude, installPlugin, reinstallPlugin, uninstallPlugin, report, run } = require('./install');
const { pluginChecker } = require('./plugin-status');
const { isNewer } = require('./update-check');

const USAGE = `Usage: claude-code-hub ext <command>

  ext install <name>     Install an extension from the registry, https://nikiforovall.blog/claude-code-hub/extensions/
  ext install github:<owner>/<repo>[/<folder>][@<commit or branch>]
                         Clone the extension into the hub dir, add it to the hub and install its plugin
  ext install <dir>      Run the extension in <dir> from the hub and install its plugin
  ext install <id>       Install the plugin of an app the hub runs, or put an add-on on the dock, in a config dir
  ext list               List the extensions and the state of their plugins
  ext update <id>        Get the latest code of a GitHub extension, and install its plugin again
  ext remove <id>        Remove the extension's plugin and its entry, and the clone of a GitHub extension

  A Kanban dock add-on (addon.json) installs the same way: in place of a plugin, it goes on the
  Kanban dock of the config dir, for every session.

  A feature the hub ships (voice) is turned on by ext install <id> and off by ext remove <id>.

  --hub-dir <path>       The hub dir (default CLAUDE_HUB_DIR, else ~/.claude-hub)
  --dir <path>           The config dir for plugin and dock steps (default CLAUDE_CONFIG_DIR, else ~/.claude)`;

const RESTART = '  Restart the hub to load the change.';
const REGISTRY = 'https://nikiforovall.blog/claude-code-hub/extensions.json';


function checkRequires(ctx, { id, requires }, config) {
  if (!requires) return;
  const fail = (why) => {
    throw new Error(`Cannot use ${id}: ${why}.`);
  };
  if (requires.hub && isNewer(requires.hub, ctx.hubVersion)) fail(`it needs hub ${requires.hub}, this hub is ${ctx.hubVersion}`);
  if (requires.node && isNewer(requires.node, ctx.nodeVersion)) fail(`it needs Node ${requires.node}, this is ${ctx.nodeVersion}`);
  const enabled = selectApps(config.apps, ctx.hubDir).apps.map((a) => a.id);
  const off = (requires.apps ?? []).filter((app) => !enabled.includes(app));
  if (off.length) fail(`it needs ${off.join(', ')} enabled in the hub`);
}

const isExt = (e) => typeof e?.id === 'string' && typeof e.source === 'string';

// [entry, kind] for each entry of the kinds' lists in config.json; extEntries keeps the extensions.
const allEntries = (config) => Object.values(KINDS).flatMap((kind) => (config[kind.list] ?? []).map((e) => [e, kind]));
const extEntries = (config) => allEntries(config).filter(([e]) => isExt(e));

const withList = (config, kind, change) => ({ ...config, [kind.list]: change(config[kind.list] ?? []) });

function extEntry(config, id) {
  if (!id) throw new Error(USAGE);
  const found = extEntries(config).find(([e]) => e.id === id);
  if (!found) throw new Error(`"${id}" is not an extension. ext list shows them.`);
  return found;
}

const isGithub = (entry) => entry.source.startsWith('github:');

function managedEntry(config, id, verb) {
  const found = extEntry(config, id);
  const [entry] = found;
  const { source } = entry;
  if (source !== 'local' && !isGithub(entry)) throw new Error(`${id} has source "${source}": only a local or GitHub extension can ${verb}.`);
  return found;
}

const rootOf = (ctx, entry) => path.resolve(ctx.hubDir, entry.path);

const GITHUB_RE = /^github:([\w.-]+)\/([\w.-]+)((?:\/[\w.-]+)*)(?:@(\w[\w./-]*))?$/;

function parseGithub(target) {
  const m = GITHUB_RE.exec(target);
  if (!m) throw new Error(`"${target}" is not a GitHub source. Write it as github:<owner>/<repo>[/<folder>][@<commit or branch>].`);
  const [, owner, repo, sub, ref] = m;
  return { owner, repo, subdir: sub.slice(1), ref, source: `github:${owner}/${repo}${sub}` };
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('git is not on PATH. Install git to install an extension from GitHub.');
    throw new Error(`git ${args[0]} failed: ${e.stderr?.trim() || e.message}`);
  }
}

function resolveRef(dir, ref) {
  for (const name of ref ? [`origin/${ref}`, ref] : ['origin/HEAD']) {
    try {
      return git(['rev-parse', '--verify', '--quiet', `${name}^{commit}`], dir);
    } catch {}
  }
  throw new Error(`${ref} is not a branch or a commit of the repo.`);
}

function checkout(dir, ref) {
  const sha = resolveRef(dir, ref);
  git(['checkout', '--quiet', '--detach', sha], dir);
  return sha;
}

// A partial clone with only the extension's folder checked out, because an extension can live in a big repo.
function cloneSource(ctx, src) {
  const base = path.join(ctx.hubDir, 'extensions');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, '.clone-'));
  try {
    git(['clone', '--quiet', '--filter=blob:none', '--no-checkout', `${ctx.githubBase}/${src.owner}/${src.repo}`, dir]);
    if (src.subdir) git(['sparse-checkout', 'set', src.subdir], dir);
    return { dir, sha: checkout(dir, src.ref) };
  } catch (e) {
    removeDir(dir);
    throw e;
  }
}

// The retries outlast a dock add-on's server, which the board stops a moment after the add-on goes.
function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    return true;
  } catch (e) {
    console.log(`  Could not delete ${dir} (${e.code ?? e.message}). Delete it by hand.`);
    return false;
  }
}

// Install scripts are off: they would run code from the clone before anyone has looked at it.
function installDeps(ctx, root) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return true;
  }
  if (!Object.keys(pkg?.dependencies ?? {}).length) return true;
  return report('Install dependencies', ctx.exec(`npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefix "${root}"`));
}

const cloneOf = (ctx, entry) => path.resolve(git(['rev-parse', '--show-toplevel'], rootOf(ctx, entry)));
const short = (sha) => sha.slice(0, 7);

// The registered marketplace with the plugin's marketplace name, when it comes from another folder.
function marketplaceClash(plugin, env, exec) {
  const res = exec('claude plugin marketplace list --json', env);
  if (!res.ok) return null;
  let list;
  try {
    list = JSON.parse(res.output);
  } catch {
    return null;
  }
  const { name, dir } = plugin.marketplace;
  const same = Array.isArray(list) ? list.find((m) => m?.name === name) : undefined;
  if (!same || (typeof same.path === 'string' && isContained(same.path, dir) && isContained(dir, same.path))) return null;
  return `marketplace "${name}" is registered from ${same.path ?? same.repo ?? same.source}. Remove it with: claude plugin marketplace remove ${name}`;
}

// A command that starts with one of the app's own bins runs that bin through node, because the bin is on
// PATH only when the app is installed on its own, not when it comes with the hub.
function appCommand(cmd, root) {
  const [name, ...rest] = cmd.split(' ');
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return cmd;
  }
  const file = typeof pkg?.bin === 'string' ? pkg.name === name && pkg.bin : pkg?.bin?.[name];
  if (typeof file !== 'string') return cmd;
  return [`"${process.execPath}"`, `"${path.join(root, file)}"`, ...rest].join(' ');
}

function pluginStep(ctx, plugin, step, root) {
  const configDir = ctx.configDir();
  const env = claudeEnv(configDir);
  console.log(`\n  Plugin ${plugin.id}\n  Config dir: ${configDir}\n`);
  if (!hasClaude(env, ctx.exec)) return false;
  if (plugin.custom && step !== 'uninstall') return report(plugin.custom, ctx.exec(appCommand(plugin.custom, root), env));
  if (step === 'install') {
    const clash = marketplaceClash(plugin, env, ctx.exec);
    if (clash) {
      console.log(`  Cannot register the plugin: ${clash}`);
      return false;
    }
  }
  const args = { marketplaceDir: plugin.marketplace.dir, marketplace: plugin.marketplace.name, pluginId: plugin.id, env, exec: ctx.exec };
  return { install: installPlugin, reinstall: reinstallPlugin, uninstall: uninstallPlugin }[step](args);
}

function readAddon(root, id) {
  const file = path.join(root, 'addon.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file}: ${e.code === 'ENOENT' ? 'not found' : e.message}`);
  }
  // Kanban's addon add --manifest checks the rest of the manifest.
  if (manifest?.kind !== 'addon' || !ID_RE.test(manifest.id ?? '')) {
    throw new Error(`${file}: an add-on manifest needs "kind": "addon" and an id of lowercase letters, digits and dashes`);
  }
  if (id && manifest.id !== id) throw new Error(`${file}: its id is ${manifest.id}, not ${id}`);
  return { manifest };
}

// Kanban's CLI writes the dock entry into the config dir's addons.json, and a running board picks it up.
// The manifest's id keys the entry, so an add again updates it.
function dockStep(ctx, id, _ext, step, root, config) {
  const kanban = selectApps(config.apps, ctx.hubDir).apps.find((a) => a.id === 'kanban');
  if (!kanban) {
    console.log('  Kanban is off in the hub, so it has no dock to change.');
    return false;
  }
  const configDir = ctx.configDir();
  console.log(`\n  Dock add-on ${id}\n  Config dir: ${configDir}\n`);
  const [label, cmd] =
    step === 'uninstall'
      ? ['Take it off the dock', `claude-code-kanban addon rm --key ${id} --offline`]
      : ['Put it on the dock', `claude-code-kanban addon add --manifest "${root}" --offline`];
  return report(label, ctx.exec(appCommand(cmd, appRoot(kanban, HUB_ROOT, require.resolve)), claudeEnv(configDir)));
}

// What differs between an app the hub runs (hub-app.json, with a plugin) and a Kanban dock add-on
// (addon.json, put on the dock). The hub keeps add-ons in `addons`, because it runs every entry of `apps`.
const KINDS = {
  app: {
    list: 'apps',
    file: 'hub-app.json',
    read: readApp,
    step: (ctx, _id, ext, step, root) => !ext?.plugin || pluginStep(ctx, ext.plugin, step, root),
    stepName: 'Plugin install',
    removeName: 'Plugin removal',
    unread: 'The plugin is not removed, because the manifest does not name it.',
    installed: RESTART,
    removed: RESTART,
    updated: 'Restart it (Ctrl+R in the app launcher) to load app changes, and start a new Claude Code session to load plugin changes.',
    noPlugin: 'no plugin',
  },
  addon: {
    list: 'addons',
    file: 'addon.json',
    read: readAddon,
    step: dockStep,
    stepName: 'Putting it on the dock',
    removeName: 'Taking it off the dock',
    unread: 'It is taken off the dock by its id.',
    installed: '  It is on the Kanban dock of every session in that config dir.',
    removed: '  It is off the Kanban dock of that config dir.',
    updated: 'Restart its server (Ctrl+R on its row in the app launcher) to load the new code.',
    noPlugin: 'dock add-on',
  },
};

const kindOf = (root) => (fs.existsSync(path.join(root, 'addon.json')) ? KINDS.addon : KINDS.app);

// An id the hub runs gets its plugin installed. A folder is added to the hub, with its plugin, unless the
// hub already runs it from there; then only the plugin is installed. Any other name is looked up in the registry.
function install(ctx, target) {
  if (!target) throw new Error(USAGE);
  const { file, config } = readConfig(ctx.hubDir);
  if (target.startsWith('github:')) return installGithub(ctx, target, file, config);
  if (/^(npm|https?):/.test(target)) throw new Error('Only a registry name, a github: source or a local folder installs. ext --help shows the forms.');
  const app = selectApps(config.apps, ctx.hubDir).apps.find((a) => a.id === target);
  if (app) return installAppPlugin(ctx, app);
  const [addon] = extEntries(config).find(([e, k]) => k === KINDS.addon && e.id === target) ?? [];
  if (addon) return dockStep(ctx, target, null, 'install', rootOf(ctx, addon), config);
  const feature = readFeature(target, ctx.features);
  if (feature) return setFeature(ctx, feature, true, file, config);
  if (!fs.existsSync(target) && ID_RE.test(target)) return installRegistry(ctx, target, file, config);
  return installFolder(ctx, target, file, config);
}

// A feature is code the hub ships, off by default: `ext install` checks what it needs and merges its
// `config` into config.json; `ext remove` sets `enabled: false` in each of those keys and keeps the rest.
const FEATURES = path.join(HUB_ROOT, 'features');
const TOOL_CHECKS = {
  'voice.hex': () => !!require('./voice/hex').hexExe(),
};
const OS_NAMES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

function readFeature(id, features = FEATURES) {
  if (!ID_RE.test(id ?? '')) return null;
  const file = path.join(features, id, 'feature.json');
  if (!fs.existsSync(file)) return null;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.kind !== 'feature' || manifest.id !== id || typeof manifest.config !== 'object') {
    throw new Error(`${file}: a feature manifest needs "kind": "feature", the id ${id} and a config object`);
  }
  return manifest;
}

function setFeature(ctx, feature, on, file, config) {
  const { id, title = id, requires = {} } = feature;
  if (on) {
    // The hub ships the feature, so its hub version is this one.
    checkRequires(ctx, { id, requires: { ...requires, hub: undefined } }, config);
    const platform = ctx.platform ?? process.platform;
    if (requires.os && !requires.os.includes(platform)) {
      throw new Error(`Cannot use ${id}: it runs on ${requires.os.map((o) => OS_NAMES[o] ?? o).join(' or ')} only.`);
    }
    const checks = { ...TOOL_CHECKS, ...ctx.toolChecks };
    const absent = (requires.tools ?? []).filter((t) => !checks[t.check]?.());
    const named = (t) => (t.url ? `${t.name} (${t.url})` : t.name);
    const missing = absent.filter((t) => !t.optional);
    if (missing.length) throw new Error(`Cannot use ${id}: install ${missing.map(named).join(' and ')} first.`);
    for (const t of absent.filter((t) => t.optional)) console.log(`\n  ${named(t)} is not installed. ${t.without ?? ''}`.trimEnd());
  }
  const next = { ...config };
  for (const [key, value] of Object.entries(feature.config)) {
    next[key] = on ? { ...config[key], ...value } : { ...config[key], enabled: false };
  }
  writeConfigFile(file, next);
  console.log(`\n  ${title} is ${on ? 'on' : 'off'}.\n${RESTART}`);
  return true;
}

// fetch is async and ext runs synchronously, so a child node reads the index.
const FETCH =
  'fetch(process.argv[1]).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); process.stdout.write(await r.text()); })' +
  '.catch((e) => { process.stderr.write(e.cause?.message ?? e.message); process.exitCode = 1; })';

function readRegistry(where) {
  let text;
  try {
    text = /^https?:/.test(where)
      ? execFileSync(process.execPath, ['-e', FETCH, where], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 })
      : fs.readFileSync(where, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read the registry ${where}: ${e.stderr?.trim() || e.message}`);
  }
  let list;
  try {
    list = JSON.parse(text).extensions;
  } catch {}
  if (!Array.isArray(list)) throw new Error(`The registry ${where} has no extensions list.`);
  return list;
}

// The entry keeps the GitHub source, not the name, so a later change to the registry does not move an installed extension.
function installRegistry(ctx, name, file, config) {
  const found = readRegistry(ctx.registry).find((x) => x?.id === name);
  if (!found) throw new Error(`"${name}" is not an app the hub runs, a folder, or an extension in the registry ${ctx.registry}.`);
  const target = found.pinned ? `${found.source}@${found.sha}` : found.source;
  console.log(`  ${name}: ${target}, from the registry`);
  return installGithub(ctx, target, file, config, name);
}

// The entry the hub has for the id when `same` accepts it; throws when the id is built-in or taken.
function claimId(id, config, file, kind, same) {
  if (APPS.some((a) => a.id === id)) throw new Error(`Cannot install ${id}: it is the id of a built-in app.`);
  const [entry, k] = allEntries(config).find(([e]) => e?.id === id) ?? [];
  const ours = entry && isExt(entry) && k === kind && same(entry);
  if (entry && !ours) throw new Error(`Cannot install ${id}: ${file} already has an entry for it.`);
  return entry;
}

// Runs the install step, then adds the entry. Returns false with nothing written when the step fails.
function addExtension(ctx, root, file, config, fields, kind) {
  const ext = kind.read(root);
  const { id } = ext.manifest;
  if (!kind.step(ctx, id, ext, 'install', root, config)) {
    console.log(`\n  ${kind.stepName} failed, so ${id} is not added. See the errors above.`);
    return false;
  }
  writeConfigFile(file, withList(config, kind, (list) => [...list, { id, ...fields }]));
  return true;
}

function installGithub(ctx, target, file, config, name) {
  const src = parseGithub(target);
  const { dir, sha } = cloneSource(ctx, src);
  let id;
  let kind;
  try {
    const extDir = path.join(dir, src.subdir);
    kind = kindOf(extDir);
    const ext = kind.read(extDir);
    id = ext.manifest.id;
    if (name && id !== name) throw new Error(`The registry lists ${name} at ${src.source}, but its ${kind.file} has the id ${id}.`);
    const entry = claimId(id, config, file, kind, (e) => e.source === src.source);
    if (entry) {
      removeDir(dir);
      const root = rootOf(ctx, entry);
      if (!kind.step(ctx, id, kind.read(root, id), 'install', root, config)) return false;
      console.log(`\n  ${id} is already in the hub, at ${short(entry.sha ?? '')}. ext update ${id} gets the latest code.`);
      return true;
    }
    checkRequires(ctx, ext.manifest, config);
  } catch (e) {
    removeDir(dir);
    throw e;
  }
  const clone = path.join(ctx.hubDir, 'extensions', id);
  if (fs.existsSync(clone) && !removeDir(clone)) {
    removeDir(dir);
    return false;
  }
  fs.renameSync(dir, clone);
  const root = path.join(clone, src.subdir);
  const rel = path.relative(ctx.hubDir, root).replaceAll('\\', '/');
  const fields = { path: rel, source: src.source, ...(src.ref && { ref: src.ref }), sha };
  if (!installDeps(ctx, root) || !addExtension(ctx, root, file, config, fields, kind)) {
    removeDir(clone);
    return false;
  }
  console.log(`\n  Installed ${id} from ${src.source} at ${short(sha)}.\n${kind.installed}`);
  return true;
}

function installAppPlugin(ctx, app) {
  const { root, plugin: p } = appPlugin(app);
  if (!p) throw new Error(`${app.id} ships no plugin.`);
  return pluginStep(ctx, p, 'install', root);
}

function installFolder(ctx, target, file, config) {
  let root;
  try {
    root = fs.realpathSync.native(path.resolve(target));
  } catch {
    throw new Error(`"${target}" is not an app the hub runs, and no folder has that name.`);
  }
  const kind = kindOf(root);
  const ext = kind.read(root);
  const { id } = ext.manifest;
  const entry = claimId(id, config, file, kind, (e) => rootOf(ctx, e) === root);
  checkRequires(ctx, ext.manifest, config);
  if (entry) {
    if (!kind.step(ctx, id, ext, 'install', root, config)) {
      console.log(`\n  ${kind.stepName} failed. See the errors above.`);
      return false;
    }
    console.log(`\n  ${id} is already in the hub.`);
    return true;
  }
  const linked = root.replaceAll('\\', '/');
  if (!addExtension(ctx, root, file, config, { path: linked, source: 'local' }, kind)) return false;
  console.log(`\n  Linked ${id} to ${linked}.\n${kind.installed}`);
  return true;
}

function list(ctx) {
  const { config } = readConfig(ctx.hubDir);
  const entries = extEntries(config);
  if (!entries.length) {
    console.log('  No extensions.');
    return true;
  }
  const check = pluginChecker(ctx.configDir());
  for (const [e, kind] of entries) {
    const where = e.source === 'local' ? `local ${e.path}` : [e.source, e.ref, e.sha && short(e.sha)].filter(Boolean).join(' ');
    let plugin = kind.noPlugin;
    try {
      const p = kind.read(rootOf(ctx, e), e.id).plugin;
      if (p) plugin = `${p.id} ${check(p).state}`;
    } catch (err) {
      plugin = err.message;
    }
    console.log(`  ${e.id}  ${where}  ${plugin}`);
  }
  return true;
}

// A GitHub extension moves to the tip of its ref, or of the default branch, and goes back when the new code fails.
function update(ctx, id) {
  const { file, config } = readConfig(ctx.hubDir);
  const [entry, kind] = managedEntry(config, id, 'update');
  const root = rootOf(ctx, entry);
  let sha;
  if (isGithub(entry)) {
    const clone = cloneOf(ctx, entry);
    git(['fetch', '--quiet', 'origin'], clone);
    sha = checkout(clone, entry.ref);
    const back = () => entry.sha && entry.sha !== sha && checkout(clone, entry.sha);
    try {
      checkRequires(ctx, kind.read(root, id).manifest, config);
    } catch (e) {
      back();
      throw e;
    }
    if (!installDeps(ctx, root)) {
      back();
      return false;
    }
  } else {
    checkRequires(ctx, kind.read(root, id).manifest, config);
  }
  if (!kind.step(ctx, id, kind.read(root, id), 'reinstall', root, config)) return false;
  if (sha && sha !== entry.sha) writeConfigFile(file, withList(config, kind, (list) => list.map((e) => (e === entry ? { ...e, sha } : e))));
  const at = sha ? ` to ${short(sha)}` : '';
  console.log(`\n  Updated ${id}${at}. ${kind.updated}`);
  return true;
}

function remove(ctx, id) {
  const { file, config } = readConfig(ctx.hubDir);
  const feature = readFeature(id, ctx.features);
  if (feature) return setFeature(ctx, feature, false, file, config);
  const [entry, kind] = managedEntry(config, id, 'be removed');
  const root = rootOf(ctx, entry);
  let ext = null;
  try {
    ext = kind.read(root, id);
  } catch (e) {
    console.log(`  ${e.message}\n  ${kind.unread}`);
  }
  if (!kind.step(ctx, id, ext, 'uninstall', root, config)) {
    console.log(`\n  ${kind.removeName} failed, so ${id} keeps its entry. See the errors above.`);
    return false;
  }
  const extensions = path.join(ctx.hubDir, 'extensions');
  const clone = isGithub(entry) ? path.join(extensions, id) : null;
  writeConfigFile(file, withList(config, kind, (list) => list.filter((e) => e !== entry)));
  if (clone && isContained(clone, extensions) && fs.existsSync(clone)) {
    if (removeDir(clone)) console.log(`\n  Removed ${id} and its clone.\n${kind.removed}`);
    return true;
  }
  console.log(`\n  Removed ${id}. ${entry.path} is left in place.\n${kind.removed}`);
  return true;
}

function appPlugin(app) {
  const root = appRoot(app, HUB_ROOT, require.resolve);
  return { root, plugin: readApp(root, app.id).plugin };
}

// For --install: the plugins of the enabled built-in apps. Extensions install theirs with ext install.
function installBuiltInPlugins(ctx) {
  const full = { exec: run, ...ctx };
  let ok = true;
  let config;
  try {
    ({ config } = readConfig(full.hubDir));
  } catch (e) {
    console.error(`  ${e.message}`);
    return false;
  }
  for (const app of selectApps(config.apps, full.hubDir).apps.filter((a) => APPS.some((b) => b.id === a.id))) {
    try {
      const { root, plugin: p } = appPlugin(app);
      if (p) ok = pluginStep(full, p, 'install', root) && ok;
    } catch (e) {
      console.error(`  ${e.message}`);
      ok = false;
    }
  }
  return ok;
}

const COMMANDS = { install, list, update, remove };

// ctx: {hubDir, configDir: () => dir for plugin steps, hubVersion, nodeVersion?, exec?, githubBase?, registry?: URL or file}.
function runExt(argv, ctx) {
  const registry = process.env.CLAUDE_HUB_REGISTRY || REGISTRY;
  const full = { nodeVersion: process.versions.node, exec: run, githubBase: 'https://github.com', registry, ...ctx };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { dir: { type: 'string' }, 'hub-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    });
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    return false;
  }
  const [name, target] = parsed.positionals;
  const command = COMMANDS[name];
  if (!command || parsed.values.help) {
    console.log(USAGE);
    return !!parsed.values.help;
  }
  try {
    return command(full, target, parsed.values);
  } catch (e) {
    console.error(`  ${e.message}`);
    return false;
  }
}

module.exports = { runExt, installBuiltInPlugins, USAGE };
