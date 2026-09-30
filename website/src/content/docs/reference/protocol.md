---
title: Hub protocol v1
description: The stable contract between the hub and an app in one of its tabs, for authors of hub apps. It covers the launch, the SDK, the postMessage messages, the theme variables and the app manifest.
---

This spec is the contract between the hub and an app that runs in one of its tabs. It covers the launch, the SDK, the postMessage protocol, the theme variables and the app manifest. For an overview, see [Architecture](/claude-code-hub/reference/architecture/).

:::note[Standalone first]
An app must work with no hub. Everything in this spec turns on only when the hub launches the app.
:::

## Status

**Stable.** Protocol version `1`, manifest format `1`. The protocol before v1 (v0) is not supported ([Compatibility](#11-compatibility)).

## Versioning

| Version | Where | Changes when |
|---|---|---|
| Protocol | `hello.protocol`, `welcome.protocol` | A change that an app or hub of the same version cannot ignore |
| Manifest | `hub-app.json` `manifest` | A field that the hub must read in a new way |
| SDK | `version` in `packages/claude-hub-sdk/package.json`, also in the stamp line of each synced copy | Any change to the SDK |

1. **Additive changes keep the version.** A new message type, topic, action, optional payload field or manifest field is not a new protocol version. The hub and the app ignore a type or field they do not know ([Message rules](#4-message-rules)).
2. **A breaking change bumps the version.** The next version is `2`. An app lists every version it speaks in `hello`, and the hub answers with the highest version that both sides speak ([Handshake](#5-handshake)).
3. **The hub supplies the SDK.** Under the hub, an app runs the hub's SDK, so the app and the hub always speak the same version ([SDK](#3-sdk)).

## Terms

| Term | Meaning |
|---|---|
| Hub | The hub server and the hub page that holds the iframes |
| App | A web app that the hub spawns and shows in an iframe |
| App id | A name that matches `^[a-z][a-z0-9-]{0,31}$`, unique in the hub, for example `cost`. `hub` is reserved |
| Pool | The set of app processes for one Claude config dir |
| Framed | The app document is not the top window (`window.top !== window`) |
| Current document | The document that the iframe holds now. A reload or a config-dir switch starts a new one |
| Live | The iframe sent `hub:hello` after its last `load` event |

## 1. Launch

The hub spawns each enabled app once per config dir. It runs `run.entry` from the manifest with Node and `--max-http-header-size=65536`, with the hub root as the working directory. An app must resolve its own files from its script path, not from the working directory. The env vars:

| Env | Value |
|---|---|
| `CLAUDE_HUB` | `1` |
| `HUB_URL` | The hub origin, `http://localhost:<hub port>`, with the port the hub is bound to. The hub binds its port before it starts any app |
| `CLAUDE_CONFIG_DIR` | The Claude config dir of this pool |
| `PORT` | `0`. The app binds any free port |
| `HOST`, `ALLOWED_HOSTS` | The hub's bind rules. The app must use them as they are |
| `HUB_SDK_SERVER` | The absolute path of the hub's server SDK, `packages/claude-hub-sdk/src/server.js`. Always set ([SDK](#3-sdk)) |
| Capability env | Only for the provider of that capability, for example `CCK_TERMINAL` and `CCK_TERMINAL_TOKEN` for `terminal` |

The app reads these once at start. A new config dir gets a new process. If an app exits, the hub starts it again, up to 5 times in 60 seconds.

### Ready line

When the app listens, it prints one stdout line with its real port:

```text
<Name> running at http://localhost:<port>
```

- The hub matches it with `/running at http:\/\/localhost:(\d+)/i`. Print no other line that matches.
- End the line with a newline: the hub reads stdout line by line.
- The hub waits 20 s for the ready lines of a config dir's apps, then shows the apps that are ready.

### IPC channel

The hub spawns the app with a Node IPC channel. The server SDK's `mount()` does all of this:

- The app answers `{type: 'hub:ping', id}` with `{type: 'hub:pong', id}`.
- The app exits when the channel closes, and unrefs the channel.

After 3 failed connects to the app, the hub pings it:

| Answer | What the hub does |
|---|---|
| Pong in 3 s | The loopback dropped the connects. The hub keeps the app, and the request retries for up to 30 s more. |
| No pong | The hub replaces the app. |
| Pong, but connects still fail after 30 s | The hub replaces the app. |

## 2. Origin

The hub serves each app through a proxy port per app id. The proxy origin is the app's origin in the browser, so it keys the app's `localStorage`. So each app must declare a fixed `run.defaultPort`, different from the other apps.

The hub takes the first port that is set:

1. The `--<id>-port` flag.
2. The `port` of the app's entry in the `apps` list of the hub's `config.json`. The user sets it, not the app, so it overrides the manifest.
3. `run.defaultPort` from the manifest.

When that port is taken, the hub uses a random free port for this run, and the app starts with empty `localStorage` for that run.

The app must allow framing by the hub origin: it must not send an `X-Frame-Options` header or a `frame-ancestors` rule that blocks it.

## 3. SDK

The hub ships the SDK and hands it to each app it spawns, so the app runs the hub's version. The SDK has three files in [`packages/claude-hub-sdk/src`](https://github.com/NikiforovAll/claude-code-hub/tree/master/packages/claude-hub-sdk/src):

| File | Runs in | Does |
|---|---|---|
| `server.js` | The app server, under the hub | `mount(app)` answers `hub:ping` ([Launch](#1-launch)), and registers `GET /hub-config` and `GET /vendor/claude-hub-sdk.js`, which serves `client.js` |
| `client.js` | The app page, under the hub | The app side of this spec. It sets `window.ClaudeHub` |
| `stub.js` | The app page, standalone | The same API as `client.js`, with no hub. It never fetches `/hub-config` and sends no message |

1. **Mount under the hub only.** The app server calls `require(process.env.HUB_SDK_SERVER).mount(app)` when `HUB_SDK_SERVER` is set, before its static files, so the route for `client.js` wins over the stub.
2. **Ship the stub.** The app serves `stub.js` as its own `public/vendor/claude-hub-sdk.js`. `npm run sdk:sync -- <app id | dir>` in the hub repo copies it there, with a stamp line that names the SDK version and hash. It also copies `client.js` to `test/vendor/claude-hub-sdk.js`, for the app's tests. The app does not ship that copy.
3. **Load it first.** The page loads `/vendor/claude-hub-sdk.js` as a classic script, the first element in `<body>`, with no `defer` or `async` ([Theme](#6-theme), rule 3).
4. **Same API.** The stub and the client have the same functions. The hub's tests check this.

The app's page code calls `ClaudeHub.connect()` and uses the returned object: `subscribe`, `bindTheme`, `onActive`, `onStatus`, `handle`, `invoke`, `can`, `forwards`, `closeGuard`, `openExternal` and `terminalToken`. It works the same with the stub and the client.

### HTTP

| Route | Response |
|---|---|
| `GET /hub-config` | `{enabled: <CLAUDE_HUB is set>, url: HUB_URL}` |

`mount()` registers this route, so it exists only under the hub. The client fetches it once at start. It is how the app learns that it is under the hub and which origin to trust.

## 4. Message rules

Each message is `{type: 'hub:<name>', …payload}`, sent with `postMessage`.

**App side:**

1. Until `/hub-config` resolves with `enabled: true`, the app sends nothing and drops every message.
2. The app accepts a message only when `e.source === window.parent` and `e.origin` is the origin of `/hub-config`'s `url`.
3. The app posts only to `window.parent`, with that origin as the target origin.
4. Every apply must be idempotent. The hub can send the same state more than once.

**Hub side:**

1. The hub names the sender by `e.source`: the iframe whose `contentWindow` sent it. It drops a message when `e.source` is not an app iframe, or when `e.origin` is not that app's origin. A payload never names the sender.
2. The hub posts to an iframe with that app's exact origin.
3. The hub ignores a type it does not know. The app must do the same.

## 5. Handshake

| Direction | Type | Payload |
|---|---|---|
| App → hub | `hub:hello` | `{protocol: [1], subscribes?: string[]}` |
| Hub → app | `hub:welcome` | `{protocol: 1, forward: string[], themes: Theme[], actions: string[]}` |

1. The app sends `hello` after its own `load` event, once `/hub-config` resolves with `enabled: true` and its message listeners are in place. It sends it once per document.
2. `protocol` lists the versions the app speaks. The hub answers with the highest version in both lists. When there is none, the hub does not answer, and the app works as an app with no `welcome` ([No welcome](#no-welcome)).
3. A valid `hello` makes the app live. The hub clears the live state on each iframe `load` event, because `e.source` stays the same object across reloads. Every new document, from a reload or from a `src` that the hub sets, ends in a `load`. Because `hello` comes after the app's `load`, the hub always sees `load` first, and a late `hello` from the old document is cleared by that `load`.
4. After `welcome`, the hub sends the current state: a `hub:event` for each sticky topic in `subscribes` that has a value ([Events](#10-events)), and `hub:active`. An app gets no theme or project for a topic it did not subscribe to.
5. `welcome` fields:
   - `forward`: the key combos the hub binds ([Keys](#8-keys)).
   - `themes`: the list for the theme picker ([Theme](#6-theme)).
   - `actions`: the actions that an enabled app handles ([Actions](#7-actions)).

## 6. Theme

The hub is the theme source. Under the hub, an app takes its colors from the hub. Its own theme CSS is for standalone use only.

### Messages

| Direction | Type | Payload |
|---|---|---|
| App → hub | `hub:theme` | `{theme: 'light' \| 'dark', colorTheme?}`: the user changed the theme in the app |
| Hub → app | `hub:event` `theme.changed` | `{theme, colorTheme, vars?}` |

- `vars`: the core variables for the current theme and mode, for example `{"--accent": "#e86f33", …}`. The hub omits it when it has no theme registry. A `theme.changed` with no `vars` means: remove the inline vars and use the app's own theme CSS.
- `Theme` in `welcome.themes`: `{id, label, swatch: {dark, light}}`, where each swatch is `{bg, accent, ink, border}`.
- The id of the default theme, Ember, is `ember`.

### Core variables

| Group | Variables |
|---|---|
| Accent | `--accent`, `--accent-text`, `--accent-dim`, `--accent-glow` |
| Background | `--bg-deep`, `--bg-surface`, `--bg-elevated`, `--bg-hover` |
| Border | `--border` |
| Text | `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-muted` |
| Sidebar | `--sidebar-bg`, `--sidebar-item-bg`. Only some themes set them |

The hub does not theme semantic colors (`--success`, `--warning`, `--error`), chart series colors or fonts. The app owns them.

### Rules

1. **Apply on `body`.** The app writes `vars` as inline custom properties on `document.body`, so they win over every selector rule. It also sets its own mode class and theme attribute for the rest of its styles.
2. **Apply on change only.** When `vars` equal the last set it applied, the app does nothing.
3. **Paint the cached set first.** The app keeps the last `vars` in `localStorage`.
   - When framed, it applies them synchronously at start, before the first paint and before `/hub-config` resolves. So the code runs from a classic script that is the first element in `<body>`, before the app's own scripts, with no `defer` or `async`. In `<head>`, `document.body` does not exist yet.
   - Standalone, it never applies them: a standalone tab can share the origin with the proxy.
   - When the hub sends no `vars`, or sends no `welcome` within 2 s of `hello`, the app removes the cached set from the page and from `localStorage`. Until then, it keeps the cached set.
4. **Derive extras.** An app computes any extra variable from the core set in its own CSS, for example `--chart-fill: color-mix(in srgb, var(--accent) 32%, transparent)`, so it follows a theme it does not know. It declares the extra on `body`, not `:root`: `var()` resolves where the property is declared, and the inline `vars` are on `body`.
5. **Picker.** Under the hub, the app's theme picker lists `welcome.themes` and paints the swatches inline. Standalone, it lists the app's own themes.
6. **Report.** When the user picks a theme in the app, the app sends `hub:theme` and applies what it has: its own CSS for a theme it knows, else the swatch only. The hub stores the theme and sends it as `theme.changed` with `vars` to every live app, the sender included.
7. **Unknown id standalone.** An app that stored a hub-only theme id shows its default theme when it runs standalone.
8. **Subscribe.** An app that applies the theme lists `theme.changed` in `hello.subscribes`, so it gets the theme as a sticky `hub:event` after `welcome`. The SDK's `bindTheme` adds the topic. Call it right after `connect()`: the SDK sends `hello` after `load`, with the topics it has then. An app that binds after `hello` gets no theme from the hub.

## 7. Actions

An action is a request with exactly one handler, for example `session.cost`: "show the cost of this session". The caller does not know which app handles it.

### Names

`<noun>.<verb or view>`, lowercase: `session.cost`, `project.plugins`, `project.memory`. An app-specific name uses the app id as its prefix, for example `cost.refresh`. `hub.*` is reserved for the hub's own actions. v1 has none. The hub skips an app handler with a `hub.*` name, with a log line.

### Declaration

An app declares what it handles in its manifest ([Manifest](#9-manifest)), because the hub needs it before the app runs:

```json
"actions": {
  "handles": {
    "session.cost": { "params": { "session": "string?" }, "url": "?view=detail&session={session}", "mode": "message" }
  }
}
```

| Field | Meaning |
|---|---|
| `params` | Param names and types. The only types are `string` (required) and `string?` (optional) |
| `url` | A path and query relative to the app origin, with no `#`. `{name}` is replaced by the param value. The hub skips an action whose `url` has a `#` |
| `mode` | `url` (default) or `message` |

### Messages

| Direction | Type | Payload |
|---|---|---|
| App → hub | `hub:invoke` | `{id, action, params}`. `id` is a string that the caller picks, to match the result |
| Hub → app | `hub:result` | `{id, ok: true, handledBy: <app id>}` or `{id, ok: false, reason: 'unhandled' \| 'bad-params'}` |
| Hub → app | `hub:action` | `{id, action, params}`, to the handler in `message` mode |

### Routing

1. **Handler.** The first enabled app in tab order that declares the action. When there is none, the hub answers `unhandled`.
2. **Params.** The hub answers `bad-params` when a required param is missing, a param is not declared, or a value is not a string.
3. **Switch.** The hub switches to the handler's tab.
4. **`message` mode.** When the handler is live, the hub posts `hub:action` and answers `hub:result` at once. It does not wait for the handler to finish, and it does not queue a call for an app that is not live.
5. **`url` mode**, and `message` mode when the handler is not live. When every param in the template is present, the hub fills it in with `encodeURIComponent` on each value and sets the iframe `src`. It builds the URL the same way as the first `src`, so the handler keeps what the hub adds, such as the `#t=` fragment. It refuses a result that is not on the handler's origin. When a param is missing, or the handler has `hub:closeGuard` on, the hub only switches: setting `src` reloads the app.
6. **Handler duty.** An app must handle every action that it declares with `mode: "message"`. It logs an action it does not know.
7. **Availability.** The caller shows a link or runs a key for an action only when the action is in `welcome.actions`. With no `welcome`, see [No welcome](#no-welcome).

## 8. Keys

A key press inside an iframe does not reach the hub page, so the app forwards the combos that the hub binds.

| Direction | Type | Payload |
|---|---|---|
| App → hub | `hub:keydown` | `{key, code, ctrl, alt, shift, meta}` |

1. `welcome.forward` lists the combos by name, for example `ctrl+alt+p`, `ctrl+alt+ArrowLeft`, `alt+1`.
2. **Combo name.** The modifiers that are down, in the order `ctrl`, `alt`, `shift`, `meta`, joined by `+`, then the key. The key is `e.key` lowercased when that is `a`–`z` or `1`–`9`. Else, when `e.code` is `Key<A-Z>` or `Digit<1-9>`, it is that letter or digit lowercased, because macOS turns `Option+<key>` into another character. Else it is `e.key` as it is.
3. The app forwards a press only when its combo name is in the list, and then prevents its default action. Every other key stays in the app.
4. The hub runs the binding for that combo.

An element that handles keys before the document sees them, such as a terminal, asks the SDK's `forwards(e)` and lets a forwarded key through.

## 9. Manifest

`hub-app.json` at the app root, next to `package.json`, tells the hub how to run the app and what it handles. An npm package must list it in `files`.

```json
{
  "manifest": 1,
  "id": "cost",
  "name": "Cost",
  "icon": "dollar-sign",
  "run": { "entry": "server.js", "defaultPort": 3543 },
  "loading": { "verbs": ["Counting tokens…"] },
  "actions": {
    "handles": { "session.cost": { "params": { "session": "string?" }, "url": "?view=detail&session={session}", "mode": "message" } }
  },
  "provides": {}
}
```

| Field | Meaning |
|---|---|
| `manifest` | The manifest format version. Now `1` |
| `id` | The app id |
| `name`, `icon` | The tab name and a Lucide icon name |
| `run.entry` | The server script, relative to the app root |
| `run.defaultPort` | The first choice for the proxy port ([Origin](#2-origin)). Not a reservation |
| `loading.verbs` | Lines for the hub's loading screen while this app loads. Optional |
| `actions.handles` | [Actions](#7-actions) |
| `provides` | Capabilities, for example `{"projects": {"path": "/api/projects"}, "terminal": {"liveWork": "/api/terminals"}}`. The hub finds a capability's provider here |

### Rules

1. **Discovery, not runtime.** The manifest holds what the hub needs before the app runs. The protocol version comes from `hello` only, because the running document may be an older bundle.
2. **Built-in apps.** v1 runs the four built-in apps only. The hub reads each manifest from the submodule, else from the installed package, and keeps no copy. The hub's tests validate the manifest of each pinned package.
3. **Skip.** The hub skips an app, with a log line, when its file is missing or not valid JSON, `manifest` is a version it does not know, `id` does not match the id rule ([Terms](#terms)) or is not the app's id, `run.entry` is not inside the app directory, or a `provides` path does not start with `/`. It skips one action, with a log line, when the action is not valid ([Actions](#7-actions)).
4. **Providers.** For each capability, the first enabled app in tab order whose `provides` declares it is the provider. `projects.path` and `terminal.liveWork` must be paths on the provider's origin. `projects.path` answers `[{path, modifiedAt}]`. `terminal.liveWork` answers `{sessions: []}`, and a pool whose provider has sessions is not evicted. With no provider, the capability is off: no terminal, and the project palette has no list.

## 10. Events

An event is a fact from the hub that any number of apps can receive.

| Direction | Type | Payload |
|---|---|---|
| App → hub | `hub:hello` | `subscribes: string[]`, the topics the app wants |
| Hub → app | `hub:event` | `{topic, payload}` |

| Topic | Sticky | Payload |
|---|---|---|
| `project.changed` | Yes | `{project, encoded, name}`, or `null` when there is no project |
| `theme.changed` | Yes | `{theme, colorTheme, vars?}` |

1. A **sticky** topic keeps its last value in the hub. After `welcome`, the hub sends the last value of each sticky topic the app subscribes to, then every change. A topic that has had no value yet sends nothing.
2. The hub sends an event only to live apps that subscribe to its topic.
3. `project` is the absolute path and `encoded` is the hub's encoded form of it. An app does not encode a path itself.
4. The hub starts with no project, so that each app restores its own. It sends `null` only when the user clears the project. On `null`, the app clears its project scope.
5. A document that the hub loaded from an action URL does not get the `project.changed` replay after `welcome`, so the link keeps its project. The next change goes to it as usual.
6. An event never carries a secret.

## 11. Compatibility

| Pair | What happens |
|---|---|
| App with no `hello` + v1 hub | The hub sends the app no theme, project, keys or active state |
| v1 app + hub with no `welcome` | The app gets no `welcome`. It forwards no keys, calls no hub action, and uses its own theme CSS |
| v1 app standalone | The app serves the stub ([SDK](#3-sdk)). It sends no message and uses its own URLs and themes |

v0 (`hub:project`, `hub:keys`, hub → app `hub:theme`, `hub:navigate`, `hub:keydown` with `{key}` only) is not supported. An app and a hub from before v1 do not work with a v1 hub or app. So the v1 releases of the hub and all four apps are breaking and ship together, and the hub pins the exact v1 app versions.

### No welcome

1. **Wait.** The app waits 2 s after `hello` for `welcome`. With none, its status is `unanswered`, and it removes the cached theme ([Theme](#6-theme), rule 3). A `welcome` that comes later still applies.
2. **Calls wait too.** An action call made before `welcome` and before the 2 s end waits for one of them. After the 2 s, `can` is false for every action and a call resolves `unhandled`.

## 12. Other messages

| Direction | Type | Payload | Meaning |
|---|---|---|---|
| Hub → app | `hub:active` | `{active: boolean}` | Whether this app is the tab on screen. Sent after `welcome` and on each tab switch. An app cannot find this itself: a hidden iframe is `display: none`, and `visibilityState` follows the top window |
| App → hub | `hub:closeGuard` | `{on: boolean}` | While any app has it on, the hub asks before the window closes. Cleared when the app document loads again |
| App → hub | `hub:openExternal` | `{url}` | The hub opens an `http` or `https` URL in a new window |
| App → hub | `hub:terminalToken` | `{}` | The `terminal` provider asks for a fresh token |
| Hub → app | `hub:terminalToken` | `{token}` | The answer. Sent only to the `terminal` provider |

The hub gives the `terminal` provider its first token in the iframe URL fragment, `#t=<token>`.

**Hub token.** The hub never sends its token to an app. Cookies on `localhost` are shared across ports, so the browser sends the `hub_token` cookie to every app origin. The proxy removes `hub_token` from the `Cookie` header of each request and WebSocket upgrade before it forwards them.

:::caution[Trust]
An app is local code that the user chose to run, with the user's rights. It can read `~/.claude-hub/token`, it gets the hub's whole environment, and it can call any action. The rules in this spec keep apps from breaking each other by mistake. They are not a sandbox.
:::

## Planned

These are not in v1. Each is additive ([Versioning](#versioning)).

- A shared shortcut list: each app serves a `shortcuts.json`, named by a manifest field `shortcuts`, and the hub shows all of them in one overlay on <kbd>Ctrl+Alt+K</kbd> through the hub action `hub.shortcuts`.
- More hub actions, such as `app.<id>` and `hub.nextApp`, with a user keymap that can bind app actions to global keys.
- A `providers` map in the user config to pick one handler or provider among several. v1 takes the first enabled app in tab order.
- Topics that apps emit (`hub:emit`), and the manifest fields `invokes`, `emits` and `reservedKeys`.
- A `project` param type that gives a template `{project.encoded}`.
- `run.ready` in the manifest, and a fixed prefix for the ready line.
- Added apps: a `path` entry in the `apps` list of `~/.claude-hub/config.json`, apps from npm packages, and external apps that the hub does not spawn.
