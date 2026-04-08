# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Claude Code Hub — a unified launcher that combines multiple Claude Code tools (Marketplace + Kanban + Cost + Memory) into a single chromeless PWA via iframes and git submodules.

## Commands

```bash
npm start                # Start hub + all sub-apps (http://localhost:3455)
npm run dev              # Start with auto-open browser
```

CLI flags: `--port <n>`, `--marketplace-port <n>`, `--kanban-port <n>`, `--cost-port <n>`, `--memory-port <n>`, `--open`

## Architecture

**Hub server** (`server.js`) spawns four child processes — marketplace, kanban, cost, and memory — passing `CLAUDE_HUB=1` and `HUB_URL` env vars. It parses their stdout to detect actual ports (handles fallback when default ports are busy) and exposes `GET /api/config` returning the live app URLs.

**Hub client** (`public/app.js`) fetches config, creates one iframe per app, and switches visibility on tab change. No visible chrome — switching is keyboard-only via `Ctrl+Alt+Left/Right`.

**postMessage protocol** enables cross-app communication:
- `hub:navigate` — sub-app requests the hub to switch to another app (with optional deep link URL)
- `hub:keydown` — sub-app forwards keyboard shortcuts that don't bubble out of iframes

Origin validation on the hub side restricts messages to known sub-app origins.

## Git Submodules

- `marketplace/` → [claude-code-marketplace](https://github.com/NikiforovAll/claude-code-marketplace) (port 3457)
- `cck/` → [claude-task-viewer](https://github.com/NikiforovAll/claude-task-viewer) (port 3456)
- `cost/` → [claude-code-cost](https://github.com/NikiforovAll/claude-code-cost) (port 3458)
- `memory/` → [claude-code-memory](https://github.com/NikiforovAll/claude-code-memory) (port 3459)

After cloning: `git submodule update --init` then `npm install` in root, `marketplace/`, `cck/`, `cost/`, and `memory/`.

Each sub-app has its own linter (Biome) and pre-commit hooks. The hub repo itself has no linter.

## Sub-app Hub Integration

All sub-apps expose `GET /hub-config` (returns `{enabled, url}` from env vars) and append a `HUB_INTEGRATION` region to their `public/app.js` with:
- `initHub()` — fetches config, stores in `window.__HUB__`
- Keyboard forwarding (`Ctrl+Alt+Arrow` → `postMessage` to parent)
- `hubNavigate(app, url)` — callable API for cross-app deep links (no-op when standalone)

## Landing Page

`docs/index.html` — static GitHub Pages landing site. Screenshots in `docs/assets/`. Deployed automatically on push to master.
