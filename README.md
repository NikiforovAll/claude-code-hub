# Claude Code Hub

Unified launcher for Claude Code tools — browse plugins in **Marketplace** and track tasks in **Kanban**, all from a single chromeless PWA.

## Quick Start

```bash
git clone --recurse-submodules https://github.com/NikiforovAll/claude-code-hub.git
cd claude-code-hub
npm install && npm install --prefix marketplace && npm install --prefix cck
npm start        # http://localhost:3455
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+Right` | Switch to next tool |
| `Ctrl+Alt+Left` | Switch to previous tool |

## How It Works

The hub server spawns both sub-apps as child processes, each on its own port. A minimal shell page embeds them in iframes and switches visibility on tab change — zero UI chrome, just the keyboard shortcut.

Sub-apps communicate with the hub via `postMessage`:

```js
// From inside a sub-app, trigger cross-app navigation:
hubNavigate('kanban', '?session=abc');
```

## Included Tools

| Tool | Submodule | Default Port |
|---|---|---|
| [Marketplace](https://github.com/NikiforovAll/claude-code-marketplace) | `marketplace/` | 3457 |
| [Kanban](https://github.com/NikiforovAll/claude-task-viewer) | `cck/` | 3456 |

## CLI Flags

```
--port <n>              Hub port (default: 3455)
--marketplace-port <n>  Marketplace port (default: 3457)
--kanban-port <n>       Kanban port (default: 3456)
--open                  Auto-open browser
```

## License

MIT
