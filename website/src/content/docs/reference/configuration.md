---
title: CLI and configuration
description: The hub's command-line flags, environment variables, config file, and the files it writes.
---

## Flags

```bash
npx claude-code-hub [flags]
```

| Flag | Default | Action |
| --- | --- | --- |
| `--port <n>` | 3540 | Hub port |
| `--kanban-port <n>` | 3541 | Kanban port |
| `--marketplace-port <n>` | 3542 | Marketplace port |
| `--cost-port <n>` | 3543 | Cost port |
| `--memory-port <n>` | 3544 | Memory Diagnoser port |
| `--hub-dir <path>` | `~/.claude-hub` | The folder for the hub's config file and token. See [Run a second hub](#run-a-second-hub) |
| `--pool-size <n>` | 3 | How many [config-dir](/claude-code-hub/guides/config-dirs/) sets stay running after a switch |
| `--disable-terminal` | | Turn off the [embedded terminal](/claude-code-hub/guides/terminal/) in Kanban |
| `--host <addr>` | `127.0.0.1` | Bind address. See [Security](/claude-code-hub/reference/security/#reach-the-hub-from-another-machine). |
| `--allowed-hosts <list>` | | Extra host names to accept, comma-separated |
| `--open` | | Open the browser on start |

A flag takes its value after a space or after `=`: `--port 4000` and `--port=4000` are the same.

### Install the hub plugin

The hub ships a Claude Code plugin with the `hub-builder` skill. The skill helps an agent build on the hub: it links each task to the page of these docs that covers it, and explains custom themes.

```bash
npx claude-code-hub --install [--dir <config dir>]
npx claude-code-hub --uninstall [--dir <config dir>]
```

| Flag | Default | Action |
| --- | --- | --- |
| `--install` | | Install or update the plugin in one config dir, then exit |
| `--uninstall` | | Remove the plugin from one config dir, then exit |
| `--dir <path>` | `CLAUDE_CONFIG_DIR`, else `~/.claude` | The config dir to install into or remove from |

The install copies the plugin to `plugin/` in the hub folder and registers that copy in the config dir. Run it once for each config dir, and again after you update the hub. Start a new Claude Code session to load the skill. The uninstall keeps the copy, because other config dirs can use it.

### Ports

The hub listens on its own port and on the port of each enabled tool. The tool ports forward to the tools of the active config dir, which run on free ports that the hub picks. So the tool URLs stay the same when you switch the config dir.

Each tool's port comes from the first of these that is set:

1. The `--<id>-port` flag, for example `--cost-port 4543`.
2. The `port` of the tool's entry in the `apps` list of the [config file](#the-config-file).
3. The tool's default port.

If that port is busy, the hub uses a random free port for this run and logs `port <n> in use, trying random port...`. The port is the tool's origin in the browser, so on a random port the tool starts with no saved browser state: pins, filters and the theme. To keep that state, set a port that is free. The banner shows the hub's real port.

### Run a second hub

Every hub reads its config file and token from the same folder, `~/.claude-hub`. To run a second hub with its own config dirs, tools and ports, give it its own folder with `--hub-dir` or `CLAUDE_HUB_DIR`:

```bash
npx claude-code-hub --hub-dir ~/.claude-hub-work --port 4540
```

The hub creates the folder, the config file and a new token on the first run. Set a `port` for each tool in that config file, or the second hub's tools fall back to random ports while the first hub holds the defaults.

## Environment variables

| Variable | Action |
| --- | --- |
| `PORT` | Hub port, if `--port` is not set |
| `HOST` | Bind address, if `--host` is not set |
| `ALLOWED_HOSTS` | Extra host names, if `--allowed-hosts` is not set |
| `CLAUDE_CONFIG_DIR` | The default config dir. Else `~/.claude`. |
| `CLAUDE_HUB_DIR` | The hub folder, if `--hub-dir` is not set. Else `~/.claude-hub`. |

## The config file

The hub keeps its settings in `config.json` in the hub folder, `~/.claude-hub` by default:

```json
{
  "configDirs": ["C:\\Users\\me\\.claude", "C:\\Users\\me\\.claude-work"],
  "activeConfigDir": "C:\\Users\\me\\.claude",
  "terminal": { "enabled": false },
  "apps": [
    { "id": "kanban" },
    { "id": "cost", "port": 4543 },
    { "id": "marketplace", "enabled": false }
  ]
}
```

- `configDirs` and `activeConfigDir` are the config-dir list and the active dir. The config-dir palette writes them. You do not need to edit them.
- `terminal` is for you to edit. `"enabled": false` turns off the embedded terminal. The hub gives the whole block to Kanban as its terminal config, so you can also set keys like `shell`, `fontFamily` and `maxSessions` (most terminals open at the same time, 30 by default) here. See [Terminal config](https://nikiforovall.blog/claude-code-kanban/reference/configuration/#terminal-config) in the Kanban docs. The hub keeps this block when it writes the file.
- `apps` is for you to edit. It sets which tools run and the tab order. The ids are `kanban`, `marketplace`, `cost` and `memory`. The tools you list come first, in list order, and the tools you do not list follow in the default order. A tool with `"enabled": false` does not start, gets no tab and no port, and links from other tools to it do nothing. With Kanban off, the embedded terminal is off and the project palette has no project list. <kbd>Alt</kbd>+<kbd>1</kbd> to <kbd>Alt</kbd>+<kbd>4</kbd> follow the tab order. `port` sets the tool's port, a whole number from 1 to 65535 (see [Ports](#ports)). The hub logs and ignores a value that is not valid, such as `"4543"` in quotes. The hub keeps this list when it writes the file, and does not start when every tool is off.

Restart the hub after you edit the file.

## Files the hub writes

The paths are for the default hub folder. With `--hub-dir` or `CLAUDE_HUB_DIR`, the files are in that folder.

| File | Content |
| --- | --- |
| `~/.claude-hub/config.json` | The config-dir list, the active dir, and your `terminal` block and `apps` list |
| `~/.claude-hub/token` | The [hub token](/claude-code-hub/reference/security/#the-hub-token) |
| `~/.claude-hub/plugin/` | The copy of the [hub plugin](#install-the-hub-plugin) that `--install` writes |

The tools write their own files. See their docs:

- [Kanban](https://nikiforovall.blog/claude-code-kanban/reference/configuration/)
- [Marketplace](https://nikiforovall.blog/claude-code-marketplace/reference/configuration/)
- [Cost](https://nikiforovall.blog/claude-code-cost/reference/configuration/)
- [Memory Diagnoser](https://nikiforovall.blog/claude-code-memory/reference/configuration/)
