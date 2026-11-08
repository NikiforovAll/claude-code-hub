'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pluginChecker } = require('./plugin-status');

const ONBOARDING = ['done', 'skipped'];
const SETTLED = new Set(['ok', 'disabled']);

function canonical(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

// Claude config dirs in the home folder that the hub does not list yet: a `.claude*` folder with a
// settings.json or a projects folder, so a cache or a backup folder is left out.
function findConfigDirs({ home, known, hubDir }) {
  let entries;
  try {
    entries = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    return [];
  }
  const skip = new Set([...known, hubDir].map((d) => canonical(d) ?? d));
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith('.claude'))
    .map((e) => path.join(home, e.name))
    .filter((d) => fs.existsSync(path.join(d, 'settings.json')) || fs.existsSync(path.join(d, 'projects')))
    .map((d) => canonical(d))
    .filter((d) => d && !skip.has(d))
    .sort();
}

// `plugins` is [{id, name, bundled, install, args}]: args are the hub command-line arguments that install it.
function dirPlugins(configDir, plugins) {
  const check = pluginChecker(configDir);
  return plugins.map((p) => {
    const { state, installed, bundled } = check(p);
    return { id: p.id, name: p.name, state, installed, bundled };
  });
}

function pluginsToInstall(configDir, plugins) {
  const check = pluginChecker(configDir);
  return plugins.filter((p) => !SETTLED.has(check(p).state));
}

function setupStatus({ tray, configDirs, activeConfigDir, candidates, plugins }) {
  const dirs = configDirs.map((d) => {
    const list = dirPlugins(d, plugins);
    return { path: d, active: d === activeConfigDir, plugins: list, pending: list.some((p) => !SETTLED.has(p.state)) };
  });
  return { tray, dirs, candidates, pluginsDone: dirs.every((d) => !d.pending) };
}

module.exports = { ONBOARDING, findConfigDirs, pluginsToInstall, setupStatus };
