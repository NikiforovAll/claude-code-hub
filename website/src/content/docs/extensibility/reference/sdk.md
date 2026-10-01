---
title: The SDK
description: The page API of the hub SDK, ClaudeHub.connect() and every function of the object it returns, with and without the hub.
---

The hub SDK is one script that the app page loads. Under the hub, the hub serves its own copy, so the app always runs the hub's version. When the app runs alone, it serves a stub with the same API that does nothing.

## Set up

1. **Ship the stub.** Copy `packages/claude-hub-sdk/src/stub.js` from the [hub repository](https://github.com/NikiforovAll/claude-code-hub/tree/master/packages/claude-hub-sdk/src) to `public/vendor/claude-hub-sdk.js` in your app. In a clone of the hub, `npm run sdk:sync -- <app folder>` does this.
2. **Mount the server SDK.** See [What the app server must do](/claude-code-hub/extensibility/reference/apps-entry/#what-the-app-server-must-do). Under the hub, `mount()` serves the real client at the same URL, in place of the stub.
3. **Load it first.** Make it the first element in `<body>`, as a classic script, with no `defer` or `async`. The SDK paints the cached theme before the first paint.

   ```html
   <body>
     <script src="/vendor/claude-hub-sdk.js"></script>
   ```

4. **Connect.** In your page script:

   ```js
   const hub = ClaudeHub.connect();
   ```

## `ClaudeHub.connect(options?)`

Returns the hub object. A second call returns the same object.

| Option | Meaning |
| --- | --- |
| `standalone` | An object, or a function that returns one, that maps an action name to `(params) => url`. When the app runs alone, `invoke` opens that URL in a new tab, and `can` is true for that action. Use a function when the URLs are known only later |

## Status

| Member | Meaning |
| --- | --- |
| `status` | `connecting`, then `waiting` (hello sent), then `live` (welcome received). `standalone` when no hub frames the page. `unanswered` when the hub sent no welcome in 2 s |
| `inHub` | True once `/hub-config` says a hub frames the page, also when the hub does not answer |
| `onStatus(fn)` | Calls `fn(status)` on each change. Returns a function that removes `fn` |
| `onActive(fn)` | Calls `fn(active)` when the app's tab comes on screen or goes off. A hidden iframe cannot find this itself. Use it to pause polling |

## Events

| Member | Meaning |
| --- | --- |
| `subscribe(topic, fn)` | Calls `fn(payload)` for each event of the topic. Returns a function that removes `fn`. Subscribe before the page's `load` event: the SDK sends the topic list with hello, after `load`, and the hub sends nothing for a topic that is not in it |
| `publish(topic, payload)` | Publishes a topic that the manifest lists in `publishes`. `payload` is a plain object or `null`, at most 16 KB as JSON. Before welcome, the SDK keeps the last payload per topic and sends it on welcome |

See [Topics](/claude-code-hub/extensibility/reference/connect/#topics) for the hub's topics and [The built-in tools](/claude-code-hub/extensibility/reference/built-in/#topics) for the topics of the built-in tools.

## Actions

| Member | Meaning |
| --- | --- |
| `invoke(action, params?)` | Runs an action in the app that handles it. Resolves `{ok: true, handledBy}` or `{ok: false, reason}`, where `reason` is `unhandled` or `bad-params`. A call before welcome waits for it, up to 2 s |
| `can(action)` | True when an enabled app handles the action, or, alone, when `standalone` has it. Show a link or button for an action only when this is true |
| `handle(action, fn)` | Calls `fn(params, {id})` when the hub sends the action to this page. Needed for each action that the manifest declares with `mode: "message"` |

## Theme

| Member | Meaning |
| --- | --- |
| `bindTheme({get, set})` | Keeps the app's theme in step with the hub. `get()` returns `{theme, colorTheme}`, where `theme` is `light` or `dark`. `set({theme, colorTheme})` applies a theme from the hub. Returns `report()`: call it when the user changes the theme in the app. Call `bindTheme` right after `connect()` |
| `onThemes(fn)` | Calls `fn([{id, label}])` once with the hub's theme list, which includes the user's own themes, for the app's theme picker. The SDK adds `.theme-swatch-<id>` rules with `--sw-bg`, `--sw-accent`, `--sw-ink` and `--sw-border` first. Not called when the app runs alone |
| `themes` | The hub's theme list, after welcome |

Under the hub, the SDK writes the hub's color variables, such as `--accent` and `--bg-surface`, on `document.body`. Use them in your CSS. See [Core variables](/claude-code-hub/reference/protocol/#core-variables).

## Keys and window

| Member | Meaning |
| --- | --- |
| `forwards(e)` | True when the hub binds the key of this `keydown` event. The SDK forwards those keys from the document by itself. Ask this only in an element that takes keys before the document sees them, such as a terminal, and let those keys through |
| `closeGuard(on)` | While `on` is true, the hub asks before the window closes. Use it while a key such as <kbd>Ctrl+W</kbd> can mean something in the app |
| `openExternal(url)` | Opens an `http` or `https` URL in a new window. In the installed hub window, a framed page cannot open one itself |
| `terminalToken()` | Resolves a fresh terminal token, or `null` alone or after 3 s. The hub answers only the `terminal` provider |

## Alone

With the stub, `status` is `standalone`, `inHub` is false, `subscribe`, `publish`, `handle`, `bindTheme` and `closeGuard` do nothing, `forwards` is false, and `terminalToken` resolves `null`. `invoke` and `can` use the `standalone` option. `openExternal` opens a new tab.
