# Claude Code Hub

[![npm version](https://img.shields.io/npm/v/claude-code-hub)](https://www.npmjs.com/package/claude-code-hub)
[![license](https://img.shields.io/npm/l/claude-code-hub)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dm/claude-code-hub)](https://www.npmjs.com/package/claude-code-hub)

Unified launcher for Claude Code tools — browse plugins in **Marketplace**, track tasks in **Kanban**, and monitor costs in **Cost**, all from a single chromeless PWA.

## Kanban:

![Kanban Screenshot](./cck/assets/screenshot-light-v2.png)

## Marketplace:
![Marketplace Screenshot](./marketplace/assets/main-light.png)

## Cost:
![Cost Screenshot](./cost/assets/sesssion-light.png)

## Quick Start

```bash
npx claude-code-hub --open
```

### From Source

```bash
git clone --recurse-submodules https://github.com/NikiforovAll/claude-code-hub.git
cd claude-code-hub
npm install && npm install --prefix marketplace && npm install --prefix cck
npm start        # http://localhost:3455
```

## Keyboard Shortcuts

| Shortcut         | Action                  |
| ---------------- | ----------------------- |
| `Alt+1`          | Switch to Kanban        |
| `Alt+2`          | Switch to Marketplace   |
| `Alt+3`          | Switch to Cost          |
| `Ctrl+Alt+Right` | Switch to next tool     |
| `Ctrl+Alt+Left`  | Switch to previous tool |

## How It Works

The hub server spawns both sub-apps as child processes, each on its own port. A minimal shell page embeds them in iframes and switches visibility on tab change — zero UI chrome, just keyboard shortcuts.
```

The Kanban sidebar shows a marketplace button on session cards — click it to jump to the Marketplace pre-filtered to that project.

## Included Tools

| Tool                                                                   | Submodule      | Default Port |
| ---------------------------------------------------------------------- | -------------- | ------------ |
| [Marketplace](https://github.com/NikiforovAll/claude-code-marketplace) | `marketplace/` | 3457         |
| [Kanban](https://github.com/NikiforovAll/claude-task-viewer)           | `cck/`         | 3456         |
| [Cost](https://github.com/NikiforovAll/claude-code-cost)               | `cost/`        | 3458         |

## CLI Flags

```
--port <n>              Hub port (default: 3455)
--marketplace-port <n>  Marketplace port (default: 3457)
--kanban-port <n>       Kanban port (default: 3456)
--cost-port <n>         Cost port (default: 3458)
--open                  Auto-open browser
```

## License

MIT
