#!/usr/bin/env node

const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const http = require('http');
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

const POOL_SIZE = Math.max(1, parseInt(getArg('pool-size') || '3', 10));
const DEFAULT_PORTS = { marketplace: MARKETPLACE_PORT, kanban: KANBAN_PORT, cost: COST_PORT, memory: MEMORY_PORT };

// One child set per config dir, kept alive after a switch so switching back is instant. Map
// insertion order doubles as LRU: activating a dir re-inserts it at the end.
const pools = new Map();

function activePool() {
  return pools.get(hubConfig.activeConfigDir);
}

// Every sub-app resolves CLAUDE_CONFIG_DIR once at startup into a module constant, so switching
// the dir means restarting the children. Kept on the server, not in the browser: the dir has to
// be known before the first spawn, and the hub already has one localStorage key to reason about.
const HUB_CONFIG_FILE = path.join(os.homedir(), '.claude-hub', 'config.json');

// The dir the hub would use with no saved config. Set by loadHubConfig; the client uses it to keep
// the default dir out of the window title.
let defaultConfigDir = null;

function expandHome(p) {
  return p.startsWith('~') ? p.replace('~', os.homedir()) : p;
}

// Real on-disk spelling (true casing, native separators). One dir is one list entry and one child
// pool whichever way it was typed. Throws when the path does not exist.
function canonicalDir(p) {
  return fs.realpathSync.native(path.resolve(expandHome(p)));
}

function loadHubConfig() {
  const canonical = (p) => {
    try {
      return canonicalDir(p);
    } catch {
      return expandHome(p);
    }
  };
  const fallback = canonical(
    process.env.CLAUDE_CONFIG_DIR || process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude'),
  );
  defaultConfigDir = fallback;
  let raw = '';
  let saved = {};
  try {
    raw = fs.readFileSync(HUB_CONFIG_FILE, 'utf8');
    saved = JSON.parse(raw);
  } catch {}
  const savedDirs = Array.isArray(saved.configDirs) ? saved.configDirs.filter((d) => typeof d === 'string') : [];
  const dirs = [...new Set(savedDirs.map(canonical))];
  if (!dirs.includes(fallback)) dirs.unshift(fallback);
  const savedActive = typeof saved.activeConfigDir === 'string' ? canonical(saved.activeConfigDir) : null;
  const active = dirs.includes(savedActive) ? savedActive : fallback;
  const config = { configDirs: dirs, activeConfigDir: active };
  // Configs saved before canonicalization can hold one dir under two spellings; persist the merge.
  if (serializeConfig(config) !== raw) writeHubConfig(config);
  return config;
}

function serializeConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function writeHubConfig(config) {
  fs.mkdirSync(path.dirname(HUB_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(HUB_CONFIG_FILE, serializeConfig(config));
}

function saveHubConfig() {
  writeHubConfig(hubConfig);
}

const hubConfig = loadHubConfig();

// Created before spawnApp so the same host/allowed-hosts decision reaches the
// children. Without that propagation, `--host 0.0.0.0` would expose the hub shell
// while every iframe 403'd on its own Host check.
const net = createNetGuard({ appName: 'Claude Code Hub' });

function spawnApp(pool, name, cmd, args) {
  const child = spawn(cmd, args, {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: '0',
      CLAUDE_CONFIG_DIR: pool.dir,
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
  child.stdout.on('data', (d) => {
    stdoutBuf += d.toString();
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl + 1);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      process.stdout.write(`[${name}] ${line}`);
      const match = line.match(/running at http:\/\/localhost:(\d+)/i);
      if (match) {
        pool.ports[name] = parseInt(match[1], 10);
        markReady();
      }
    }
  });
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => {
    console.log(`[${name}] exited (code ${code})`);
    markReady();
  });

  pool.children.push(child);
  return child;
}

function killPool(pool) {
  for (const child of pool.children) {
    if (child.exitCode !== null || child.killed) continue;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  }
}

function killAll() {
  for (const pool of pools.values()) killPool(pool);
}

function withTimeout(promise, ms) {
  let timer;
  const gate = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([promise, gate]).finally(() => clearTimeout(timer));
}

// Returns the live pool for a dir, spawning one when absent and evicting the least recently used
// pool past POOL_SIZE. Resolves once every child has printed its port banner (or given up), so
// the caller can hand the client URLs that are actually live.
async function ensurePool(dir) {
  let pool = pools.get(dir);
  if (pool) {
    pools.delete(dir);
    pools.set(dir, pool);
    return pool.ready;
  }
  while (pools.size >= POOL_SIZE) {
    const oldestDir = pools.keys().next().value;
    console.log(`Evicting children for ${oldestDir}`);
    dropPool(oldestDir);
  }
  pool = { dir, children: [], ports: {} };
  pools.set(dir, pool);
  spawnChildren(pool);
  pool.ready = withTimeout(Promise.all(pool.children.map((c) => c.ready)), 20000).then(() => pool);
  return pool.ready;
}

function dropPool(dir) {
  const pool = pools.get(dir);
  if (!pool) return;
  pools.delete(dir);
  killPool(pool);
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

// Children bind ephemeral ports; the public ports below belong to the hub's proxies. Browser
// localStorage is keyed by origin, so the sub-app origin has to stay put across switches or the
// user loses pins and filters every time the active set changes.
function spawnChildren(pool) {
  spawnApp(pool, 'marketplace', process.execPath, [NODE_HDR, marketplacePath]);
  spawnApp(pool, 'kanban', process.execPath, [NODE_HDR, kanbanPath]);
  spawnApp(pool, 'cost', process.execPath, [NODE_HDR, costPath]);
  spawnApp(pool, 'memory', process.execPath, [NODE_HDR, memoryPath]);
}

const publicPorts = { ...DEFAULT_PORTS };

function rewriteOrigin(origin, publicPort, childPort) {
  try {
    const u = new URL(origin);
    if (Number(u.port) !== publicPort) return origin;
    u.port = String(childPort);
    return u.origin;
  } catch {
    return origin;
  }
}

const proxyAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });

// Host is forwarded untouched so the child's hostGuard still sees what the browser sent. Origin is
// the one header the child cannot judge on its own: its guard compares the port to its own
// ephemeral one, so the public-port spelling is mapped to the child's; anything else passes
// through as-is and the child rejects it.
function proxyHandler(name) {
  return (req, res) => {
    const childPort = activePool()?.ports[name];
    if (!childPort) {
      res.writeHead(503, { 'Retry-After': '1' });
      res.end(`${name} is starting`);
      return;
    }
    const headers = { ...req.headers };
    if (headers.origin) headers.origin = rewriteOrigin(headers.origin, publicPorts[name], childPort);
    const upstream = http.request(
      { host: '127.0.0.1', port: childPort, method: req.method, path: req.url, headers, agent: proxyAgent },
      (u) => {
        res.writeHead(u.statusCode, u.headers);
        u.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502);
      res.end(err.message);
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  };
}

function listenWithFallback(handler, port, onReady, label) {
  const server = net.listenLoopback(handler, port, onReady, { maxHeaderSize: HDR_BYTES });
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
    console.log(`${label}port ${port} in use, trying random port...`);
    net.listenLoopback(handler, 0, onReady, { maxHeaderSize: HDR_BYTES });
  });
  return server;
}

for (const [name, port] of Object.entries(DEFAULT_PORTS)) {
  listenWithFallback(
    proxyHandler(name),
    port,
    (actual) => {
      publicPorts[name] = actual;
    },
    `[${name}] `,
  );
}

ensurePool(hubConfig.activeConfigDir);

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
    kanban: { name: 'Kanban', url: `http://localhost:${publicPorts.kanban}`, icon: 'columns' },
    marketplace: { name: 'Marketplace', url: `http://localhost:${publicPorts.marketplace}`, icon: 'store' },
    cost: { name: 'Cost', url: `http://localhost:${publicPorts.cost}`, icon: 'dollar-sign' },
    memory: { name: 'Memory Diagnoser', url: `http://localhost:${publicPorts.memory}`, icon: 'database' },
  };
}

app.get('/api/config', (_req, res) => {
  res.json({ themeAccents, apps: appsConfig(), activeConfigDir: hubConfig.activeConfigDir, defaultConfigDir });
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
    resolved = canonicalDir(input.trim());
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
  dropPool(target);
  res.json({ dirs: hubConfig.configDirs, active: hubConfig.activeConfigDir });
});

// The response carries the app URLs so the client reloads every iframe against the new set.
app.post('/api/config-dirs/activate', async (req, res) => {
  const target = typeof req.body?.path === 'string' ? req.body.path : '';
  if (!hubConfig.configDirs.includes(target)) {
    res.status(404).json({ error: 'Unknown config dir; add it first' });
    return;
  }
  if (target !== hubConfig.activeConfigDir) {
    console.log(`Switching CLAUDE_CONFIG_DIR -> ${target}`);
    await ensurePool(target);
    hubConfig.activeConfigDir = target;
    saveHubConfig();
  }
  res.json({ apps: appsConfig() });
});

// Project list for the switcher palette, proxied from kanban — it is the only sub-app that
// enumerates projects. The port is read per request because kanban's real port is only known
// once its banner has been scraped (see spawnApp).
app.get('/api/projects', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const kanbanPort = activePool()?.ports.kanban;
  if (!kanbanPort) {
    res.status(503).json({ error: 'kanban is starting' });
    return;
  }
  try {
    // 127.0.0.1, not localhost — Node's verbatim DNS ordering tries ::1 first on Windows.
    const upstream = await fetch(`http://127.0.0.1:${kanbanPort}/api/projects`, {
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

listenWithFallback(app, HUB_PORT, onReady, '');

function printBanner(port) {
  console.log(`Claude Code Hub running at http://localhost:${port}`);
  const warning = net.exposureWarning();
  if (warning) console.log(warning);
  console.log('Type "q" or "exit" to stop the server');
}
