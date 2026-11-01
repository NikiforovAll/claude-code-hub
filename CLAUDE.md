# CLAUDE.md

## Project

Claude Code Hub — a unified launcher that combines multiple Claude Code tools (Marketplace + Kanban + Cost + Memory Diagnoser) into a single chromeless PWA via iframes and git submodules.

## Commands

```bash
npm start                # Start hub + all sub-apps (http://localhost:3540)
npm run dev              # Start with auto-open browser
npm run lint             # Biome over public/app.js, server.js and packages/claude-hub-sdk, plus the escaping and security-lib checks
npm run test:e2e         # Hub keys in Chrome (needs Chrome); by hand only, not in npm test, the hook or CI
```

`test/fixtures/key-matrix.json` is the list of key presses and what each one must do. `npm test` runs it against the hub page and the SDK; `npm run test:e2e` presses it in Chrome against a scratch hub with fixture apps. A row with `todo` is a known bug. Add a row with each key change.

The hub is usually already running on :3540. Check it with `curl -s -o /dev/null -w '%{http_code}' http://localhost:3540/api/config` (401 without the token still means it is up; add `?token=$(cat ~/.claude-hub/token)` to read it). Use it only for read-only checks. To test a fix, start a second hub on other ports (`--port`, `--marketplace-port`, `--kanban-port`, `--cost-port`, `--memory-port`) so the running one is not disturbed. Start it with `CCK_TERMINALS_FILE=<scratch path>`: its cck shares the config dir and would otherwise rewrite the real board's `terminals.json`.

CLI flags: `--port <n>`, `--<id>-port <n>` (`kanban`, `marketplace`, `cost`, `memory`), `--hub-dir <path>`, `--pool-size <n>` (else `poolSize` in `config.json`, else 3), `--open`, `--detached` (do not stop when stdin closes), `--install`/`--uninstall` (with `--dir <config dir>`), `--tray`/`--autostart`/`--no-autostart`/`--tray-status` and `--app-id <id>` (Windows and macOS)

**Hub dir.** `--hub-dir`, else `CLAUDE_HUB_DIR`, else `~/.claude-hub`. It holds `config.json`, `token` and `hub.json`; one hub runs per hub dir. A test hub can use its own dir instead of overriding `USERPROFILE`.

**App ports.** `--<id>-port`, else `port` in the app's `apps` entry in `config.json`, else the manifest's `run.defaultPort`. A busy port falls back to a random one for that run. Nothing saves it: the port is the app's origin, so the app has empty `localStorage` for that run.

## Topic docs

Read the doc before you change its area:

- **Tray**, `--tray`/`--autostart`, or `hub.json` and the one-hub-per-dir check: `docs/agents/tray.md`
- **Install**, `plugin/`, `ext` (extensions, dock add-ons, features): `docs/agents/extensions.md`
- **Hub client** UI, the app launcher, settings, or a hub shortcut and the user keymap: `docs/agents/hub-client.md`
- **SDK** (`packages/claude-hub-sdk`), a sub-app's `HUB_INTEGRATION` region, or the postMessage protocol: `docs/agents/sdk.md`
- **Voice** (`lib/voice/`, `voice` in `config.json`): `docs/agents/voice.md`
- **Liveness**: proxy retries, IPC ping, slow ports, stopping an app: `docs/agents/liveness.md`
- **Website** (`website/`, screenshots, Git LFS): `docs/agents/website.md`

## Performance

Every feature, in the hub or a sub-app, states its performance impact before you build it: what work it adds, where that work runs (startup, a hot path such as a render, a poll, the session list or a keystroke, or only on demand), and how often. If the change can cause a delay the user notices, push back and propose a cheaper design before you write it. Report the impact with the change.

## Architecture

**Apps.** `lib/apps.js` lists the four built-in apps (id, submodule dir, npm package) in default tab order; nothing else in `server.js` names them all. Name, icon, entry, default port, loading verbs, actions and capabilities come from the app's `hub-app.json` (in the submodule, else the npm package). An app whose manifest is missing or fails validation is logged and skipped. `test/apps.test.js` validates each app's manifest, so the release run checks the pinned packages.

**Capabilities.** `provides.projects.path` and `provides.terminal.liveWork` name the provider of the project list and the embedded terminal; the first enabled app in tab order that declares one wins (today Kanban). The terminal env, the terminal token, pool pinning and `/api/projects` go to that app. When two enabled apps declare the same capability, action or port, the hub logs it at startup; the first in tab order wins. With no enabled provider, the terminal is off and `/api/projects` answers 503 at once.

**`apps` in `config.json`.** The hand-edited list in `~/.claude-hub/config.json` (`[{id, enabled, port, path, hidden, deferredStart}]`) reorders the apps and turns them off: a disabled app is not spawned and gets no proxy port or tab. `hidden: true` keeps the app running and in the app launcher but gives it no tab key and no place in the `Ctrl+Alt+Left/Right` cycle; its frame loads only when the launcher or an action opens it. `deferredStart: true` does not spawn the app with its pool; it starts from the launcher's Start/Stop toggle. `path` (relative to the hub dir) runs the app from that folder: a fork in place of a built-in id, or a new app under a new id; its `hub-app.json` id must match.

**Hub server** (`server.js`) spawns four child processes — marketplace, kanban, cost, and memory — passing `CLAUDE_HUB=1`, `HUB_URL`, `CLAUDE_HUB_DIR` (cck's terminal strips `HUB_URL` and `CLAUDE_HUB` from sessions but keeps this, so a session finds `hub.json` and `token`), `CLAUDE_CONFIG_DIR` and `HUB_SDK_SERVER` (the path of the hub's `packages/claude-hub-sdk/src/server.js`) env vars, over an IPC channel. It parses their stdout to detect actual ports (handles fallback when default ports are busy) and exposes `GET /api/config` returning the live app URLs.

**Config dirs.** The hub keeps a list of Claude config dirs and the active one in `~/.claude-hub/config.json` (`GET/POST/DELETE /api/config-dirs`, `POST /api/config-dirs/activate`). Every sub-app resolves `CLAUDE_CONFIG_DIR` once at startup, so each dir gets its own set of four children. Sets stay alive after a switch (LRU pool, `--pool-size`, default 3) so switching back is instant; the activate response carries that set's app URLs (fallback ports when the defaults are taken) and the client reloads every iframe. Removing a dir kills its set. Activate records the old dir as `previousConfigDir`; `POST /api/config-dirs/swap` activates it (else the other of exactly two dirs, else 409, and the client opens the palette). `configDirSwitch` in `config.json` (`palette`, default, or `swap`) picks what `hub.configDirPicker` runs. cck's plugin (hooks and context mod) is installed per dir, so a dir without it shows tasks and sessions but no live agent activity.

**Hub token.** The hub page (`/`, `/index.html`) and every `/api/*` route require the token in `~/.claude-hub/token` (created on first run, mode 600, kept across restarts). Loopback is not a user boundary, and `/api/config` carries cck's terminal token. The banner and `--open` use `/?token=…`; the hub answers with an HttpOnly, SameSite=Strict `hub_token` cookie and a redirect that drops the query. Without the token the page answers 401 with `public/locked.html`. Scripts, icons and the manifest stay public, because Chrome fetches the manifest without cookies. Delete the file to rotate the token.

**Hub client** (`public/app.js`) creates one iframe per app and switches tabs with keys only (`Ctrl+Alt+Left/Right`, `Alt+1`…). Apps talk to the hub through the SDK's `ClaudeHub` over postMessage; the hub validates each message's origin.

**Update check.** `lib/update-check.js` asks npm for `claude-code-hub@latest` on start. `GET /api/update` waits for a check in flight and answers `{version, update}`; the page shows a toast for it on load. The check is off in a git checkout and with `CLAUDE_HUB_NO_UPDATE_CHECK`, so a dev hub never shows it.

## Git Submodules

- `marketplace/` → [claude-code-marketplace](https://github.com/NikiforovAll/claude-code-marketplace) (port 3542)
- `cck/` → [claude-task-viewer](https://github.com/NikiforovAll/claude-task-viewer) (port 3541)
- `cost/` → [claude-code-cost](https://github.com/NikiforovAll/claude-code-cost) (port 3543)
- `memory/` → [claude-code-memory](https://github.com/NikiforovAll/claude-code-memory) (port 3544)

After cloning: `git submodule update --init` then `npm install` in root, `marketplace/`, `cck/`, `cost/`, and `memory/`.

Submodules are often on a detached HEAD. Before you change one, run `git -C <submodule> checkout main`, so a commit does not land on a detached HEAD and get lost.

Each sub-app has its own linter (Biome) and pre-commit hooks; the hub root has `npm run lint` and husky pre-commit hooks.
