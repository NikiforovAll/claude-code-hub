#!/usr/bin/env node

const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

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

const children = [];
const actualPorts = { marketplace: MARKETPLACE_PORT, kanban: KANBAN_PORT, cost: COST_PORT, memory: MEMORY_PORT };

function spawnApp(name, cmd, args, envPort) {
  const child = spawn(cmd, args, {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(envPort),
      CLAUDE_HUB: '1',
      HUB_URL: `http://localhost:${HUB_PORT}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  child.stdout.on('data', (d) => {
    stdoutBuf += d.toString();
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl + 1);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      process.stdout.write(`[${name}] ${line}`);
      const match = line.match(/running at http:\/\/localhost:(\d+)/i);
      if (match) actualPorts[name] = parseInt(match[1], 10);
    }
  });
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => console.log(`[${name}] exited (code ${code})`));

  children.push(child);
  return child;
}

function killAll() {
  for (const child of children) {
    if (child.killed) continue;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  }
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
const NODE_HDR = '--max-http-header-size=65536';

spawnApp('marketplace', process.execPath, [NODE_HDR, marketplacePath, `--port=${MARKETPLACE_PORT}`], MARKETPLACE_PORT);
spawnApp('kanban', process.execPath, [NODE_HDR, kanbanPath], KANBAN_PORT);
spawnApp('cost', process.execPath, [NODE_HDR, costPath, `--port=${COST_PORT}`], COST_PORT);
spawnApp('memory', process.execPath, [NODE_HDR, memoryPath, `--port=${MEMORY_PORT}`], MEMORY_PORT);

const app = express();

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

app.get('/api/config', (_req, res) => {
  res.json({
    themeAccents,
    apps: {
      kanban: { name: 'Kanban', url: `http://localhost:${actualPorts.kanban}`, icon: 'columns' },
      marketplace: { name: 'Marketplace', url: `http://localhost:${actualPorts.marketplace}`, icon: 'store' },
      cost: { name: 'Cost', url: `http://localhost:${actualPorts.cost}`, icon: 'dollar-sign' },
      memory: { name: 'Memory', url: `http://localhost:${actualPorts.memory}`, icon: 'database' },
    },
  });
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

// Normalizes a typed path to its real on-disk form (true casing, native separators) so cck's
// strict === project match and cost's abs->encoded transform both hit. List-picked paths skip
// this: they are byte-exact copies of what kanban reported.
app.get('/api/resolve-path', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const input = typeof req.query.path === 'string' ? req.query.path.trim() : '';
  if (!input) {
    res.status(400).json({ error: 'path is required' });
    return;
  }
  let resolved;
  try {
    resolved = fs.realpathSync.native(path.resolve(input));
  } catch {
    res.status(404).json({ error: 'Path not found' });
    return;
  }
  if (!fs.statSync(resolved).isDirectory()) {
    res.status(400).json({ error: 'Not a directory' });
    return;
  }
  res.json({ path: resolved });
});

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer({ maxHeaderSize: 65536 }, app);
server.listen(HUB_PORT, () => {
  const actual = server.address().port;
  printBanner(actual);
  if (process.argv.includes('--open')) {
    import('open').then((m) => m.default(`http://localhost:${actual}`));
  }
});

function printBanner(port) {
  console.log(`Claude Code Hub running at http://localhost:${port}`);
  console.log('Type "q" or "exit" to stop the server');
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
    console.log(`Port ${HUB_PORT} in use, trying random port...`);
    const fallback = http.createServer({ maxHeaderSize: 65536 }, app);
    fallback.listen(0, () => {
      const actual = fallback.address().port;
      printBanner(actual);
      if (process.argv.includes('--open')) {
        import('open').then((m) => m.default(`http://localhost:${actual}`));
      }
    });
  } else {
    throw err;
  }
});
