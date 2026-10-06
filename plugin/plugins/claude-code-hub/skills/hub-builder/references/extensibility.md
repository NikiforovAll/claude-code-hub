# Extend the hub

The hub runs each tool from a folder. An entry in the `apps` list of `config.json` points the hub at your folder, so you change or add a tool and leave the hub as it is. This file holds the mechanism. Each section names the docs page with the full rules, under `https://nikiforovall.blog/claude-code-hub/`.

## Pick the way

| Way | Use it when | You keep | Page |
|---|---|---|---|
| Patch | A few lines of a published tool change | A wrapper project: the npm package pinned to the hub's exact version, `patch-package`, a `hub-app.json` | `extensibility/patch/`, example `extensibility/examples/compact-rows/` |
| Fork | A new page, a new route, or changes in many parts of a tool | A clone of the tool's repo at the tag the hub runs, with a new or the same id | `extensibility/fork/`, example `extensibility/examples/task-board/` |
| New app | The tool does a different job | Your own server, page and manifest | `extensibility/new-app/`, example `extensibility/examples/inspector/` |

Start with a patch. Move to a fork when the patch grows or breaks on each upgrade. A patch can stop applying when the pinned version changes, and `npm install` still succeeds unless the `postinstall` script has `--error-on-fail`.

## The apps entry

`<hub-dir>/config.json` (`--hub-dir`, else `CLAUDE_HUB_DIR`, else `~/.claude-hub`) has `apps: [{id, path?, enabled?, port?}]`. Page: `extensibility/reference/apps-entry/`. The other keys of the file (`configDirs`, `activeConfigDir`, `terminal`, `keys`) are in `reference/configuration/#the-config-file`; keep them as they are.

To configure an extension:

1. Open `config.json` and add the `apps` key if it is not there.
2. Add one entry per change:

   ```json
   {
     "apps": [
       { "id": "kanban-patched", "path": "C:/dev/kanban-patched" },
       { "id": "kanban", "enabled": false },
       { "id": "inspector", "path": "C:/dev/inspector", "port": 3560 }
     ]
   }
   ```

   The first two entries replace Kanban: the patched copy runs under its own id, and the original is off, so the copy gets Kanban's capabilities. A built-in id with a `path` does the same in one entry (see the rules below). The third adds a new app as a tab, on a fixed port. To run a fork next to the original, keep `{ "id": "kanban" }` enabled.
3. Make the `id` in the folder's `hub-app.json` the same as the entry's `id`, or the hub skips the app.
4. Run `npm install` in the app folder.
5. Restart the hub, because it reads the list at startup only. The startup log names each skipped app and why, and each conflict.

Rules:

- `path` is the folder with `hub-app.json`: absolute, or relative to the folder of `config.json`. The hub does not expand `~`.
- A built-in id (`kanban`, `marketplace`, `cost`, `memory`) with a `path` runs that folder in place of the tool, with no second entry. A new id needs a `path` and runs as an extra tab.
- Listed apps come first in list order, then the unlisted built-ins in default order. Tab order is also the `Alt+1`…`Alt+9` order (`⌃⌥1`…`⌃⌥9` on macOS).
- `enabled: false` removes the app: no process, tab or port, and its actions and capabilities go to no one.

## The launch

For each config dir, the hub runs `run.entry` with its own Node and an IPC channel, and restarts it up to 5 times in 60 s. The working dir is the hub's folder, so the app resolves its files from `__dirname`. Page: `extensibility/reference/apps-entry/#launch`.

The app server must:

1. Call `require(process.env.HUB_SDK_SERVER).mount(app)` before it serves static files, when the variable is set.
2. Listen on `PORT` (`0`, any free port) and `HOST`, and print one stdout line that matches `/running at http:\/\/localhost:(\d+)/i` with the real port, within 20 s.
3. Allow framing by the hub origin: no `X-Frame-Options`, no blocking `frame-ancestors`.
4. Work with no hub.

The browser sees the app on a proxy port (`--<id>-port`, else the entry's `port`, else `run.defaultPort`). That port is the app's origin and keys its `localStorage`, so a busy port falls back to a random one and the app starts with empty storage for that run. Give each app its own `defaultPort`.

After a server change, restart the app: `Ctrl+Alt+A`, select it, `Ctrl+R`. After a change in `public/`, reload the page. A change to `hub-app.json` or `config.json` needs a hub restart.

## The manifest

`hub-app.json` declares how to run the app and what it offers: `manifest: 1`, `id`, `name`, `icon` (a Lucide name), `run.entry` (inside the folder; a path into `node_modules` is fine), `run.defaultPort`, `loading.verbs`, `publishes`, `actions.handles`, `provides`. The hub reads it before the app runs and skips the app, with a log line, when it breaks a rule. Page: `extensibility/reference/manifest/`.

The npm packages of the built-in tools do not ship `hub-app.json`. A patch or fork starts from the tool's manifest in its GitHub repo and changes `id`, `name` and `run.entry`. Page for what each built-in declares: `extensibility/reference/built-in/`.

## The SDK

The page loads `/vendor/claude-hub-sdk.js` as the first element in `<body>`, a classic script, and calls `ClaudeHub.connect()`. Under the hub, `mount()` serves the hub's client at that URL, so the app always runs the hub's SDK. Alone, the app serves its own copy of the stub (`packages/claude-hub-sdk/src/stub.js`, copied by `npm run sdk:sync -- <app folder>` in a hub clone), which has the same API and does nothing. Page: `extensibility/reference/sdk/`.

The SDK writes the hub's color variables (`--accent`, `--bg-surface`, …) on `document.body`, so the app's CSS reads them and follows every hub theme, the user's own themes too. `bindTheme` keeps light/dark and the color theme in step. `onActive` tells a hidden tab to pause polling. The SDK forwards the hub's keys by itself; an element that eats keys first, such as a terminal, asks `forwards(e)`. An app that uses a `Ctrl+Alt` combo of its own lists it in `keys.keeps` in `hub-app.json`, for example `{"keeps": ["ctrl+alt+n"]}`, so the hub does not bind it, and the user cannot give it to a hub action in `config.json` `keys`. The user can change the hub's own keys there, so an app takes them from `welcome.forward`, never from a fixed list, and a help dialog shows each hub key with `hub.keyLabel(action)`, for example `hub.keyLabel('hub.projectPicker')` → `['Ctrl', 'Alt', 'P']`. Page: `extensibility/reference/manifest/#kept-keys`.

## Connect to other tools

Apps never talk to each other directly. Each page talks to the hub page through the SDK, and the hub passes the message on. There is no server-to-server channel. Page: `extensibility/reference/connect/`.

- **Topics: one to many, sticky.** The hub keeps the last value and replays it when an app connects or comes on screen. The hub publishes `project.changed` (`{project, encoded, name}` or `null`) and `theme.changed`. An app publishes only the topics its manifest lists in `publishes`. Kanban publishes `session.changed`. Subscribe before the page's `load` event, because the SDK sends the topic list with its hello.
- **Actions: one caller, one handler.** The caller names the action, not the app: `hub.can(name)` decides whether to show the control, `hub.invoke(name, params)` routes it and resolves when routed. The handler declares it in `actions.handles` with a `url` template; with `mode: "message"` a live page gets it through `hub.handle`, else the hub loads the URL, so the handler also reads the params from its query string. The built-in actions are `session.cost` (Cost), `project.plugins` (Marketplace) and `project.memory` (Memory Diagnoser).
- **Capabilities: one provider per job.** `provides.projects.path` answers the project palette's list; `provides.terminal.liveWork` answers the open terminals and makes the app the terminal provider, which gets the terminal env and token. Kanban provides both today.

## First in tab order wins

When two enabled apps declare the same capability, action or port, the first in tab order gets it, and the hub logs the conflict at startup. Use this to take over a built-in action or capability: put your app first, or turn the built-in off.

A replacement must keep what the original gave, or the other tools lose it: Kanban's `projects`, `terminal` and `session.changed`, and each other tool's action. A tool that runs next to the original can leave these to it. Page: `extensibility/fork/#what-the-built-in-tool-gives`.

## Check

An extension is done when:

- The hub startup log shows `<id> runs from <folder>` and no skip or conflict line for it.
- Its tab shows at the expected `Alt+N` (`⌃⌥N` on macOS), and what it publishes, handles or provides reaches the other tools.
- It still runs alone, with the stub.
