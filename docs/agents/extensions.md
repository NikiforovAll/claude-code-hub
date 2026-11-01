# Hub plugin, --install and extensions

`plugin/` is a Claude Code marketplace with one plugin, `claude-code-hub`, which holds the `hub-builder` skill. `--install` (`lib/install.js`) copies it to `<hub-dir>/plugin` and registers that copy in one config dir per run: `--dir`, else `CLAUDE_CONFIG_DIR`, else `~/.claude`. Any change under `plugin/` bumps the version in `plugin/plugins/claude-code-hub/.claude-plugin/plugin.json`, because `claude plugin update` only loads a new version. Test an install with scratch `--dir` and `--hub-dir`. The hub never installs or updates a plugin on its own: after a hub update the user runs `--install` again.

`--install` also installs the plugins of the enabled built-in apps (`installBuiltInPlugins` in `lib/ext.js`, today Kanban's) through `ext install <id>`, which the launcher's ⚠ copies.

## `ext install`

- `ext install <dir>` links an extension and installs its plugin.
- `ext install github:<owner>/<repo>[/<folder>][@<ref>]` clones one into `<hub-dir>/extensions/<id>` (a partial sparse clone with `npm install --ignore-scripts`) and installs its plugin. The tests use a local repo as `githubBase`.
- With an id the hub runs, it installs only the plugin.
- Any other id-shaped name that is not a folder is looked up in the site's `extensions.json` (`CLAUDE_HUB_REGISTRY` overrides it, `ctx.registry` can be a file), and `ext` installs the `github:` source it lists, which the entry keeps.
- `ext` runs a manifest's own `install` command, with an app `bin` run through node because it is not on PATH under the hub.

## Kinds (`KINDS` in `lib/ext.js`)

- **Add-on.** A folder with an `addon.json` is a Kanban dock add-on. Its entry goes in `addons` of `config.json`, not `apps`, because the hub runs every app. In place of the plugin step, `ext` runs Kanban's `addon add --manifest <dir> --offline` (or `addon rm --key <id> --offline`) in the config dir.
- **Feature.** A `feature.json` (`readFeature`/`setFeature`) is code the hub ships: install checks `requires` (OS, apps, tools through `TOOL_CHECKS`) and merges `config` into `config.json`; `ext remove` sets `enabled: false`. Example: `features/voice/feature.json`.
