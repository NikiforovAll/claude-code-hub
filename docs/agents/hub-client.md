# Hub client, launcher, settings and keymap

`public/app.js` fetches config, creates one iframe per app, and switches visibility on tab change. No visible chrome: switching is keyboard-only.

## Palettes

`Ctrl+Alt+P` opens the project palette, `Ctrl+Alt+W` the config-dir palette (same widget, typing a path adds a new dir).

## App launcher (`Ctrl+Alt+A`)

- Each row and the footer show the app's or the hub's version and plugin from `GET /api/apps/stats`. An app names its plugin in `plugin` of `hub-app.json`, and `lib/plugin-status.js` checks it in the active config dir: a ⚠ for missing, disabled or not the shipped version.
- The cursor starts on the previous tab. Each row shows the app's host and port; `Ctrl+C` with no text selected in the input copies its URL.
- `Ctrl+R` restarts the selected app's process through `POST /api/apps/:id/restart`, which answers 409 for the terminal provider while it has live terminals unless the body has `force: true`.
- `Ctrl+S` toggles Start/Stop through `POST /api/apps/:id/stop` and `/start` (the same handler as restart), with the same 409. A stopped app is in `pool.stopped`, gets `stopped: true` in the stats, is not restarted on exit, and its port serves a page that does not reload, as does the page of an app that gave up.
- The icons are a small Lucide set in `APP_ICONS`; any other manifest icon shows the app's first letter.

## Settings (`Ctrl+,`)

The hub settings modal (`#settings`, `renderSettings`; `GET/POST /api/settings`, `lib/settings.js`) saves each change at once: `configDirSwitch` applies at once and `poolSize` (`--pool-size` overrides it) at the next switch to a dir with no running set; the per-app state (`enabled`/`hidden`, `deferredStart`) is written to the `apps` list and needs a hub restart, which `restartNeeded` reports. The POST writes from the file's copy on disk, and a new `apps` entry lists every app so the tab order stays.

## Shortcuts and user keymap

A new hub shortcut goes in `hubActions()` (`public/app.js`, `{id, combo, run, inPalette}`; `bindings()` turns it into the combo → binding map, cached until `setApps`) and in `HUB_ACTIONS` in `lib/keymap.js`, and needs no submodule change. Add a row to `test/fixtures/key-matrix.json` with each key change.

`keys` in `config.json` (`{actionId: combo | null}`, `hub.appByNumber` as `<mods>+{n}`) overrides the defaults. `userKeys()` in `lib/keymap.js` checks it at startup and logs and drops an entry that is not valid, repeats another entry's combo or takes a combo in an app's `keys.keeps`; `/api/config` carries the rest as `keys`. In `bindings()`, a user combo takes that combo from the action that had it by default, and `null` unbinds.

An app lists the combos it uses for itself in `keys.keeps` of its `hub-app.json`; the hub must not bind them. cck keeps 18, for example `Ctrl+Alt+N` New session and `Ctrl+Alt+1`…`9`; read `cck/hub-app.json` for the full list before you pick a combo.

**Known gap (macOS, accepted).** On macOS `hub.appByNumber` defaults to `ctrl+alt+{n}` (Option+digit types a character there), which overlaps cck's kept `ctrl+alt+1`…`9`. `userKeys()` checks `keys.keeps` against user combos only, not the defaults, so under the hub on macOS the hub takes those keys and cck's "Go to tab N" does not fire. Leave it as is unless asked.

## Testing gotcha

`public/sw.js` fetches every `/api/*` request itself, so a Playwright `page.route` mock of an `/api/*` route needs `serviceWorkers: 'block'`.
