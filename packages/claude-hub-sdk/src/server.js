'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The hub hands this file to each app it spawns (HUB_SDK_SERVER), so it runs the hub's version, not
// one the app shipped. An app run alone never loads it.

// The app's own process only: a process-tree walk needs an OS call that costs more than the number
// is worth. CPU is sampled over a short window when asked, so nothing runs between asks, and asks
// that overlap share one sample.
const STATS_SAMPLE_MS = 250;
let statsSample = null;

function sampleStats() {
  statsSample ??= new Promise((resolve) => {
    const cpu0 = process.cpuUsage();
    const t0 = process.hrtime.bigint();
    setTimeout(() => {
      const cpu = process.cpuUsage(cpu0);
      const elapsedUs = Number(process.hrtime.bigint() - t0) / 1000;
      statsSample = null;
      resolve({ rss: process.memoryUsage.rss(), cpu: Math.round(((cpu.user + cpu.system) / elapsedUs) * 100) });
    }, STATS_SAMPLE_MS);
  });
  return statsSample;
}

// The hub spawns each app with an IPC channel. A loopback connect can fail while the app is fine,
// so before the hub replaces an app it asks over the channel, which does not go through TCP.
function answerHub() {
  if (!process.channel) return;
  process.on('message', (m) => {
    if (m?.type === 'hub:ping') process.send({ type: 'hub:pong', id: m.id });
    if (m?.type === 'hub:stats')
      sampleStats().then((s) => process.connected && process.send({ type: 'hub:stats', id: m.id, ...s }));
  });
  process.on('disconnect', () => process.exit(0));
  // Listeners ref the channel. The app's own server keeps it alive, not the hub.
  process.channel.unref();
}

// What an app page loads as /vendor/claude-hub-sdk.js: keys.js, then client.js with mods.js ahead of it, or stub.js.
function bundle(file) {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const parts = file === 'client.js' ? ['keys.js', 'mods.js', file] : ['keys.js', file];
  return parts.map(read).join('\n');
}

// HUB_MODS, fixed for the process's life: {assets, files}. `assets` is the page's mod list as the
// client reads it; `files` maps each /mods path to the file on disk, and only those are served.
// The hub builds both (lib/mods.js appModEnv), so the URL format is not repeated here.
function readMods() {
  try {
    const { assets, files } = JSON.parse(process.env.HUB_MODS || '{}');
    if (assets && typeof assets === 'object' && files && typeof files === 'object')
      return { assets, files: new Map(Object.entries(files)) };
  } catch {}
  return { assets: null, files: new Map() };
}

// Mount before express.static: the hub's client must win over the app's stub in public/vendor.
function mount(app) {
  answerHub();
  const { assets, files } = readMods();
  const prefix = assets ? `self.ClaudeHubMods = ${JSON.stringify(assets)};\n` : '';
  const client = prefix + bundle('client.js');
  app.get('/vendor/claude-hub-sdk.js', (_req, res) => res.type('js').send(client));
  if (files.size) {
    // app.use, not a route pattern, so it works on each app's Express version.
    app.use('/mods', (req, res, next) => {
      const abs = files.get(req.path);
      if (!abs || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
      res.sendFile(abs, { maxAge: '1y', immutable: true });
    });
  }
  app.get('/hub-config', (_req, res) => {
    res.json({ enabled: !!process.env.CLAUDE_HUB, url: process.env.HUB_URL || null });
  });
}

module.exports = { mount, bundle };
