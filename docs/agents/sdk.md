# SDK, sub-app integration and postMessage protocol

## SDK

The hub ships `packages/claude-hub-sdk/src` in its npm package and hands it to every app, so an app under the hub always runs the hub's SDK.

- `src/client.js` is the app side of the hub protocol, a classic script that sets `window.ClaudeHub`.
- `src/server.js` is the app's server side: `mount(app)` registers `/hub-config` and `/vendor/claude-hub-sdk.js` (serving `client.js`), answers the hub's `hub:ping` and `hub:stats` (process memory and CPU, for the app launcher's `GET /api/apps/stats`) over IPC and exits when the hub's channel closes.
- `src/stub.js` has the client's API with no hub, for an app run alone; a test checks the two APIs match.
- `npm run sdk:sync -- <app id | dir>` copies the stub to `<app>/public/vendor/claude-hub-sdk.js` and the client to `<app>/test/vendor/claude-hub-sdk.js` (for the app's tests, not shipped), each with a stamp line.

The hub pins exact app versions. The SDK is semver (`packages/claude-hub-sdk/package.json`, `CHANGELOG.md`). `packages/claude-hub-sdk/test/version.test.js` records a hash of `src/` per version, so a change to `src/` fails the test until you bump the version, add a CHANGELOG entry, record the new hash and rerun `sdk:sync` for each app.

## Sub-app integration

Each sub-app's server calls `require(process.env.HUB_SDK_SERVER).mount(app)` when that env var is set, before `express.static`, and each has a `HUB_INTEGRATION` region in its `public/app.js`.

The page loads `/vendor/claude-hub-sdk.js` as the first element in `<body>`. Under the hub, `mount()` serves the hub's client there. Run alone, the app serves its `public/vendor` copy of the stub, and `/hub-config` does not exist. The region calls `ClaudeHub.connect()`, which fetches `/hub-config` and forwards keys, and uses `subscribe`, `bindTheme`, `onThemes`, `onActive`, `handle`, `invoke`, `can`, `closeGuard`, `openExternal`, `terminalToken` and `keyLabel` in place of the raw messages. Each app's help dialog gives its hub rows an `action` (a hub action id, or a list for one shared row) and shows `hub.keyLabel(row.action)`, its default keys until welcome, and hides a row that has no key. `hub.inHub` is true once `/hub-config` says a hub frames the page. Each app ships a `hub-app.json`, the only copy of its manifest. Marketplace and Memory apply the `project` (absolute path) of `project.changed`; Cost applies `encoded`.

- **Keyboard forwarding.** The SDK forwards a press (`key`, `code`, modifiers) only when its combo name is in `welcome.forward`; every other key stays in the app, and before welcome it forwards nothing. `comboOf()` lives once, in `packages/claude-hub-sdk/src/keys.js`: the hub page loads it as `/sdk/keys.js`, and `mount()` and `sdk:sync` put it in front of `client.js` and `stub.js` (`bundle()` in `src/server.js`). It must stay self-contained, because cck puts its source text into a sandboxed frame.
- **cck.** cck opens Cost, Marketplace and Memory with `hub.invoke('session.cost' | 'project.plugins' | 'project.memory')` and shows each link button only when `hub.can` says so. It passes `standalone` as a function, because `--cost-url`, `--marketplace-url` and `--memory-url` arrive with `/api/config` after connect. Its terminal runs in a frame on another origin, so cck sends that frame `hub.forwardCombos()` and the frame matches presses with `ClaudeHub.comboOf(e)` and hands them back, because xterm eats a key before the SDK's document listener sees it. `setupEventSource` runs before the region connects, so it hands its `hub:active` handler over through `onHubActive`.

## postMessage protocol (v1, stable)

The spec, with the combo format, is `website/src/content/docs/reference/protocol.md`; keep it in step with the code.

- `hub:hello` / `hub:welcome` — the app says hello with the topics it subscribes to; the hub answers with `forward` (the combos it binds, the keys of `bindings()`: `ctrl+alt+p`, `ctrl+alt+w`, `ctrl+alt+a`, `ctrl+,`, `ctrl+alt+ArrowLeft`, `alt+1` … `alt+N` for N enabled apps, `ctrl+alt+1` … on macOS because Option+digit types a character there), `keys` (`actionKeys()`: action id → combo, `hub.appByNumber` as its `{n}` pattern, `null` when no key runs it; the apps' help dialogs read it through `hub.keyLabel`), `themes` and `actions`. The hub sends nothing else to an app until its hello. An app with no welcome after 2 s runs as if alone.
- `hub:event` — hub → sub-apps, a topic the app subscribed to: `theme.changed` (light/dark, color theme and vars) and `project.changed` (the hub owns the abs-path → encoded transform). Both are replayed on hello. A document the hub loaded from an action URL skips the `project.changed` replay once, so the link keeps its project.
- `hub:publish` — app → hub, `{topic, payload}` for a topic in the app's manifest `publishes` (cck: `session.changed`). The hub keeps the last value, adds `encoded`/`projectName` when the payload has `project`, sends it as `hub:event` to subscribers except the sender, replays it after welcome and clears it on a config-dir switch. A hidden app gets only the last value of each topic it missed, when it comes on screen, before `hub:active`.
- `hub:invoke` / `hub:result` / `hub:action` — an app calls a hub action; the hub routes it to the target app as `hub:action` or loads its URL.
- `hub:keydown` — sub-app forwards the `welcome.forward` presses that don't bubble out of iframes, with `key`, `code` and modifiers.
- `hub:theme` — app → hub, a theme change in the app; the hub sends `theme.changed` to every app, the sender too, for the vars.
- `hub:active` — hub → sub-apps, whether that app is the one on screen. Sub-apps can't detect this themselves: inactive iframes are `display:none`, and a nested document's `visibilityState` follows the top-level tab regardless. Cost uses it to gate auto-refresh.
- `hub:closeGuard` — sub-app → hub, `{on}`. While any app has it on, the hub asks before the window closes. cck turns it on while its embedded terminal is attached, because Ctrl+W meant for the terminal closes the window. Cleared on iframe load.
- `hub:terminalToken` — cck → hub asks, hub → cck answers `{token}`. The hub mints the terminal token per run and hands it over in the iframe's `#t=` fragment, so a page that outlived a hub restart holds a dead one. On a 401 or a token refusal cck asks once; the hub re-reads `/api/config`, because its own page may have outlived the restart too.

Origin validation on the hub side restricts messages to known sub-app origins; the SDK checks `e.source === window.parent` and the hub's origin.
