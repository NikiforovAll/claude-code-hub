'use strict';

const { version: HUB_VERSION } = require('../package.json');

// Every flag the hub reads, and whether it takes a value. `--<app id>-port` is open-ended, because
// config.json can add apps.
const FLAGS = {
  port: true,
  'hub-dir': true,
  'pool-size': true,
  'disable-terminal': false,
  'no-mods': false,
  host: true,
  'allowed-hosts': true,
  open: false,
  'show-token': false,
  detached: false,
  install: false,
  uninstall: false,
  dir: true,
  tray: false,
  autostart: false,
  'no-autostart': false,
  'tray-status': false,
  'app-id': true,
  version: false,
  help: false,
};
const SHORT = { '-v': 'version', '-h': 'help' };
const APP_PORT_RE = /^[a-z0-9-]+-port$/;

const HELP = `Claude Code Hub ${HUB_VERSION}

Usage:
  claude-code-hub [options]       Start the hub, or print the URL of the one that runs
  claude-code-hub ext <command>   Manage extensions (claude-code-hub ext --help)

Options:
  --port <n>                      Hub port (default 3540)
  --<app>-port <n>                Port of an app: kanban, marketplace, cost, memory
  --hub-dir <path>                Hub dir (default ~/.claude-hub)
  --pool-size <n>                 Config dirs kept running (default 3)
  --disable-terminal              Turn off the embedded terminal in Kanban
  --no-mods                       Start without mods
  --host <addr>                   Bind address (default 127.0.0.1)
  --allowed-hosts <list>          Extra host names to accept, comma-separated
  --open                          Open the hub in the browser
  --show-token                    Print the hub URL with its token also when output is not a terminal
  --detached                      Keep running when stdin closes
  --install, --uninstall          Install or remove the hub plugin (--dir <config dir>)
  --tray, --autostart, --no-autostart, --tray-status, --app-id <id>
                                  Tray and start at login (Windows and macOS)
  -v, --version                   Print the version
  -h, --help                      Print this help`;

// {exit, out} when the command line is answered here: the version, the help, or a usage error.
// {} when the hub should go on. `ext` keeps its own parser.
function checkArgs(args) {
  if (args[0] === 'ext') return {};
  const bad = (what) => ({ exit: 1, out: `${what}\n\n${HELP}` });
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) return bad(i === 0 ? `Unknown command: ${arg}` : `Unexpected argument: ${arg}`);
    const [flag, value] = arg.startsWith('--') ? [arg.slice(2).split('=')[0], arg.includes('=')] : [SHORT[arg], false];
    const takes = FLAGS[flag] ?? (APP_PORT_RE.test(flag ?? '') || undefined);
    if (takes === undefined) return bad(`Unknown option: ${arg}`);
    if (flag === 'version') return { exit: 0, out: HUB_VERSION };
    if (flag === 'help') return { exit: 0, out: HELP };
    if (takes && !value) i++;
  }
  return {};
}

// The hub URL as printed. Off a terminal (an agent's shell, a pipe, the tray's hub.log) the output is
// kept or read by others, so the token is hidden unless --show-token asks for it.
function printedUrl(line, url, { show, tokenFile }) {
  if (show) return `${line} ${url}`;
  const hidden = url.replace(/([?&]token=)[^&]*/, '$1<hidden>');
  return `${line} ${hidden}\n  The token is hidden. Open the hub with --open, print it with --show-token, or read ${tokenFile}`;
}

module.exports = { HUB_VERSION, FLAGS, HELP, checkArgs, printedUrl };
