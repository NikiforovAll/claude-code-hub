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

// The version in the plugin.json under pluginDir, the folder an app or the hub ships its plugin in.
function bundledVersion(pluginDir) {
  return readJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'))?.version ?? null;
}

// Reads the config dir once and gives a check for each plugin, {id, bundled, install}. The claude CLI
// records installs in <config dir>/plugins/installed_plugins.json, one entry per scope; a user-scope
// entry wins, because the installers install at user scope.
function pluginChecker(configDir) {
  const installs = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
  const enabledPlugins = readJson(path.join(configDir, 'settings.json'))?.enabledPlugins ?? {};
  return ({ id, bundled, install }) => {
    const entries = Array.isArray(installs[id]) ? installs[id] : [];
    const entry = entries.find((e) => e?.scope === 'user') ?? entries[0];
    const installed = typeof entry?.version === 'string' ? entry.version : null;
    let state = 'ok';
    if (!installed) state = 'missing';
    else if (enabledPlugins[id] === false) state = 'disabled';
    else if (bundled && installed !== bundled) state = 'mismatch';
    return { id, bundled, installed, state, installCommand: installCommand(install, configDir) };
  };
}

module.exports = { pluginChecker, bundledVersion, isDefaultConfigDir };
