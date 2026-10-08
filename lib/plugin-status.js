'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isDefaultConfigDir(configDir) {
  return path.resolve(configDir) === path.resolve(os.homedir(), '.claude');
}

// --dir rather than CLAUDE_CONFIG_DIR=…, so the same line runs in bash, PowerShell and cmd.
function installCommand(base, configDir) {
  return isDefaultConfigDir(configDir) ? base : `${base} --dir "${configDir}"`;
}

// `plugin` is {id, manifest, install}: the plugin id, the path of the plugin.json the app ships, and
// its install command. The claude CLI records installs in <config dir>/plugins/installed_plugins.json,
// one entry per scope; a user-scope entry wins, because the installers install at user scope.
function pluginStatus(configDir, plugin) {
  const bundled = readJson(plugin.manifest)?.version ?? null;
  const installs = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'))?.plugins?.[plugin.id];
  const entries = Array.isArray(installs) ? installs : [];
  const entry = entries.find((e) => e?.scope === 'user') ?? entries[0];
  const installed = typeof entry?.version === 'string' ? entry.version : null;
  const enabled = readJson(path.join(configDir, 'settings.json'))?.enabledPlugins?.[plugin.id] !== false;
  let state = 'ok';
  if (!installed) state = 'missing';
  else if (!enabled) state = 'disabled';
  else if (bundled && installed !== bundled) state = 'mismatch';
  return { id: plugin.id, bundled, installed, state, installCommand: installCommand(plugin.install, configDir) };
}

module.exports = { pluginStatus, isDefaultConfigDir };
