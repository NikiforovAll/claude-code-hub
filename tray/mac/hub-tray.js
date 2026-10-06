// macOS tray, run by `osascript -l JavaScript`. In the JXA bridge a method with no arguments is
// read as a property (`task.launch`), and an exception in an ObjC callback is dropped silently,
// so every callback goes through guard().
ObjC.import('Cocoa');
ObjC.bindFunction('kill', ['int', ['int', 'int']]);

const sa = Application.currentApplication();
sa.includeStandardAdditions = true;
const fm = $.NSFileManager.defaultManager;

// AppKit enum values, because BridgeSupport may not expose the newer names.
const ACCESSORY_POLICY = 1;
const VARIABLE_LENGTH = -1;
const ON = 1;
const OFF = 0;
const SIGTERM = 15;
const SIGKILL = 9;

const STATE_COLORS = { running: [34, 197, 94], starting: [245, 158, 11], stopped: [239, 68, 68] };

let HUB_DIR, TRAY_DIR, HUB_FILE, LOG_FILE, TRAY_LOG, PID_FILE, config;
let target, statusItem, menu, icons;
let miHeader, miOpen, miStartStop, miRestart, miAuto;
let hubTask = null;
let nodePid = null;
let hub = null;
let state = '';
let timer = null;
let selfTestArgv = null;

const dirname = (p) => ObjC.unwrap($(p).stringByDeletingLastPathComponent);
const basename = (p) => ObjC.unwrap($(p).lastPathComponent);
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const exists = (p) => fm.fileExistsAtPath(p);

function readText(p) {
  const s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null);
  return s.isNil() ? null : ObjC.unwrap(s);
}

function readJson(p) {
  try {
    return JSON.parse(readText(p));
  } catch (e) {
    return null;
  }
}

function appendHandle(p) {
  if (!exists(p)) fm.createFileAtPathContentsAttributes(p, null, null);
  const h = $.NSFileHandle.fileHandleForWritingAtPath(p);
  h.seekToEndOfFile;
  return h;
}

function log(msg) {
  try {
    const h = appendHandle(TRAY_LOG);
    h.writeData($(`${new Date().toISOString()} ${msg}\n`).dataUsingEncoding($.NSUTF8StringEncoding));
    h.closeFile;
  } catch (e) {}
}

function guard(name, fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (e) {
      log(`${name}: ${e}`);
    }
  };
}

function sh(cmd) {
  return sa.doShellScript(cmd);
}

function notify(msg) {
  try {
    sa.displayNotification(msg, { withTitle: 'Claude Code Hub' });
  } catch (e) {}
}

function processCommand(pid, column) {
  try {
    return sh(`/bin/ps -p ${pid} -o ${column}=`).trim();
  } catch (e) {
    return '';
  }
}

function schedule(seconds, selector, repeats) {
  const t = $.NSTimer.timerWithTimeIntervalTargetSelectorUserInfoRepeats(seconds, target, selector, null, repeats);
  $.NSRunLoop.currentRunLoop.addTimerForMode(t, $.NSRunLoopCommonModes);
  return t;
}

// A child that exited stays a zombie until NSTask reaps it, and kill(pid, 0) still finds a zombie.
function alive(pid) {
  if (hubTask && hubTask.processIdentifier === pid) return hubTask.isRunning;
  return $.kill(pid, 0) === 0;
}

function waitExit(pid, seconds) {
  for (let i = 0; i < seconds * 4 && alive(pid); i++) delay(0.25);
  return !alive(pid);
}

// The hub writes hub.json once it listens; a dead pid there is a hub that is gone. A pid is checked
// to be node once, so the 3 s tick starts no process.
function getHub() {
  const rec = readJson(HUB_FILE);
  if (!rec || !Number.isInteger(rec.pid) || !alive(rec.pid)) return null;
  if (rec.pid !== nodePid) {
    if (!/(^|\/)node$/.test(processCommand(rec.pid, 'comm'))) return null;
    nodePid = rec.pid;
  }
  return rec;
}

function token() {
  return (readText(`${HUB_DIR}/token`) || '').trim();
}

// The saved node comes first: the app packages were installed with it, and a version manager may
// have switched the one on PATH since.
function hubCommand() {
  const hubArgs = ['--hub-dir', HUB_DIR, '--port', String(config.port), '--detached'];
  const node = exists(config.node) ? config.node : 'node';
  if (exists(config.serverJs)) return [node, config.serverJs, ...hubArgs];
  notify(`The installed hub is gone. Starting ${config.version} with npx.`);
  return ['npx', '-y', `claude-code-hub@${config.version}`, ...hubArgs];
}

// launchd gives the tray only /usr/bin:/bin:/usr/sbin:/sbin, and the hub's tools run git and claude,
// so the hub gets the PATH that --tray saved.
function startHub() {
  if (getHub()) return updateState();
  if (exists(LOG_FILE) && fm.attributesOfItemAtPathError(LOG_FILE, null).fileSize > 5 * 1024 * 1024) {
    fm.removeItemAtPathError(`${LOG_FILE}.1`, null);
    fm.moveItemAtPathToPathError(LOG_FILE, `${LOG_FILE}.1`, null);
  }
  const cmd = hubCommand();
  log(`start: ${cmd.join(' ')}`);
  const env = $.NSProcessInfo.processInfo.environment.mutableCopy;
  if (config.path) env.setObjectForKey(config.path, 'PATH');
  const out = appendHandle(LOG_FILE);
  const task = $.NSTask.alloc.init;
  task.launchPath = '/usr/bin/env';
  task.arguments = $(cmd);
  task.environment = env;
  task.currentDirectoryPath = HUB_DIR;
  task.standardInput = $.NSFileHandle.fileHandleWithNullDevice;
  task.standardOutput = out;
  task.standardError = out;
  task.launch;
  out.closeFile;
  hubTask = task;
  setState('starting');
}

// The shutdown route lets the hub stop its tools and remove hub.json; signals are the fallback for
// a hub that does not answer. The tools exit on their own when the hub's IPC channel closes.
function stopHub() {
  const rec = getHub();
  let pid = rec ? rec.pid : hubTask && hubTask.processIdentifier;
  if (rec) {
    log(`stop: pid ${rec.pid}`);
    try {
      sh(`/usr/bin/curl -s -m 3 -X POST ${q(`http://127.0.0.1:${rec.port}/api/shutdown?token=${token()}`)}`);
      if (waitExit(rec.pid, 15)) pid = null;
    } catch (e) {
      log(`shutdown request failed: ${e}`);
    }
  }
  if (pid && alive(pid)) {
    log(`kill: pid ${pid}`);
    $.kill(pid, SIGTERM);
    if (!waitExit(pid, 5)) $.kill(pid, SIGKILL);
  }
  hubTask = null;
  updateState();
}

function toggleHub() {
  if (state === 'stopped') startHub();
  else stopHub();
}

function restartHub() {
  stopHub();
  startHub();
}

// Chrome and Edge put an installed app's shim in ~/Applications, with the app id in its Info.plist.
function findAppShim() {
  const home = ObjC.unwrap($.NSHomeDirectory());
  const browsers = [
    ['Chrome Apps.localized', 'com.google.Chrome'],
    ['Edge Apps.localized', 'com.microsoft.edgemac'],
  ];
  for (const [folder, bundle] of browsers) {
    const base = `${home}/Applications/${folder}`;
    const names = ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError(base, null)) || [];
    for (const name of names) {
      if (!name.endsWith('.app')) continue;
      if (!config.app.id && name !== `${config.app.name}.app`) continue;
      const info = ObjC.deepUnwrap($.NSDictionary.dictionaryWithContentsOfFile(`${base}/${name}/Contents/Info.plist`));
      if (!info || !info.CrAppModeShortcutID) continue;
      if (config.app.id && info.CrAppModeShortcutID !== config.app.id) continue;
      return {
        id: info.CrAppModeShortcutID,
        bundle: info.CrBundleIdentifier || bundle,
        profile: info.CrAppModeProfileDir ? basename(info.CrAppModeProfileDir) : null,
      };
    }
  }
  return null;
}

// Chrome loads any URL into an app, so a hub on another port must not open in it.
function openHub() {
  const rec = getHub();
  if (!rec) return;
  const url = `http://localhost:${rec.port}/?token=${token()}`;
  const shim = rec.port === config.app.port ? findAppShim() : null;
  if (shim) {
    const args = [`--app-id=${shim.id}`, `--app-launch-url-for-shortcuts-menu-item=${url}`];
    if (shim.profile) args.unshift(`--profile-directory=${shim.profile}`);
    try {
      sh(`/usr/bin/open -n -b ${q(shim.bundle)} --args ${args.map(q).join(' ')}`);
      return;
    } catch (e) {
      log(`open app failed: ${e}`);
    }
  }
  sh(`/usr/bin/open ${q(url)}`);
}

function openLog() {
  if (exists(LOG_FILE)) sh(`/usr/bin/open -t ${q(LOG_FILE)}`);
}

function autostartOn() {
  return exists(config.launchAgent);
}

function toggleAutostart() {
  if (autostartOn()) {
    fm.removeItemAtPathError(config.launchAgent, null);
  } else {
    fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dirname(config.launchAgent), true, null, null);
    fm.copyItemAtPathToPathError(`${TRAY_DIR}/mac/autostart.plist`, config.launchAgent, null);
  }
}

function configDirName() {
  const hubConfig = readJson(`${HUB_DIR}/config.json`);
  return hubConfig && hubConfig.activeConfigDir ? basename(hubConfig.activeConfigDir) : null;
}

function color(r, g, b) {
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(r / 255, g / 255, b / 255, 1);
}

// public/icons/icon-192.svg redrawn at menu bar size, with a status dot in place of the bottom-right
// tile. AppKit's origin is bottom-left, so y is flipped from the SVG.
function trayImage(dotRgb) {
  const size = 18;
  const k = size / 192;
  const img = $.NSImage.alloc.initWithSize($.NSMakeSize(size, size));
  img.lockFocus;
  color(26, 26, 46).setFill;
  $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius($.NSMakeRect(0, 0, size, size), 32 * k, 32 * k).fill;
  const stroke = Math.max(1, 6 * k);
  const tile = 40 * k;
  color(233, 69, 96).setStroke;
  for (const [x, y] of [
    [44, 44],
    [108, 44],
    [44, 108],
  ]) {
    const rect = $.NSMakeRect(x * k + stroke / 2, (192 - y - 40) * k + stroke / 2, tile - stroke, tile - stroke);
    const p = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius(rect, Math.max(0.5, 6 * k), Math.max(0.5, 6 * k));
    p.lineWidth = stroke;
    p.stroke;
  }
  const c = 128 * k;
  const dot = size * 0.2;
  color(...dotRgb).setFill;
  $.NSBezierPath.bezierPathWithOvalInRect($.NSMakeRect(c - dot, (192 - 128) * k - dot, 2 * dot, 2 * dot)).fill;
  img.unlockFocus;
  return img;
}

function setState(s) {
  if (state === s) return;
  state = s;
  statusItem.button.image = icons[s];
  statusItem.button.toolTip = `Claude Code Hub: ${s}`;
  miStartStop.title = s === 'stopped' ? 'Start Hub' : 'Stop Hub';
  miOpen.enabled = s === 'running';
  miRestart.enabled = s !== 'stopped';
}

function updateHeader() {
  const parts = [hub ? `Running on port ${hub.port}` : state === 'starting' ? 'Starting' : 'Stopped'];
  const name = configDirName();
  if (name) parts.push(name);
  miHeader.title = parts.join(`  ${String.fromCharCode(0xb7)}  `);
  miAuto.state = autostartOn() ? ON : OFF;
}

// stopHub clears hubTask, so a hubTask that has exited is a hub that died on its own.
function updateState() {
  hub = getHub();
  if (hub) return setState('running');
  if (hubTask && hubTask.isRunning) return setState('starting');
  if (hubTask) {
    hubTask = null;
    log('hub exited');
    notify('The hub stopped. Start it from the menu bar; see Open log.');
  }
  setState('stopped');
}

function quit() {
  if (timer) timer.invalidate;
  stopHub();
  fm.removeItemAtPathError(PID_FILE, null);
  $.NSApplication.sharedApplication.terminate(null);
}

function menuSnapshot() {
  updateState();
  updateHeader();
  const items = [];
  for (let i = 0; i < menu.numberOfItems; i++) {
    const m = menu.itemAtIndex(i);
    if (m.isSeparatorItem) continue;
    items.push({ title: ObjC.unwrap(m.title), enabled: m.isEnabled, checked: m.state === ON });
  }
  return { state, items };
}

function waitForRunning() {
  for (let i = 0; i < 120 && state !== 'running'; i++) {
    delay(1);
    updateState();
  }
}

const SELF_TEST_ACTIONS = {
  start: () => {
    toggleHub();
    waitForRunning();
  },
  stop: toggleHub,
  restart: () => {
    restartHub();
    waitForRunning();
  },
  autostart: toggleAutostart,
};

// --self-test [--actions stop,start,…] [--screenshot <png>]: runs the menu's handlers without
// clicks, prints the menu after each one as JSON, and captures the open menu.
function selfTest(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const steps = [{ step: 'initial', ...menuSnapshot() }];
  for (const action of (arg('--actions') || '').split(',').filter(Boolean)) {
    if (!SELF_TEST_ACTIONS[action]) throw new Error(`unknown action ${action}`);
    SELF_TEST_ACTIONS[action]();
    steps.push({ step: action, ...menuSnapshot() });
  }
  const shot = arg('--screenshot');
  if (shot) {
    const cap = $.NSTask.alloc.init;
    cap.launchPath = '/usr/sbin/screencapture';
    cap.arguments = $(['-x', '-T', '1', shot]);
    cap.launch;
    schedule(2.5, 'closeMenu:', false);
    statusItem.button.performClick(null);
    cap.waitUntilExit;
  }
  return { ok: true, steps };
}

function runSelfTest() {
  let result;
  try {
    result = selfTest(selfTestArgv);
  } catch (e) {
    result = { ok: false, error: String(e) };
  }
  if (hubTask) stopHub();
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(
    $(`${JSON.stringify(result, null, 2)}\n`).dataUsingEncoding($.NSUTF8StringEncoding),
  );
  $.NSApplication.sharedApplication.terminate(null);
}

function buildUi() {
  const handler = (name, fn) => ({ types: ['void', ['id']], implementation: guard(name, fn) });
  ObjC.registerSubclass({
    name: 'HubTrayTarget',
    protocols: ['NSMenuDelegate'],
    methods: {
      'openHub:': handler('open', openHub),
      'toggleHub:': handler('start/stop', toggleHub),
      'restartHub:': handler('restart', restartHub),
      'openLog:': handler('log', openLog),
      'toggleAutostart:': handler('autostart', toggleAutostart),
      'quit:': handler('quit', quit),
      'tick:': handler('tick', updateState),
      'menuWillOpen:': handler('menu', updateHeader),
      'closeMenu:': handler('close menu', () => menu.cancelTracking),
      'selfTest:': handler('self-test', runSelfTest),
    },
  });
  target = $.HubTrayTarget.alloc.init;

  icons = {};
  for (const s of Object.keys(STATE_COLORS)) icons[s] = trayImage(STATE_COLORS[s]);

  menu = $.NSMenu.alloc.init;
  menu.autoenablesItems = false;
  menu.delegate = target;
  const add = (title, action) => {
    const m = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(title, action, '');
    if (action) m.target = target;
    menu.addItem(m);
    return m;
  };
  const separator = () => menu.addItem($.NSMenuItem.separatorItem);
  miHeader = add('Claude Code Hub', null);
  miHeader.enabled = false;
  separator();
  miOpen = add('Open Hub', 'openHub:');
  miStartStop = add('Stop Hub', 'toggleHub:');
  miRestart = add('Restart Hub', 'restartHub:');
  separator();
  add('Open log', 'openLog:');
  miAuto = add('Open at Login', 'toggleAutostart:');
  separator();
  add('Quit (stops the hub)', 'quit:');

  statusItem = $.NSStatusBar.systemStatusBar.statusItemWithLength(VARIABLE_LENGTH);
  statusItem.menu = menu;
}

function run(argv) {
  const script = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments).find((a) => a.endsWith('hub-tray.js'));
  TRAY_DIR = dirname(dirname(script));
  HUB_DIR = dirname(TRAY_DIR);
  HUB_FILE = `${HUB_DIR}/hub.json`;
  LOG_FILE = `${HUB_DIR}/hub.log`;
  TRAY_LOG = `${HUB_DIR}/tray.log`;
  PID_FILE = `${HUB_DIR}/tray.pid`;
  config = readJson(`${TRAY_DIR}/config.json`);
  if (!config) {
    sa.displayAlert('Claude Code Hub', { message: `Missing ${TRAY_DIR}/config.json. Run: claude-code-hub --tray` });
    return;
  }

  // lib/tray.js makes the same check for --tray-status.
  const testing = argv.includes('--self-test');
  const myPid = $.NSProcessInfo.processInfo.processIdentifier;
  if (!testing) {
    const other = Number.parseInt(readText(PID_FILE) || '', 10);
    if (Number.isInteger(other) && other !== myPid && processCommand(other, 'command').includes('hub-tray.js')) return;
    $(`${myPid}\n`).writeToFileAtomicallyEncodingError(PID_FILE, true, $.NSUTF8StringEncoding, null);
  }

  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy(ACCESSORY_POLICY);
  buildUi();

  if (testing) {
    selfTestArgv = argv;
    setState('stopped');
    schedule(0.5, 'selfTest:', false);
  } else {
    setState('starting');
    guard('start', startHub)();
    timer = schedule(3, 'tick:', true);
  }
  app.run;
}
