#!/usr/bin/env node

const { spawn } = require('child_process');
const express = require('express');
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

const children = [];
const actualPorts = { marketplace: MARKETPLACE_PORT, kanban: KANBAN_PORT, cost: COST_PORT };

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

process.on('SIGINT', () => {
  killAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  killAll();
  process.exit(0);
});

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

spawnApp('marketplace', process.execPath, [marketplacePath, `--port=${MARKETPLACE_PORT}`], MARKETPLACE_PORT);
spawnApp('kanban', process.execPath, [kanbanPath], KANBAN_PORT);
spawnApp('cost', process.execPath, [costPath, `--port=${COST_PORT}`], COST_PORT);

const app = express();

app.get('/api/config', (_req, res) => {
  res.json({
    apps: {
      kanban: { name: 'Kanban', url: `http://localhost:${actualPorts.kanban}`, icon: 'columns' },
      marketplace: { name: 'Marketplace', url: `http://localhost:${actualPorts.marketplace}`, icon: 'store' },
      cost: { name: 'Cost', url: `http://localhost:${actualPorts.cost}`, icon: 'dollar-sign' },
    },
  });
});

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(HUB_PORT, () => {
  const actual = server.address().port;
  console.log(`Claude Code Hub running at http://localhost:${actual}`);
  if (process.argv.includes('--open')) {
    import('open').then((m) => m.default(`http://localhost:${actual}`));
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
    console.log(`Port ${HUB_PORT} in use, trying random port...`);
    const fallback = app.listen(0, () => {
      const actual = fallback.address().port;
      console.log(`Claude Code Hub running at http://localhost:${actual}`);
      if (process.argv.includes('--open')) {
        import('open').then((m) => m.default(`http://localhost:${actual}`));
      }
    });
  } else {
    throw err;
  }
});
