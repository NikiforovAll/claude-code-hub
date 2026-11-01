---
title: Extensions
description: Package a hub app with its Claude Code plugin, and add it to the hub with one command.
---

An extension is a hub app that the hub does not ship. It is a folder with a `hub-app.json`, and it can ship one Claude Code plugin. `claude-code-hub ext` adds it to the hub, installs its plugin and removes both again.

Use an extension when you want to share a [new app](/claude-code-hub/extensibility/new-app/), or when your app needs a skill or a hook in Claude Code to work.

The [Extensions page](/claude-code-hub/extensions/) lists the official extensions, which install from their latest code, and the reviewed ones, each pinned to the commit that was reviewed, with the command that installs each one. Agents read the same list as JSON at [`/claude-code-hub/extensions.json`](/claude-code-hub/extensions.json).

## Layout

The folder that holds `hub-app.json` is the extension root. Every path in the manifest starts from the root and must stay inside it.

```text
<root>/
├── hub-app.json                      run.entry, plugin, requires
├── package.json                      optional: dependencies and bins
├── …                                 the app
└── plugin/                           optional: a Claude Code marketplace
    ├── .claude-plugin/marketplace.json
    └── plugins/<name>/
        ├── .claude-plugin/plugin.json
        └── skills/ hooks/ …
```

Claude Code installs a plugin by copying its folder into its plugin cache. So code that a skill or a hook runs must be inside the plugin folder. The app can be inside the plugin folder too, so that the plugin also works with no hub.

The built-in Kanban tool has the same layout: its root holds `plugin/plugins/claude-code-kanban`.

## The manifest

An extension's `hub-app.json` is a normal [app manifest](/claude-code-hub/extensibility/reference/manifest/). Two fields matter most to an extension:

```json
{
  "manifest": 1,
  "id": "swarm",
  "name": "Swarm",
  "run": { "entry": "plugin/plugins/swarm/viewer/server.js", "defaultPort": 3546 },
  "plugin": { "marketplace": "plugin", "name": "swarm" },
  "requires": { "node": "22.13.0", "apps": ["kanban"] }
}
```

- [`plugin`](/claude-code-hub/extensibility/reference/manifest/#plugin) names the plugin in the extension's own marketplace.
- [`requires`](/claude-code-hub/extensibility/reference/manifest/#requires) sets the lowest hub and Node versions, and the apps that must be on.

The `id` must not be a built-in id (`kanban`, `marketplace`, `cost`, `memory`).

## Add an extension from the registry

```bash
claude-code-hub ext install <name>
```

For example, `claude-code-hub ext install swarm`. The command finds `<name>` in the [registry](/claude-code-hub/extensions/) and installs the GitHub source that it lists, as in [Add an extension from GitHub](#add-an-extension-from-github). A reviewed extension installs at the commit that was reviewed.

The entry in `config.json` keeps the GitHub source, not the name. So `ext update` follows that repository, and a later change to the registry does not move an installed extension. When the current folder has a folder named `<name>`, the command adds that folder instead. To use another registry, set `CLAUDE_HUB_REGISTRY` to the URL of its `extensions.json`.

## Add an extension from GitHub

```bash
claude-code-hub ext install github:<owner>/<repo>[/<folder>][@<commit or branch>]
```

For example, `claude-code-hub ext install github:NikiforovAll/claude-code-kanban/extensions/swarm`. The command needs `git` on `PATH`. It:

1. Clones the repository into `<hub dir>/extensions/<id>`. The clone has only `<folder>` and gets file contents on demand, so a big repository costs little.
2. Checks out `@<commit or branch>`, else the tip of the default branch.
3. Reads `hub-app.json` in `<folder>` and checks it, the `id` and `requires`.
4. Runs `npm install --omit=dev --ignore-scripts` when `package.json` has dependencies. Install scripts do not run.
5. Installs the plugin in one config dir: `--dir`, else `CLAUDE_CONFIG_DIR`, else `~/.claude`.
6. Adds an entry to the `apps` list in `config.json`.

When a step fails, the command deletes the clone and does not change `config.json`. The entry records where the code came from:

```json
{ "id": "swarm", "path": "extensions/swarm/extensions/swarm", "source": "github:NikiforovAll/claude-code-kanban/extensions/swarm", "sha": "6f1c2e0…" }
```

With `@<commit or branch>`, the entry also has `ref`. Then restart the hub. The extension starts with the hub and gets the next tab. To start it only from the app launcher (<kbd>Ctrl+Alt+A</kbd>, then <kbd>Ctrl+S</kbd>), add [`"deferredStart": true`](/claude-code-hub/extensibility/reference/apps-entry/) to its entry.

## Add an extension from a folder

```bash
claude-code-hub ext install <dir>
```

The command runs the same checks and plugin install, and copies nothing: the entry points at `<dir>`, so the hub runs the app from that folder. Use it for an extension you are writing.

```json
{ "id": "swarm", "path": "C:/dev/swarm", "source": "local" }
```

Run `npm install` in `<dir>` first when the app has dependencies. The app's row in the launcher has a **linked** badge.

## Install the plugin in another config dir

The hub runs an extension once, for every config dir. Claude Code loads a plugin per config dir. To install the plugin in another config dir, give the id:

```bash
claude-code-hub ext install swarm --dir ~/.claude-work
```

With an id the hub runs, `ext install` installs only the plugin. This also works for a built-in tool, for example `ext install kanban`. When the plugin of the active config dir is missing, off or not the version the app ships, the app launcher shows a ⚠ on the app's row. A click copies this command.

`ext install` is safe to run again. It updates a plugin that is already installed.

## Update an extension

```bash
claude-code-hub ext update swarm
```

For an extension from GitHub, `ext update` fetches the repository, checks out the tip of `ref` (or of the default branch), installs the dependencies and the plugin again, and writes the new `sha` to the entry. An extension pinned to a commit stays at that commit. When the new code fails a check, the clone goes back to the commit it had. Restart the app (<kbd>Ctrl+R</kbd> on its row in the app launcher) and start a new Claude Code session.

For a linked extension:

- **App code.** Restart the app: <kbd>Ctrl+R</kbd> on its row in the app launcher.
- **Plugin.** Claude Code runs the copy in its cache, so an edit in `<dir>` does not reach it. Run `ext update`, then start a new Claude Code session. `ext update` installs the plugin again, also when its version did not change.
- **Manifest.** Restart the hub.

## Commands

```bash
claude-code-hub ext <command> [--hub-dir <path>] [--dir <config dir>]
```

| Command | Action |
| --- | --- |
| `ext install <name>` | Find the extension in the registry, then install it as from GitHub |
| `ext install github:<owner>/<repo>[/<folder>][@<ref>]` | Clone the extension into the hub dir, add it to the hub and install its plugin. When the hub already has it from that source, install only the plugin |
| `ext install <dir>` | Add the extension in `<dir>` to the hub and install its plugin. When the hub already runs `<dir>`, install only the plugin |
| `ext install <id>` | Install or update the plugin of an app the hub runs, built-in or extension |
| `ext list` | List the extensions with their source or folder and the state of their plugin in the config dir |
| `ext update <id>` | Get the latest code of an extension from GitHub, and install the plugin of an extension again |
| `ext remove <id>` | Remove the plugin and its marketplace from the config dir, and the entry from `config.json`. The clone of an extension from GitHub is deleted; a linked folder stays |

| Option | Default | Meaning |
| --- | --- | --- |
| `--hub-dir <path>` | `CLAUDE_HUB_DIR`, else `~/.claude-hub` | The hub folder with `config.json` |
| `--dir <path>` | `CLAUDE_CONFIG_DIR`, else `~/.claude` | The config dir for the plugin steps |

`ext update` and `ext remove` work only on an entry that `ext install` added. Restart the hub after you add or remove an extension.

## The plugin install

With no `install` command in the manifest, the hub runs the same steps as for its own plugin:

```bash
claude plugin marketplace add "<root>/<marketplace>"
claude plugin marketplace update <marketplace name>
claude plugin install <name>@<marketplace name>
```

The marketplace name comes from the extension's `marketplace.json`. Pick a name that no other marketplace uses. When a marketplace with that name is already registered from another folder, `ext install` stops and prints the command that removes it.

An extension that needs more steps sets [`plugin.install`](/claude-code-hub/extensibility/reference/manifest/#plugin) to its own command.

## Add-ons

An add-on is a page on the dock rail beside Kanban's embedded terminal, not a hub app. It has no tab, and the hub does not run it: Kanban starts its server the first time you open it from the rail and stops it with the board. The board fills the page's URL for the session in the terminal, so the page can follow that session's folder. The [Extensions page](/claude-code-hub/extensions/) lists add-ons next to apps, with an **Add-on** badge.

The folder of an add-on holds an `addon.json` in place of `hub-app.json`:

```json
{
  "manifest": 1,
  "kind": "addon",
  "id": "git-changes",
  "title": "Changes",
  "icon": "±",
  "url": "http://localhost:4117/?cwd={cwd}",
  "run": "node server.js",
  "requires": { "node": "20.0.0", "apps": ["kanban"] },
  "listing": { "tagline": "The session's git changes, beside its terminal" }
}
```

| Field | Meaning |
| --- | --- |
| `url` | The page. Kanban fills `{cwd}`, `{sessionId}` and `{project}` for each session. The port is fixed: pick one that no other add-on uses |
| `title`, `icon` | The rail button: the title, and one or two characters |
| `run` | The command that starts the server, run in the add-on folder with `PORT` set. Kanban runs it only when nothing answers on the port |
| `requires`, `listing` | As in an [app manifest](/claude-code-hub/extensibility/reference/manifest/) |

### Make an add-on

Kanban's plugin has an `addon` skill that builds an add-on for you. In a Claude Code session, run `/claude-code-kanban:addon build <what the page shows>`. The skill writes the page and its server and puts it on the dock. To install it with `ext`, add an `addon.json` to its folder, then run `claude-code-hub ext install <dir>`.

### Install an add-on

`ext install` takes an add-on in the same forms as an app: a registry name, a `github:` source or a local folder.

```bash
claude-code-hub ext install git-changes
claude-code-hub ext install ./my-addon
```

In place of a plugin, `ext install` puts the add-on on the Kanban dock of the config dir (`--dir`, else `CLAUDE_CONFIG_DIR`, else `~/.claude`). It writes `.cck/addons.json` there through Kanban's CLI, so it needs no board running, and a running board shows the add-on at once, with no restart. Every session on that config dir shows it. The hub keeps the add-on in `addons` of `config.json`, not in `apps`, because it does not run it. For another config dir, run `ext install <id>` with that `--dir`.

- **Update.** `claude-code-hub ext update <id>` gets the latest code of a GitHub add-on and updates its dock entry. Then restart its server: <kbd>Ctrl+R</kbd> on its row under Kanban in the app launcher.
- **Remove.** `claude-code-hub ext remove <id>` takes it off the dock of the config dir, removes its entry and deletes the clone of a GitHub add-on. <kbd>Ctrl+D</kbd> on its row in the app launcher takes it off the dock only.

## Features

A feature is a part of the hub that is off by default, because it needs a tool that not everyone has. The hub ships its code, so `ext install` clones nothing: it checks the tool and turns the feature on in `config.json`. The [Extensions page](/claude-code-hub/extensions/) lists features next to apps and add-ons, with a **Feature** badge, so you can find them in one place.

```bash
claude-code-hub ext install voice
claude-code-hub ext remove voice
```

Restart the hub after either command. A feature's folder holds a `feature.json`:

```json
{
  "manifest": 1,
  "kind": "feature",
  "id": "voice",
  "title": "Voice control",
  "requires": { "hub": "1.27.0", "os": ["win32"], "apps": ["kanban"], "tools": [{ "name": "Hex", "check": "voice.hex", "url": "https://github.com/anomalyco/hex/releases" }] },
  "config": { "voice": { "enabled": true } },
  "listing": { "tagline": "Hold a key and speak" }
}
```

| Field | Meaning |
| --- | --- |
| `config` | What `ext install` merges into `config.json`. `ext remove` sets `enabled` to `false` and keeps your other keys |
| `requires.os` | The platforms the feature runs on |
| `requires.tools` | The tools it needs. `check` names a check the hub ships, which finds the tool. `url` is where to get it: `ext install` prints it when the tool is missing, and the Extensions page links it |
| `requires.apps`, `listing` | As in an [app manifest](/claude-code-hub/extensibility/reference/manifest/) |

Only the hub's own repository has features today: [Voice control](/claude-code-hub/guides/voice/).

## Trust

An extension runs as you, with no sandbox. It can read the hub token and every file you can read, and its plugin can run hooks in each Claude Code session. Add only an extension whose source you trust, the same as a Claude Code plugin.
