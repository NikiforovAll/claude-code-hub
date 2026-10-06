'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTrayCommand, runValue, launchAgentLabel, launchAgentPlist, appConfig } = require('../lib/tray');

test('tray flags fail outside Windows and macOS', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (msg) => errors.push(msg));
  for (const flag of ['--tray', '--autostart', '--no-autostart', '--tray-status']) {
    assert.strictEqual(await runTrayCommand({ flag, hubDir: 'unused', port: 3540, platform: 'linux' }), false);
  }
  assert.strictEqual(errors.length, 4);
  assert.match(errors[0], /only on Windows and macOS/);
});

test('the tray looks up the app by name on the default port, or by --app-id on the hub port', () => {
  assert.deepStrictEqual(appConfig({ port: 4000, defaultPort: 3540 }), { name: 'Claude Code Hub', port: 3540 });
  assert.deepStrictEqual(appConfig({ appId: 'abc', port: 4000, defaultPort: 3540 }), { id: 'abc', port: 4000 });
});

test('each hub dir gets its own Run value and launch agent', () => {
  assert.match(runValue('/home/a/.claude-hub'), /^ClaudeCodeHub-[0-9a-f]{8}$/);
  assert.notStrictEqual(runValue('/home/a/.claude-hub'), runValue('/home/a/test-hub'));
  assert.match(launchAgentLabel('/home/a/.claude-hub'), /^com\.claude-code-hub\.tray\.[0-9a-f]{8}$/);
  assert.notStrictEqual(launchAgentLabel('/home/a/.claude-hub'), launchAgentLabel('/home/a/test-hub'));
});

test('the launch agent runs the tray script with osascript and escapes the path', () => {
  const plist = launchAgentPlist({ label: 'com.claude-code-hub.tray.x', script: '/Users/a & b/<hub>/tray/mac/hub-tray.js' });
  assert.match(plist, /<string>\/usr\/bin\/osascript<\/string>\s*<string>-l<\/string>\s*<string>JavaScript<\/string>/);
  assert.match(plist, /<string>\/Users\/a &amp; b\/&lt;hub&gt;\/tray\/mac\/hub-tray\.js<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>AbandonProcessGroup<\/key>\s*<true\/>/);
});

test('--no-autostart on macOS removes only this hub dir\'s launch agent', async (t) => {
  t.mock.method(console, 'log', () => {});
  const agents = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-agents-'));
  t.after(() => fs.rmSync(agents, { recursive: true, force: true }));
  const mine = path.join(agents, `${launchAgentLabel('/hub/a')}.plist`);
  const other = path.join(agents, `${launchAgentLabel('/hub/b')}.plist`);
  fs.writeFileSync(mine, '');
  fs.writeFileSync(other, '');
  const opts = { flag: '--no-autostart', hubDir: '/hub/a', platform: 'darwin', launchAgentsDir: agents };
  assert.strictEqual(await runTrayCommand(opts), true);
  assert.strictEqual(fs.existsSync(mine), false);
  assert.strictEqual(fs.existsSync(other), true);
  assert.strictEqual(await runTrayCommand(opts), true);
});

test('the macOS tray script parses', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tray', 'mac', 'hub-tray.js'), 'utf8');
  assert.doesNotThrow(() => new Function(src));
});
