'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { APPS, HUB_ROOT, selectApps, appRoot, readApp } = require('./apps');
const { isContained } = require('./contain');
const { writeConfigFile } = require('./hub-config');
const { claudeEnv, hasClaude, installPlugin, reinstallPlugin, uninstallPlugin, report, run } = require('./install');
const { pluginChecker } = require('./plugin-status');
const { isNewer } = require('./update-check');

const USAGE = `Usage: claude-code-hub ext <command>

  ext install github:<owner>/<repo>[/<folder>][@<commit or branch>]
                         Clone the extension into the hub dir, add it to the hub and install its plugin
  ext install <dir>      Run the extension in <dir> from the hub and install its plugin
  ext install <id>       Install the plugin of an app the hub runs, in a config dir
  ext list               List the extensions and the state of their plugins
  ext update <id>        Get the latest code of a GitHub extension, and install its plugin again
  ext remove <id>        Remove the extension's plugin and its entry, and the clone of a GitHub extension

  --hub-dir <path>       The hub dir (default CLAUDE_HUB_DIR, else ~/.claude-hub)
  --dir <path>           The config dir for plugin steps (default CLAUDE_CONFIG_DIR, else ~/.claude)`;

const RESTART = '  Restart the hub to load the change.';

function readConfig(hubDir) {
  const file = path.join(hubDir, 'config.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { file, config: {} };
    throw e;
  }
  try {
    return { file, config: JSON.parse(raw) };
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
}

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

function extEntry(config, id) {
  if (!id) throw new Error(USAGE);
  const entry = (config.apps ?? []).find((e) => isExt(e) && e.id === id);
  if (!entry) throw new Error(`"${id}" is not an extension. ext list shows them.`);
  return entry;
}

const isGithub = (entry) => entry.source.startsWith('github:');

function managedEntry(config, id, verb) {
  const entry = extEntry(config, id);
  if (entry.source !== 'local' && !isGithub(entry)) throw new Error(`${id} has source "${entry.source}": only a local or GitHub extension can ${verb}.`);
  return entry;
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

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
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

// An id the hub runs gets its plugin installed. A folder is added to the hub, with its plugin, unless the
// hub already runs it from there; then only the plugin is installed.
function install(ctx, target) {
  if (!target) throw new Error(USAGE);
  const { file, config } = readConfig(ctx.hubDir);
  if (target.startsWith('github:')) return installGithub(ctx, target, file, config);
  if (/^(npm|https?):/.test(target)) throw new Error('Only a github: source or a local folder installs. ext --help shows the forms.');
  const app = selectApps(config.apps, ctx.hubDir).apps.find((a) => a.id === target);
  return app ? installAppPlugin(ctx, app) : installFolder(ctx, target, file, config);
}

// The entry the hub has for the id when `same` accepts it; throws when the id is built-in or taken.
function claimId(id, config, file, same) {
  if (APPS.some((a) => a.id === id)) throw new Error(`Cannot install ${id}: it is the id of a built-in app.`);
  const entry = (config.apps ?? []).find((e) => e?.id === id);
  if (entry && !(isExt(entry) && same(entry))) throw new Error(`Cannot install ${id}: ${file} already has an entry for it.`);
  return entry;
}

// Installs the plugin, then adds the entry. Returns false with nothing written when the plugin fails.
function addExtension(ctx, root, file, config, fields) {
  const ext = readApp(root);
  const { id } = ext.manifest;
  if (ext.plugin && !pluginStep(ctx, ext.plugin, 'install', root)) {
    console.log(`\n  Plugin install failed, so ${id} is not added. See the errors above.`);
    return false;
  }
  writeConfigFile(file, { ...config, apps: [...(config.apps ?? []), { id, ...fields }] });
  return true;
}

function installGithub(ctx, target, file, config) {
  const src = parseGithub(target);
  const { dir, sha } = cloneSource(ctx, src);
  let id;
  try {
    const ext = readApp(path.join(dir, src.subdir));
    id = ext.manifest.id;
    const entry = claimId(id, config, file, (e) => e.source === src.source);
    if (entry) {
      removeDir(dir);
      const root = rootOf(ctx, entry);
      const { plugin } = readApp(root, id);
      if (plugin && !pluginStep(ctx, plugin, 'install', root)) return false;
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
  if (!installDeps(ctx, root) || !addExtension(ctx, root, file, config, fields)) {
    removeDir(clone);
    return false;
  }
  console.log(`\n  Installed ${id} from ${src.source} at ${short(sha)}.\n${RESTART}`);
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
  const ext = readApp(root);
  const { id } = ext.manifest;
  const entry = claimId(id, config, file, (e) => rootOf(ctx, e) === root);
  checkRequires(ctx, ext.manifest, config);
  if (entry) {
    if (ext.plugin && !pluginStep(ctx, ext.plugin, 'install', root)) {
      console.log('\n  Plugin install failed. See the errors above.');
      return false;
    }
    console.log(`\n  ${id} is already in the hub.`);
    return true;
  }
  const linked = root.replaceAll('\\', '/');
  if (!addExtension(ctx, root, file, config, { path: linked, source: 'local' })) return false;
  console.log(`\n  Linked ${id} to ${linked}.\n${RESTART}`);
  return true;
}

function list(ctx) {
  const { config } = readConfig(ctx.hubDir);
  const entries = (config.apps ?? []).filter(isExt);
  if (!entries.length) {
    console.log('  No extensions.');
    return true;
  }
  const check = pluginChecker(ctx.configDir());
  for (const e of entries) {
    const where = e.source === 'local' ? `local ${e.path}` : [e.source, e.ref, e.sha && short(e.sha)].filter(Boolean).join(' ');
    let plugin = 'no plugin';
    try {
      const p = readApp(rootOf(ctx, e), e.id).plugin;
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
  const entry = managedEntry(config, id, 'update');
  const root = rootOf(ctx, entry);
  let sha;
  if (isGithub(entry)) {
    const clone = cloneOf(ctx, entry);
    git(['fetch', '--quiet', 'origin'], clone);
    sha = checkout(clone, entry.ref);
    const back = () => entry.sha && entry.sha !== sha && checkout(clone, entry.sha);
    try {
      checkRequires(ctx, readApp(root, id).manifest, config);
    } catch (e) {
      back();
      throw e;
    }
    if (!installDeps(ctx, root)) {
      back();
      return false;
    }
  } else {
    checkRequires(ctx, readApp(root, id).manifest, config);
  }
  const { plugin } = readApp(root, id);
  if (plugin && !pluginStep(ctx, plugin, 'reinstall', root)) return false;
  if (sha && sha !== entry.sha) writeConfigFile(file, { ...config, apps: config.apps.map((e) => (e === entry ? { ...e, sha } : e)) });
  const at = sha ? ` to ${short(sha)}` : '';
  console.log(`\n  Updated ${id}${at}. Restart it (Ctrl+R in the app launcher) to load app changes, and start a new Claude Code session to load plugin changes.`);
  return true;
}

function remove(ctx, id) {
  const { file, config } = readConfig(ctx.hubDir);
  const entry = managedEntry(config, id, 'be removed');
  let ext = null;
  try {
    ext = readApp(rootOf(ctx, entry), id);
  } catch (e) {
    console.log(`  ${e.message}\n  The plugin is not removed, because the manifest does not name it.`);
  }
  if (ext?.plugin && !pluginStep(ctx, ext.plugin, 'uninstall')) {
    console.log(`\n  Plugin removal failed, so ${id} keeps its entry. See the errors above.`);
    return false;
  }
  const extensions = path.join(ctx.hubDir, 'extensions');
  const clone = isGithub(entry) ? path.join(extensions, id) : null;
  writeConfigFile(file, { ...config, apps: config.apps.filter((e) => e !== entry) });
  if (clone && isContained(clone, extensions) && fs.existsSync(clone)) {
    if (removeDir(clone)) console.log(`\n  Removed ${id} and its clone.\n${RESTART}`);
    return true;
  }
  console.log(`\n  Removed ${id}. ${entry.path} is left in place.\n${RESTART}`);
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

// ctx: {hubDir, configDir: () => dir for plugin steps, hubVersion, nodeVersion?, exec?, githubBase?}.
function runExt(argv, ctx) {
  const full = { nodeVersion: process.versions.node, exec: run, githubBase: 'https://github.com', ...ctx };
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
