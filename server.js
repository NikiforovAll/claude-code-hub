#!/usr/bin/env node

const { spawn } = require('child_process');
const express = require('express');
const http = require('http');
const path = require('path');

function getArg(name) {
  const idx = process.argv.findIndex((a) => a.startsWith(`--${name}`));
  if (idx === -1) return null;
  const arg = process.argv[idx];
  if (arg.includes('=')) return arg.split('=').slice(1).join('=');
  return process.argv[idx + 1] || null;
}

const HUB_PORT = parseInt(getArg('port') || process.env.PORT || '3455', 10);
const MARKETPLACE_PORT = parseInt(getArg('marketplace-port') || '3457', 10);
const KANBAN_PORT = parseInt(getArg('kanban-port') || '3456', 10);
const COST_PORT = parseInt(getArg('cost-port') || '3458', 10);
const MEMORY_PORT = parseInt(getArg('memory-port') || '3459', 10);

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

app.get('/api/config', (_req, res) => {
  res.json({
    apps: {
      kanban: { name: 'Kanban', url: `http://localhost:${actualPorts.kanban}`, icon: 'columns' },
      marketplace: { name: 'Marketplace', url: `http://localhost:${actualPorts.marketplace}`, icon: 'store' },
      cost: { name: 'Cost', url: `http://localhost:${actualPorts.cost}`, icon: 'dollar-sign' },
      memory: { name: 'Memory', url: `http://localhost:${actualPorts.memory}`, icon: 'database' },
    },
  });
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
