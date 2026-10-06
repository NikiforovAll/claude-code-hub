# Changelog

The SDK follows semver. A new function or message is a minor version, a change that breaks an app is a major version. The protocol version is separate ([Versioning](https://nikiforovall.blog/claude-code-hub/reference/protocol/#versioning)).

## 1.3.0

- `src/keys.js` holds `comboOf()`, the one rule that names a key press. The hub page, `client.js` and `stub.js` all use it, so the copies are gone. `/vendor/claude-hub-sdk.js` and the `sdk:sync` copies are `keys.js` followed by the client or the stub, still one classic script. It adds one global, `ClaudeHubKeys`. `ClaudeHub.comboOf` is the same function and stays self-contained, so its source text still runs on its own.
- Server `bundle(file)` gives that one-script text for `client.js` or `stub.js`. `mount()` builds it once at startup.

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
