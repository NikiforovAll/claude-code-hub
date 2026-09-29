#!/usr/bin/env node

const { spawn } = require('child_process');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const http = require('http');
const tcp = require('net');
const os = require('os');
const path = require('path');
const { actionTable } = require('./lib/actions');
const { selectApps, loadApp } = require('./lib/apps');
const { stripCookie } = require('./lib/cookies');
const { createNetGuard, KEEP_ALIVE_MS } = require('./lib/net-guard');
const { ping } = require('./lib/ping');
const { killChild } = require('./lib/kill-child');
const { themeConfig } = require('./lib/themes');

function getArg(name) {
  const idx = process.argv.findIndex((a) => a.startsWith(`--${name}`));
  if (idx === -1) return null;
  const arg = process.argv[idx];
  if (arg.includes('=')) return arg.split('=').slice(1).join('=');
  return process.argv[idx + 1] || null;
}

const HUB_PORT = parseInt(getArg('port') || process.env.PORT || '3540', 10);
let hubPort = HUB_PORT;

const POOL_SIZE = Math.max(1, parseInt(getArg('pool-size') || '3', 10));
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
const HUB_DIR = path.resolve(expandHome(getArg('hub-dir') || process.env.CLAUDE_HUB_DIR || '~/.claude-hub'));
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
  if (Array.isArray(saved.apps)) config.apps = saved.apps;
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

const { apps: selectedApps, unknown: unknownApps } = selectApps(hubConfig.apps);
const ENABLED_APPS = selectedApps.map((a) => loadApp(a, { flagPort: getArg(`${a.id}-port`) })).filter(Boolean);
for (const id of unknownApps) console.log(`Unknown app "${id}" in ${HUB_CONFIG_FILE}, ignored`);
if (!selectedApps.length) {
  console.error(`Every app is disabled in ${HUB_CONFIG_FILE}. Enable at least one.`);
  process.exit(1);
}
if (!ENABLED_APPS.length) {
  const ids = selectedApps.map((a) => a.id).join(', ');
  console.error(`No enabled app could load (${ids}). The reasons are logged above.`);
  process.exit(1);
}
const ACTIONS = actionTable(ENABLED_APPS);
// The first enabled app in tab order that declares the capability in its manifest.
const provider = (cap) => ENABLED_APPS.find((a) => a.provides[cap]);
const PROJECTS_APP = provider('projects');
const TERMINAL_APP = provider('terminal');

// Every keystroke into cck's terminal passes through the upgrade proxy below. Windows only, for the
// reasons in cck/lib/priority.js; the children spawned after this still start at normal.
if (process.platform === 'win32' && process.env.CCK_PRIORITY_BOOST !== '0') {
  try {
    if (os.getPriority() > os.constants.priority.PRIORITY_ABOVE_NORMAL)
      os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL);
  } catch {
    /* keep the default priority */
  }
}

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
  enabled: !!TERMINAL_APP && !process.argv.includes('--disable-terminal') && hubConfig.terminal?.enabled !== false,
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
// Only a repo checkout has packages/: the npm package does not ship it. An app serves this file in
// place of its vendored copy, so an SDK edit shows up with no sync.
const SDK_SRC = path.join(__dirname, 'packages', 'claude-hub-sdk', 'src', 'client.js');
const HUB_SDK_SRC = fs.existsSync(SDK_SRC) ? SDK_SRC : null;

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
    HUB_URL: `http://localhost:${hubPort}`,
    HOST: net.BIND_HOST,
    ALLOWED_HOSTS: net.ALLOWED_HOSTS,
  };
  if (HUB_SDK_SRC) env.HUB_SDK_SRC = HUB_SDK_SRC;
  if (TERMINAL.enabled && name === TERMINAL_APP.id) {
    env.CCK_TERMINAL = JSON.stringify(TERMINAL);
    env.CCK_TERMINAL_TOKEN = TERMINAL_TOKEN;
  }
  return env;
}

function spawnApp(pool, name, cmd, args) {
  const child = spawn(cmd, args, {
    cwd: __dirname,
    env: childEnv(pool, name),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
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
      child.gaveUp = true;
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

function killPool(pool) {
  pool.retired = true;
  return Promise.all([...pool.children.values()].map((child) => killChild(child)));
}

function killAll() {
  return Promise.all([...pools.values()].map(killPool));
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
  const port = pool.ports[TERMINAL_APP.id];
  if (!port) return 0;
  try {
    const r = await fetch(`http://127.0.0.1:${port}${TERMINAL_APP.provides.terminal.liveWork}`, {
      signal: AbortSignal.timeout(1500),
    });
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

// Waits for the children, so a POSIX child that ignores SIGTERM still gets SIGKILL before the hub exits.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  killAll().then(() => process.exit(0));
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

// Raise header size limit to 64KB — localhost cookies from sibling apps can pile up and
// trip Node's default 16KB limit, breaking iframes with HTTP 431.
const HDR_BYTES = 65536;
const NODE_HDR = `--max-http-header-size=${HDR_BYTES}`;

// Children bind ephemeral ports; the public ports below belong to the hub's proxies. Browser
// localStorage is keyed by origin, so the sub-app origin has to stay put across switches or the
// user loses pins and filters every time the active set changes.
function spawnChildren(pool) {
  for (const a of ENABLED_APPS) spawnApp(pool, a.id, process.execPath, [NODE_HDR, a.entry]);
}

const publicPorts = Object.fromEntries(ENABLED_APPS.map((a) => [a.id, a.port]));

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

// The socket timeout drops idle sockets before the app's server closes them (KEEP_ALIVE_MS), so a
// request never lands on a socket being closed. It does not cut a slow response.
const proxyAgent = new http.Agent({ keepAlive: true, maxSockets: 64, timeout: KEEP_ALIVE_MS - 5000 });

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
    if (pool?.children.get(name)?.gaveUp) return null;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await Promise.race([pool?.children.get(name)?.ready, delay(Math.min(remaining, 250))]);
  }
}

function noPortReason(name) {
  const child = activePool()?.children.get(name);
  if (child?.gaveUp) {
    const detail = `${name} exited after ${MAX_RESTARTS} restarts in ${RESTART_WINDOW_MS / 1000}s. The hub stopped restarting it`;
    return { headline: 'stopped', detail };
  }
  return { headline: 'is starting', detail: `${name} is starting` };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// A document load that fails gets a page that reloads itself — the reload the user would do by
// hand. The cap is small because the server already waited NAV_PORT_WAIT_MS before serving this,
// and each reload re-spends that wait. sessionStorage throws when site data is blocked, and a page
// whose only job is to reload must still reload there.
function retryPage(name, headline, detail) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>:root{color-scheme:light dark}body{font:14px system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh}
div{text-align:center;opacity:.7}code{font-size:12px;opacity:.6}</style>
</head><body><div><p id="m">${escapeHtml(name)} ${escapeHtml(headline)}…</p><p><code>${escapeHtml(detail)}</code></p></div>
<script>
let n = 0;
const k = 'hub-retry:' + location.pathname;
try { n = +(sessionStorage.getItem(k) || 0); sessionStorage.setItem(k, n + 1); } catch {}
if (n < 3) setTimeout(() => location.reload(), 1000);
else { try { sessionStorage.removeItem(k); } catch {} document.getElementById('m').textContent = 'not responding'; }
</script></body></html>`;
}

function sendUnavailable(req, res, name, status, detail, headline) {
  if (res.destroyed || res.headersSent) return;
  if (isNavigation(req)) {
    res.writeHead(status, { 'Retry-After': '1', 'Content-Type': 'text/html; charset=utf-8' });
    res.end(retryPage(name, headline, detail));
    return;
  }
  // The sub-app's own callers hand the body to .json(): plain text surfaces as a SyntaxError
  // instead of the reason.
  res.writeHead(status, { 'Retry-After': '1', 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: detail }));
}

// The child on childPort, or null when it has been replaced since the connect was tried.
function currentChild(name, childPort) {
  const pool = activePool();
  return pool?.ports[name] === childPort ? pool.children.get(name) : null;
}

// A busy event loop (cck's cache warmup) must not read as a dead app.
const PING_TIMEOUT_MS = 3000;
// A drop burst fails many requests at once; they share one ping per child.
const pings = new WeakMap();
function pingChild(name, childPort, err) {
  const child = currentChild(name, childPort);
  if (!child) return Promise.resolve(false);
  if (!pings.has(child)) {
    const alive = ping(child, PING_TIMEOUT_MS).then((ok) => {
      pings.delete(child);
      if (ok) console.warn(`[${name}] answers over IPC at 127.0.0.1:${childPort} (${err.code}) - keeping it`);
      return ok;
    });
    pings.set(child, alive);
  }
  return pings.get(child);
}

// A drop burst fails dozens of connects that the next attempt fixes, so retries are counted and
// logged as one line per app every RETRY_LOG_MS. The IPC check, a replace and a failure log at once.
const RETRY_LOG_MS = 5 * 60_000;
const retryCounts = new Map();
function countRetry(name, code) {
  const key = `${name} ${code}`;
  const entry = retryCounts.get(key) || { name, code, n: 0 };
  entry.n++;
  retryCounts.set(key, entry);
}
setInterval(() => {
  for (const { name, code, n } of retryCounts.values()) {
    console.log(`[${name}] ${n} connects failed (${code}) and were retried in the last ${RETRY_LOG_MS / 60_000} min`);
  }
  retryCounts.clear();
}, RETRY_LOG_MS).unref();

const ALIVE_WAIT_MS = 30000;
const MAX_BACKOFF_MS = 2000;

// Returns {wait} before the next connect attempt, or {headline, detail} to give up with. A pong
// moves budget.deadline to ALIVE_WAIT_MS from now: the child runs, so the request waits out the drop.
async function afterConnectFailure(name, childPort, err, attempt, budget) {
  const next = await nextAttempt(name, childPort, err, attempt, budget);
  if (next.wait) countRetry(name, err.code);
  return next;
}

async function nextAttempt(name, childPort, err, attempt, budget) {
  if (attempt < MAX_ATTEMPTS) return { wait: ATTEMPT_DELAY_MS };
  if (attempt === MAX_ATTEMPTS) {
    if (!(await pingChild(name, childPort, err))) {
      replaceChild(name, childPort, err);
      return { headline: 'is restarting', detail: `${name} did not answer over TCP (${err.code}) or IPC` };
    }
    budget.deadline = Math.max(budget.deadline, Date.now() + ALIVE_WAIT_MS);
  }
  const wait = Math.min(ATTEMPT_DELAY_MS * 2 ** (attempt - MAX_ATTEMPTS + 1), MAX_BACKOFF_MS);
  if (Date.now() + wait < budget.deadline) return { wait };
  // Its listener is gone or stuck while the process lives on. A new process gets a new port.
  if (currentChild(name, childPort)) {
    console.warn(`[${name}] answers over IPC, but connects to 127.0.0.1:${childPort} kept failing (${err.code})`);
    replaceChild(name, childPort, err);
  }
  return {
    headline: 'is restarting',
    detail: `${name} answers over IPC, but connects to it kept failing (${err.code}) for ${ALIVE_WAIT_MS / 1000}s`,
  };
}

// A pooled socket the child closed under us is normal and recovers on the next attempt. A port that
// never completes a connect does not, so the child is replaced and the respawn gives it a new one.
function replaceChild(name, childPort, err) {
  const child = currentChild(name, childPort);
  if (!child) return;
  console.log(`[${name}] unreachable at 127.0.0.1:${childPort} (${err.code}) - replacing it`);
  delete activePool().ports[name];
  killChild(child);
}

const connectTimeoutError = (name, childPort) =>
  Object.assign(new Error(`no connect to ${name} at 127.0.0.1:${childPort}`), { code: 'ETIMEDOUT' });

// Fires only while the socket is still connecting, so a slow handler is never interrupted.
function capConnect(upstream, name, childPort) {
  upstream.on('socket', (socket) => {
    if (!socket.connecting) return;
    const timer = setTimeout(() => upstream.destroy(connectTimeoutError(name, childPort)), CONNECT_TIMEOUT_MS);
    const clear = () => clearTimeout(timer);
    socket.once('connect', clear);
    upstream.once('close', clear);
  });
}

// Resolves null once the response is committed (or the client is gone), or the error when nothing
// has been written yet and the caller may still retry.
const MAX_REPLAY_BODY = 1024 * 1024;

// Resolves the whole body when it is small enough to keep for a retry, else null (the body then
// streams once). A chunked body has no length up front, so it streams too.
function readReplayBody(req) {
  const te = req.headers['transfer-encoding'];
  const cl = req.headers['content-length'];
  if (te) return Promise.resolve(null);
  if (cl === undefined) return Promise.resolve(Buffer.alloc(0));
  const len = Number(cl);
  if (!Number.isSafeInteger(len) || len > MAX_REPLAY_BODY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.once('end', () => resolve(Buffer.concat(chunks)));
    req.once('error', () => resolve(undefined));
    req.once('close', () => {
      if (!req.complete) resolve(undefined);
    });
  });
}

function forward(name, req, res, childPort, headers, body, onUpstream) {
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
    if (body) upstream.end(body.length ? body : undefined);
    else req.pipe(upstream);
  });
}

// RFC 9110 §7.6.1. The client's "Connection: close" would otherwise close the pooled socket to the
// app too. Transfer-Encoding stays: it frames the body that is piped on.
function stripHopByHop(headers) {
  for (const h of (headers.connection || '').split(',')) delete headers[h.trim().toLowerCase()];
  for (const h of ['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'upgrade']) delete headers[h];
}

// Host is forwarded untouched so the child's hostGuard still sees what the browser sent. Origin is
// the one header the child cannot judge on its own: its guard compares the port to its own
// ephemeral one, so the public-port spelling is mapped to the child's; anything else passes
// through as-is and the child rejects it. Cookies on localhost are shared across ports, so the
// browser sends the hub's own token cookie to every app; it never reaches a child.
function proxyHandler(name) {
  return async (req, res) => {
    const headers = { ...req.headers };
    const cookie = stripCookie(headers.cookie, TOKEN_COOKIE);
    if (cookie) headers.cookie = cookie;
    else delete headers.cookie;
    stripHopByHop(headers);
    // req is consumed by the first attempt, so a request is re-sent only from its kept body. Waiting
    // for a port is not a replay — nothing has been sent yet — so every request gets the same wait.
    const body = await readReplayBody(req);
    if (body === undefined) return;
    // One deadline for the whole request, not one per attempt: a retry must not re-spend the wait.
    const budget = { deadline: Date.now() + (isNavigation(req) ? NAV_PORT_WAIT_MS : API_PORT_WAIT_MS) };
    // One listener for the request, however many attempts it takes.
    let current = null;
    res.once('close', () => current?.destroy());

    for (let attempt = 1; !res.destroyed; attempt++) {
      const childPort = await waitForPort(name, budget.deadline);
      if (!childPort) {
        const { headline, detail } = noPortReason(name);
        sendUnavailable(req, res, name, 503, detail, headline);
        return;
      }
      if (req.headers.origin) {
        headers.origin = rewriteOrigin(req.headers.origin, publicPorts[name], childPort);
      }
      const err = await forward(name, req, res, childPort, headers, body, (u) => {
        current = u;
      });
      if (!err) return;
      if (body === null || !RETRYABLE.has(err.code)) {
        sendUnavailable(req, res, name, 502, err.message, 'did not respond');
        return;
      }
      const next = await afterConnectFailure(name, childPort, err, attempt, budget);
      if (!next.wait) {
        sendUnavailable(req, res, name, 503, next.detail, next.headline);
        return;
      }
      await delay(next.wait);
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
      const header = req.rawHeaders[i].toLowerCase();
      let value = req.rawHeaders[i + 1];
      if (header === 'origin') value = rewriteOrigin(value, publicPorts[name], childPort);
      if (header === 'cookie' && !(value = stripCookie(value, TOKEN_COOKIE))) continue;
      lines.push(`${req.rawHeaders[i]}: ${value}`);
    }
    const budget = { deadline: Date.now() + NAV_PORT_WAIT_MS };
    tunnel(name, childPort, `${lines.join('\r\n')}\r\n\r\n`, head, socket, 1, budget);
  };
}

// A connect that never opened follows the same retry rule as proxyHandler.
function tunnel(name, childPort, request, head, socket, attempt, budget) {
  let connected = false;
  const upstream = tcp.connect(childPort, '127.0.0.1', () => {
    connected = true;
    clearTimeout(connectTimer);
    upstream.write(request);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const connectTimer = setTimeout(() => upstream.destroy(connectTimeoutError(name, childPort)), CONNECT_TIMEOUT_MS);
  const onSocketClose = () => upstream.destroy();
  socket.on('close', onSocketClose);
  upstream.on('error', async (err) => {
    if (connected || socket.destroyed) {
      socket.destroy();
      return;
    }
    clearTimeout(connectTimer);
    socket.off('close', onSocketClose);
    upstream.removeAllListeners('close');
    const next = await afterConnectFailure(name, childPort, err, attempt, budget);
    if (!next.wait || socket.destroyed) {
      socket.destroy();
      return;
    }
    await delay(next.wait);
    if (socket.destroyed) return;
    tunnel(name, childPort, request, head, socket, attempt + 1, budget);
  });
  upstream.on('close', () => socket.destroy());
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

for (const [name, port] of Object.entries(publicPorts)) {
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
// is one source of truth.
// Read once — themes.json only changes when the generator is re-run, which restarts the hub anyway.
const THEME_CONFIG = themeConfig();

function appsConfig() {
  return Object.fromEntries(
    ENABLED_APPS.map((a) => {
      const entry = { name: a.name, url: `http://localhost:${publicPorts[a.id]}`, icon: a.icon, loading: a.loading };
      if (TERMINAL_TOKEN && a.id === TERMINAL_APP.id) entry.terminalToken = TERMINAL_TOKEN;
      return [a.id, entry];
    }),
  );
}

app.get('/api/config', (_req, res) => {
  res.json({
    ...THEME_CONFIG,
    apps: appsConfig(),
    actions: ACTIONS,
    activeConfigDir: hubConfig.activeConfigDir,
    defaultConfigDir,
  });
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

// Project list for the switcher palette, proxied from the app that provides `projects`. The port is
// read per request because the provider's real port is only known once its banner has been scraped
// (see spawnApp).
app.get('/api/projects', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!PROJECTS_APP) {
    res.status(503).json({ error: 'no enabled app provides projects' });
    return;
  }
  const { id } = PROJECTS_APP;
  // Waits like the proxy does, so the palette is not the one thing that hard-fails during a restart.
  const port = await waitForPort(id, Date.now() + API_PORT_WAIT_MS);
  if (!port) {
    res.status(503).json({ error: `${id} is starting` });
    return;
  }
  try {
    // 127.0.0.1, not localhost — Node's verbatim DNS ordering tries ::1 first on Windows.
    const upstream = await fetch(`http://127.0.0.1:${port}${PROJECTS_APP.provides.projects.path}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `${id} responded ${upstream.status}` });
      return;
    }
    res.json(await upstream.json());
  } catch (err) {
    // Soft-fail so the palette still opens and offers literal-path entry.
    res.status(502).json({ error: `${id} unavailable: ${err.message}` });
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

// Children get HUB_URL at spawn and trust only that origin, so the first pool waits for the port
// the hub actually bound: HUB_PORT may be busy and fall back to a random one.
const onReady = (actual) => {
  hubPort = actual;
  ensurePool(hubConfig.activeConfigDir);
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
