'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { bundledVersion, isDefaultConfigDir } = require('./plugin-status');

const PLUGIN_SRC = path.join(__dirname, '..', 'plugin');
const MARKETPLACE = 'claude-code-hub';
const PLUGIN_ID = `claude-code-hub@${MARKETPLACE}`;
const HUB_PLUGIN = {
  id: PLUGIN_ID,
  bundled: bundledVersion(path.join(PLUGIN_SRC, 'plugins', 'claude-code-hub')),
  install: 'claude-code-hub --install',
};

// Claude Code keeps .claude.json beside ~/.claude when CLAUDE_CONFIG_DIR is unset but inside the
// dir when it is set, so the default dir must stay unset rather than be spelled out.
function claudeEnv(configDir) {
  return isDefaultConfigDir(configDir) ? process.env : { ...process.env, CLAUDE_CONFIG_DIR: configDir };
}

// `idempotent` when the output names an ok pattern, on exit 0 too: some commands report "already" and succeed.
function run(cmd, env, okPatterns = []) {
  const matches = (text) => okPatterns.some((p) => text.toLowerCase().includes(p));
  try {
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }).trim();
    return { ok: true, idempotent: matches(output), output };
  } catch (e) {
    const error = e.stderr?.trim() || e.stdout?.trim() || e.message;
    if (matches(error)) return { ok: true, idempotent: true, output: '' };
    return { ok: false, error };
  }
}

// Deletes files but never directories: on Windows a running Claude Code process holds handles on
// the registered marketplace dirs, so removing one fails EPERM and leaves the copy half gone.
function clearFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) clearFiles(target);
    else fs.rmSync(target, { force: true });
  }
}

function report(label, result, idempotentText) {
  if (result.ok) console.log(`  ${label}: ${result.idempotent ? idempotentText : 'done'}`);
  else console.log(`  ${label}: failed\n    ${result.error.split('\n').join('\n    ')}`);
  return result.ok;
}

function hasClaude(env, exec = run) {
  if (exec('claude --version', env).ok) return true;
  console.log('  claude CLI not found. Install Claude Code first.');
  return false;
}

function registerMarketplace({ marketplaceDir, marketplace, env, exec = run }) {
  const ok = report('Register marketplace', exec(`claude plugin marketplace add "${marketplaceDir}"`, env, ['already']), 'already registered');
  // Claude caches the marketplace manifest, so a re-copied plugin stays invisible until refreshed.
  return report('Refresh marketplace', exec(`claude plugin marketplace update ${marketplace}`, env)) && ok;
}

function removePlugin({ pluginId, env, exec = run }) {
  return report('Remove plugin', exec(`claude plugin uninstall ${pluginId}`, env, ['not found', 'not installed']), 'not installed');
}

function installPlugin(args) {
  const { pluginId, env, exec = run } = args;
  let ok = registerMarketplace(args);
  const install = exec(`claude plugin install ${pluginId}`, env, ['already installed']);
  ok = report('Install plugin', install, 'already installed') && ok;
  // `install` exits 0 on a plugin that is present and keeps the cached old version; `update` loads the new copy.
  if (install.idempotent) {
    ok = report('Update plugin', exec(`claude plugin update ${pluginId}`, env, ['already at the latest']), 'already at the latest version') && ok;
  }
  return ok;
}

// `update` keeps the cached copy while the version is unchanged; uninstall and install copy the plugin again.
function reinstallPlugin(args) {
  const { pluginId, env, exec = run } = args;
  let ok = registerMarketplace(args);
  ok = removePlugin(args) && ok;
  return report('Install plugin', exec(`claude plugin install ${pluginId}`, env)) && ok;
}

function uninstallPlugin(args) {
  const { marketplace, env, exec = run } = args;
  const ok = removePlugin(args);
  return report('Remove marketplace', exec(`claude plugin marketplace remove ${marketplace}`, env, ['not found', 'not configured']), 'not registered') && ok;
}

// One copy of the plugin in the hub dir; each config dir registers that copy as a marketplace.
function runInstall({ hubDir, configDir }) {
  const dest = path.join(hubDir, 'plugin');
  const env = claudeEnv(configDir);
  console.log(`\n  claude-code-hub plugin install\n  Config dir: ${configDir}\n  Plugin copy: ${dest}\n`);

  if (!hasClaude(env)) return false;

  clearFiles(dest);
  fs.cpSync(PLUGIN_SRC, dest, { recursive: true });
  console.log('  Copy plugin: done');

  const ok = installPlugin({ marketplaceDir: dest, marketplace: MARKETPLACE, pluginId: PLUGIN_ID, env });
  console.log(ok ? '\n  Done. Start a new Claude Code session to load the hub-builder skill.\n' : '\n  Install incomplete, see the errors above.\n');
  return ok;
}

// Keeps the plugin copy in the hub dir, because other config dirs can still point at it.
function runUninstall({ configDir }) {
  const env = claudeEnv(configDir);
  console.log(`\n  claude-code-hub plugin uninstall\n  Config dir: ${configDir}\n`);
  const ok = uninstallPlugin({ marketplace: MARKETPLACE, pluginId: PLUGIN_ID, env });
  console.log(ok ? '\n  Done.\n' : '\n  Uninstall incomplete, see the errors above.\n');
  return ok;
}

module.exports = {
  runInstall,
  runUninstall,
  installPlugin,
  reinstallPlugin,
  uninstallPlugin,
  hasClaude,
  report,
  run,
  claudeEnv,
  HUB_PLUGIN,
};
