# Changelog

The SDK follows semver. A new function or message is a minor version, a change that breaks an app is a major version. The protocol version is separate ([Versioning](https://nikiforovall.blog/claude-code-hub/reference/protocol/#versioning)).

## 1.12.0

- `comboOf()` names a punctuation key by its US character when `e.key` is not ASCII, so `Ctrl+,` on a Cyrillic or Greek layout is `ctrl+,`. A Latin layout keeps its own punctuation. `Digit0` falls back to `0` as `Digit1`…`9` do.
- A letter key falls back to its physical letter only when `e.key` is not ASCII. Before, AZERTY's `Ctrl+,` (the `KeyM` key) was `ctrl+m`; now it is `ctrl+,`.
- `ClaudeHubKeys.codeOf(key)` gives the US physical key (`e.code`) of a combo's key, or `null` for a named key.
- `hub:keys` (hub → app) carries new `forward` and `keys` after the user changes the hub's keys. The client applies them, and `hub.onKeys(fn)` calls `fn` so a page can read `forwardCombos()` or `keyLabel()` again. In the stub, `onKeys` does nothing.

## 1.11.0

- `hub.voiceCommands()` gives the voice commands the app handles, as `[{say, help}]` from `welcome.voice`, for the app's help. It gives `[]` with voice off, before welcome, standalone and in the stub.

## 1.10.0

- `ClaudeHub.mod` loads the hub mods for the app and gives them a way in. The hub passes `HUB_MODS` as `{assets, files}`: `mount()` puts `assets` in `self.ClaudeHubMods` ahead of the client as given, and serves only the paths in `files` under `/mods`. The hub builds the URLs, so the SDK holds no URL format. The client writes a stylesheet per CSS file and a deferred script per JS file, so mod JS runs after a deferred `app.js`. `mod.wrap(name, fn)` replaces the global function `name` with `fn(original, ...args)`; when `fn` throws before it calls `original`, `original` runs. `mod.on(event, fn)` and `mod.emit(event, detail)` carry the events an app emits after a render. `mod.list` names the loaded mods. In the stub, no mod loads, `wrap` returns `false` and `emit` reaches no one.
- `mod.send(topic, data)` posts `hub:mod` to the hub page, where the same mod's hub code gets it through `ClaudeHub.mod.on(topic)` as `{app, data}`. The topic is `<mod id>:<name>` with the id of an installed mod. Before the hub answers, only the latest data per topic waits. In the stub, `send` returns `false`.
- A page with mod JS gets a `connect-src 'self'` meta CSP before the first mod script, so mod code cannot send what it reads to another host with fetch, XHR, WebSocket or a beacon. It does not stop image or script loads or navigation.
- `?nomods` in the page URL loads no mod.
- Mods load only in an app's own tab, or in the page opened on its own. A page nested inside an app's page, such as cck's terminal or a pane, loads none.
- The client sets `data-hub-mode` (`light` or `dark`) on `<html>` from `theme.changed` and keeps it in `localStorage` for the next load, so CSS can follow the hub's mode without an app's own theme class.
- `mod.wrap` warns when a second mod wraps the same function.
- The mod runtime is `src/mods.js`, which `mount()` and `sdk:sync` put in front of `client.js`. The hub page loads the same code.

## 1.9.0

- `comboOf()` names the space bar `Space`, as in `ctrl+shift+Space`. Before, the name ended in a space character, which `config.json` `keys` could not hold. The hub binds `ctrl+shift+Space` for hold to talk when voice is on.

## 1.8.0

- `hub.invoke(action, params, {open: 'pane'})` asks for the action's URL instead of running it. The hub sends `open: 'pane'` in `hub:invoke`, fills the action's `url` template on the handler's origin and answers `{ok: true, handledBy, url}` without a tab switch, so the caller can show the app in a pane of its own. When the action has no `url` or a template param is missing, the hub runs the action as before and the result has no `url`. Standalone and in the stub, the result carries the standalone URL and no window opens.
- A nested page hands back the keys the app page around it claims ([protocol §5.2](https://nikiforovall.blog/claude-code-hub/reference/protocol/#52-host-keys)). The host posts `hub:hostKeys` with its claims; the client answers `hub:hostReady` once and posts each matching press as `hub:hostKey`, except a press in a text field or one the page already handled. Hub combos still go to the hub first. `ClaudeHubKeys.keySigs(e)` gives the signatures a claim is matched by.

## 1.7.0

- `hub.settings` and `hub.onSettings(fn)` give the values of the settings in the manifest's `settings`, from `welcome.settings` and each `hub:settings` message. In the stub, `settings` is `null` and `onSettings` never calls back.

## 1.6.0

- After `welcome`, the client opens every `http` or `https` link to another site through `openExternal`, from a click or a middle click. Before, a link with no target loaded in the app's frame, where most sites refuse framing. The client listens on `window` in the capture phase, so a modal that stops the click's propagation does not hide it. Links to the app's own origin or an origin in `welcome.origins` stay in the frame unless they have `target="_blank"`. A link to the hub goes outside, because the hub page refuses framing. Other schemes, `download` links and links with a named `target` are left to the page. Standalone, the browser handles links as before.
- `openExternal(url)` called for the link the client just opened from the same click does nothing, so an app's own `target="_blank"` handler does not open it twice. Such a handler is no longer needed. The next major version drops this check.

## 1.5.0

- A page framed inside another app's page, such as a Swarm page in a Kanban pane, talks to the hub through `window.top`, so it gets `welcome`, the themes and `theme.changed` like a tab. Before, it sent `hello` to the page around it, waited 2 s for nothing and then dropped the hub's theme. A tab sees no change: its `window.top` is its parent.
- Where the browser lists `location.ancestorOrigins`, the client runs standalone at once when the top window is not the hub, and sends no `hello`.
- The cached theme vars keep the hub origin that sent them: `claude-hub:vars` holds `{origin, vars}`, and a cache in the old shape is not painted. A framed page paints them at start only when its top window has that origin, so a page framed by something other than the hub does not paint the hub's last theme.

## 1.4.0

- `hub.keyLabel(action)` gives the keys of a hub action from `welcome.keys`, as a help row shows them: `['Ctrl', 'Alt', 'P']`, or `['⌃', '⌥', 'P']` on macOS. A list of actions shares one row, merged by their common modifiers: `['Ctrl', 'Alt', '←/→']`. It gives `[]` when no key runs the action, and `null` before welcome, standalone, or for an action the hub did not list. The stub always gives `null`.
- `ClaudeHubKeys.keyParts(combo, mac)` names the keys of a combo. The hub page uses it for the app launcher too.

## 1.3.0

- `src/keys.js` holds `comboOf()`, the one rule that names a key press. The hub page, `client.js` and `stub.js` all use it, so the copies are gone. `/vendor/claude-hub-sdk.js` and the `sdk:sync` copies are `keys.js` followed by the client or the stub, still one classic script. It adds one global, `ClaudeHubKeys`. `ClaudeHub.comboOf` is the same function and stays self-contained, so its source text still runs on its own.
- Server `bundle(file)` gives that one-script text for `client.js` or `stub.js`. `mount()` builds it once at startup.
- `comboOf()` names a press by its character when `getModifierState('AltGraph')` is set, with no `e.code` fallback, so AltGr text (Polish AltGr+A is `ą`) is no longer Ctrl+Alt+A.

## 1.2.0

- Server `mount(app)` answers `hub:stats` over IPC with `{id, rss, cpu}`: the memory of the app's own process in bytes and its CPU in percent of one core, sampled over 250 ms. Child processes are not counted.
- `hub.forwardCombos()` gives the combos that `forwards()` matches, as strings (empty before welcome and standalone). `ClaudeHub.comboOf(e)` names a key event's combo. Together they let a nested frame, such as a terminal in its own process, tell which keys to hand back to the app.

## 1.1.0

- `onThemes(fn)` calls `fn` once with the hub's themes as `[{id, label}]`, the user's own themes included, after it adds a style sheet of `.theme-swatch-<id>` rules for their picker swatches. The stub never calls it.

## 1.0.0

The first stable release, for protocol v1.

- `connect()` with `subscribe`, `bindTheme`, `onActive`, `onStatus`, `handle`, `invoke`, `can`, `forwards`, `closeGuard`, `openExternal` and `terminalToken`.
- `publish(topic, payload)` sends `hub:publish` for a topic in the app's manifest `publishes`. Before `welcome`, only the latest payload per topic waits.
- Server `mount(app)`: `/hub-config`, `/vendor/claude-hub-sdk.js` and the IPC ping.
