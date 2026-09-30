# Changelog

The SDK follows semver. A new function or message is a minor version, a change that breaks an app is a major version. The protocol version is separate ([Versioning](https://nikiforovall.blog/claude-code-hub/reference/protocol/#versioning)).

## 1.0.0

The first stable release, for protocol v1.

- `connect()` with `subscribe`, `bindTheme`, `onActive`, `onStatus`, `handle`, `invoke`, `can`, `forwards`, `closeGuard`, `openExternal` and `terminalToken`.
- `publish(topic, payload)` sends `hub:publish` for a topic in the app's manifest `publishes`. Before `welcome`, only the latest payload per topic waits.
- Server `mount(app)`: `/hub-config`, `/vendor/claude-hub-sdk.js` and the IPC ping.
