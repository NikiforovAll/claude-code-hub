#!/usr/bin/env node

const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNetGuard } = require('./lib/net-guard');

function getArg(name) {
  const idx = process.argv.findIndex((a) => a.startsWith(`--${name}`));
  if (idx === -1) return null;
  const arg = process.argv[idx];
  if (arg.includes('=')) return arg.split('=').slice(1).join('=');
  return process.argv[idx + 1] || null;
}

const HUB_PORT = parseInt(getArg('port') || process.env.PORT || '3540', 10);
const MARKETPLACE_PORT = parseInt(getArg('marketplace-port') || '3542', 10);
const KANBAN_PORT = parseInt(getArg('kanban-port') || '3541', 10);
const COST_PORT = parseInt(getArg('cost-port') || '3543', 10);
const MEMORY_PORT = parseInt(getArg('memory-port') || '3544', 10);

let children = [];
const DEFAULT_PORTS = { marketplace: MARKETPLACE_PORT, kanban: KANBAN_PORT, cost: COST_PORT, memory: MEMORY_PORT };
const actualPorts = { ...DEFAULT_PORTS };

// Every sub-app resolves CLAUDE_CONFIG_DIR once at startup into a module constant, so switching
// the dir means restarting the children. Kept on the server, not in the browser: the dir has to
// be known before the first spawn, and the hub already has one localStorage key to reason about.
const HUB_CONFIG_FILE = path.join(os.homedir(), '.claude-hub', 'config.json');

function expandHome(p) {
  return p.startsWith('~') ? p.replace('~', os.homedir()) : p;
}

function loadHubConfig() {
  const fallback = expandHome(
    process.env.CLAUDE_CONFIG_DIR || process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude'),
  );
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(HUB_CONFIG_FILE, 'utf8'));
  } catch {}
  const dirs = Array.isArray(saved.configDirs) ? saved.configDirs.filter((d) => typeof d === 'string') : [];
  if (!dirs.includes(fallback)) dirs.unshift(fallback);
  const active = dirs.includes(saved.activeConfigDir) ? saved.activeConfigDir : fallback;
  return { configDirs: dirs, activeConfigDir: active };
}

function saveHubConfig() {
  fs.mkdirSync(path.dirname(HUB_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(HUB_CONFIG_FILE, `${JSON.stringify(hubConfig, null, 2)}\n`);
}

const hubConfig = loadHubConfig();

// Created before spawnApp so the same host/allowed-hosts decision reaches the
// children. Without that propagation, `--host 0.0.0.0` would expose the hub shell
// while every iframe 403'd on its own Host check.
const net = createNetGuard({ appName: 'Claude Code Hub' });

function spawnApp(name, cmd, args, envPort) {
  const child = spawn(cmd, args, {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(envPort),
      CLAUDE_CONFIG_DIR: hubConfig.activeConfigDir,
      CLAUDE_HUB: '1',
      HUB_URL: `http://localhost:${HUB_PORT}`,
      HOST: net.BIND_HOST,
      ALLOWED_HOSTS: net.ALLOWED_HOSTS,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let markReady;
  child.ready = new Promise((resolve) => {
    markReady = resolve;
  });
  child.exited = new Promise((resolve) => child.on('exit', resolve));
  child.stdout.on('data', (d) => {
    stdoutBuf += d.toString();
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl + 1);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      process.stdout.write(`[${name}] ${line}`);
      const match = line.match(/running at http:\/\/localhost:(\d+)/i);
      if (match) {
        actualPorts[name] = parseInt(match[1], 10);
        markReady();
      }
    }
  });
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => {
    console.log(`[${name}] exited (code ${code})`);
    markReady();
  });

  children.push(child);
  return child;
}

function killAll() {
  for (const child of children) {
    if (child.exitCode !== null || child.killed) continue;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  }
}

function withTimeout(promise, ms) {
  let timer;
  const gate = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([promise, gate]).finally(() => clearTimeout(timer));
}

// Kills the current children and spawns a fresh set against hubConfig.activeConfigDir. Resolves
// once every child has printed its port banner (or given up), so the caller can hand the client
// URLs that are actually live.
let restarting = null;
function restartChildren() {
  if (restarting) return restarting;
  restarting = (async () => {
    const old = children;
    killAll();
    await withTimeout(Promise.all(old.map((c) => c.exited)), 8000);
    children = [];
    Object.assign(actualPorts, DEFAULT_PORTS);
    spawnChildren();
    await withTimeout(Promise.all(children.map((c) => c.ready)), 20000);
  })().finally(() => {
    restarting = null;
  });
  return restarting;
}

function shutdown() {
  killAll();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
process.on('exit', killAll);

// Git Bash + tmux on Windows doesn't deliver signals — read stdin directly
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stdin.on('data', (data) => {
  const d = data.trim().toLowerCase();
  // Ctrl+C (0x03), Ctrl+D (0x04), or typed "q"/"exit"
  if (data.includes('\x03') || data.includes('\x04') || d === 'q' || d === 'exit') {
    console.log('\nShutting down...');
    shutdown();
  }
});
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);

function resolveApp(submoduleDir, npmPackage) {
  const local = path.join(__dirname, submoduleDir, 'server.js');
  try {
    require.resolve(local);
    return local;
  } catch {}
  return require.resolve(`${npmPackage}/server.js`);
}

const marketplacePath = resolveApp('marketplace', 'claude-code-marketplace');
const kanbanPath = resolveApp('cck', 'claude-code-kanban');
const costPath = resolveApp('cost', 'claude-code-cost');
const memoryPath = resolveApp('memory', 'claude-code-memory-explorer');

// Raise header size limit to 64KB — localhost cookies from sibling apps can pile up and
// trip Node's default 16KB limit, breaking iframes with HTTP 431.
const HDR_BYTES = 65536;
const NODE_HDR = `--max-http-header-size=${HDR_BYTES}`;

function spawnChildren() {
  spawnApp(
    'marketplace',
    process.execPath,
    [NODE_HDR, marketplacePath, `--port=${MARKETPLACE_PORT}`],
    MARKETPLACE_PORT,
  );
  spawnApp('kanban', process.execPath, [NODE_HDR, kanbanPath], KANBAN_PORT);
  spawnApp('cost', process.execPath, [NODE_HDR, costPath, `--port=${COST_PORT}`], COST_PORT);
  spawnApp('memory', process.execPath, [NODE_HDR, memoryPath, `--port=${MEMORY_PORT}`], MEMORY_PORT);
}

spawnChildren();

const app = express();
app.use(express.json());

// Mounted before the routes below, which are registered ahead of the first
// app.use() and would otherwise bypass the guards entirely.
app.use(net.hostGuard);
app.use(net.frameGuard);
app.use(net.originGuard);

// The accent hex per color theme, read from the same registry generate-themes.mjs compiles into each
// sub-app's themes.css. Served rather than hand-copied into public/app.js so there is one source of
// truth; the palette is the hub's only themed surface, so only ember (the accent role) is needed.
// Read once — themes.json only changes when the generator is re-run, which restarts the hub anyway.
const themeAccents = (() => {
  try {
    const themes = JSON.parse(fs.readFileSync(path.join(__dirname, 'scripts/themes.json'), 'utf8'));
    return Object.fromEntries(themes.map((t) => [t.id, { dark: t.dark.ember, light: t.light.ember }]));
  } catch {
    // Palette falls back to the --accent in index.html; not worth failing startup over.
    return {};
  }
})();

function appsConfig() {
  return {
    kanban: { name: 'Kanban', url: `http://localhost:${actualPorts.kanban}`, icon: 'columns' },
    marketplace: { name: 'Marketplace', url: `http://localhost:${actualPorts.marketplace}`, icon: 'store' },
    cost: { name: 'Cost', url: `http://localhost:${actualPorts.cost}`, icon: 'dollar-sign' },
    memory: { name: 'Memory Diagnoser', url: `http://localhost:${actualPorts.memory}`, icon: 'database' },
  };
}

app.get('/api/config', (_req, res) => {
  res.json({ themeAccents, apps: appsConfig() });
});

app.get('/api/config-dirs', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ dirs: hubConfig.configDirs, active: hubConfig.activeConfigDir });
});

// Normalizes a typed path to its real on-disk form (true casing, native separators) so cck's
// strict === project match and cost's abs->encoded transform both hit, and so the config-dir list
// holds one spelling per dir.
function resolveDir(input) {
  if (typeof input !== 'string' || !input.trim()) return { error: 'path is required', status: 400 };
  let resolved;
  try {
    resolved = fs.realpathSync.native(path.resolve(expandHome(input.trim())));
  } catch {
    return { error: 'Path not found', status: 404 };
  }
  if (!fs.statSync(resolved).isDirectory()) return { error: 'Not a directory', status: 400 };
  return { path: resolved };
}

app.post('/api/config-dirs', (req, res) => {
  const r = resolveDir(req.body?.path);
  if (r.error) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  if (!hubConfig.configDirs.includes(r.path)) {
    hubConfig.configDirs.push(r.path);
    saveHubConfig();
  }
  res.json({ path: r.path });
});

app.delete('/api/config-dirs', (req, res) => {
  const raw = typeof req.body?.path === 'string' ? req.body.path : '';
  const target = resolveDir(raw).path ?? raw;
  if (target === hubConfig.activeConfigDir) {
    res.status(400).json({ error: 'Cannot remove the active config dir' });
    return;
  }
  hubConfig.configDirs = hubConfig.configDirs.filter((d) => d !== target);
  saveHubConfig();
  res.json({ dirs: hubConfig.configDirs, active: hubConfig.activeConfigDir });
});

// Switching restarts every child, so the response carries the fresh app URLs — a child whose
// default port was still held by its predecessor may have fallen back to another one.
app.post('/api/config-dirs/activate', async (req, res) => {
  const target = typeof req.body?.path === 'string' ? req.body.path : '';
  if (!hubConfig.configDirs.includes(target)) {
    res.status(404).json({ error: 'Unknown config dir; add it first' });
    return;
  }
  const changed = target !== hubConfig.activeConfigDir;
  if (changed) {
    hubConfig.activeConfigDir = target;
    saveHubConfig();
    console.log(`Switching CLAUDE_CONFIG_DIR -> ${target}`);
    await restartChildren();
  }
  res.json({ apps: appsConfig() });
});

// Project list for the switcher palette, proxied from kanban — it is the only sub-app that
// enumerates projects. actualPorts is read per request because kanban's real port is only
// known once its banner has been scraped (see spawnApp).
app.get('/api/projects', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // 127.0.0.1, not localhost — Node's verbatim DNS ordering tries ::1 first on Windows.
    const upstream = await fetch(`http://127.0.0.1:${actualPorts.kanban}/api/projects`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `kanban responded ${upstream.status}` });
      return;
    }
    res.json(await upstream.json());
  } catch (err) {
    // Soft-fail so the palette still opens and offers literal-path entry.
    res.status(502).json({ error: `kanban unavailable: ${err.message}` });
  }
});

// List-picked project paths skip this: they are byte-exact copies of what kanban reported.
app.get('/api/resolve-path', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const r = resolveDir(req.query.path);
  if (r.error) res.status(r.status).json({ error: r.error });
  else res.json({ path: r.path });
});

app.use(express.static(path.join(__dirname, 'public')));

const onReady = (actual) => {
  printBanner(actual);
  if (process.argv.includes('--open')) {
    import('open').then((m) => m.default(`http://localhost:${actual}`));
  }
};

const server = net.listenLoopback(app, HUB_PORT, onReady, { maxHeaderSize: HDR_BYTES });

function printBanner(port) {
  console.log(`Claude Code Hub running at http://localhost:${port}`);
  const warning = net.exposureWarning();
  if (warning) console.log(warning);
  console.log('Type "q" or "exit" to stop the server');
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
    console.log(`Port ${HUB_PORT} in use, trying random port...`);
    net.listenLoopback(app, 0, onReady, { maxHeaderSize: HDR_BYTES });
  } else {
    throw err;
  }
});
