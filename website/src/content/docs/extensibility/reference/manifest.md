---
title: The app manifest
description: Every field of hub-app.json and the validation rules.
---

`hub-app.json` in the app folder tells the hub how to run the app and what it offers. The hub reads it at startup, before the app runs.

```json
{
  "manifest": 1,
  "id": "board",
  "name": "Board",
  "icon": "layout-grid",
  "run": { "entry": "server.js", "defaultPort": 4560 },
  "loading": { "verbs": ["Laying out the board…"] },
  "publishes": ["board.selected"],
  "actions": {
    "handles": {
      "board.open": { "params": { "session": "string" }, "url": "?session={session}", "mode": "message" }
    }
  },
  "provides": {}
}
```

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `manifest` | Yes | The format version. Now `1` |
| `id` | Yes | The app id, `^[a-z][a-z0-9-]{0,31}$`. Must be the id of the `apps` entry. `hub` is reserved |
| `name` | No | The tab name. Default: the id |
| `icon` | No | A [Lucide](https://lucide.dev/icons/) icon name |
| `run.entry` | Yes | The server script, relative to the app folder. Must be inside the folder. A path into `node_modules` is allowed |
| `run.defaultPort` | No | The first choice for the proxy port. See [Ports](/claude-code-hub/extensibility/reference/apps-entry/#ports) |
| `loading.verbs` | No | Lines for the hub's loading screen while the app loads |
| `publishes` | No | The topics the app publishes. See [Topics](/claude-code-hub/extensibility/reference/connect/#topics) |
| `actions.handles` | No | The actions the app handles. See [Actions](#actions) |
| `provides` | No | The capabilities the app provides. See [Capabilities](#capabilities) |
| `keys.keeps` | No | The combos the app uses for its own commands. See [Kept keys](#kept-keys) |
| `plugin` | No | The Claude Code plugin the app ships. See [Plugin](#plugin) |
| `requires` | No | The lowest hub and Node versions, and the apps that must be on. See [Requires](#requires) |
| `listing` | No | What the Extensions page shows. See [Listing](#listing) |
| `settings` | No | The user settings the hub shows and stores for the app. See [Settings](#settings) |

## Actions

Each key of `actions.handles` is an action name, `<noun>.<verb or view>` in lowercase, for example `session.cost`. Use your app id as the prefix for an action that only your app has.

| Field | Meaning |
| --- | --- |
| `params` | Param names and types. `string` is required, `string?` is optional |
| `url` | A path and query on the app's origin, with `{name}` for each param, for example `?session={session}`. No `#` |
| `mode` | `url` (default): the hub loads the URL. `message`: the hub sends the action to the live page, and loads the URL only when the page is not live |

With `mode: "message"`, the app must call `hub.handle(name, fn)` for the action. See [Handle an action](/claude-code-hub/extensibility/reference/connect/#handle-an-action).

## Capabilities

A capability is a job that one app does for the hub. For each capability, the first enabled app in tab order that declares it is the provider.

| Capability | Field | The provider's route answers | The hub uses it for |
| --- | --- | --- | --- |
| `projects` | `path` | `[{path, modifiedAt}]` | The project list in the project palette (<kbd>Ctrl+Alt+P</kbd>) |
| `terminal` | `liveWork` | `{sessions: [...]}` | Keeping a set of apps alive while it has open terminals. The provider also gets the terminal env and token |

Each field is a path on the provider's own origin that starts with `/`. With no provider, the capability is off: no terminal, and the palette has no project list.

## Kept keys

`keys.keeps` lists the combos that your app keeps for itself, by combo name: the modifiers in the order `ctrl`, `alt`, `shift`, `meta`, joined by `+`, then the key, for example `ctrl+alt+n`. The key is a lowercase letter, a digit from 1 to 9, or a key name such as `ArrowLeft`. Each combo needs one modifier at least. See [Keys](/claude-code-hub/reference/protocol/#8-keys) for the full rule.

```json
"keys": { "keeps": ["ctrl+alt+n", "ctrl+alt+r", "ctrl+alt+s"] }
```

The hub does not bind a kept combo. Kanban keeps <kbd>Ctrl+Alt+N</kbd>, <kbd>Ctrl+Alt+R</kbd> and <kbd>Ctrl+Alt+S</kbd>.

## Plugin

`plugin` names the Claude Code plugin that your app ships, so the hub can install it and the app launcher (<kbd>Ctrl+Alt+A</kbd>) can show its state in the active config dir:

```json
"plugin": {
  "marketplace": "plugin",
  "name": "claude-code-kanban",
  "install": "claude-code-kanban --install --yes"
}
```

| Field | Meaning |
| --- | --- |
| `marketplace` | The marketplace folder, relative to the app folder. It holds `.claude-plugin/marketplace.json` |
| `name` | The plugin's name in `marketplace.json`. The plugin id is `<name>@<marketplace name>`, and the hub reads the version from the plugin's `source` folder |
| `install` | Optional. The command that installs the plugin, when your app needs more than the claude CLI's marketplace and plugin install. The hub gives it the config dir in `CLAUDE_CONFIG_DIR`, except for `~/.claude`, where the variable stays unset. A command that starts with a `bin` of your `package.json` runs that bin through Node, so it works when your app comes with the hub and is not on `PATH` |

`claude-code-hub ext install <id>` installs the plugin in a config dir (`--dir`, else `CLAUDE_CONFIG_DIR`, else `~/.claude`). With no `install`, it registers the marketplace folder and installs the plugin with the claude CLI.

The launcher shows the installed version. When the plugin is not installed, is disabled, or is not the version the app ships, it shows a ⚠, and a click copies the `ext install` command for the active config dir.

## Requires

`requires` states what an [extension](/claude-code-hub/extensibility/extensions/) needs:

```json
"requires": { "hub": "1.12.0", "node": "22.13.0", "apps": ["kanban"] }
```

| Field | Meaning |
| --- | --- |
| `hub` | The lowest hub version, `x.y.z` |
| `node` | The lowest Node version, `x.y.z` |
| `apps` | The ids of the apps that must be enabled in the hub |

`ext install` and `ext update` stop when the hub or Node is older, or when an app in `apps` is off.

## Listing

`listing` is what the [Extensions](/claude-code-hub/extensions/) page shows for an extension. The hub does not use it. Every text field is plain text.

```json
"listing": {
  "tagline": "One Claude Code session, turn by turn",
  "description": "Reads a session transcript and shows each prompt, its tool calls and their token use.",
  "tags": ["sessions", "debugging"],
  "screenshots": [
    {
      "url": "https://example.com/shots/turns.webp",
      "alt": "The turns of one session",
      "title": "Turns",
      "caption": "Each prompt, its tool calls and their token use."
    }
  ],
  "author": "NikiforovAll",
  "homepage": "https://nikiforovall.blog/claude-code-hub/inspector/",
  "license": "MIT"
}
```

| Field | Rule |
| --- | --- |
| `tagline` | 80 characters or fewer. The Extensions page needs it |
| `description` | 500 characters or fewer |
| `tags` | Up to 5. Lowercase letters, digits and `-` |
| `screenshots` | Up to 4. Each has `alt` and one of `path` (a file in the extension folder) or `url` (an `https://` link). PNG, JPEG or WebP. Optional: `title` (40 characters or fewer) and `caption` (200 or fewer), which the Extensions page shows under the image |
| `author` | 60 characters or fewer |
| `homepage` | An `https://` URL |
| `license` | An SPDX id, for example `MIT` |

Text fields must not contain `<` or `>`.

## Settings

`settings` lists the user settings of your app. The hub shows them in its settings modal (<kbd>Ctrl+,</kbd>), under the app's name, and stores the values in `~/.claude-hub/config.json`. The page reads them with `hub.settings` and `hub.onSettings` ([SDK](/claude-code-hub/extensibility/reference/sdk/#settings)). A change applies at once.

```json
"settings": [
  { "key": "zenCentered", "type": "boolean", "label": "Center zen mode", "help": "Centers the session in the sidebar.", "default": false },
  { "key": "density", "type": "choice", "label": "Density", "options": [{ "value": "cozy", "label": "Cozy" }, { "value": "compact", "label": "Compact" }], "default": "cozy" }
]
```

| Field | Rule |
| --- | --- |
| `key` | Letters and digits, starting with a letter, 32 characters or fewer. Unique in the list |
| `type` | `boolean` or `choice` |
| `label` | 60 characters or fewer |
| `help` | Optional. 200 characters or fewer |
| `options` | For `choice`: 2 to 6 of `{value, label}`, a non-empty string and 30 characters or fewer. No two with the same value |
| `default` | A boolean for `boolean`, one of the option values for `choice` |

Up to 20 settings. Text fields must not contain `<` or `>`. A value is the same in every config dir. When the app runs alone, it uses its own defaults.

## Validation

The hub skips the app, with a log line, when:

| Log reason | Cause |
| --- | --- |
| `not found` | No `hub-app.json` in the folder |
| `unknown manifest version ...` | `manifest` is not `1` |
| `id ... does not match ...` | `id` breaks the id rule |
| `id "<a>" is not "<b>"` | `id` is not the id of the `apps` entry |
| `run.entry is missing` | No `run.entry` |
| `run.entry is outside the app directory` | `run.entry` points outside the folder, or at the folder itself |
| `provides.<cap>.<key> is not a path` | A capability path does not start with `/` |
| `publishes topic ... does not match ...` | A topic breaks the topic rule |
| `publishes topic "<t>" is the hub's` | `project.changed`, `theme.changed` or a `hub.*` topic |
| `keys is not an object` | `keys` is an array or a value |
| `keys.keeps is not an array` | `keys.keeps` is not a list |
| `keys.keeps combo ... is not a combo name` | A kept combo breaks the [combo rule](#kept-keys) |
| `plugin is not an object` | `plugin` is an array or a value |
| `plugin.marketplace is not a path` | `plugin.marketplace` is missing or not a string |
| `plugin.marketplace is outside the app directory` | `plugin.marketplace` points outside the folder |
| `plugin.name is not a plugin name` | `plugin.name` is missing or has characters other than letters, digits, `_`, `.` and `-` |
| `plugin.install is not a command` | `plugin.install` is empty or not a string |
| `.../marketplace.json does not list plugin "<name>"` | No plugin in `marketplace.json` has that `name`. Other `marketplace.json` lines: the file is missing, its `name` is not valid, or the plugin's `source` is not a folder inside the app folder |
| `requires is not an object` | `requires` is an array or a value |
| `requires.<hub or node> is not a version x.y.z` | A version is not three numbers |
| `requires.apps is not a list of app ids` | `requires.apps` is not a list, or an item breaks the id rule |
| `listing is not an object` | `listing` is an array or a value |
| `listing.<field> is not plain text of <n> characters or fewer` | `tagline`, `description`, `author`, or a screenshot's `title` or `caption`, is empty, too long, not a string, or has `<` or `>` |
| `listing.tags is not a list of up to 5 lowercase tags` | `tags` breaks the tag rule |
| `listing.screenshots ...` | A screenshot has no `alt`, has both or neither of `path` and `url`, is not PNG, JPEG or WebP, has a `url` that is not `https://`, or a `path` outside the folder. Or there are more than 4 |
| `listing.homepage is not an https URL` | `homepage` does not start with `https://` |
| `listing.license is not an SPDX id` | `license` has characters other than letters, digits, `.`, `+` and `-` |
| `settings is not a list of up to 20` | `settings` is not a list, or it has more than 20 entries |
| `settings ...` | An entry breaks a [settings rule](#settings), or two entries share a key |

The hub skips one action, and keeps the app, when the name starts with `hub.`, `url` has a `#` or is not a string, `mode` is not `url` or `message`, or a param type is not `string` or `string?`.

## Built-in manifests

For the ids, ports, topics, actions and capabilities of the four built-in tools, see [The built-in tools](/claude-code-hub/extensibility/reference/built-in/).
