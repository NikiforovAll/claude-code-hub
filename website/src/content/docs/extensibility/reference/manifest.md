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

The hub skips one action, and keeps the app, when the name starts with `hub.`, `url` has a `#` or is not a string, `mode` is not `url` or `message`, or a param type is not `string` or `string?`.

## Built-in manifests

For the ids, ports, topics, actions and capabilities of the four built-in tools, see [The built-in tools](/claude-code-hub/extensibility/reference/built-in/).
