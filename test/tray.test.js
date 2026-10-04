'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { runTrayCommand, runValue, appConfig } = require('../lib/tray');

test('tray flags fail outside Windows', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (msg) => errors.push(msg));
  for (const flag of ['--tray', '--autostart', '--no-autostart', '--tray-status']) {
    assert.strictEqual(await runTrayCommand({ flag, hubDir: 'unused', port: 3540, platform: 'linux' }), false);
  }
  assert.strictEqual(errors.length, 4);
  assert.match(errors[0], /only on Windows/);
});

test('the tray looks up the app by name on the default port, or by --app-id on the hub port', () => {
  assert.deepStrictEqual(appConfig({ port: 4000, defaultPort: 3540 }), { name: 'Claude Code Hub', port: 3540 });
  assert.deepStrictEqual(appConfig({ appId: 'abc', port: 4000, defaultPort: 3540 }), { id: 'abc', port: 4000 });
});

test('each hub dir gets its own Run value', () => {
  assert.match(runValue('/home/a/.claude-hub'), /^ClaudeCodeHub-[0-9a-f]{8}$/);
  assert.notStrictEqual(runValue('/home/a/.claude-hub'), runValue('/home/a/test-hub'));
});
