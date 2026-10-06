---
title: Run the hub from the tray
description: On Windows and macOS, run the hub in the background with an icon in the notification area, and start it when you log on.
---

On Windows, the hub can run in the background with no terminal window. An icon in the notification area shows whether the hub runs, and its menu starts, stops and opens the hub. You can also make the hub start when you log on.

The tray is opt-in. Without the flags on this page, the hub runs as before: no icon, no registry entry, no copied files. The flags work on Windows and, as an experiment, on [macOS](#macos). On other systems they print an error and exit.

## Start the tray

```bash
claude-code-hub --tray
```

Run the tray from a [global install](/claude-code-hub/getting-started/#install-the-hub), so that an update and **Restart Hub** load the new version. See [Update the hub](#update-the-hub).

The command starts the tray and exits. The tray then starts the hub. If a hub already runs from the same hub folder, the tray uses that hub and does not start a second one.

To also start the tray when you log on:

```bash
claude-code-hub --autostart
```

`--hub-dir` and `--port` carry over to the tray. For example, `--tray --hub-dir ~/.claude-hub-work --port 4540` runs a tray for a [second hub](/claude-code-hub/reference/configuration/#run-a-second-hub). Each hub folder gets its own tray and its own autostart entry.

## Use the tray

Click the icon to open the hub, in the [installed app](#open-the-installed-app) or in the browser. Right-click it for the menu. Its first line shows the state of the hub, its port and the active config dir, for example `Running on port 3540 · .claude`.

| Item | Action |
| --- | --- |
| **Open Hub** | Open the hub in the installed app or the browser |
| **Start Hub** / **Stop Hub** | Start or stop the hub and its tools |
| **Restart Hub** | Stop the hub, then start it again |
| **Open log** | Open `hub.log`, the hub's output |
| **Start with Windows** | Turn autostart on or off |
| **Quit** | Stop the hub and close the tray |

The icon is the hub logo. In place of its bottom-right tile, a dot shows the state of the hub:

| Dot | State |
| --- | --- |
| Green | Running |
| Amber | Starting |
| Red | Stopped |

If the hub stops unexpectedly, the tray shows a notice and the dot turns red. The tray does not restart the hub. Use **Start Hub**, and see **Open log** for the cause.

## Open the installed app

If you installed the hub as an app from Chrome or Edge, **Open Hub** opens it in the app window. The tray finds the app through its shortcut in the Start Menu. Without an app, **Open Hub** opens a browser tab.

An app belongs to the address you installed it from, for example `localhost:3540`, and the shortcut does not record that address. So the tray looks up the app by its name, **Claude Code Hub**, only when the hub runs on the default port, 3540. On any other port, it opens a browser tab.

To choose the app yourself, for example for a second hub, give its id:

```bash
claude-code-hub --tray --hub-dir ~/.claude-hub-work --port 4540 --app-id <id>
```

With `--app-id`, the tray opens that app when the hub runs on the `--port` you gave. To find the id, right-click the app in the Start Menu, click **Open file location**, and open the properties of its shortcut. The **Target** box ends with `--app-id=<id>`. Use the app that you installed from the address of that hub.

## Check the state

```bash
claude-code-hub --tray-status
```

```
  Hub dir: C:\Users\me\.claude-hub
  Config dir: C:\Users\me\.claude
  Autostart: on (ClaudeCodeHub-8d096618)
  Tray: running (pid 37628)
  Hub: running on port 3540 (pid 19868)
```

- **Hub dir**: the hub folder.
- **Config dir**: the active [config dir](/claude-code-hub/guides/config-dirs/).
- **Autostart**: whether the tray starts when you log on, and the name of its registry entry.
- **Tray** and **Hub**: whether each one runs. The hub line also shows the port the hub uses.

Add `--hub-dir` to check the tray of another hub folder.

## Turn off autostart

Untick **Start with Windows** in the tray menu, or run:

```bash
claude-code-hub --no-autostart
```

This removes the registry entry only. A tray that runs keeps running until you click **Quit**.

## Update the hub

**Restart Hub** runs the hub's `server.js` again, so it loads the code at that path. Whether that path has the new version depends on how you installed the hub:

| Install | After an update |
| --- | --- |
| `npm i -g claude-code-hub` | Run `npm i -g claude-code-hub@latest`, then click **Restart Hub**. The update replaces the files at the same path. |
| `npx claude-code-hub` | Run `npx claude-code-hub@latest --tray`. Each npx version is in a different cache folder, so a restart keeps the old version. |
| A git checkout | Click **Restart Hub**. |

The tools restart with the hub, so they also load their new code.

The tray runs from a copy in the hub folder, and only `--tray` or `--autostart` updates that copy. To use a new version of the tray itself, click **Quit**, then run `--tray` again. If a tray already runs, the new one exits, and the old tray stays until you quit it or log on again.

If the hub files that the tray points to are gone, for example because npm cleared its cache, the tray starts the same hub version with `npx` and shows a notice.

## How it works

`--tray` and `--autostart` copy the tray to `tray/` in the hub folder, with a `config.json` that holds the port, the app to open, the hub version, and the paths of `node` and `server.js`. The tray starts from that copy, so it keeps working when the npx cache is cleared.

The tray is a PowerShell script that `wscript.exe` starts with no window. `--autostart` adds a value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, so it needs no admin rights.

When the hub listens, it writes `hub.json` with its process id and port, and it deletes the file when it stops. The tray reads this file to find the hub and open it on the right port, so the tray also works when the hub uses a fallback port. If you start the hub yourself while the tray runs it, for example with `claude-code-hub` and the same hub folder, the new hub prints the URL of the running one and exits.

**Stop Hub** asks the hub to stop through `POST /api/shutdown`, so the hub stops its tools first. If the hub does not stop in 15 seconds, the tray ends its processes.

## Files

The paths are for the default hub folder.

| File | Content |
| --- | --- |
| `~/.claude-hub/tray/` | The copy of the tray and its `config.json` |
| `~/.claude-hub/hub.json` | The process id and port of the running hub. The hub deletes it when it stops. |
| `~/.claude-hub/hub.log` | The hub's output when the tray starts it. At 5 MB, the tray moves it to `hub.log.1` on the next start. |
| `~/.claude-hub/tray.log` | When the tray starts and stops the hub |
| `~/.claude-hub/tray.pid` | The process id of the tray |

## macOS

On macOS, the tray is an experiment. It works like the Windows tray, with these differences:

- The icon is in the menu bar. Click it for the menu.
- The autostart item is **Open at Login**. It adds a launch agent in `~/Library/LaunchAgents`.
- The hub gets the `PATH` of the shell where you ran `--tray` or `--autostart`. Run it again after you change `PATH`.

If something does not work, see `tray.log` and `hub.log` in the hub folder.

## Limits

- The tray works only on Windows and macOS.
- If the hub falls back to a port other than the one of its app, **Open Hub** opens a browser tab, not the app.
- The tray uses about 100 MB of memory, because it runs in PowerShell.
- Some company machines block PowerShell scripts with a group policy. On those machines the tray does not start.
