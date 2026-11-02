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
- **Mod.** A `mod.json` (`lib/mods.js`) adds CSS and JS to the hub page and the apps, and can bring color themes. Its entry goes in `mods` of `config.json`. Bundled mods live in `extensions/` (`BUNDLED`), and `ext install <id>` finds them before the registry. See [Mods](#mods).

## Mods

- **Themes.** `lib/themes.js` `modThemes` takes a mod's themes once at start and skips, with a log line, one whose id a built-in or an earlier mod's theme has. So a mod never replaces a theme, and the user's `themes.json` still tunes the built-ins.
- **Targets.** `targets.<hub|app id>` lists `css` and `js` files and a `surface`, an integer: the version of that target's `mod-surface.json` (the hub's at the repo root, each app's in its root) the files are written for. `resolveMods` drops a target whose app is off without a word, and logs and drops one whose surface differs or is missing. Bump a surface number only when a name in it is renamed or removed.
- **Loading.** The hub passes each app `HUB_MODS` = `{assets, files}` from `lib/mods.js` `appModEnv`, the only place that builds mod URLs; the SDK's `mount()` serves `files` as given and the client loads `assets` (`packages/claude-hub-sdk/src/mods.js`, see `docs/agents/sdk.md`). Only the app's tab loads them, not a page nested inside it (cck's terminal, a pane), so `?nomods` on the tabs covers every page with mods. The hub page gets `/mods/hub.css` and `/mods/hub.js`, and leaves both tags out when no mod has hub files or under `?nomods`.
- **Consent.** Mod JS runs in the page's origin with the page's rights. `ext install` asks a typed y/N for a mod with JS, and `ext update` asks again when the JS hash (`modJsHash`) changes; no answer keeps the old commit. With no terminal it fails unless `--yes`. A CSS-only mod never asks. A page with mod JS gets `connect-src 'self'` as a meta CSP: it blocks fetch, XHR, WebSocket and beacons to other hosts, not image loads or navigation.
- **Off switches.** `enabled: false` on a `mods` entry, `modsEnabled: false` in `config.json` or `--no-mods` (all at startup), and `/?nomods` for one page load: the hub page drops its mod CSS and adds `nomods=1` to each app frame.
- **Lint.** `test/mods.test.js` checks each bundled mod against the surfaces: `data-hub-part` names, `wrap`/`on`/`send` names, CSS vars (`--<id>-*` or the SDK's `coreVars`) and classes (`<id>-` prefix or a listed state).
- **Performance budget.** A mod adds no work to a hot path it does not wrap. A wrap of a render must keep the render's output stable for the same input. Animation runs on the compositor or at 30 fps at most, stops while the page is hidden and respects `prefers-reduced-motion`. `mod.send` posts only on a change.
