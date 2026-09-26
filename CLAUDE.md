# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Claude Code Hub — a unified launcher that combines multiple Claude Code tools (Marketplace + Kanban + Cost + Memory Diagnoser) into a single chromeless PWA via iframes and git submodules.

## Commands

```bash
npm start                # Start hub + all sub-apps (http://localhost:3540)
npm run dev              # Start with auto-open browser
```

The hub is usually already running on :3540. Check it with `curl -s -o /dev/null -w '%{http_code}' http://localhost:3540/api/config` (401 without the token still means it is up; add `?token=$(cat ~/.claude-hub/token)` to read it). Use it only for read-only checks. To test a fix, start a second hub on other ports (`--port`, `--marketplace-port`, `--kanban-port`, `--cost-port`, `--memory-port`) so the running one is not disturbed.

CLI flags: `--port <n>`, `--marketplace-port <n>`, `--kanban-port <n>`, `--cost-port <n>`, `--memory-port <n>`, `--pool-size <n>`, `--open`

## Architecture

**Hub server** (`server.js`) spawns four child processes — marketplace, kanban, cost, and memory — passing `CLAUDE_HUB=1`, `HUB_URL`, and `CLAUDE_CONFIG_DIR` env vars. It parses their stdout to detect actual ports (handles fallback when default ports are busy) and exposes `GET /api/config` returning the live app URLs.

**Config dirs.** The hub keeps a list of Claude config dirs and the active one in `~/.claude-hub/config.json` (`GET/POST/DELETE /api/config-dirs`, `POST /api/config-dirs/activate`). Every sub-app resolves `CLAUDE_CONFIG_DIR` once at startup, so each dir gets its own set of four children. Sets stay alive after a switch (LRU pool, `--pool-size`, default 3) so switching back is instant; the activate response carries that set's app URLs (fallback ports when the defaults are taken) and the client reloads every iframe. Removing a dir kills its set. cck's hooks and statusLine are installed per dir, so a dir without them shows tasks and sessions but no live agent activity.

**Hub token.** The hub page (`/`, `/index.html`) and every `/api/*` route require the token in `~/.claude-hub/token` (created on first run, mode 600, kept across restarts). Loopback is not a user boundary, and `/api/config` carries cck's terminal token. The banner and `--open` use `/?token=…`; the hub answers with an HttpOnly, SameSite=Strict `hub_token` cookie and a redirect that drops the query. Without the token the page answers 401 with `public/locked.html`. Scripts, icons and the manifest stay public, because Chrome fetches the manifest without cookies. Delete the file to rotate the token.

**Hub client** (`public/app.js`) fetches config, creates one iframe per app, and switches visibility on tab change. No visible chrome — switching is keyboard-only via `Ctrl+Alt+Left/Right`. `Ctrl+Alt+P` opens the project palette, `Ctrl+Alt+W` the config-dir palette (same widget, typing a path adds a new dir).

**postMessage protocol** enables cross-app communication:
- `hub:navigate` — sub-app requests the hub to switch to another app (with optional deep link URL)
- `hub:keydown` — sub-app forwards keyboard shortcuts that don't bubble out of iframes
- `hub:theme` — light/dark + color theme, echoed both ways so a change in one app reaches all
- `hub:project` — hub → sub-apps, the current project scope (the hub owns the abs-path → encoded transform)
- `hub:active` — hub → sub-apps, whether that app is the one on screen. Sub-apps can't detect this themselves: inactive iframes are `display:none`, and a nested document's `visibilityState` follows the top-level tab regardless. Cost uses it to gate auto-refresh.
- `hub:closeGuard` — sub-app → hub, `{on}`. While any app has it on, the hub asks before the window closes. cck turns it on while its embedded terminal is attached, because Ctrl+W meant for the terminal closes the window. Cleared on iframe load.
- `hub:terminalToken` — cck → hub asks, hub → cck answers `{token}`. The hub mints the terminal token per run and hands it over in the iframe's `#t=` fragment, so a page that outlived a hub restart holds a dead one. On a 401 or a token refusal cck asks once; the hub re-reads `/api/config`, because its own page may have outlived the restart too.

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
- Keyboard forwarding (`Ctrl+Alt+Arrow`, any `Ctrl+Alt+<letter>`, `Alt+digit` → `postMessage` to parent, modifiers included). The hub owns the letter keymap and ignores letters it has no binding for, so a new hub shortcut needs no submodule change. The exceptions are cck's `Ctrl+Alt+N` (New session), `Ctrl+Alt+R` (Resume session) and `Ctrl+Alt+S` (Swap to previous session), which cck keeps and never forwards, so the hub cannot bind N, R or S. The payload carries `code` beside `key` because macOS composes Option+&lt;key&gt; into a character; the hub normalizes the pair in `bindingKey()`, so a shim never needs to know a binding.
- `hubNavigate(app, url)` — callable API for cross-app deep links (no-op when standalone)

## Landing Page

`docs/index.html` — static GitHub Pages landing site. Screenshots in `docs/assets/`. Deployed automatically on push to master.
