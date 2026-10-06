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

// What an app page loads as /vendor/claude-hub-sdk.js: keys.js, then client.js or stub.js.
function bundle(file) {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  return `${read('keys.js')}\n${read(file)}`;
}

// Mount before express.static: the hub's client must win over the app's stub in public/vendor.
function mount(app) {
  answerHub();
  const client = bundle('client.js');
  app.get('/vendor/claude-hub-sdk.js', (_req, res) => res.type('js').send(client));
  app.get('/hub-config', (_req, res) => {
    res.json({ enabled: !!process.env.CLAUDE_HUB, url: process.env.HUB_URL || null });
  });
}

module.exports = { mount, bundle };
