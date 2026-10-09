---
title: Pick a project
description: Use the project palette to set one project for all four tools, or type a path to a project that is not in the list.
---

Press <kbd>Ctrl+Alt+P</kbd> to open the project palette. The project you pick goes to every tool: Kanban filters its sessions, Marketplace shows that project's plugins, Cost shows its spend, and Memory Diagnoser loads its memory files.

## Find a project

The palette lists the projects that Claude Code has sessions for in the active config dir, with the most recently used project at the top. Each row shows the folder name, the parent path, and how long ago you last used it.

A git repo and its linked worktrees share one row. When you pick it, the tools get the repo with its worktrees, so Cost, for example, counts the spend of all of them together.

Type to filter. The palette ranks the matches in this order:

1. The folder name is the text you typed.
2. The folder name starts with it.
3. A word in the folder name starts with it, for example `api` in `billing-api`.
4. The folder name contains it.
5. A folder in the parent path is the text you typed.
6. The parent path contains it.
7. The name of one of the repo's worktrees contains it.

If nothing matches, the palette tries the letters in order with gaps, so `cch` finds `claude-code-hub`.

| Key | Action |
| --- | --- |
| <kbd>↓</kbd> or <kbd>Tab</kbd> | Next row |
| <kbd>↑</kbd> or <kbd>Shift+Tab</kbd> | Previous row |
| <kbd>Enter</kbd> | Pick the selected project |
| <kbd>Esc</kbd> or <kbd>Ctrl+Alt+P</kbd> | Close the palette |

## Use a path that is not in the list

Type a full path, for example `~/dev/new-app` or `C:\dev\new-app`. The palette adds a **Use literal path** row. Pick it, and the hub checks that the folder exists before it sends the path to the tools.

## What the tools do with the project

Each tool treats the project as its own project choice, as if you picked it inside the tool. You can still pick a different project inside one tool. The next project you pick in the palette replaces it.

The hub does not save the project. When you reload the hub page or switch the [config dir](/claude-code-hub/guides/config-dirs/), the tools start with no project from the hub.
