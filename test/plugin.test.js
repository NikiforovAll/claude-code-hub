const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { claudeEnv } = require('../lib/install');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(PLUGIN, p), 'utf8'));

describe('hub plugin', () => {
  it('lists the plugin in the marketplace under the name install uses', () => {
    const market = readJson('.claude-plugin/marketplace.json');
    assert.equal(market.name, 'claude-code-hub');
    assert.deepEqual(
      market.plugins.map((p) => [p.name, p.source]),
      [['claude-code-hub', './plugins/claude-code-hub']],
    );
    const plugin = readJson('plugins/claude-code-hub/.claude-plugin/plugin.json');
    assert.equal(plugin.name, 'claude-code-hub');
    assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  });

  it('points hub-builder only at files it ships', () => {
    const dir = path.join(PLUGIN, 'plugins/claude-code-hub/skills/hub-builder');
    const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: hub-builder\ndescription: .+\n---\n/);
    const links = [...skill.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]);
    assert.ok(links.length > 0);
    for (const link of links) assert.ok(fs.existsSync(path.join(dir, link)), link);
  });
});

describe('claudeEnv', () => {
  it('leaves CLAUDE_CONFIG_DIR alone for ~/.claude and sets it for any other dir', () => {
    assert.equal(claudeEnv(path.join(os.homedir(), '.claude')), process.env);
    assert.equal(claudeEnv(path.join(os.tmpdir(), 'cfg')).CLAUDE_CONFIG_DIR, path.join(os.tmpdir(), 'cfg'));
  });
});
