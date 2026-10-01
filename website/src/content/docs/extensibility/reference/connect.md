---
title: Connect to other tools
description: How an app uses the built-in tools and lets them use it, through hub topics, actions and capabilities.
---

Apps do not talk to each other directly. Each app talks to the hub page through the [SDK](/claude-code-hub/extensibility/reference/sdk/), and the hub passes the message on. An app connects to other tools in three ways:

| Way | Direction | Example |
| --- | --- | --- |
| [Topics](#topics) | One app to many | Kanban tells every app which session is open |
| [Actions](#actions) | One app to the one app that handles it | Kanban asks Cost to show the cost of a session |
| [Capabilities](#capabilities) | One app to the hub | Kanban gives the hub the project list |

The connection is between pages only. v1 has no channel between app servers.

## Topics

A topic is a fact that any number of apps can receive. Each topic is sticky: the hub keeps its last value and sends it to an app when the app connects.

| Topic | From | Payload |
| --- | --- | --- |
| `project.changed` | Hub, when the user picks a project | `{project, encoded, name}`, or `null` when the user clears it |
| `theme.changed` | Hub | `{theme, colorTheme, vars?}`. Use `bindTheme` in place of a subscription |
| `session.changed` | Kanban | `{sessionId, project, encoded, projectName, name, gitBranch, live, source}`, or `null` when no session is open |

- `project` is an absolute path. `encoded` is the form that Claude Code uses for its folder names under `projects/`. Use it as it is; do not encode a path yourself.
- `session.changed`: `live` is true while the session works or waits for the user. `source` is `user` for a pick in Kanban, `cli` for `claude-code-kanban session open`. Kanban publishes it when a selection stays the same for 150 ms.
- The hub sends `project.changed` and `theme.changed` to every app at once. It sends an app topic only to the app on screen; a hidden app gets the last value of each topic it missed when it comes on screen.

### Receive a topic

```js
const hub = ClaudeHub.connect();

hub.subscribe('project.changed', (p) => showProject(p?.project ?? null));

hub.subscribe('session.changed', (s) => {
  if (!s) return clearSession();
  showSession(s.sessionId, s.projectName, s.gitBranch);
});
```

Subscribe at start, before the page's `load` event.

### Publish a topic

1. List the topic in the manifest: `"publishes": ["board.selected"]`. The name is `<noun>.<verb>` in lowercase, with your app id as the noun when no other app uses it.
2. Publish it:

   ```js
   hub.publish('board.selected', { sessionId, project });
   ```

The hub drops a topic that is not in the manifest, and does not send an event back to the app that published it. When the payload has a string `project`, the hub adds `encoded` and `projectName`. Keep the payload small: ids and names. The receiver fetches the rest.

## Actions

An action is a request that exactly one app handles. The caller names the action and does not know which app handles it. The hub switches to the handler's tab and hands it the call.

| Action | Handler | Params | Shows |
| --- | --- | --- | --- |
| `session.cost` | Cost | `session?`: a session id | The cost of that session |
| `project.plugins` | Marketplace | `project?`: an absolute path | The plugins of that project |
| `project.memory` | Memory Diagnoser | `project?`: an absolute path | The memory files of that project |

### Call an action

```js
if (hub.can('session.cost')) costButton.hidden = false;

costButton.onclick = async () => {
  const r = await hub.invoke('session.cost', { session: sessionId });
  if (!r.ok) console.warn('session.cost', r.reason);
};
```

Show the control only when `can` is true: the handler can be turned off. The result comes when the hub has routed the call, not when the handler has finished.

When the app runs alone, give `connect` a `standalone` map so the same call opens the other tool in a new tab:

```js
const hub = ClaudeHub.connect({
  standalone: { 'session.cost': (p) => p.session && `http://localhost:3543/?view=detail&session=${p.session}` },
});
```

### Handle an action

1. Declare it in the manifest:

   ```json
   "actions": {
     "handles": {
       "board.open": { "params": { "session": "string" }, "url": "?session={session}", "mode": "message" }
     }
   }
   ```

2. With `mode: "message"`, handle it in the page:

   ```js
   hub.handle('board.open', ({ session }) => openSession(session));
   ```

When the page is live, the hub sends the call to `handle`. When it is not, the hub loads the `url` with the params filled in, so the app must also read them from its query string. With `mode: "url"`, the hub loads the URL each time. When a param of the URL is missing, or the handler has `closeGuard` on, the hub only switches to the tab, because loading the URL reloads the app.

To take over a built-in action, declare the same name and put your app before the built-in tool, or turn the built-in tool off. The hub logs the conflict.

## Capabilities

A capability is a job for the hub that one app does. See [Capabilities](/claude-code-hub/extensibility/reference/manifest/#capabilities) for the fields.

- **`projects`.** The provider answers `GET <path>` with `[{path, modifiedAt}]`. The hub calls it for the project palette. Kanban provides it.
- **`terminal`.** The provider gets `CCK_TERMINAL` and `CCK_TERMINAL_TOKEN` in its environment, the token in its iframe URL as `#t=<token>`, and answers on `hub.terminalToken()`. It runs the terminal itself. Its `liveWork` route answers `{sessions: [...]}`, and the hub keeps the app's processes alive while the list is not empty. Kanban provides it.

An app that declares a capability takes it from Kanban only when it comes first in tab order or Kanban is off.

## Shortcuts

The SDK forwards the hub's keys from your page: <kbd>Ctrl+Alt+P</kbd>, <kbd>Ctrl+Alt+W</kbd>, <kbd>Ctrl+Alt+A</kbd>, <kbd>Ctrl+Alt+Left</kbd>, <kbd>Ctrl+Alt+Right</kbd> and <kbd>Alt+1</kbd> to <kbd>Alt+N</kbd>, one for each of the first nine tabs. Every other key stays in your app. Do not use the hub's keys for your own commands. See [Keyboard shortcuts](/claude-code-hub/reference/shortcuts/).
