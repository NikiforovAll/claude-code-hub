---
name: hub-builder
description: Build on Claude Code Hub. Use when the user wants to write an app for a hub tab, make a custom color theme, configure the hub (flags, config dirs, token), or fix a hub problem.
---

# Hub builder

Claude Code Hub runs Kanban, Cost, Marketplace and Memory as tabs of one window, and apps talk to it through the hub protocol. The docs site is the reference. Find the case below, fetch its page, and work from what the page says.

The site documents the latest stable release. When the user's hub behaves differently from a page, trust the installed hub and say which version it is (`npm ls -g claude-code-hub`).

## Docs

Base URL: `https://nikiforovall.blog/claude-code-hub/`

| Case | Page |
|---|---|
| Write or debug an app for a hub tab: SDK, messages, manifest, theme variables | `reference/protocol/`, then `reference/architecture/` for processes and ports |
| Start the hub, open it with its token, install it as an app | `getting-started/` |
| Flags, environment variables, `config.json`, the files the hub writes | `reference/configuration/` |
| Switch between Claude config dirs | `guides/config-dirs/` |
| The hub token, or exposing the hub to a network | `reference/security/` |
| Keys the hub binds and keys the tools keep | `reference/shortcuts/` |
| The embedded terminal in Kanban | `guides/terminal/` |
| The project palette | `guides/projects/` |
| Something is broken | `reference/troubleshooting/` |
| Make a custom color theme, or change a built-in one | [`references/themes.md`](references/themes.md), shipped with this skill |
