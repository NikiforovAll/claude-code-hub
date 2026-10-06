---
name: hub-builder
description: Build on and extend Claude Code Hub. Use when the user wants to patch or fork a built-in tool (Kanban, Cost, Marketplace, Memory), write a new app for a hub tab, connect apps through topics and actions, make a custom color theme, configure the hub (flags, config dirs, token, hub keyboard shortcuts), or fix a hub problem.
---

# Hub builder

Claude Code Hub runs Kanban, Cost, Marketplace and Memory as tabs of one window, and apps talk to it through the hub protocol. The docs site is the reference. Find the case below, fetch its page, and work from what the page says.

The site documents the latest stable release. When the user's hub behaves differently from a page, trust the installed hub and say which version it is (`npm ls -g claude-code-hub`).

## Docs

Base URL: `https://nikiforovall.blog/claude-code-hub/`

The files under `references/` ship with the installed hub, so they match its version. Read them before the site.

| Case | Page |
|---|---|
| Extend the hub: patch or fork a built-in tool, write a new app, configure the `apps` entry, the manifest, the SDK, topics, actions, capabilities | [`references/extensibility.md`](references/extensibility.md). It names the docs page for each part |
| The wire messages of the hub protocol | `reference/protocol/`, then `reference/architecture/` for processes and ports |
| Start the hub, open it with its token, install it as an app | `getting-started/` |
| Flags, environment variables, `config.json`, the files the hub writes | `reference/configuration/` |
| Switch between Claude config dirs | `guides/config-dirs/` |
| The hub token, or exposing the hub to a network | `reference/security/` |
| Rebind or turn off a hub key (`keys` in `config.json`) | [`references/keys.md`](references/keys.md) |
| Look up a key: the hub's, a palette's, or a tool's own | `reference/shortcuts/` |
| The embedded terminal in Kanban | `guides/terminal/` |
| The project palette | `guides/projects/` |
| Something is broken | `reference/troubleshooting/` |
| Make a custom color theme, or change a built-in one | [`references/themes.md`](references/themes.md) |
