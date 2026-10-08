// Presses the key matrix in Chrome against a scratch hub with fixture apps, focus inside an app frame.
// CDP key events are trusted and carry any key/code/modifiers, so macOS and AltGr shapes run on any OS.
// They cannot set AltGraph or go through the OS layout; those cases stay on the manual checklist.
// Run by hand: npm run test:e2e (needs Chrome installed).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { MATRIX, ROW_SETS } = require('../helpers/hub-keys.js');
const { killChild } = require('../../lib/kill-child.js');
const { APPS } = require('../../lib/apps.js');

const ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURE = path.join(import.meta.dirname, 'fixture-app', 'server.js');
const IDS = Array.from({ length: MATRIX.apps }, (_, i) => `e2e${i + 1}`);
const CDP_MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

// os.tmpdir() can be an 8.3 short path on Windows, which breaks path matching in the hub.
function scratchHubDir(appPorts) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'hub-keys-e2e-'));
  for (const id of IDS) {
    const appDir = path.join(dir, id);
    fs.mkdirSync(appDir);
    fs.writeFileSync(path.join(appDir, 'hub-app.json'), JSON.stringify({ manifest: 1, id, name: id, run: { entry: 'server.js' } }));
    fs.writeFileSync(path.join(appDir, 'server.js'), `require(${JSON.stringify(FIXTURE)});\n`);
  }
  // e2e1 ships a plugin at 1.0.0 and the config dir has 0.9.0, so its row shows the ⚠.
  const e2e1 = path.join(dir, 'e2e1');
  fs.writeFileSync(path.join(e2e1, 'package.json'), JSON.stringify({ version: '2.0.0' }));
  const plugin = { id: 'e2e@e2e', path: 'plugin', install: 'e2e --install' };
  fs.writeFileSync(
    path.join(e2e1, 'hub-app.json'),
    JSON.stringify({ manifest: 1, id: 'e2e1', name: 'e2e1', run: { entry: 'server.js' }, plugin }),
  );
  fs.mkdirSync(path.join(e2e1, 'plugin', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(e2e1, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '1.0.0' }));
  fs.mkdirSync(path.join(dir, 'claude', 'plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'e2e@e2e': [{ scope: 'user', version: '0.9.0' }] } }),
  );
  const apps = [
    ...IDS.map((id, i) => ({ id, path: id, port: appPorts[i] })),
    ...APPS.map(({ id }) => ({ id, enabled: false })),
  ];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apps }, null, 2));
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dir, 'token'), `${token}\n`);
  return { dir, token };
}

async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

let hub;
let hubDir;
let browser;
let page;
let cdp;
let appPorts;
let hubUrl;
let log = '';

before(async () => {
  const hubPort = await freePort();
  appPorts = await Promise.all(IDS.map(freePort));
  const scratch = scratchHubDir(appPorts);
  hubDir = scratch.dir;
  // A piped stdin, with no --detached, stops the hub and its apps when this process dies, so Ctrl+C leaves nothing behind.
  hub = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--hub-dir', hubDir, '--port', String(hubPort)], {
    cwd: ROOT,
    env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(hubDir, 'claude'), CLAUDE_HUB_NO_UPDATE_CHECK: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  hub.stdout.on('data', (d) => (log += d));
  hub.stderr.on('data', (d) => (log += d));
  const base = `http://localhost:${hubPort}`;
  await waitFor(async () => {
    const r = await fetch(`${base}/api/config?token=${scratch.token}`);
    return r.ok && IDS.every((id) => log.includes(`[${id}] running at`));
  }, `the hub and its apps (log:\n${log})`);

  hubUrl = `${base}/?token=${scratch.token}`;
  browser = await chromium.launch({ channel: 'chrome' });
});

const PLATFORMS = { win: { platform: 'Win32', uaPlatform: 'Windows' }, mac: { platform: 'MacIntel', uaPlatform: 'macOS' } };

// The hub picks its keys from navigator.platform, so each platform gets its own page. keys stands
// in for config.json `keys` as /api/config carries it; lib/keymap.js has its own tests.
async function openHub(name, keys) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  if (keys) {
    await context.route('**/api/config', async (route) => {
      const response = await route.fetch();
      route.fulfill({ response, json: { ...(await response.json()), keys } });
    });
  }
  await context.addInitScript(({ platform, uaPlatform }) => {
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform });
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => ({ platform: uaPlatform }) });
  }, PLATFORMS[name]);
  page = await context.newPage();
  await page.goto(hubUrl);
  for (const id of IDS) await waitFor(() => frameOf(id)?.evaluate(() => window.hub.status === 'live'), `${id} to connect`);
  cdp = await context.newCDPSession(page);
  return context;
}

after(async () => {
  await browser?.close();
  if (hub) await killChild(hub);
  if (hubDir) fs.rmSync(hubDir, { recursive: true, force: true });
});

const frameOf = (id) => page.frame({ url: (u) => u.port === String(appPorts[IDS.indexOf(id)]) });

async function hubState() {
  return page.evaluate(() => ({ active: activeApp, palette: palette.open ? palette.mode : null }));
}

async function press(row) {
  const modifiers = row.mods.reduce((m, k) => m | CDP_MODS[k], 0);
  const text = [...row.key].length === 1 ? row.key : undefined;
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: row.key, code: row.code, modifiers, text });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: row.key, code: row.code, modifiers });
  await page.waitForTimeout(50);
}

async function focusApp(id) {
  await page.evaluate((app) => {
    if (palette.open) closePalette();
    switchTab(app);
  }, id);
  const frame = frameOf(id);
  await frame.evaluate(() => {
    const t = document.getElementById('text');
    t.value = '';
    window.lastKey = null;
    t.focus();
  });
  return frame;
}

const PALETTES = { 'hub.projectPicker': 'project', 'hub.configDirPicker': 'configDir', 'hub.appLauncher': 'app' };
const MOVES = { 'hub.prevApp': 'e2e1', 'hub.nextApp': 'e2e3' };

const SUITES = ROW_SETS.flatMap((set) =>
  Object.keys(PLATFORMS).map((platform) => ({ ...set, platform, remapped: set.rows !== MATRIX.rows })),
);

for (const { platform, rows, keys, remapped } of SUITES) describe(`key matrix${remapped ? ', remapped,' : ''} in Chrome on ${platform}, focus in an app`, () => {
  let context;
  before(async () => {
    context = await openHub(platform, remapped ? keys : null);
  });
  after(() => context?.close());

  for (const row of rows.filter((r) => r.platform === platform)) {
    it(row.name, { todo: row.todo }, async () => {
      const start = row.expect === 'hub.appByNumber:2' ? 'e2e1' : 'e2e2';
      const frame = await focusApp(start);
      await frame.evaluate(() => {
        window.addEventListener('keydown', (e) => (window.lastKey = { key: e.key, prevented: e.defaultPrevented }), { once: true });
      });
      // CDP has no AltGraph modifier, so the app frame reports it for this press.
      await frame.evaluate((on) => {
        const proto = KeyboardEvent.prototype;
        window.realGetModifierState ??= proto.getModifierState;
        proto.getModifierState = on
          ? function (m) {
              return m === 'AltGraph' || window.realGetModifierState.call(this, m);
            }
          : window.realGetModifierState;
      }, row.altGraph === true);
      await press(row);
      const kept = row.expect === 'text';
      assert.deepEqual(await frame.evaluate(() => window.lastKey), { key: row.key, prevented: !kept }, 'the press lands in the app');
      const state = await hubState();
      if (PALETTES[row.expect]) {
        assert.equal(state.palette, PALETTES[row.expect]);
        await press({ key: 'Escape', code: 'Escape', mods: [] });
        assert.equal((await hubState()).palette, null, 'Escape closes the palette');
      } else if (MOVES[row.expect]) {
        assert.equal(state.active, MOVES[row.expect]);
      } else if (row.expect.startsWith('hub.appByNumber:')) {
        assert.equal(state.active, `e2e${row.expect.split(':')[1]}`);
      } else {
        assert.deepEqual(state, { active: start, palette: null }, 'the hub does nothing');
      }
    });
  }
});

describe('app launcher', () => {
  const { version } = require('../../package.json');
  let context;
  before(async () => {
    context = await openHub('win');
    await page.evaluate(() => openPalette('app'));
    await waitFor(() => page.locator('#palette-list .ver').count(), 'the app versions');
  });
  after(() => context?.close());

  it('shows the hub version and its plugin in its footer', async () => {
    const hint = await page.locator('#palette-hint').textContent();
    assert.ok(hint.startsWith(`Claude Code Hub ${version} · ⚠ plugin not installed · `), hint);
  });

  it("shows an app's version and a ⚠ for a plugin that is not the shipped version", async () => {
    const row = page.locator('#palette-list .palette-row', { hasText: 'e2e1' });
    assert.equal(await row.locator('.ver').textContent(), '2.0.0');
    const badge = row.locator('.plugin-warn');
    assert.equal(await badge.textContent(), '⚠ plugin 0.9.0');
    assert.match(await badge.getAttribute('title'), /e2e@e2e 0\.9\.0 is installed, this version ships 1\.0\.0\.\nClick to copy: e2e --install --dir /);
    assert.equal(await page.locator('#palette-list .palette-row', { hasText: 'e2e2' }).locator('.ver, .plugin-warn').count(), 0);
  });

  it('copies the install command on a click and keeps the palette open', async () => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('#palette-list .palette-row', { hasText: 'e2e1' }).locator('.plugin-warn').click();
    await waitFor(async () => (await page.locator('#palette-hint').textContent()).startsWith('Copied e2e --install --dir '), 'the copy');
    assert.equal((await hubState()).palette, 'app');
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^e2e --install --dir "/);
  });
});
