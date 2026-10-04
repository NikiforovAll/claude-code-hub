'use strict';

const { execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');
const { liveHub } = require('./hub-record');

const TRAY_SRC = path.join(__dirname, '..', 'tray');
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

// One Run value and one tray per hub dir, so a test hub never replaces the real autostart.
function runValue(hubDir) {
  const hash = crypto.createHash('sha1').update(path.resolve(hubDir).toLowerCase()).digest('hex').slice(0, 8);
  return `ClaudeCodeHub-${hash}`;
}

// An installed app is bound to the origin it was installed from, and its shortcut does not record
// it, so the tray opens the app only when the hub runs on the port the app is assumed to serve.
function appConfig({ appId, port, defaultPort }) {
  return appId ? { id: appId, port } : { name: 'Claude Code Hub', port: defaultPort };
}

// The Run key and the tray start from this copy, never from the package: an npx cache path can vanish.
function copyTray({ hubDir, port, appId, defaultPort, value }) {
  const dest = path.join(hubDir, 'tray');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(TRAY_SRC, dest, { recursive: true });
  const config = {
    port,
    app: appConfig({ appId, port, defaultPort }),
    version,
    serverJs: path.join(__dirname, '..', 'server.js'),
    node: process.execPath,
    runValue: value,
  };
  fs.writeFileSync(path.join(dest, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return path.join(dest, 'launch.vbs');
}

// A pid file outlives its process, and Windows reuses pids, so the image name must match too.
function pidAlive(pid, image) {
  if (!Number.isInteger(pid)) return false;
  const out = execFileSync('tasklist', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], { encoding: 'utf8' });
  return out.toLowerCase().startsWith(`"${image}"`);
}

async function printStatus({ hubDir, configDir, value }) {
  let autostart = 'off';
  try {
    execFileSync('reg', ['query', RUN_KEY, '/v', value], { stdio: 'ignore' });
    autostart = `on (${value})`;
  } catch {}
  let trayPid = null;
  try {
    trayPid = Number.parseInt(fs.readFileSync(path.join(hubDir, 'tray.pid'), 'utf8'), 10);
  } catch {}
  let hub = null;
  try {
    hub = await liveHub(hubDir, fs.readFileSync(path.join(hubDir, 'token'), 'utf8').trim());
  } catch {}
  console.log(`  Hub dir: ${hubDir}`);
  console.log(`  Config dir: ${configDir}`);
  console.log(`  Autostart: ${autostart}`);
  console.log(`  Tray: ${pidAlive(trayPid, 'powershell.exe') ? `running (pid ${trayPid})` : 'not running'}`);
  console.log(`  Hub: ${hub ? `running on port ${hub.port} (pid ${hub.pid})` : 'stopped'}`);
}

async function runTrayCommand({ flag, hubDir, port, defaultPort, appId, configDir, platform = process.platform }) {
  if (platform !== 'win32') {
    console.error(`  ${flag} works only on Windows.`);
    return false;
  }
  const value = runValue(hubDir);
  if (flag === '--tray-status') {
    await printStatus({ hubDir, configDir, value });
    return true;
  }
  if (flag === '--no-autostart') {
    try {
      execFileSync('reg', ['delete', RUN_KEY, '/v', value, '/f'], { stdio: 'ignore' });
      console.log('  Autostart: removed');
    } catch {
      console.log('  Autostart: not set');
    }
    return true;
  }
  const vbs = copyTray({ hubDir, port, appId, defaultPort, value });
  console.log(`  Tray copy: ${path.dirname(vbs)}`);
  if (flag === '--autostart') {
    execFileSync('reg', ['add', RUN_KEY, '/v', value, '/t', 'REG_SZ', '/d', `wscript.exe "${vbs}"`, '/f'], { stdio: 'ignore' });
    console.log('  Autostart: on (starts at logon)');
  }
  spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore' }).unref();
  console.log('  Tray: started. Look for the hub icon in the notification area.');
  return true;
}

module.exports = { runTrayCommand, runValue, appConfig };
