# Changelog

The SDK follows semver. A new function or message is a minor version, a change that breaks an app is a major version. The protocol version is separate ([Versioning](https://nikiforovall.blog/claude-code-hub/reference/protocol/#versioning)).

## 1.2.0

- Server `mount(app)` answers `hub:stats` over IPC with `{id, rss, cpu}`: the memory of the app's own process in bytes and its CPU in percent of one core, sampled over 250 ms. Child processes are not counted.

## 1.1.0

- `onThemes(fn)` calls `fn` once with the hub's themes as `[{id, label}]`, the user's own themes included, after it adds a style sheet of `.theme-swatch-<id>` rules for their picker swatches. The stub never calls it.

## 1.0.0

The first stable release, for protocol v1.

- `connect()` with `subscribe`, `bindTheme`, `onActive`, `onStatus`, `handle`, `invoke`, `can`, `forwards`, `closeGuard`, `openExternal` and `terminalToken`.
- `publish(topic, payload)` sends `hub:publish` for a topic in the app's manifest `publishes`. Before `welcome`, only the latest payload per topic waits.
- Server `mount(app)`: `/hub-config`, `/vendor/claude-hub-sdk.js` and the IPC ping.
