---
title: Use more than one config dir
description: Switch the hub between Claude config dirs, for example a work dir and a personal dir, and keep each set of tools running.
---

Claude Code keeps its settings, sessions, and plugins in a config dir: `~/.claude` by default, or the dir in `CLAUDE_CONFIG_DIR`. If you use more than one, for example one for work and one for personal projects, the hub can show the tools for each dir.

## Switch the config dir

Press <kbd>Ctrl+Alt+W</kbd> to open the config-dir palette. It lists the dirs you added, and the active dir has an **active** label.

When the palette opens, the dir above the active one is selected. So with two dirs, <kbd>Ctrl+Alt+W</kbd> then <kbd>Enter</kbd> switches between them.

| Key | Action |
| --- | --- |
| <kbd>↑</kbd>/<kbd>↓</kbd> or <kbd>Tab</kbd> | Move the selection |
| <kbd>Enter</kbd> | Switch to the selected dir |
| <kbd>Ctrl+D</kbd> | Remove the selected dir from the list |
| <kbd>Esc</kbd> or <kbd>Ctrl+Alt+W</kbd> | Close the palette |

When you switch, every tool reloads with the data of the new dir. The window title shows the name of the active dir, for example `.claude-work`. For the default dir, it shows Claude Code Hub.

## Add a dir

Type a path in the palette, for example `~/.claude-work`. An **Add config dir** row appears. Pick it, and the hub checks the folder, adds it to the list, and switches to it.

## Remove a dir

Select a dir and press <kbd>Ctrl+D</kbd>, or click **×** on its row. This removes the dir from the hub's list only. Nothing on disk changes. You cannot remove the active dir.

## Each dir has its own set of tools

Each tool reads its config dir once, when it starts. So the hub starts a separate set of the four tools for each dir.

When you switch away from a dir, the hub keeps its set running, so switching back is instant. `--pool-size` sets how many sets stay alive, 3 by default. When a new set would go over that number, the hub stops the set you used least recently. It does not stop a set whose Kanban has an open terminal.

The first switch to a dir takes a few seconds, while its tools start.

## The default dir

When the hub starts, it adds one dir to the list if it is not there already: the dir in `CLAUDE_CONFIG_DIR`, else `~/.claude`.

## Hooks for each dir

Kanban's hooks and status line are installed in one config dir. A dir without them shows tasks and sessions, but no live agent activity. To install them for a dir, run:

```bash
CLAUDE_CONFIG_DIR=~/.claude-work npx claude-code-kanban --install
```

## Where the list is saved

The list and the active dir are in `~/.claude-hub/config.json`. See [CLI and configuration](/claude-code-hub/reference/configuration/#the-config-file).
