# Extensions

An extension is a hub app that the hub does not ship: a folder with a `hub-app.json`, often with a Claude Code plugin. `ext install <dir>` makes it a *linked* extension: the hub runs it from that folder in place and copies nothing. Page: `extensibility/extensions/`.

`claude-code-hub ext` prints the commands and their options. In a clone of the hub, run `node server.js ext …` from the clone.

## Find

Fetch the registry index, `https://nikiforovall.blog/claude-code-hub/extensions.json`, and match the user's need against each entry's `tagline`, `description` and `tags`. Done when the user has the `page` link of every match, or knows the registry has none.

## Install

1. **Trust.** An extension runs as the user with no sandbox, and its plugin can run hooks in every Claude Code session. Tell the user that, name the repository and the plugin, and wait for a yes.
2. **Run** the entry's `install` commands in order. A failed check or plugin install leaves `config.json` as it was, so fix the cause (see Failures) and run the command again.
3. **Restart** the hub, then tell the user to start the app: `Ctrl+Alt+A`, select it, `Ctrl+S`. A linked extension does not start with the hub.

Done when `claude-code-hub ext list` shows the id with `local <folder>` and its plugin `ok`.

For an extension outside the registry, the user's own included: step 1, `npm install` in the folder when its `package.json` has dependencies, `claude-code-hub ext install <dir>`, step 3. `ext install` takes a local folder; clone a GitHub source first.

A linked extension lives in its folder: to move it, `ext remove <id>`, move the folder, `ext install` again.

## Develop

A linked extension is the dev loop: the hub runs the code where the user edits it.

| Changed | Then |
|---|---|
| App code | Restart the app: `Ctrl+Alt+A`, select it, `Ctrl+R` |
| Plugin | `claude-code-hub ext update <id>`, then a new Claude Code session. Claude Code runs a copy from its cache, and `update` reinstalls even at the same version |
| `hub-app.json` | Restart the hub |

The registry lists an extension whose manifest has `listing.tagline`. Page: `extensibility/reference/manifest/#listing`.

## Manage

- **Another config dir.** Claude Code loads plugins per config dir: `ext install <id> --dir <config dir>`. It works for a built-in tool too (`ext install kanban`), and is safe to run again.
- **Remove.** `ext remove <id>` removes the plugin, its marketplace and the `apps` entry, keeps the folder, and needs a hub restart.
- `ext update` and `ext remove` act on linked extensions only.

## Failures

- **⚠ on the app's row in the app launcher**, or a plugin state other than `ok` in `ext list` (`missing`, `disabled`, `mismatch`): a click on the ⚠ copies the `ext install <id>` command that fixes it.
- **`Cannot register the plugin: marketplace "<name>" is registered from <path>`**: another folder already uses that marketplace name. The line ends with a `claude plugin marketplace remove` command; ask the user before running it, because it removes that marketplace's plugins.
- **`it needs hub <x>` or `it needs Node <x>`**: upgrade the hub (`npm i -g claude-code-hub`) or Node. When it names an app that is off, turn that app on in the `apps` list of `config.json`.
- **`not built yet`**: the source is `github:`, `npm:` or a URL. Clone it and pass the folder.
- **The app is missing from the launcher after a restart**: the hub startup log names each skipped app and why.
