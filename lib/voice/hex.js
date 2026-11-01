'use strict';

// Speech provider: the Hex app's CLI (https://github.com/anomalyco/hex).
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Hex keeps one folder per version and names the current one in current-version.
function hexExe(root = path.join(process.env.APPDATA || '', 'hex')) {
  if (process.env.HEX_EXE) return process.env.HEX_EXE;
  try {
    const v = fs.readFileSync(path.join(root, 'current-version'), 'utf8').trim();
    const exe = path.join(root, 'versions', v, process.platform === 'win32' ? 'hex.exe' : 'hex');
    return fs.existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
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

module.exports = { createHex, hexExe };
