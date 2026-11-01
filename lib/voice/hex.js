'use strict';

// Speech provider: the Hex app's CLI (https://github.com/anomalyco/hex).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Hex's data folder, as Hex's app_paths::support_dir resolves it (Rust dirs::data_dir). It holds
// local-api.json on every OS.
function hexDir({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.HEX_APPLICATION_SUPPORT_DIR) return env.HEX_APPLICATION_SUPPORT_DIR;
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'hex');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'hex');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'hex');
}

// Where Hex's installers put the CLI: Windows keeps one folder per version and names the current one
// in current-version, Linux links `current` to it, and macOS has it inside Hex.app.
function hexCandidates({ platform, home, dir }) {
  if (platform === 'darwin') return ['/Applications', path.join(home, 'Applications')].map((d) => path.join(d, 'Hex.app', 'Contents', 'MacOS', 'hex'));
  if (platform !== 'win32') return [path.join(dir, 'current', 'hex')];
  try {
    const v = fs.readFileSync(path.join(dir, 'current-version'), 'utf8').trim();
    return [path.join(dir, 'versions', v, 'hex.exe')];
  } catch {
    return [];
  }
}

function hexExe({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.HEX_EXE) return env.HEX_EXE;
  const dir = hexDir({ env, platform, home });
  return hexCandidates({ platform, home, dir }).find((f) => fs.existsSync(f)) ?? null;
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: e.message });
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

// `dictation stop --print` prints the transcript, and exits 4 when Hex heard no speech.
function createHex({ exe = hexExe() } = {}) {
  async function call(action) {
    if (!exe) return { ok: false, error: 'Hex is not installed' };
    const args = action === 'stop' ? ['dictation', 'stop', '--print'] : ['dictation', action];
    const r = await run(exe, args, 70_000);
    const error = r.code ? (r.err || r.out).trim() || `hex exited ${r.code}` : undefined;
    if (action !== 'stop') return { ok: !r.code, error };
    if (r.code === 4) return { ok: true, text: '' };
    return { ok: !r.code, text: r.out.trim(), error };
  }
  return { start: () => call('start'), stop: () => call('stop'), cancel: () => call('cancel') };
}

module.exports = { createHex, hexDir, hexExe };
