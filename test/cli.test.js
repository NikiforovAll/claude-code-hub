const { it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { HUB_ROOT } = require('../lib/apps');
const { FLAGS, HELP, checkArgs, printedUrl } = require('../lib/cli');
const { version } = require('../package.json');

it('answers the version and the help, wherever the flag is', () => {
  for (const args of [['--version'], ['-v'], ['--hub-dir', 'x', '--version']]) assert.deepEqual(checkArgs(args), { exit: 0, out: version });
  for (const args of [['--help'], ['-h'], ['--port=4000', '-h']]) assert.deepEqual(checkArgs(args), { exit: 0, out: HELP });
});

it('lets the hub start on known flags, values and app ports', () => {
  for (const args of [[], ['--hub-dir', '-v'], ['--port', '4000', '--kanban-port=4001', '--detached'], ['--memory-port', '9', '--open'], ['ext', 'nope', '--x']]) {
    assert.deepEqual(checkArgs(args), {}, args.join(' '));
  }
});

it('rejects an unknown command, option or argument with the help', () => {
  const cases = [
    [['foo'], 'Unknown command: foo'],
    [['--verison'], 'Unknown option: --verison'],
    [['-x'], 'Unknown option: -x'],
    [['--open', 'foo'], 'Unexpected argument: foo'],
  ];
  for (const [args, line] of cases) {
    const r = checkArgs(args);
    assert.equal(r.exit, 1);
    assert.ok(r.out.startsWith(`${line}\n\n${HELP}`), args.join(' '));
  }
});

it('the help, the configuration page and FLAGS list the same flags', () => {
  const flags = (text) => new Set([...text.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]).filter((f) => f === 'port' || !f.endsWith('-port')));
  const known = new Set(Object.keys(FLAGS));
  const page = fs.readFileSync(path.join(HUB_ROOT, 'website', 'src', 'content', 'docs', 'reference', 'configuration.md'), 'utf8');
  const table = page.slice(page.indexOf('| Flag |'), page.indexOf('\n\n', page.indexOf('| Flag |')));
  assert.deepEqual(flags(HELP), known);
  for (const f of flags(table)) assert.ok(known.has(f), `--${f} in configuration.md`);
});

it('hides the token off a terminal unless asked', () => {
  const url = 'http://localhost:3540/?token=abc123';
  assert.equal(printedUrl('Hub at', url, { show: true, tokenFile: 'T' }), `Hub at ${url}`);
  const hidden = printedUrl('Hub at', url, { show: false, tokenFile: 'T' });
  assert.ok(hidden.startsWith('Hub at http://localhost:3540/?token=<hidden>\n'));
  assert.match(hidden, /--show-token.*read T$/);
  assert.doesNotMatch(hidden, /abc123/);
});

it('server.js exits on -v before it loads the hub', () => {
  const r = spawnSync(process.execPath, [path.join(HUB_ROOT, 'server.js'), '-v'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), version);
});
