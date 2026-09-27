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
| `--pool-size <n>` | 3 | How many [config-dir](/claude-code-hub/guides/config-dirs/) sets stay running after a switch |
| `--disable-terminal` | | Turn off the [embedded terminal](/claude-code-hub/guides/terminal/) in Kanban |
| `--host <addr>` | `127.0.0.1` | Bind address. See [Security](/claude-code-hub/reference/security/#reach-the-hub-from-another-machine). |
| `--allowed-hosts <list>` | | Extra host names to accept, comma-separated |
| `--open` | | Open the browser on start |

A flag takes its value after a space or after `=`: `--port 4000` and `--port=4000` are the same.

### Ports

The hub listens on all five ports itself. The tool ports forward to the tools of the active config dir, which run on free ports that the hub picks. So the tool URLs stay the same when you switch the config dir.

If a port is busy, the hub uses a free port instead and logs `port <n> in use, trying random port...`. The banner shows the hub's real port.

## Environment variables

| Variable | Action |
| --- | --- |
| `PORT` | Hub port, if `--port` is not set |
| `HOST` | Bind address, if `--host` is not set |
| `ALLOWED_HOSTS` | Extra host names, if `--allowed-hosts` is not set |
| `CLAUDE_CONFIG_DIR` | The default config dir. Else `~/.claude`. |

## The config file

The hub keeps its settings in `~/.claude-hub/config.json`:

```json
{
  "configDirs": ["C:\\Users\\me\\.claude", "C:\\Users\\me\\.claude-work"],
  "activeConfigDir": "C:\\Users\\me\\.claude",
  "terminal": { "enabled": false }
}
```

- `configDirs` and `activeConfigDir` are the config-dir list and the active dir. The config-dir palette writes them. You do not need to edit them.
- `terminal` is for you to edit. `"enabled": false` turns off the embedded terminal. The hub gives the whole block to Kanban as its terminal config, so you can also set keys like `shell` and `fontFamily` here. See [Terminal config](https://nikiforovall.blog/claude-code-kanban/reference/configuration/#terminal-config) in the Kanban docs. The hub keeps this block when it writes the file.

Restart the hub after you edit the file.

## Files the hub writes

| File | Content |
| --- | --- |
| `~/.claude-hub/config.json` | The config-dir list, the active dir, and your `terminal` block |
| `~/.claude-hub/token` | The [hub token](/claude-code-hub/reference/security/#the-hub-token) |

The tools write their own files. See their docs:

- [Kanban](https://nikiforovall.blog/claude-code-kanban/reference/configuration/)
- [Marketplace](https://nikiforovall.blog/claude-code-marketplace/reference/configuration/)
- [Cost](https://nikiforovall.blog/claude-code-cost/reference/configuration/)
- [Memory Diagnoser](https://nikiforovall.blog/claude-code-memory/reference/configuration/)
