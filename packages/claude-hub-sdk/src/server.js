'use strict';

const path = require('node:path');

// The hub hands this file to each app it spawns (HUB_SDK_SERVER), so it runs the hub's version, not
// one the app shipped. An app run alone never loads it.

// The hub spawns each app with an IPC channel. A loopback connect can fail while the app is fine,
// so before the hub replaces an app it asks over the channel, which does not go through TCP.
function answerHub() {
  if (!process.channel) return;
  process.on('message', (m) => {
    if (m?.type === 'hub:ping') process.send({ type: 'hub:pong', id: m.id });
  });
  process.on('disconnect', () => process.exit(0));
  // Listeners ref the channel. The app's own server keeps it alive, not the hub.
  process.channel.unref();
}

// Mount before express.static: the hub's client must win over the app's stub in public/vendor.
function mount(app) {
  answerHub();
  const client = path.join(__dirname, 'client.js');
  app.get('/vendor/claude-hub-sdk.js', (_req, res) => res.sendFile(client));
  app.get('/hub-config', (_req, res) => {
    res.json({ enabled: !!process.env.CLAUDE_HUB, url: process.env.HUB_URL || null });
  });
}

module.exports = { mount };
