---
title: Patch a tool
description: Change a few lines of a published tool with patch-package, in a small wrapper project that the hub runs.
---

A patch changes the files of the published npm package after `npm install`. You keep a small wrapper project with the package, your patch and a manifest. The hub runs the tool from the wrapper, in place of the original or next to it.

The steps below use Kanban (`claude-code-kanban`). The same steps work for the other tools. For a complete example with all the files and screenshots, see [Compact session rows](/claude-code-hub/extensibility/examples/compact-rows/).

## 1. Make the wrapper

Make a folder with this `package.json`. The folder can be anywhere, for example in your projects folder or in a git repository of its own:

```json
{
  "name": "kanban-patched",
  "private": true,
  "scripts": { "postinstall": "patch-package" },
  "dependencies": { "claude-code-kanban": "4.31.1" },
  "devDependencies": { "patch-package": "8.0.1" }
}
```

Use the exact version that your hub runs. A patch applies to one version only.

Run `npm install`.

## 2. Change the package and save the patch

Edit the files in `node_modules/claude-code-kanban` directly. The page files are in `public/`, for example `public/app.js` and `public/style.css`. You can use the functions and the theme variables that the tool already has.

To see the change, run the hub with the wrapper (steps 3 and 4), then reload the page after each edit.

Then save the change as a patch:

```bash
npx patch-package claude-code-kanban
```

This writes `patches/claude-code-kanban+4.31.1.patch`. Each `npm install` applies it again. To check, delete `node_modules`, run `npm install` again, and look for `claude-code-kanban@4.31.1 ✔` in the output.

## 3. Add a manifest

The hub reads the tool's name, entry and capabilities from `hub-app.json`. The npm package does not include this file, so the wrapper must have its own. Put this `hub-app.json` in the wrapper folder:

```json
{
  "manifest": 1,
  "id": "kanban-patched",
  "name": "Kanban (patched)",
  "icon": "columns",
  "run": { "entry": "node_modules/claude-code-kanban/server.js", "defaultPort": 4546 },
  "publishes": ["session.changed"],
  "provides": {
    "projects": { "path": "/api/projects" },
    "terminal": { "liveWork": "/api/terminals" }
  }
}
```

Start from the original tool's manifest and change `id`, `name` and `run.entry`. `run.entry` must be inside the wrapper folder. A path into `node_modules` is correct. See [The built-in tools](/claude-code-hub/extensibility/reference/built-in/) for what each built-in manifest declares.

## 4. Add it to the hub

Add the wrapper to the `apps` list in `config.json`, and turn the original Kanban off:

```json
{
  "apps": [
    { "id": "kanban-patched", "path": "C:/dev/kanban-patched" },
    { "id": "kanban", "enabled": false }
  ]
}
```

Set `path` to your wrapper folder.

Restart the hub. The patched Kanban is the first tab (<kbd>Alt+1</kbd>), and it has the embedded terminal and the project list. If you keep the original Kanban on, see [One tool per capability](/claude-code-hub/extensibility/overview/#one-tool-per-capability).

## Things to know

- **Old files after a change.** Kanban uses a service worker. The first load after you change the patch can show the old files. Reload the page.
- **Upgrades.** When you change the version in `package.json`, the patch can stop applying. `patch-package` then prints an error, but `npm install` still succeeds unless you add `--error-on-fail` to the `postinstall` script. Make the change again on the new version and save a new patch.
- **Size.** A larger patch costs more on each upgrade. When a patch gets large, or when it changes many parts of the tool, think about a [fork](/claude-code-hub/extensibility/fork/).
