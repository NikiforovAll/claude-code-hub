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

CLI flags: `--port <n>`, `--<id>-port <n>` (`kanban`, `marketplace`, `cost`, `memory`), `--hub-dir <path>`, `--pool-size <n>`, `--open`, `--install`/`--uninstall` (with `--dir <config dir>`)

**Hub plugin.** `plugin/` is a Claude Code marketplace with one plugin, `claude-code-hub`, which holds the `hub-builder` skill. `--install` (`lib/install.js`) copies it to `<hub-dir>/plugin` and registers that copy in one config dir per run: `--dir`, else `CLAUDE_CONFIG_DIR`, else `~/.claude`. Any change under `plugin/` bumps the version in `plugin/plugins/claude-code-hub/.claude-plugin/plugin.json`, because `claude plugin update` only loads a new version. Test an install with scratch `--dir` and `--hub-dir`.

**Hub dir.** `--hub-dir`, else `CLAUDE_HUB_DIR`, else `~/.claude-hub`. It holds `config.json` and `token`. A test hub can use its own dir instead of overriding `USERPROFILE`.

**App ports.** `--<id>-port`, else `port` in the app's `apps` entry in `config.json`, else the manifest's `run.defaultPort`. A busy port falls back to a random one for that run. Nothing saves it: the port is the app's origin, so the app has empty `localStorage` for that run.

## Architecture

**Apps.** `lib/apps.js` lists the four built-in apps (id, submodule dir, npm package) in default tab order; nothing else in `server.js` names them all. Name, icon, entry, default port, loading verbs, actions and capabilities come from the app's `hub-app.json` (in the submodule, else the npm package). An app whose manifest is missing or fails validation is logged and skipped. `test/apps.test.js` validates each app's manifest, so the release run checks the pinned packages. **Capabilities.** `provides.projects.path` and `provides.terminal.liveWork` name the provider of the project list and the embedded terminal; the first enabled app in tab order that declares one wins (today Kanban). The terminal env, the terminal token, pool pinning and `/api/projects` go to that app. The hand-edited `apps` list in `~/.claude-hub/config.json` (`[{id, enabled, port, path}]`) reorders them and turns them off: a disabled app is not spawned and gets no proxy port or tab. `path` (relative to the hub dir) runs the app from that folder: a fork in place of a built-in id, or a new app under a new id; its `hub-app.json` id must match. When two enabled apps declare the same capability, action or port, the hub logs it at startup; the first in tab order wins. With no enabled provider, the terminal is off and `/api/projects` answers 503 at once.

**Hub server** (`server.js`) spawns four child processes — marketplace, kanban, cost, and memory — passing `CLAUDE_HUB=1`, `HUB_URL`, `CLAUDE_CONFIG_DIR` and `HUB_SDK_SERVER` (the path of the hub's `packages/claude-hub-sdk/src/server.js`) env vars, over an IPC channel (see Liveness). It parses their stdout to detect actual ports (handles fallback when default ports are busy) and exposes `GET /api/config` returning the live app URLs.

**Config dirs.** The hub keeps a list of Claude config dirs and the active one in `~/.claude-hub/config.json` (`GET/POST/DELETE /api/config-dirs`, `POST /api/config-dirs/activate`). Every sub-app resolves `CLAUDE_CONFIG_DIR` once at startup, so each dir gets its own set of four children. Sets stay alive after a switch (LRU pool, `--pool-size`, default 3) so switching back is instant; the activate response carries that set's app URLs (fallback ports when the defaults are taken) and the client reloads every iframe. Removing a dir kills its set. cck's plugin (hooks and context mod) is installed per dir, so a dir without it shows tasks and sessions but no live agent activity.

**Hub token.** The hub page (`/`, `/index.html`) and every `/api/*` route require the token in `~/.claude-hub/token` (created on first run, mode 600, kept across restarts). Loopback is not a user boundary, and `/api/config` carries cck's terminal token. The banner and `--open` use `/?token=…`; the hub answers with an HttpOnly, SameSite=Strict `hub_token` cookie and a redirect that drops the query. Without the token the page answers 401 with `public/locked.html`. Scripts, icons and the manifest stay public, because Chrome fetches the manifest without cookies. Delete the file to rotate the token.

**Hub client** (`public/app.js`) fetches config, creates one iframe per app, and switches visibility on tab change. No visible chrome — switching is keyboard-only via `Ctrl+Alt+Left/Right`. `Ctrl+Alt+P` opens the project palette, `Ctrl+Alt+W` the config-dir palette (same widget, typing a path adds a new dir), `Ctrl+Alt+A` the app launcher (the cursor starts on the previous tab; `Ctrl+R` restarts the selected app's process through `POST /api/apps/:id/restart`, which answers 409 for the terminal provider while it has live terminals unless the body has `force: true`). The launcher's icons are a small Lucide set in `APP_ICONS`; any other manifest icon shows the app's first letter. `public/sw.js` fetches every `/api/*` request itself, so a Playwright `page.route` mock of an `/api/*` route needs `serviceWorkers: 'block'`.

**Update check.** `lib/update-check.js` asks npm for `claude-code-hub@latest` on start. `GET /api/update` waits for a check in flight and answers `{version, update}`; the page shows a toast for it on load. The check is off in a git checkout and with `CLAUDE_HUB_NO_UPDATE_CHECK`, so a dev hub never shows it.

**postMessage protocol (v1, stable)** enables cross-app communication. The spec is `website/src/content/docs/reference/protocol.md`; keep it in step with the code.
- `hub:hello` / `hub:welcome` — the app says hello with the topics it subscribes to; the hub answers with `forward` (the combos it binds, the keys of `bindings()`: `ctrl+alt+p`, `ctrl+alt+w`, `ctrl+alt+a`, `ctrl+alt+ArrowLeft`, `alt+1` … `alt+N` for N enabled apps), `themes` and `actions`. The hub sends nothing else to an app until its hello. An app with no welcome after 2 s runs as if alone.
- `hub:event` — hub → sub-apps, a topic the app subscribed to: `theme.changed` (light/dark, color theme and vars) and `project.changed` (the hub owns the abs-path → encoded transform). Both are replayed on hello. A document the hub loaded from an action URL skips the `project.changed` replay once, so the link keeps its project.
- `hub:publish` — app → hub, `{topic, payload}` for a topic in the app's manifest `publishes` (cck: `session.changed`). The hub keeps the last value, adds `encoded`/`projectName` when the payload has `project`, sends it as `hub:event` to subscribers except the sender, replays it after welcome and clears it on a config-dir switch. A hidden app gets only the last value of each topic it missed, when it comes on screen, before `hub:active`.
- `hub:invoke` / `hub:result` / `hub:action` — an app calls a hub action; the hub routes it to the target app as `hub:action` or loads its URL
- `hub:keydown` — sub-app forwards the `welcome.forward` presses that don't bubble out of iframes, with `key`, `code` and modifiers
- `hub:theme` — app → hub, a theme change in the app; the hub sends `theme.changed` to every app, the sender too, for the vars
- `hub:active` — hub → sub-apps, whether that app is the one on screen. Sub-apps can't detect this themselves: inactive iframes are `display:none`, and a nested document's `visibilityState` follows the top-level tab regardless. Cost uses it to gate auto-refresh.
- `hub:closeGuard` — sub-app → hub, `{on}`. While any app has it on, the hub asks before the window closes. cck turns it on while its embedded terminal is attached, because Ctrl+W meant for the terminal closes the window. Cleared on iframe load.
- `hub:terminalToken` — cck → hub asks, hub → cck answers `{token}`. The hub mints the terminal token per run and hands it over in the iframe's `#t=` fragment, so a page that outlived a hub restart holds a dead one. On a 401 or a token refusal cck asks once; the hub re-reads `/api/config`, because its own page may have outlived the restart too.

Origin validation on the hub side restricts messages to known sub-app origins; the SDK checks `e.source === window.parent` and the hub's origin.

## Git Submodules

- `marketplace/` → [claude-code-marketplace](https://github.com/NikiforovAll/claude-code-marketplace) (port 3542)
- `cck/` → [claude-task-viewer](https://github.com/NikiforovAll/claude-task-viewer) (port 3541)
- `cost/` → [claude-code-cost](https://github.com/NikiforovAll/claude-code-cost) (port 3543)
- `memory/` → [claude-code-memory](https://github.com/NikiforovAll/claude-code-memory) (port 3544)

After cloning: `git submodule update --init` then `npm install` in root, `marketplace/`, `cck/`, `cost/`, and `memory/`.

**IMPORTANT**: Submodules are often in detached HEAD state. Before making any changes in a submodule, always checkout its main branch first: `git -C <submodule> checkout main`. This avoids committing on a detached HEAD and losing work.

Each sub-app has its own linter (Biome) and pre-commit hooks. The hub root does too: `npm run lint` (Biome over `public/app.js` and `server.js`, plus the escaping and security-lib checks) and husky-managed pre-commit hooks.

## Sub-app Hub Integration

Each sub-app's server calls `require(process.env.HUB_SDK_SERVER).mount(app)` when that env var is set, before `express.static`, and each has a `HUB_INTEGRATION` region in its `public/app.js`.

**On the SDK (all four apps).** The page loads `/vendor/claude-hub-sdk.js` as the first element in `<body>`. Under the hub, `mount()` serves the hub's client there. Run alone, the app serves its `public/vendor` copy of the stub, and `/hub-config` does not exist. The region calls `ClaudeHub.connect()`, which fetches `/hub-config` and forwards keys, and uses `subscribe`, `bindTheme`, `onThemes`, `onActive`, `handle`, `invoke`, `can`, `closeGuard`, `openExternal` and `terminalToken` in place of the raw messages. `hub.inHub` is true once `/hub-config` says a hub frames the page. Each app ships a `hub-app.json`, the only copy of its manifest. Marketplace and Memory apply the `project` (absolute path) of `project.changed`; Cost applies `encoded`.
- Keyboard forwarding: the SDK forwards a press (`key`, `code`, modifiers) only when its combo name is in `welcome.forward`; every other key stays in the app, and before welcome it forwards nothing. Its `comboOf()` is a copy of the hub's; the combo format is in `website/src/content/docs/reference/protocol.md`.
- cck opens Cost, Marketplace and Memory with `hub.invoke('session.cost' | 'project.plugins' | 'project.memory')` and shows each link button only when `hub.can` says so. It passes `standalone` as a function, because `--cost-url`, `--marketplace-url` and `--memory-url` arrive with `/api/config` after connect. Its terminal runs in a frame on another origin, so cck sends that frame `hub.forwardCombos()` and the frame matches presses with `ClaudeHub.comboOf(e)` and hands them back, because xterm eats a key before the SDK's document listener sees it. `setupEventSource` runs before the region connects, so it hands its `hub:active` handler over through `onHubActive`.

A new hub shortcut goes in `bindings()` and needs no submodule change. The hub must not bind cck's `Ctrl+Alt+N` (New session), `Ctrl+Alt+R` (Resume session) or `Ctrl+Alt+S` (Swap to previous session).

## SDK

The hub ships `packages/claude-hub-sdk/src` in its npm package and hands it to every app, so an app under the hub always runs the hub's SDK. `src/client.js` is the app side of the hub protocol, a classic script that sets `window.ClaudeHub`. `src/server.js` is the app's server side: `mount(app)` registers `/hub-config` and `/vendor/claude-hub-sdk.js` (serving `client.js`), answers the hub's `hub:ping` and `hub:stats` (process memory and CPU, for the app launcher's `GET /api/apps/stats`) over IPC and exits when the hub's channel closes. `src/stub.js` has the client's API with no hub, for an app run alone; a test checks the two APIs match. `npm run sdk:sync -- <app id | dir>` copies the stub to `<app>/public/vendor/claude-hub-sdk.js` and the client to `<app>/test/vendor/claude-hub-sdk.js` (for the app's tests, not shipped), each with a stamp line. The hub pins exact app versions. The SDK is semver (`packages/claude-hub-sdk/package.json`, `CHANGELOG.md`). `test/version.test.js` records a hash of `src/` per version, so a change to `src/` fails the test until you bump the version, add a CHANGELOG entry, record the new hash and rerun `sdk:sync` for each app.

**Liveness.** The hub spawns each app with an IPC channel. Fresh loopback connects fail in bursts on some Windows machines while the app is fine. After `MAX_ATTEMPTS` failed connects (HTTP or WebSocket), the hub pings the app over IPC. No pong in 3 s replaces it. A pong keeps it, and the request retries with backoff (up to 2 s apart) for up to 30 s more; if connects still fail, the hub replaces it too. A request body of 1 MB or less is kept, so a POST retries like a GET; a larger or chunked body is sent once. The error page and JSON `error` name the real cause: starting, restarting, or stopped (gave up after its restarts). Failed connects are logged as one count per app and error code every 5 min. The app servers keep idle sockets for 65 s (`KEEP_ALIVE_MS` in net-guard) and the hub agent drops them after 60 s, so few requests need a fresh connect. On POSIX the hub stops an app with SIGTERM and sends SIGKILL after 3 s; on Windows it uses `taskkill /f /t`. `npm test` runs its tests; one of them checks its `comboOf` against the hub's.

## Website

`website/` — Astro + Starlight landing and docs, published at https://nikiforovall.blog/claude-code-hub/. It shares its design kit (`src/kit/`, `src/components/`) with the four sub-app sites; keep the copies the same. Screenshots come from `~/dev/claude-code-hub-demo` (`node export-site.mjs hub`). `.github/workflows/pages.yml` deploys it after a stable release, or when run by hand. See `website/README.md`.

## Release

Every repo (hub and the 4 sub-apps) has the same `.github/workflows/release.yml`. A `v*` tag push, or a manual run from a tag, checks that the tag matches `package.json`, runs `npm test` if the package has one, and publishes to npm through trusted publishing (OIDC, environment `release`, no token). A version with `-` in it goes to the `rc` dist-tag and skips the docs deploy. The hub's `npm ci` installs the sub-apps from npm, so release the sub-apps first and wait for their packages before you tag the hub. Use `/release`.
