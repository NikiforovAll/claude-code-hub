# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Claude Code Hub — a unified launcher that combines multiple Claude Code tools (Marketplace + Kanban + Cost + Memory Diagnoser) into a single chromeless PWA via iframes and git submodules.

## Commands

```bash
npm start                # Start hub + all sub-apps (http://localhost:3540)
npm run dev              # Start with auto-open browser
```

CLI flags: `--port <n>`, `--marketplace-port <n>`, `--kanban-port <n>`, `--cost-port <n>`, `--memory-port <n>`, `--open`

## Architecture

**Hub server** (`server.js`) spawns four child processes — marketplace, kanban, cost, and memory — passing `CLAUDE_HUB=1` and `HUB_URL` env vars. It parses their stdout to detect actual ports (handles fallback when default ports are busy) and exposes `GET /api/config` returning the live app URLs.

**Hub client** (`public/app.js`) fetches config, creates one iframe per app, and switches visibility on tab change. No visible chrome — switching is keyboard-only via `Ctrl+Alt+Left/Right`.

**postMessage protocol** enables cross-app communication:
- `hub:navigate` — sub-app requests the hub to switch to another app (with optional deep link URL)
- `hub:keydown` — sub-app forwards keyboard shortcuts that don't bubble out of iframes
- `hub:theme` — light/dark + color theme, echoed both ways so a change in one app reaches all
- `hub:project` — hub → sub-apps, the current project scope (the hub owns the abs-path → encoded transform)
- `hub:active` — hub → sub-apps, whether that app is the one on screen. Sub-apps can't detect this themselves: inactive iframes are `display:none`, and a nested document's `visibilityState` follows the top-level tab regardless. Cost uses it to gate auto-refresh.

Origin validation on the hub side restricts messages to known sub-app origins; each sub-app shim checks `e.source === window.parent` and the hub's origin. `hub:project`/`hub:active` are re-posted 400 ms after an iframe load because the shims gate on `window.__HUB__`, which arrives from an async `/hub-config` fetch — every apply is idempotent.

## Git Submodules

- `marketplace/` → [claude-code-marketplace](https://github.com/NikiforovAll/claude-code-marketplace) (port 3542)
- `cck/` → [claude-task-viewer](https://github.com/NikiforovAll/claude-task-viewer) (port 3541)
- `cost/` → [claude-code-cost](https://github.com/NikiforovAll/claude-code-cost) (port 3543)
- `memory/` → [claude-code-memory](https://github.com/NikiforovAll/claude-code-memory) (port 3544)

After cloning: `git submodule update --init` then `npm install` in root, `marketplace/`, `cck/`, `cost/`, and `memory/`.

**IMPORTANT**: Submodules are often in detached HEAD state. Before making any changes in a submodule, always checkout its main branch first: `git -C <submodule> checkout main`. This avoids committing on a detached HEAD and losing work.

Each sub-app has its own linter (Biome) and pre-commit hooks. The hub root does too: `npm run lint` (Biome over `public/app.js` and `server.js`, plus the escaping and security-lib checks) and husky-managed pre-commit hooks.

## Sub-app Hub Integration

All sub-apps expose `GET /hub-config` (returns `{enabled, url}` from env vars) and append a `HUB_INTEGRATION` region to their `public/app.js` with:
- `initHub()` — fetches config, stores in `window.__HUB__`
- Keyboard forwarding (`Ctrl+Alt+Arrow` → `postMessage` to parent)
- `hubNavigate(app, url)` — callable API for cross-app deep links (no-op when standalone)

## Landing Page

`docs/index.html` — static GitHub Pages landing site. Screenshots in `docs/assets/`. Deployed automatically on push to master.
