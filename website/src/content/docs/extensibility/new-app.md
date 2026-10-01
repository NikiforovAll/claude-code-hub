---
title: Write a new app
description: Add a separate web app to the hub, in its own tab, that talks to the other tools through the hub SDK. A step-by-step guide based on the Inspector example.
---

A new app is a separate web app that the hub runs in its own tab. Use it when the tool you want does a different job from the built-in tools.

This guide uses the [Inspector](/claude-code-hub/extensibility/examples/inspector/) as its example. The Inspector shows the turns, tool calls and token use of one Claude Code session. Its source is in [`examples/inspector`](https://github.com/NikiforovAll/claude-code-hub/tree/master/examples/inspector) in the hub repository.

## What you make

```text
inspector/
├── hub-app.json          the manifest
├── package.json
├── server.js             an Express server
├── lib/                  reads the transcripts
└── public/
    ├── index.html        loads the SDK first
    ├── app.js            the page, with a HUB_INTEGRATION region
    ├── style.css
    └── vendor/
        └── claude-hub-sdk.js   the SDK stub, for a run with no hub
```

The hub needs only `hub-app.json` and the server. The rest is a normal web app.

## 1. Write the manifest

Put `hub-app.json` in the app folder:

```json
{
  "manifest": 1,
  "id": "inspector",
  "name": "Inspector",
  "icon": "scan-search",
  "run": { "entry": "server.js", "defaultPort": 3545 },
  "loading": {
    "verbs": ["Reading the transcript…", "Counting tokens per turn…", "Matching tool calls to results…"]
  },
  "actions": {
    "handles": {
      "session.inspect": { "params": { "session": "string?" }, "url": "?session={session}", "mode": "message" }
    }
  }
}
```

- `id` is new, so the app runs next to the built-in tools. It must be the same as the `id` of the `apps` entry.
- `run.entry` is the server script. `run.defaultPort` is the proxy port. Use a port that no other app uses, because the port keys the app's `localStorage`.
- `loading.verbs` are the lines of the hub's loading screen.
- `actions.handles` lets other tools open a session in the Inspector with `hub.invoke('session.inspect', { session })`. With `mode: "message"`, the hub sends the action to the open page. When the page is not loaded yet, the hub loads `url` instead.

See [The app manifest](/claude-code-hub/extensibility/reference/manifest/) for every field.

## 2. Write the server

The hub starts `run.entry` with its own Node. The working directory is the hub's folder, so resolve your files from `__dirname`. The hub gives the app these variables:

| Variable | What the Inspector does with it |
| --- | --- |
| `PORT` | The hub sends `0`. The server listens on any free port. Alone, it uses `3545` |
| `HOST`, `ALLOWED_HOSTS` | The server binds to `HOST` and accepts only these `Host` headers |
| `CLAUDE_CONFIG_DIR` | The server reads the transcripts from `<CLAUDE_CONFIG_DIR>/projects`. Alone, it uses `~/.claude` |
| `HUB_SDK_SERVER` | The server mounts the server SDK from this path |
| `CLAUDE_HUB`, `HUB_URL` | Not used. The page finds the hub through the SDK |

The hub starts one copy of the app for each config dir. Read `CLAUDE_CONFIG_DIR` once at start.

The server of the Inspector, without its API routes:

```js
const path = require('node:path');
const express = require('express');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3545);
const ALLOWED = new Set(
  ['localhost', '127.0.0.1', '[::1]', HOST, ...(process.env.ALLOWED_HOSTS || '').split(',')]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

const app = express();

app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (ALLOWED.has(host)) return next();
  res.status(403).json({ error: `host ${host || '(none)'} is not allowed` });
});

if (process.env.HUB_SDK_SERVER) require(process.env.HUB_SDK_SERVER).mount(app);

// API routes go here.

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, HOST, () => {
  console.log(`Inspector running at http://localhost:${server.address().port}`);
});
server.keepAliveTimeout = 65_000;
server.on('error', (err) => {
  console.error(`Inspector could not listen on ${HOST}:${PORT}: ${err.message}`);
  process.exit(1);
});
```

Four lines matter to the hub:

- **The `Host` check.** A page on another site can reach a loopback server through DNS rebinding. The `Host` header shows it.
- **`mount(app)`, before the static files.** Under the hub, it serves the real SDK at `/vendor/claude-hub-sdk.js` in place of the stub, adds `/hub-config`, answers the hub's ping and stops the process when the hub stops.
- **The ready line.** The hub reads the real port from the first stdout line that matches `/running at http:\/\/localhost:(\d+)/i`. Print the port from `server.address()`, not `PORT`, because `PORT` is `0`. Print no other line that matches.
- **`keepAliveTimeout`.** The hub drops an idle connection after 60 s. A server that keeps it for 65 s does not close it first.

When the server exits, the hub starts it again, up to 5 times in 60 seconds. See [The apps entry and the launch](/claude-code-hub/extensibility/reference/apps-entry/) for the full rules.

## 3. Ship the SDK stub

When the app runs alone, the server serves `public/vendor/claude-hub-sdk.js`. This is the stub: the same API as the real SDK, and it does nothing. Copy `packages/claude-hub-sdk/src/stub.js` from the hub repository to that path. In a clone of the hub:

```sh
npm run sdk:sync -- examples/inspector
```

Load the SDK as the first element in `<body>`, as a classic script, before the page script:

```html
<head>
  <script defer src="/app.js"></script>
</head>
<body>
<script src="/vendor/claude-hub-sdk.js"></script>
```

The SDK paints the hub's theme before the first paint, so the tab does not flash.

## 4. Connect the page

The Inspector keeps all its hub code in one `HUB_INTEGRATION` region of `public/app.js`. The rest of the page does not know about the hub.

```js
// #region HUB_INTEGRATION
const hub = ClaudeHub.connect();

(function initHubTheme() {
  const getTheme = () => (document.body.classList.contains('light') ? 'light' : 'dark');
  const getColorTheme = () => document.body.dataset.colorTheme || 'ember';
  const report = hub.bindTheme({
    get: () => ({ theme: getTheme(), colorTheme: getColorTheme() }),
    set: ({ theme, colorTheme }) => {
      if (colorTheme !== getColorTheme()) setColorTheme(colorTheme);
      if (theme !== getTheme()) toggleTheme();
    },
  });
  new MutationObserver(report).observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'data-color-theme'],
  });
})();

hub.onThemes((themes) => buildThemeMenu(themes.map((t) => [t.id, t.label])));

let pinnedByUrl = new URLSearchParams(location.search).has('session');
let settled = false;
hub.subscribe('session.changed', (s) => {
  if (!s?.sessionId || pinnedByUrl) return;
  openSession(s.sessionId, s.encoded);
});

hub.handle('session.inspect', ({ session }) => {
  if (session) openSession(session);
});

hub.onActive((active) => {
  state.active = active;
  settled = true;
  pinnedByUrl = false;
  if (active && state.id) load();
  else autoPick();
});

function settleAlone(status) {
  if (settled || (status !== 'standalone' && status !== 'unanswered')) return;
  settled = true;
  autoPick();
}

hub.onStatus((status) => {
  settleAlone(status);
  renderTopbar();
});
settleAlone(hub.status);

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[target="_blank"]');
  if (!link || !hub.inHub) return;
  e.preventDefault();
  hub.openExternal(link.href);
});
// #endregion HUB_INTEGRATION
```

What each part does:

| Call | Why |
| --- | --- |
| `bindTheme` | Applies the hub theme. The `MutationObserver` calls `report()` when the user changes the theme in the Inspector, and the hub sends the change to every tool |
| `onThemes` | Fills the theme menu with the hub's themes, which include the user's own themes |
| `subscribe('session.changed')` | Kanban publishes the session that you open. The Inspector opens the same session. A page opened with `?session=` keeps its own session, so it skips the first event |
| `handle('session.inspect')` | Opens the session that another tool asks for |
| `onActive` | Tells the page when its tab is on screen. The Inspector reloads the session when you come back to it |
| `onStatus`, `settleAlone` | When there is no hub, or the hub does not answer in 2 s, the page picks a session itself |
| `openExternal` | A framed page cannot open a new window in the installed hub. The SDK asks the hub to do it |

Subscribe before the page's `load` event. The SDK sends the topic list to the hub at `load`, and the hub sends nothing for a topic that is not in it.

### Call another tool

The Inspector has a **Cost** button that opens the session in Cost. It shows the button only when an enabled tool handles the action:

```js
$('costBtn').hidden = !(state.id && hub.can('session.cost'));

const r = await hub.invoke('session.cost', { session: state.id });
if (!r.ok) toast(`Cost did not open: ${r.reason}`, 'error');
```

See [The built-in tools](/claude-code-hub/extensibility/reference/built-in/) for the topics and actions of the built-in tools.

## 5. Add the app to the hub

Add an entry with a `path` to the `apps` list in `~/.claude-hub/config.json`. List the built-in tools too, to keep them in the tab order:

```json
{
  "apps": [
    { "id": "kanban" },
    { "id": "marketplace" },
    { "id": "cost" },
    { "id": "memory" },
    { "id": "inspector", "path": "C:/dev/claude-code-hub/examples/inspector" }
  ]
}
```

Run `npm install` in the app folder, then restart the hub. The startup log shows where the app runs from:

```text
inspector runs from C:\dev\claude-code-hub\examples\inspector
```

The Inspector is the fifth tab, <kbd>Alt+5</kbd>. It is also in the app launcher, <kbd>Ctrl+Alt+A</kbd>. When the app does not start, the log shows why: the manifest failed validation, the `id` does not match, or the server printed no ready line in 20 s.

## 6. Check it alone

Run the app with no hub:

```sh
npm start
```

Open `http://localhost:3545`. The page must work: it picks a session, and the theme button works. The **Cost** button is hidden, because `hub.can('session.cost')` is false with the stub.

## Reference

- [The apps entry and the launch](/claude-code-hub/extensibility/reference/apps-entry/): the env, the ready line and what the server must do.
- [The app manifest](/claude-code-hub/extensibility/reference/manifest/): every field of `hub-app.json`.
- [The SDK](/claude-code-hub/extensibility/reference/sdk/): the page API.
- [Connect to other tools](/claude-code-hub/extensibility/reference/connect/): how topics, actions and capabilities work.
- [The built-in tools](/claude-code-hub/extensibility/reference/built-in/): what Kanban, Marketplace, Cost and Memory Diagnoser offer.
