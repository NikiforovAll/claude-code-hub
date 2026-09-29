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

CLI flags: `--port <n>`, `--<id>-port <n>` (`kanban`, `marketplace`, `cost`, `memory`), `--hub-dir <path>`, `--pool-size <n>`, `--open`

**Hub dir.** `--hub-dir`, else `CLAUDE_HUB_DIR`, else `~/.claude-hub`. It holds `config.json` and `token`. A test hub can use its own dir instead of overriding `USERPROFILE`.

**App ports.** `--<id>-port`, else `port` in the app's `apps` entry in `config.json`, else the manifest's `run.defaultPort`. A busy port falls back to a random one for that run. Nothing saves it: the port is the app's origin, so the app has empty `localStorage` for that run.

## Architecture

**Apps.** `lib/apps.js` lists the four built-in apps (id, submodule dir, npm package) in default tab order; nothing else in `server.js` names them all. Name, icon, entry, default port, loading verbs and actions come from the app's `hub-app.json` (in the submodule, else the npm package), else from the built-in copy in `lib/manifests/<id>.json`. A manifest that fails validation is logged and the built-in copy is used. The hand-edited `apps` list in `~/.claude-hub/config.json` (`[{id, enabled}]`) reorders them and turns them off: a disabled app is not spawned and gets no proxy port or tab. Kanban off also turns the terminal off, and `/api/projects` fails at once (`waitForPort` does not wait for an app the pool never spawned).

**Hub server** (`server.js`) spawns four child processes — marketplace, kanban, cost, and memory — passing `CLAUDE_HUB=1`, `HUB_URL`, and `CLAUDE_CONFIG_DIR` env vars, plus `HUB_SDK_SRC` when it runs from the repo. It parses their stdout to detect actual ports (handles fallback when default ports are busy) and exposes `GET /api/config` returning the live app URLs.

**Config dirs.** The hub keeps a list of Claude config dirs and the active one in `~/.claude-hub/config.json` (`GET/POST/DELETE /api/config-dirs`, `POST /api/config-dirs/activate`). Every sub-app resolves `CLAUDE_CONFIG_DIR` once at startup, so each dir gets its own set of four children. Sets stay alive after a switch (LRU pool, `--pool-size`, default 3) so switching back is instant; the activate response carries that set's app URLs (fallback ports when the defaults are taken) and the client reloads every iframe. Removing a dir kills its set. cck's hooks and statusLine are installed per dir, so a dir without them shows tasks and sessions but no live agent activity.

**Hub token.** The hub page (`/`, `/index.html`) and every `/api/*` route require the token in `~/.claude-hub/token` (created on first run, mode 600, kept across restarts). Loopback is not a user boundary, and `/api/config` carries cck's terminal token. The banner and `--open` use `/?token=…`; the hub answers with an HttpOnly, SameSite=Strict `hub_token` cookie and a redirect that drops the query. Without the token the page answers 401 with `public/locked.html`. Scripts, icons and the manifest stay public, because Chrome fetches the manifest without cookies. Delete the file to rotate the token.

**Hub client** (`public/app.js`) fetches config, creates one iframe per app, and switches visibility on tab change. No visible chrome — switching is keyboard-only via `Ctrl+Alt+Left/Right`. `Ctrl+Alt+P` opens the project palette, `Ctrl+Alt+W` the config-dir palette (same widget, typing a path adds a new dir).

**postMessage protocol** enables cross-app communication:
- `hub:navigate` — sub-app requests the hub to switch to another app (with optional deep link URL)
- `hub:keys` — hub → sub-apps, `{keys}`: the combos the hub binds (`ctrl+alt+p`, `ctrl+alt+ArrowLeft`, `alt+1` … `alt+N` for N enabled apps), the keys of `bindings()`. Posted on iframe load and in the 400 ms re-post.
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

All sub-apps expose `GET /hub-config` (returns `{enabled, url}` from env vars) and have a `HUB_INTEGRATION` region in their `public/app.js`.

**On the SDK (Cost, Marketplace, Memory, and cck for keys and `session.cost`).** The page loads `/vendor/claude-hub-sdk.js` as the first element in `<body>`, and the server serves it from `HUB_SDK_SRC`, else the vendored copy. The region calls `ClaudeHub.connect()`, which fetches `/hub-config` and forwards keys, and uses `subscribe`, `bindTheme`, `handle`, `invoke` and `can` in place of the raw messages. Each app ships a `hub-app.json` that matches `lib/manifests/<id>.json`. Marketplace and Memory apply the `project` (absolute path) of `project.changed`; Cost applies `encoded`.
- Keyboard forwarding: the SDK forwards a press (`key`, `code`, modifiers) only when its combo name is in `welcome.forward`, else in the `hub:keys` list; every other key stays in the app. Its `comboOf()` is a copy of the hub's; the combo format is in `website/src/content/docs/reference/architecture.md`. Until a list arrives it uses the old filter (`Ctrl+Alt+Arrow`, any `Ctrl+Alt+<letter>`, `Alt+digit`), which an older hub expects.
- cck passes `standalone` as a function, because `--cost-url` arrives with `/api/config` after connect. It passes `reserved`, so the SDK never forwards `Ctrl+Alt+N`, `R` or `S`, and its terminal key filter asks `hub.forwards(e)`, because xterm eats a key before the SDK's document listener sees it.

**On cck's shim.** cck's theme, project, closeGuard and terminalToken still use its own shim, which stores `/hub-config` in `window.__HUB__`. `hubNavigate(app, url)` opens the Marketplace and Memory deep links (no-op when standalone).

A new hub shortcut goes in `bindings()` and needs no submodule change. The hub must not bind cck's `Ctrl+Alt+N` (New session), `Ctrl+Alt+R` (Resume session) or `Ctrl+Alt+S` (Swap to previous session).

## SDK

`packages/claude-hub-sdk/src/client.js` is the app side of the hub protocol, a classic script that sets `window.ClaudeHub`. It is not published. `npm run sdk:sync -- <app id | dir>` copies it, with a stamp line, to `<app>/public/vendor/claude-hub-sdk.js`. In a repo checkout the hub passes `HUB_SDK_SRC` (the source path) to its children, so an app can serve the live source in place of its copy. `npm test` runs its tests; one of them checks its `comboOf` against the hub's.

## Website

`website/` — Astro + Starlight landing and docs, published at https://nikiforovall.blog/claude-code-hub/. It shares its design kit (`src/kit/`, `src/components/`) with the four sub-app sites; keep the copies the same. Screenshots come from `~/dev/claude-code-hub-demo` (`node export-site.mjs hub`). `.github/workflows/pages.yml` deploys it after a stable release, or when run by hand. See `website/README.md`.

## Release

Every repo (hub and the 4 sub-apps) has the same `.github/workflows/release.yml`. A `v*` tag push, or a manual run from a tag, checks that the tag matches `package.json`, runs `npm test` if the package has one, and publishes to npm through trusted publishing (OIDC, environment `release`, no token). A version with `-` in it goes to the `rc` dist-tag and skips the docs deploy. The hub's `npm ci` installs the sub-apps from npm, so release the sub-apps first and wait for their packages before you tag the hub. Use `/release`.
