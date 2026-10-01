---
title: Fork a tool
description: Run your own copy of a tool's source in place of the built-in tool, or next to it.
---

A fork is your own copy of a tool's source. Use it when the change is too large for a [patch](/claude-code-hub/extensibility/patch/): a new page, a new server route, or changes in many parts of the tool. You keep the tool's server and its API, and change what you need.

The steps below use Kanban. The same steps work for the other tools. For a complete example with screenshots, see [Task board](/claude-code-hub/extensibility/examples/task-board/).

| Tool | Repository | Package |
| --- | --- | --- |
| Kanban | [claude-code-kanban](https://github.com/NikiforovAll/claude-code-kanban) | `claude-code-kanban` |
| Marketplace | [claude-code-marketplace](https://github.com/NikiforovAll/claude-code-marketplace) | `claude-code-marketplace` |
| Cost | [claude-code-cost](https://github.com/NikiforovAll/claude-code-cost) | `claude-code-cost` |
| Memory Diagnoser | [claude-code-memory](https://github.com/NikiforovAll/claude-code-memory) | `claude-code-memory-explorer` |

## 1. Clone the version your hub runs

Clone the repository and check out the tag of the version that your hub runs. Make a branch for your change:

```bash
git clone https://github.com/NikiforovAll/claude-code-kanban kanban-fork
cd kanban-fork
git checkout -b my-board v4.31.1
npm install
```

The hub does not run `npm install` for you. Run it again after each change to `package.json`.

Run `npm start` once to make sure that the tool works alone. A fork must work with no hub too.

## 2. Pick the id

Decide if the fork replaces the built-in tool or runs next to it:

| You want | `id` | The built-in tool |
| --- | --- | --- |
| The fork in place of the tool | The built-in id, for example `kanban` | Does not run |
| The fork and the tool, each in its own tab | A new id, for example `kanban-next` | Runs as before |

A fork next to the original is the safer start: the original keeps working, and you can compare the two.

## 3. Change the manifest

Edit `hub-app.json` in the fork. For a fork next to the original, change these fields:

```json
{
  "manifest": 1,
  "id": "kanban-next",
  "name": "Task Board",
  "icon": "layout-dashboard",
  "run": { "entry": "server.js", "defaultPort": 4545 }
}
```

- `id` is the id that you picked in step 2.
- `run.defaultPort` must be a port that no other tool uses. The port is the tool's origin in the browser, so the fork starts with empty `localStorage`.
- Keep `publishes`, `provides` and `actions` only for what the fork still does. See [What the built-in tool gives](#what-the-built-in-tool-gives).

See [The app manifest](/claude-code-hub/extensibility/reference/manifest/) for all the fields.

## 4. Change the code

Each tool is an Express server in `server.js` with a page in `public/`. There is no build step.

- **The page.** `public/index.html`, `public/app.js` and `public/style.css`. Kanban, Cost and Memory Diagnoser mark the parts of these files with `#region` comments, for example `rg "#region" public/app.js`.
- **The hub connection.** The `HUB_INTEGRATION` region in `public/app.js` connects to the hub with the [SDK](/claude-code-hub/extensibility/reference/sdk/). A new page loads `/vendor/claude-hub-sdk.js` as the first element in `<body>` and calls `ClaudeHub.connect()`.
- **The server API.** The page reads its data from the server, for example `GET /api/sessions` in Kanban. A new page can use the same routes.

Do not edit `public/vendor/claude-hub-sdk.js`. Under the hub, the hub serves its own SDK at that path. The file in the repository is used only when the tool runs alone.

## 5. Add it to the hub

Add the fork to the `apps` list in `config.json`. Put it first, so that it is the first tab (<kbd>Alt+1</kbd>):

```json
{
  "apps": [
    { "id": "kanban-next", "path": "C:/dev/kanban-fork" },
    { "id": "kanban" }
  ]
}
```

To replace Kanban, use `"id": "kanban"` in the entry and in `hub-app.json`, and remove the second entry.

Restart the hub. The startup log shows where the fork runs from, and each capability that two tools declare:

```text
kanban-next runs from C:\dev\kanban-fork
kanban and kanban-next both declare capability "terminal"; kanban-next has it. Disable one of them.
```

## 6. Work on the fork

- **A change in `public/`.** Reload the hub page.
- **A change in the server.** Restart the hub. The hub starts the tool once and does not watch its files.
- **Logs.** The hub prints the tool's output with the id in front, for example `[kanban-next]`.

## What the built-in tool gives

When the fork replaces a built-in tool, the hub and the other tools lose what the fork does not keep. Kanban gives:

| What | Manifest | Without it |
| --- | --- | --- |
| The project list | `provides.projects` | <kbd>Ctrl+Alt+P</kbd> has no projects |
| The embedded terminal | `provides.terminal` | No tool has a terminal |
| The open session | `publishes: ["session.changed"]` | An app that subscribes to `session.changed` gets nothing |

The other built-in tools handle actions: Cost handles `session.cost`, Marketplace handles `project.plugins`, and Memory Diagnoser handles `project.memory`. A fork that replaces one of them must handle the same action, or the buttons that call it in other tools go away. See [Connect to other tools](/claude-code-hub/extensibility/reference/connect/) and [The app manifest](/claude-code-hub/extensibility/reference/manifest/#built-in-manifests).

A fork next to the original can leave these to the original. Only the first tool in tab order gets a capability. See [One tool per capability](/claude-code-hub/extensibility/overview/#one-tool-per-capability).

## Things to know

- **Upgrades.** To get a new version of the tool, merge its tag into your branch, for example `git fetch --tags` and `git merge v4.32.0`. Keep your changes in new files where you can, so the merge has fewer conflicts.
- **The SDK.** Under the hub, the fork always runs the hub's SDK, not the copy in its `public/vendor`. See [The SDK](/claude-code-hub/extensibility/reference/sdk/).
- **A tool that does a different job.** When the fork keeps little of the original, [write a new app](/claude-code-hub/extensibility/new-app/).
