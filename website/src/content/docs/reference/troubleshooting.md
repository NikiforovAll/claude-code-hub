---
title: Troubleshooting
description: Find the symptom, then apply the fix.
---

## The page shows a locked screen

The browser has no hub token cookie. Open the URL from the startup banner, the one with `?token=`. If you lost the banner, the token is in `~/.claude-hub/token`:

```text
http://localhost:3540/?token=<contents of ~/.claude-hub/token>
```

If you deleted the token file, the hub made a new token at its last start. Use the URL from that banner.

## The hub opened on a different port

The default port is 3540. If it is busy, the hub logs `port 3540 in use, trying random port...` and uses a free port. Read the banner for the real address. To fix the port, start with `--port <n>`.

An app you installed from the old port opens the old address. Start the hub on that port again, or install the app again from the new one.

## A tool shows an error or a blank page

The hub starts each tool again if it exits, up to 5 times in 60 seconds. After that it logs `[<tool>] gave up after 5 restarts in 60s`. Read the lines above it in the hub terminal, each prefixed with the tool name, for the cause. Then restart the hub.

## Kanban shows no live agent activity

The Kanban hooks are not installed in the active config dir. Run:

```bash
npx claude-code-kanban --install
```

For another config dir, set `CLAUDE_CONFIG_DIR` to that dir first. See [Use more than one config dir](/claude-code-hub/guides/config-dirs/#hooks-for-each-dir).

## A shortcut does nothing

- A palette is open. While it is open, the tool keys do nothing. Press <kbd>Esc</kbd>.
- The key also holds <kbd>Shift</kbd> or <kbd>Meta</kbd>. The tools send only the plain key to the hub.
- It is <kbd>Ctrl+Alt+N</kbd>, <kbd>Ctrl+Alt+R</kbd>, or <kbd>Ctrl+Alt+S</kbd>. Kanban keeps these keys.
- On your layout, <kbd>Ctrl+Alt</kbd> with that key types a character, for example `ą` on a Polish layout. See [AltGr layouts](/claude-code-hub/reference/shortcuts/).
- Another program on your system uses the key, for example a window manager or a keyboard tool.

## The project palette is empty

The palette gets the project list from Kanban. While Kanban starts, the list can be empty. Wait a few seconds and open the palette again. You can always type a path.

## The window asks before it closes

A Kanban terminal is attached. The prompt stops <kbd>Ctrl+W</kbd>, meant for the terminal, from closing the hub. Confirm to close, or end the terminal first. See [Embedded terminal](/claude-code-hub/guides/terminal/).

## Switching the config dir is slow

The first switch to a dir starts its four tools, which takes a few seconds. Later switches are instant while the set stays in the pool. To keep more sets running, raise `--pool-size`.

## 403 Forbidden when you use another host name

The hub and the tools answer only requests addressed to `localhost`. To use another host name, add it with `--allowed-hosts`. See [Security](/claude-code-hub/reference/security/#reach-the-hub-from-another-machine).
