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
  "run": { "entry": "plugin/plugins/kanban-delm-swarm/viewer/server.js", "defaultPort": 3546 },
  "plugin": { "marketplace": "plugin", "name": "kanban-delm-swarm" },
  "requires": { "node": "22.13.0", "apps": ["kanban"] }
}
```

- [`plugin`](/claude-code-hub/extensibility/reference/manifest/#plugin) names the plugin in the extension's own marketplace.
- [`requires`](/claude-code-hub/extensibility/reference/manifest/#requires) sets the lowest hub and Node versions, and the apps that must be on.

The `id` must not be a built-in id (`kanban`, `marketplace`, `cost`, `memory`).

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

## Trust

An extension runs as you, with no sandbox. It can read the hub token and every file you can read, and its plugin can run hooks in each Claude Code session. Add only an extension whose source you trust, the same as a Claude Code plugin.
