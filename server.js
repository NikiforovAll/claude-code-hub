#!/usr/bin/env node

const { spawn } = require('child_process');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const http = require('http');
const tcp = require('net');
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
const RESTART_DELAY_MS = 500;
// A rate window, not a total: a child may die and recover all session, but one that cannot stay up
// stops being restarted. A consecutive counter cannot express that — anything that starts at all
// clears it, so a child that starts and dies forever restarts forever.
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;

// One child set per config dir, kept alive after a switch so switching back is instant. Map
// insertion order doubles as LRU: activating a dir re-inserts it at the end.
const pools = new Map();

function activePool() {
  return pools.get(hubConfig.activeConfigDir);
}

// Every sub-app resolves CLAUDE_CONFIG_DIR once at startup into a module constant, so switching
// the dir means restarting the children. Kept on the server, not in the browser: the dir has to
// be known before the first spawn, and the hub already has one localStorage key to reason about.
const HUB_DIR = path.join(os.homedir(), '.claude-hub');
const HUB_CONFIG_FILE = path.join(HUB_DIR, 'config.json');

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
  // Hand-edited only; kept verbatim so a rewrite of the file does not drop it.
  if (saved.terminal && typeof saved.terminal === 'object') config.terminal = saved.terminal;
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

// cck's embedded terminal, on by default under the hub (standalone cck keeps it opt-in).
// `"terminal": {"enabled": false}` or --disable-terminal turns it off. One token per hub launch,
// shared by every pool: the hub puts it in the kanban iframe's URL fragment and cck checks it on
// the WebSocket. cck applies the rest of its policy (exposure refusal, Origin, session cap) itself.
const TERMINAL = {
  ...(hubConfig.terminal || {}),
  enabled: !process.argv.includes('--disable-terminal') && hubConfig.terminal?.enabled !== false,
};
const TERMINAL_TOKEN = TERMINAL.enabled ? crypto.randomBytes(32).toString('hex') : null;

// Loopback is not a user boundary: any local account can reach the hub port, and /api/config carries
// the terminal token. Persisted, unlike the terminal token, so an installed PWA's cookie outlives a
// hub restart.
const HUB_TOKEN_FILE = path.join(HUB_DIR, 'token');
const TOKEN_COOKIE = 'hub_token';
const TOKEN_COOKIE_RE = /(?:^|;\s*)hub_token=([^;]*)/;
const TOKEN_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const LOCKED_PAGE = path.join(__dirname, 'public', 'locked.html');

function loadHubToken() {
  try {
    const saved = fs.readFileSync(HUB_TOKEN_FILE, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(saved)) return saved;
  } catch {}
  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(HUB_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(HUB_TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  return token;
}

const HUB_TOKEN = loadHubToken();
const HUB_TOKEN_BUF = Buffer.from(HUB_TOKEN);

function tokenMatches(candidate) {
  if (typeof candidate !== 'string' || candidate.length !== HUB_TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), HUB_TOKEN_BUF);
}

// Scripts, styles, icons and the manifest stay public: they hold no secrets, and Chrome fetches the
// manifest without cookies, so gating it would break PWA install.
function tokenGuard(req, res, next) {
  const isApi = req.path.startsWith('/api/');
  if (!isApi && req.path !== '/' && req.path !== '/index.html') return next();
  if (tokenMatches(req.query.token)) {
    res.cookie(TOKEN_COOKIE, HUB_TOKEN, { httpOnly: true, sameSite: 'strict', maxAge: TOKEN_COOKIE_MAX_AGE_MS });
    if (isApi) return next();
    const url = new URL(req.originalUrl, 'http://hub');
    url.searchParams.delete('token');
    return res.redirect(302, url.pathname + url.search);
  }
  if (tokenMatches(TOKEN_COOKIE_RE.exec(req.headers.cookie || '')?.[1])) return next();
  res.setHeader('Cache-Control', 'no-store');
  if (isApi) return res.status(401).json({ error: 'hub token required' });
  res.status(401).sendFile(LOCKED_PAGE, { cacheControl: false });
}

function childEnv(pool, name) {
  const env = {
    ...process.env,
    PORT: '0',
    CLAUDE_CONFIG_DIR: pool.dir,
    CLAUDE_HUB: '1',
    HUB_URL: `http://localhost:${HUB_PORT}`,
    HOST: net.BIND_HOST,
    ALLOWED_HOSTS: net.ALLOWED_HOSTS,
  };
  if (name === 'kanban' && TERMINAL.enabled) {
    env.CCK_TERMINAL = JSON.stringify(TERMINAL);
    env.CCK_TERMINAL_TOKEN = TERMINAL_TOKEN;
  }
  return env;
}

function spawnApp(pool, name, cmd, args) {
  const child = spawn(cmd, args, {
    cwd: __dirname,
    env: childEnv(pool, name),
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
    // The port dies with the child and the OS may hand it to a stranger, so stop dialing it.
    delete pool.ports[name];
    markReady();
    if (pool.retired || pool.children.get(name) !== child) return;
    // Nothing else would ever bring this app back: a pool is only rebuilt when its dir is
    // re-activated.
    const recent = (pool.restarts[name] || []).filter((t) => Date.now() - t < RESTART_WINDOW_MS);
    if (recent.length >= MAX_RESTARTS) {
      console.log(`[${name}] gave up after ${MAX_RESTARTS} restarts in ${RESTART_WINDOW_MS / 1000}s`);
      return;
    }
    recent.push(Date.now());
    pool.restarts[name] = recent;
    setTimeout(() => {
      if (pool.retired) return;
      console.log(`[${name}] restarting (${recent.length}/${MAX_RESTARTS})`);
      spawnApp(pool, name, cmd, args);
    }, RESTART_DELAY_MS).unref();
  });

  pool.children.set(name, child);
  return child;
}

function killChild(child) {
  if (child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
}

function killPool(pool) {
  pool.retired = true;
  for (const child of pool.children.values()) killChild(child);
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
  if (pools.size >= POOL_SIZE) await evictPools(dir);
  pool = pools.get(dir);
  if (pool) return pool.ready;
  pool = { dir, children: new Map(), ports: {}, restarts: {}, retired: false };
  pools.set(dir, pool);
  spawnChildren(pool);
  const ready = [...pool.children.values()].map((c) => c.ready);
  pool.ready = withTimeout(Promise.all(ready), 20000).then(() => pool);
  return pool.ready;
}

async function terminalCount(pool) {
  const port = pool.ports.kanban;
  if (!port) return 0;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/terminals`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? (await r.json()).sessions?.length || 0 : 0;
  } catch {
    return 0;
  }
}

// A pool whose cck holds live terminals is pinned: killing it would kill running claude sessions.
// When every candidate is pinned the pool size is exceeded rather than losing work.
async function evictPools(keepDir) {
  let pinned = new Set();
  if (TERMINAL.enabled) {
    const candidates = [...pools.values()].filter((p) => p.dir !== keepDir);
    const counts = await Promise.all(candidates.map(terminalCount));
    pinned = new Set(candidates.filter((_, i) => counts[i]).map((p) => p.dir));
  }
  while (pools.size >= POOL_SIZE) {
    const victim = [...pools.keys()].find((d) => d !== keepDir && !pinned.has(d));
    if (!victim) {
      console.log(`Pool size ${POOL_SIZE} exceeded: every other pool has live terminals`);
      return;
    }
    console.log(`Evicting children for ${victim}`);
    dropPool(victim);
  }
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

// Two failures look the same from here and both recover on their own: a pooled socket the child
// closed under us, and a child that is restarting. The port is re-read per attempt, so a replay
// reaches the replacement child rather than the ephemeral port that died with the old one.
const RETRYABLE = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ECONNREFUSED', 'ETIMEDOUT']);
const MAX_ATTEMPTS = 3;
const ATTEMPT_DELAY_MS = 250;
// A connect to a freshly-bound loopback port is sometimes black-holed on Windows (the child shows
// as LISTENING and answers nothing) and the OS gives up only after ~20s. This caps the connect
// alone, never the response: a sub-app handler may legitimately take minutes on a cold scan, and
// capping time-to-first-byte would kill that request, replay it, and then kill a healthy child.
const CONNECT_TIMEOUT_MS = 3000;
// A restart costs about a second, so a document load waits it out instead of showing an error.
const NAV_PORT_WAIT_MS = 10000;
const API_PORT_WAIT_MS = 2000;

const delay = (ms) => new Promise((r) => setTimeout(r, ms).unref());

// An iframe document load, as opposed to the sub-app's own fetch/XHR.
function isNavigation(req) {
  if (req.headers['sec-fetch-mode']) return req.headers['sec-fetch-mode'] === 'navigate';
  return (req.headers.accept || '').includes('text/html');
}

// Races the child's own ready promise rather than polling it, so a restarted app starts serving the
// moment it prints its port instead of on the next tick.
async function waitForPort(name, deadline) {
  for (;;) {
    const pool = activePool();
    const port = pool?.ports[name];
    if (port) return port;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await Promise.race([pool?.children.get(name)?.ready, delay(Math.min(remaining, 250))]);
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// A document load that fails gets a page that reloads itself — the reload the user would do by
// hand. The cap is small because the server already waited NAV_PORT_WAIT_MS before serving this,
// and each reload re-spends that wait. sessionStorage throws when site data is blocked, and a page
// whose only job is to reload must still reload there.
function retryPage(name, detail) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>:root{color-scheme:light dark}body{font:14px system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh}
div{text-align:center;opacity:.7}code{font-size:12px;opacity:.6}</style>
</head><body><div><p id="m">${escapeHtml(name)} is restarting…</p><p><code>${escapeHtml(detail)}</code></p></div>
<script>
let n = 0;
const k = 'hub-retry:' + location.pathname;
try { n = +(sessionStorage.getItem(k) || 0); sessionStorage.setItem(k, n + 1); } catch {}
if (n < 3) setTimeout(() => location.reload(), 1000);
else { try { sessionStorage.removeItem(k); } catch {} document.getElementById('m').textContent = 'not responding'; }
</script></body></html>`;
}

function sendUnavailable(req, res, name, status, detail) {
  if (res.destroyed || res.headersSent) return;
  if (isNavigation(req)) {
    res.writeHead(status, { 'Retry-After': '1', 'Content-Type': 'text/html; charset=utf-8' });
    res.end(retryPage(name, detail));
    return;
  }
  // The sub-app's own callers hand the body to .json(): plain text surfaces as a SyntaxError
  // instead of the reason.
  res.writeHead(status, { 'Retry-After': '1', 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: detail }));
}

// A pooled socket the child closed under us is normal and recovers on the next attempt. A port that
// never completes a connect does not, so the child is replaced and the respawn gives it a new one.
function replaceChild(name, childPort, err) {
  const pool = activePool();
  const child = pool?.children.get(name);
  if (!child || pool.ports[name] !== childPort) return;
  console.log(`[${name}] unreachable at 127.0.0.1:${childPort} (${err.code}) - replacing it`);
  delete pool.ports[name];
  killChild(child);
}

// Fires only while the socket is still connecting, so a slow handler is never interrupted.
function capConnect(upstream, name, childPort) {
  upstream.on('socket', (socket) => {
    if (!socket.connecting) return;
    const timer = setTimeout(() => {
      const err = new Error(`no connect to ${name} at 127.0.0.1:${childPort}`);
      err.code = 'ETIMEDOUT';
      upstream.destroy(err);
    }, CONNECT_TIMEOUT_MS);
    const clear = () => clearTimeout(timer);
    socket.once('connect', clear);
    upstream.once('close', clear);
  });
}

// Resolves null once the response is committed (or the client is gone), or the error when nothing
// has been written yet and the caller may still retry.
function forward(name, req, res, childPort, headers, replayable, onUpstream) {
  return new Promise((resolve) => {
    const upstream = http.request(
      { host: '127.0.0.1', port: childPort, method: req.method, path: req.url, headers, agent: proxyAgent },
      (u) => {
        res.writeHead(u.statusCode, u.headers);
        u.pipe(res);
        resolve(null);
      },
    );
    onUpstream(upstream);
    capConnect(upstream, name, childPort);
    upstream.on('error', (err) => {
      if (res.headersSent) {
        res.end();
        resolve(null);
        return;
      }
      resolve(err);
    });
    if (replayable) upstream.end();
    else req.pipe(upstream);
  });
}

// Host is forwarded untouched so the child's hostGuard still sees what the browser sent. Origin is
// the one header the child cannot judge on its own: its guard compares the port to its own
// ephemeral one, so the public-port spelling is mapped to the child's; anything else passes
// through as-is and the child rejects it.
function proxyHandler(name) {
  return async (req, res) => {
    const headers = { ...req.headers };
    // req is consumed by the first attempt, so only a request with no body can be re-sent. Waiting
    // for a port is not a replay — nothing has been sent yet — so every method gets the same wait.
    const replayable = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    // One deadline for the whole request, not one per attempt: a retry must not re-spend the wait.
    const deadline = Date.now() + (isNavigation(req) ? NAV_PORT_WAIT_MS : API_PORT_WAIT_MS);
    // One listener for the request, however many attempts it takes.
    let current = null;
    res.once('close', () => current?.destroy());

    for (let attempt = 1; !res.destroyed; attempt++) {
      const childPort = await waitForPort(name, deadline);
      if (!childPort) {
        sendUnavailable(req, res, name, 503, `${name} is starting`);
        return;
      }
      if (req.headers.origin) {
        headers.origin = rewriteOrigin(req.headers.origin, publicPorts[name], childPort);
      }
      const err = await forward(name, req, res, childPort, headers, replayable, (u) => {
        current = u;
      });
      if (!err) return;
      if (!replayable || attempt >= MAX_ATTEMPTS || !RETRYABLE.has(err.code)) {
        // A port that ate every attempt is not coming back; anything less is a transient close.
        if (attempt >= MAX_ATTEMPTS) replaceChild(name, childPort, err);
        sendUnavailable(req, res, name, 502, err.message);
        return;
      }
      await delay(ATTEMPT_DELAY_MS);
    }
  };
}

// WebSocket upgrades (cck's terminal) are tunnelled as raw bytes for every app. Host and Origin get
// the same treatment as proxyHandler; the child runs its own upgrade checks, and a child with no
// upgrade listener closes the socket.
function proxyUpgrade(name) {
  return async (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    const childPort = await waitForPort(name, Date.now() + API_PORT_WAIT_MS);
    if (!childPort || socket.destroyed) {
      socket.destroy();
      return;
    }
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      let value = req.rawHeaders[i + 1];
      if (req.rawHeaders[i].toLowerCase() === 'origin') value = rewriteOrigin(value, publicPorts[name], childPort);
      lines.push(`${req.rawHeaders[i]}: ${value}`);
    }
    const upstream = tcp.connect(childPort, '127.0.0.1', () => {
      clearTimeout(connectTimer);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const connectTimer = setTimeout(() => upstream.destroy(), CONNECT_TIMEOUT_MS);
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
  };
}

function listenWithFallback(handler, port, onReady, label, onUpgrade) {
  const opts = { maxHeaderSize: HDR_BYTES, onUpgrade };
  const server = net.listenLoopback(handler, port, onReady, opts);
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
    console.log(`${label}port ${port} in use, trying random port...`);
    net.listenLoopback(handler, 0, onReady, opts);
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
    proxyUpgrade(name),
  );
}

ensurePool(hubConfig.activeConfigDir);

const app = express();

// Mounted before the routes below, which are registered ahead of the first
// app.use() and would otherwise bypass the guards entirely.
app.use(net.hostGuard);
app.use(net.frameGuard);
app.use(net.originGuard);
app.use(tokenGuard);
app.use(express.json());

// The hub's CSS variables per color theme and mode, read from the same registry generate-themes.mjs
// compiles into each sub-app's themes.css. Served rather than hand-copied into public/app.js so there
// is one source of truth. --bg is the sub-apps' --bg-deep, so the loading screen hands off to an
// iframe without a flash of another color.
// Read once — themes.json only changes when the generator is re-run, which restarts the hub anyway.
const hubVars = (p) => ({
  '--accent': p.ember,
  '--bg': p.field,
  '--surface': p.surface,
  '--surface-hover': p.hover,
  '--border': p.border,
  '--text': p.ink1,
  '--text-dim': p.inkMuted,
});
const themePalettes = (() => {
  try {
    const themes = JSON.parse(fs.readFileSync(path.join(__dirname, 'scripts/themes.json'), 'utf8'));
    return Object.fromEntries(themes.map((t) => [t.id, { dark: hubVars(t.dark), light: hubVars(t.light) }]));
  } catch {
    // Palette falls back to the --accent in index.html; not worth failing startup over.
    return {};
  }
})();

function appsConfig() {
  const kanban = { name: 'Kanban', url: `http://localhost:${publicPorts.kanban}`, icon: 'columns' };
  if (TERMINAL_TOKEN) kanban.terminalToken = TERMINAL_TOKEN;
  return {
    kanban,
    marketplace: { name: 'Marketplace', url: `http://localhost:${publicPorts.marketplace}`, icon: 'store' },
    cost: { name: 'Cost', url: `http://localhost:${publicPorts.cost}`, icon: 'dollar-sign' },
    memory: { name: 'Memory Diagnoser', url: `http://localhost:${publicPorts.memory}`, icon: 'database' },
  };
}

app.get('/api/config', (_req, res) => {
  res.json({ themePalettes, apps: appsConfig(), activeConfigDir: hubConfig.activeConfigDir, defaultConfigDir });
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
  // Waits like the proxy does, so the palette is not the one thing that hard-fails during a restart.
  const kanbanPort = await waitForPort('kanban', Date.now() + API_PORT_WAIT_MS);
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
    import('open').then((m) => m.default(accessUrl(actual)));
  }
};

listenWithFallback(app, HUB_PORT, onReady, '');

function accessUrl(port) {
  return `http://localhost:${port}/?token=${HUB_TOKEN}`;
}

function printBanner(port) {
  console.log(`Claude Code Hub running at ${accessUrl(port)}`);
  const warning = net.exposureWarning();
  if (warning) console.log(warning);
  console.log('Type "q" or "exit" to stop the server');
}
