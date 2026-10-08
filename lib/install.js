'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { isDefaultConfigDir } = require('./plugin-status');

const PLUGIN_SRC = path.join(__dirname, '..', 'plugin');
const MARKETPLACE = 'claude-code-hub';
const PLUGIN_ID = `claude-code-hub@${MARKETPLACE}`;
const HUB_PLUGIN = {
  id: PLUGIN_ID,
  manifest: path.join(PLUGIN_SRC, 'plugins', 'claude-code-hub', '.claude-plugin', 'plugin.json'),
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

// One copy of the plugin in the hub dir; each config dir registers that copy as a marketplace.
function runInstall({ hubDir, configDir }) {
  const dest = path.join(hubDir, 'plugin');
  const env = claudeEnv(configDir);
  console.log(`\n  claude-code-hub plugin install\n  Config dir: ${configDir}\n  Plugin copy: ${dest}\n`);

  if (!run('claude --version', env).ok) {
    console.log('  claude CLI not found. Install Claude Code first.');
    return false;
  }

  clearFiles(dest);
  fs.cpSync(PLUGIN_SRC, dest, { recursive: true });
  console.log('  Copy plugin: done');

  let ok = report('Register marketplace', run(`claude plugin marketplace add "${dest}"`, env, ['already']), 'already registered');
  // Claude caches the marketplace manifest, so a re-copied plugin stays invisible until refreshed.
  ok = report('Refresh marketplace', run(`claude plugin marketplace update ${MARKETPLACE}`, env)) && ok;

  const install = run(`claude plugin install ${PLUGIN_ID}`, env, ['already installed']);
  ok = report('Install plugin', install, 'already installed') && ok;
  // `install` exits 0 on a plugin that is present and keeps the cached old version; `update` loads the new copy.
  if (install.idempotent) {
    ok = report('Update plugin', run(`claude plugin update ${PLUGIN_ID}`, env, ['already at the latest']), 'already at the latest version') && ok;
  }

  console.log(ok ? '\n  Done. Start a new Claude Code session to load the hub-builder skill.\n' : '\n  Install incomplete, see the errors above.\n');
  return ok;
}

// Keeps the plugin copy in the hub dir, because other config dirs can still point at it.
function runUninstall({ configDir }) {
  const env = claudeEnv(configDir);
  console.log(`\n  claude-code-hub plugin uninstall\n  Config dir: ${configDir}\n`);
  let ok = report('Remove plugin', run(`claude plugin uninstall ${PLUGIN_ID}`, env, ['not found', 'not installed']), 'not installed');
  ok = report('Remove marketplace', run(`claude plugin marketplace remove ${MARKETPLACE}`, env, ['not found', 'not configured']), 'not registered') && ok;
  console.log(ok ? '\n  Done.\n' : '\n  Uninstall incomplete, see the errors above.\n');
  return ok;
}

module.exports = { runInstall, runUninstall, claudeEnv, HUB_PLUGIN };
