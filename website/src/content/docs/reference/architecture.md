---
title: How the hub works
description: The hub's processes, ports, and the messages it sends between the tools. Read this if you build a tool for the hub or debug one.
---

## Processes

The hub is one Node.js server. For each config dir it uses, it starts a set of four child processes: Kanban, Marketplace, Cost, and Memory Diagnoser. Each child gets these environment variables:

| Variable | Value |
| --- | --- |
| `CLAUDE_HUB` | `1`. Turns on hub integration in the tool. |
| `HUB_URL` | The hub address, for example `http://localhost:3540` |
| `CLAUDE_CONFIG_DIR` | The config dir of this set |
| `PORT` | `0`, so the child picks a free port |
| `HOST`, `ALLOWED_HOSTS` | The hub's own network settings |

The hub reads each child's startup line to learn its port. If a child exits, the hub starts it again, up to 5 times in 60 seconds.

## Ports

The hub listens on five ports: its own, 3540 by default, and one for each tool, 3541 to 3544. A tool port forwards HTTP and WebSocket traffic to that tool in the active set. So the tool URLs in the page stay the same when you switch the config dir, and only the target of the forward changes.

`GET /api/config` returns the tool URLs, the theme palettes, and the active config dir.

## The page

The hub page makes one iframe for each tool and shows one at a time. The other iframes stay loaded but hidden, so a tool keeps its state when you switch away.

## Messages

The page and the tools talk with `postMessage`. The hub accepts a message only from the four tool origins. Each tool accepts a message only from its parent window and the hub origin.

| Message | Direction | Content |
| --- | --- | --- |
| `hub:navigate` | Tool to hub | Switch to another tool, with an optional deep link |
| `hub:keys` | Hub to tool | The key combos the hub binds, for example `ctrl+alt+p` and `alt+1` |
| `hub:keydown` | Tool to hub | A hub key pressed inside the tool |
| `hub:theme` | Both | Light/dark mode and color theme |
| `hub:project` | Hub to tool | The project picked in the palette |
| `hub:active` | Hub to tool | Whether the tool is on screen. A hidden iframe cannot tell by itself. Cost uses it to pause auto-refresh. |
| `hub:closeGuard` | Tool to hub | Ask before the window closes. Kanban sets it while a terminal is attached. |
| `hub:terminalToken` | Both | Kanban asks for the current terminal token after a hub restart, and the hub answers |
| `hub:openExternal` | Tool to hub | Open an external link from the top window |

## Build a tool for the hub

A tool that runs in the hub:

1. Serves `GET /hub-config`, which returns `{enabled, url}` from `CLAUDE_HUB` and `HUB_URL`.
2. Sends the keys listed in `hub:keys` to the hub as `hub:keydown`, with `key`, `code`, and the modifiers, and keeps all other keys. A combo is the pressed modifiers in the order `ctrl`, `alt`, `shift`, `meta`, then the key, joined by `+`. The key is a lowercase letter or digit. Use `e.code` when `e.key` is not one, because macOS turns <kbd>Option</kbd>+<kbd>P</kbd> into `π`. Other keys, such as `ArrowLeft`, keep their `e.key` name. Until `hub:keys` arrives, send <kbd>Ctrl+Alt+Arrow</kbd>, every <kbd>Ctrl+Alt+Letter</kbd>, and <kbd>Alt+Digit</kbd>, because an older hub does not send the list.
3. Applies `hub:theme` and `hub:project`, and sends `hub:theme` when the user changes the theme in the tool.
4. Allows framing from the hub origin.

The four tools are on GitHub, and each has a `HUB_INTEGRATION` block in its `public/app.js`.
