# Changelog

The SDK follows semver. A new function or message is a minor version, a change that breaks an app is a major version. The protocol version is separate ([Versioning](https://nikiforovall.blog/claude-code-hub/reference/protocol/#versioning)).

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
