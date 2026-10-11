'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { APPS, selectApps, readApp } = require('./apps');
const { isContained } = require('./contain');
const { writeConfigFile } = require('./hub-config');
const { claudeEnv, hasClaude, installPlugin, reinstallPlugin, uninstallPlugin, report, run } = require('./install');
const { pluginChecker } = require('./plugin-status');
const { isNewer } = require('./update-check');

const USAGE = `Usage: claude-code-hub ext <command>

  ext add <dir> --link   Run the extension in <dir> from the hub and install its plugin
  ext list               List the extensions and the state of their plugins
  ext update <id>        Install the plugin of a linked extension again
  ext remove <id>        Remove the extension's plugin and its entry
  ext plugin <id>        Install the extension's plugin in a config dir

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

function linkedEntry(config, id, verb) {
  const entry = extEntry(config, id);
  if (entry.source !== 'local') throw new Error(`Only a linked extension can ${verb} for now.`);
  return entry;
}

const rootOf = (ctx, entry) => path.resolve(ctx.hubDir, entry.path);

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

function pluginStep(ctx, plugin, step) {
  const configDir = ctx.configDir();
  const env = claudeEnv(configDir);
  console.log(`\n  Plugin ${plugin.id}\n  Config dir: ${configDir}\n`);
  if (!hasClaude(env, ctx.exec)) return false;
  if (plugin.custom && step !== 'uninstall') return report(plugin.install, ctx.exec(plugin.install, env));
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

function add(ctx, target, opts) {
  if (!opts.link) throw new Error('ext add from GitHub is not built yet. To run an extension from a local folder: ext add <dir> --link');
  if (!target) throw new Error(USAGE);
  let root;
  try {
    root = fs.realpathSync.native(path.resolve(target));
  } catch {
    throw new Error(`Folder not found: ${target}`);
  }
  const ext = readApp(root);
  const { id } = ext.manifest;
  const { file, config } = readConfig(ctx.hubDir);
  if (APPS.some((a) => a.id === id)) throw new Error(`Cannot add ${id}: it is the id of a built-in app.`);
  if ((config.apps ?? []).some((e) => e?.id === id)) throw new Error(`Cannot add ${id}: ${file} already has an entry for it.`);
  checkRequires(ctx, ext.manifest, config);
  if (ext.plugin && !pluginStep(ctx, ext.plugin, 'install')) {
    console.log(`\n  Plugin install failed, so ${id} is not added. See the errors above.`);
    return false;
  }
  const entry = { id, path: root.replaceAll('\\', '/'), source: 'local', deferredStart: true };
  writeConfigFile(file, { ...config, apps: [...(config.apps ?? []), entry] });
  console.log(`\n  Linked ${id} to ${entry.path}.\n${RESTART} Start ${id} from the app launcher (Ctrl+Alt+A).`);
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
    const where = e.source === 'local' ? `local ${e.path}` : [e.source, e.ref, e.sha].filter(Boolean).join(' ');
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

function update(ctx, id) {
  const { config } = readConfig(ctx.hubDir);
  const entry = linkedEntry(config, id, 'update');
  const ext = readApp(rootOf(ctx, entry), id);
  checkRequires(ctx, ext.manifest, config);
  if (ext.plugin && !pluginStep(ctx, ext.plugin, 'reinstall')) return false;
  console.log(`\n  Updated ${id}. Restart it (Ctrl+R in the app launcher) to load app changes, and start a new Claude Code session to load plugin changes.`);
  return true;
}

function remove(ctx, id) {
  const { file, config } = readConfig(ctx.hubDir);
  const entry = linkedEntry(config, id, 'be removed');
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
  writeConfigFile(file, { ...config, apps: config.apps.filter((e) => e !== entry) });
  console.log(`\n  Removed ${id}. ${entry.path} is left in place.\n${RESTART}`);
  return true;
}

function plugin(ctx, id) {
  const { config } = readConfig(ctx.hubDir);
  const entry = extEntry(config, id);
  const ext = readApp(rootOf(ctx, entry), id);
  if (!ext.plugin) throw new Error(`${id} ships no plugin.`);
  return pluginStep(ctx, ext.plugin, 'install');
}

const COMMANDS = { add, list, update, remove, plugin };

// ctx: {hubDir, configDir: () => dir for plugin steps, hubVersion, nodeVersion?, exec?}.
function runExt(argv, ctx) {
  const full = { nodeVersion: process.versions.node, exec: run, ...ctx };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { link: { type: 'boolean' }, dir: { type: 'string' }, 'hub-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' } },
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

module.exports = { runExt, USAGE };
