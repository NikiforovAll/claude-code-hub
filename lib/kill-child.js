'use strict';
const { spawn: nodeSpawn } = require('node:child_process');

const KILL_GRACE_MS = 3000;

const exited = (child) => child.exitCode !== null || child.signalCode !== null;

// POSIX: SIGTERM lets an app run its exit handlers (cck removes its server.json and ends its
// terminals), but a handler on a frozen event loop never runs, so SIGKILL follows. Windows has no
// SIGTERM for a Node child: taskkill /f /t ends it and the processes it started.
// Resolves when the child has exited, or after graceMs (with SIGKILL sent on POSIX).
function killChild(child, { platform = process.platform, spawn = nodeSpawn, graceMs = KILL_GRACE_MS } = {}) {
  if (exited(child)) return Promise.resolve();
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (platform !== 'win32' && !exited(child)) child.kill('SIGKILL');
      resolve();
    }, graceMs);
    timer.unref();
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.hubKilled) return done;
  child.hubKilled = true;
  if (platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
  return done;
}

module.exports = { killChild, KILL_GRACE_MS };
