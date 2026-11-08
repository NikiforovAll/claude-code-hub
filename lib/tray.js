'use strict';

const { execFile, execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { version } = require('../package.json');
const { liveHub } = require('./hub-record');

const TRAY_SRC = path.join(__dirname, '..', 'tray');
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const LAUNCH_AGENTS = path.join(os.homedir(), 'Library', 'LaunchAgents');
// The hub page asks for the tray state, so the checks must not block the hub's event loop.
const run = promisify(execFile);

function dirHash(hubDir) {
  return crypto.createHash('sha1').update(path.resolve(hubDir).toLowerCase()).digest('hex').slice(0, 8);
}

// One Run value and one tray per hub dir, so a test hub never replaces the real autostart.
function runValue(hubDir) {
  return `ClaudeCodeHub-${dirHash(hubDir)}`;
}

function launchAgentLabel(hubDir) {
  return `com.claude-code-hub.tray.${dirHash(hubDir)}`;
}

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// AbandonProcessGroup: launchd kills what is left in a job's process group when the job exits,
// and the hub that the tray started is in it.
function launchAgentPlist({ label, script }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-l</string>
    <string>JavaScript</string>
    <string>${xml(script)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>AbandonProcessGroup</key>
  <true/>
</dict>
</plist>
`;
}

// An installed app is bound to the origin it was installed from, and its shortcut does not record
// it, so the tray opens the app only when the hub runs on the port the app is assumed to serve.
function appConfig({ appId, port, defaultPort }) {
  return appId ? { id: appId, port } : { name: 'Claude Code Hub', port: defaultPort };
}

// A pid file outlives its process, and pids are reused, so the process must still be the tray.
// tray/mac/hub-tray.js makes the same check before it starts.
function windows(hubDir) {
  const value = runValue(hubDir);
  const launcher = path.join(hubDir, 'tray', 'launch.vbs');
  return {
    area: 'notification area',
    prepare: () => ({ runValue: value }),
    async trayAlive(pid) {
      const { stdout } = await run('tasklist', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], { windowsHide: true });
      return stdout.toLowerCase().startsWith('"powershell.exe"');
    },
    async autostartName() {
      try {
        await run('reg', ['query', RUN_KEY, '/v', value], { windowsHide: true });
        return value;
      } catch {
        return null;
      }
    },
    addAutostart() {
      execFileSync('reg', ['add', RUN_KEY, '/v', value, '/t', 'REG_SZ', '/d', `wscript.exe "${launcher}"`, '/f'], { stdio: 'ignore' });
    },
    removeAutostart() {
      try {
        execFileSync('reg', ['delete', RUN_KEY, '/v', value, '/f'], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },
    start: () => spawn('wscript.exe', [launcher], { detached: true, stdio: 'ignore' }).unref(),
  };
}

function macos(hubDir, launchAgentsDir) {
  const label = launchAgentLabel(hubDir);
  const plist = path.join(launchAgentsDir, `${label}.plist`);
  const launcher = path.join(hubDir, 'tray', 'mac', 'hub-tray.js');
  const trayPlist = path.join(hubDir, 'tray', 'mac', 'autostart.plist');
  return {
    area: 'menu bar',
    prepare() {
      fs.writeFileSync(trayPlist, launchAgentPlist({ label, script: launcher }));
      return { launchAgent: plist, path: process.env.PATH };
    },
    async trayAlive(pid) {
      try {
        return (await run('ps', ['-p', String(pid), '-o', 'command='])).stdout.includes('hub-tray.js');
      } catch {
        return false;
      }
    },
    autostartName: async () => (fs.existsSync(plist) ? label : null),
    addAutostart() {
      fs.mkdirSync(launchAgentsDir, { recursive: true });
      fs.copyFileSync(trayPlist, plist);
    },
    removeAutostart() {
      if (!fs.existsSync(plist)) return false;
      fs.rmSync(plist);
      return true;
    },
    start: () => spawn('/usr/bin/osascript', ['-l', 'JavaScript', launcher], { detached: true, stdio: 'ignore' }).unref(),
  };
}

// The Run key and the tray start from this copy, never from the package: an npx cache path can vanish.
function copyTray(plat, { hubDir, port, appId, defaultPort }) {
  const dest = path.join(hubDir, 'tray');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(TRAY_SRC, dest, { recursive: true });
  const config = {
    port,
    app: appConfig({ appId, port, defaultPort }),
    version,
    serverJs: path.join(__dirname, '..', 'server.js'),
    node: process.execPath,
    ...plat.prepare(),
  };
  fs.writeFileSync(path.join(dest, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return dest;
}

async function trayPid(plat, hubDir) {
  let pid = null;
  try {
    pid = Number.parseInt(fs.readFileSync(path.join(hubDir, 'tray.pid'), 'utf8'), 10);
  } catch {}
  return Number.isInteger(pid) && (await plat.trayAlive(pid)) ? pid : null;
}

function platformOf(platform, hubDir, launchAgentsDir) {
  if (platform === 'darwin') return macos(hubDir, launchAgentsDir);
  return platform === 'win32' ? windows(hubDir) : null;
}

// {supported, autostart, running} for the hub page's setup checklist.
async function trayState({ hubDir, platform = process.platform, launchAgentsDir = LAUNCH_AGENTS }) {
  const plat = platformOf(platform, hubDir, launchAgentsDir);
  if (!plat) return { supported: false, autostart: false, running: false };
  const [autostart, pid] = await Promise.all([plat.autostartName(), trayPid(plat, hubDir)]);
  return { supported: true, autostart: !!autostart, running: pid !== null };
}

async function printStatus(plat, { hubDir, configDir }) {
  const [autostart, pid] = await Promise.all([plat.autostartName(), trayPid(plat, hubDir)]);
  let hub = null;
  try {
    hub = await liveHub(hubDir, fs.readFileSync(path.join(hubDir, 'token'), 'utf8').trim());
  } catch {}
  console.log(`  Hub dir: ${hubDir}`);
  console.log(`  Config dir: ${configDir}`);
  console.log(`  Autostart: ${autostart ? `on (${autostart})` : 'off'}`);
  console.log(`  Tray: ${pid !== null ? `running (pid ${pid})` : 'not running'}`);
  console.log(`  Hub: ${hub ? `running on port ${hub.port} (pid ${hub.pid})` : 'stopped'}`);
}

async function runTrayCommand({ flag, platform = process.platform, launchAgentsDir = LAUNCH_AGENTS, ...opts }) {
  const plat = platformOf(platform, opts.hubDir, launchAgentsDir);
  if (!plat) {
    console.error(`  ${flag} works only on Windows and macOS.`);
    return false;
  }
  if (flag === '--tray-status') {
    await printStatus(plat, opts);
    return true;
  }
  if (flag === '--no-autostart') {
    console.log(plat.removeAutostart() ? '  Autostart: removed' : '  Autostart: not set');
    return true;
  }
  console.log(`  Tray copy: ${copyTray(plat, opts)}`);
  if (flag === '--autostart') {
    plat.addAutostart();
    console.log('  Autostart: on (starts at logon)');
  }
  plat.start();
  console.log(`  Tray: started. Look for the hub icon in the ${plat.area}.`);
  return true;
}

module.exports = { runTrayCommand, trayState, runValue, launchAgentLabel, launchAgentPlist, appConfig };
