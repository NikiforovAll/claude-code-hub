# Hub client, launcher, settings and keymap

`public/app.js` fetches config, creates one iframe per app, and switches visibility on tab change. No visible chrome: switching is keyboard-only.

## Palettes

`Ctrl+Alt+P` opens the project palette, `Ctrl+Alt+W` the config-dir palette (same widget, typing a path adds a new dir).

## App launcher (`Ctrl+Alt+A`)

- Each row and the footer show the app's or the hub's version and plugin from `GET /api/apps/stats`. An app names its plugin in `plugin` of `hub-app.json`, and `lib/plugin-status.js` checks it in the active config dir: a ⚠ for missing, disabled or not the shipped version. A click on the ⚠ (not for disabled) opens update mode of the setup overlay.
- The cursor starts on the previous tab. Each row shows the app's host and port; `Ctrl+C` with no text selected in the input copies its URL.
- `Ctrl+R` restarts the selected app's process through `POST /api/apps/:id/restart`, which answers 409 for the terminal provider while it has live terminals unless the body has `force: true`.
- `Ctrl+S` toggles Start/Stop through `POST /api/apps/:id/stop` and `/start` (the same handler as restart), with the same 409. A stopped app is in `pool.stopped`, gets `stopped: true` in the stats, is not restarted on exit, and its port serves a page that does not reload, as does the page of an app that gave up.
- The icons are a small Lucide set in `APP_ICONS`; any other manifest icon shows the app's first letter.

## Settings (`Ctrl+,`)

The hub settings modal (`#settings`, `renderSettings`; `GET/POST /api/settings`, `lib/settings.js`) has a side nav of pages: General (config dirs, setup, updates), Apps, Keyboard, then one page per app that lists `settings` in its `hub-app.json`. `settingsModal.section` keeps the page across redraws; ↑/↓ in the nav moves between pages. A new hub setting goes on one of the hub pages; an app setting goes in the app's manifest, not here. The modal saves each change at once: `configDirSwitch` applies at once and `poolSize` (`--pool-size` overrides it) at the next switch to a dir with no running set; the per-app state (`enabled`/`hidden`, `deferredStart`) is written to the `apps` list and needs a hub restart, which `restartNeeded` reports. The POST writes from the file's copy on disk, and a new `apps` entry lists every app so the tab order stays.

## Setup checklist

The `#setup` overlay (`renderSetup`) opens on load while `onboarding` in `config.json` is unset and a step is not done, and from Settings → Setup checklist. `GET /api/setup` (`lib/onboarding.js`) reads every step from the machine on each call, so a step done by hand shows as done; only `POST /api/setup {onboarding: done | skipped}` is saved. With every step done on load, the page saves `done` and shows nothing.

- **Install as an app**: done when the page runs as `display-mode: standalone`. Chrome and Edge give a `beforeinstallprompt` event for the Install button; other browsers get text.
- **Start with the system**: Windows and macOS only. `POST /api/setup/tray` runs `--autostart` in a child hub process; `trayState` in `lib/tray.js` checks it.
- **Config dirs**: `findConfigDirs` lists `.claude*` folders in the home folder that have `settings.json` or `projects/` and that the hub does not list. Add uses `POST /api/config-dirs`.
- **Plugins**: the hub plugin and each enabled app's plugin, for each listed dir. `POST /api/setup/plugins {dir}` runs `--install` or `ext install <id>` in a child hub process until none is `missing` or `mismatch`. A `disabled` plugin is the user's choice and counts as done. Nothing installs without a click.

One setup job runs at a time (409 otherwise). The child process keeps the claude CLI's `execSync` calls off the hub's event loop.

### Update mode

`openUpdate()` opens the same overlay with `setupModal.mode = 'update'` and two steps: the hub package (from `GET /api/update`) and the plugins. The toast's **Review update…** and Settings → Updates open it. The hub row only shows `npm i -g claude-code-hub@latest` with a Copy button: on Windows npm cannot replace cck's loaded node-pty binary while the hub runs, so the user stops the hub first. `POST /api/setup/plugins {all: true}` runs each listed dir that has a pending plugin in turn; a failed dir does not stop the rest, and `results` gives `{dir, ok}` per dir. The modal lists the updated dirs and asks to restart their open sessions. Update mode saves nothing.

On load, `openUpdateAfterUpgrade` compares the hub version with `hub-last-version` in `localStorage`. When it changed and a plugin is not settled, it opens update mode once. It calls `GET /api/setup` only on that first load after an upgrade.

## Shortcuts and user keymap

A new hub shortcut goes in `hubActions()` (`public/app.js`, `{id, combo, run, inPalette}`; `bindings()` turns it into the combo → binding map, cached until `setApps`) and in `HUB_ACTIONS` in `lib/keymap.js`, and needs no submodule change. Add a row to `test/fixtures/key-matrix.json` with each key change.

`keys` in `config.json` (`{actionId: combo | null}`, `hub.appByNumber` as `<mods>+{n}`) overrides the defaults. `userKeys()` in `lib/keymap.js` checks it at startup and logs and drops an entry that is not valid, repeats another entry's combo or takes a combo in an app's `keys.keeps`; `/api/config` carries the rest as `keys`. In `bindings()`, a user combo takes that combo from the action that had it by default, and `null` unbinds.

The shortcuts window (`openShortcuts`, opened from the settings' **Keyboard** page) records a press with `comboOf` and saves the whole map through `POST /api/settings` `{keys}`; `applySettings` runs `userKeys()` on it and answers an error instead of dropping entries. On success `setUserKeys()` rebuilds the bindings and posts `hub:keys` to every live frame, so no restart is needed. It refuses combos an app keeps and turns off the other action that had the combo.

`comboOf` (SDK `keys.js`) names a press by the character on the key, US style. A Latin or digit `e.key` is used as typed; a non-ASCII `e.key` (Cyrillic, Greek, macOS Option) falls back to the US character of `e.code`; the digit row always reads as its digit (AZERTY `&` is `1`); AltGraph gets no fallback. cck stringifies `comboOf` into a sandboxed frame, so it must stay self-contained: no outer constants.

An app lists the combos it uses for itself in `keys.keeps` of its `hub-app.json`; the hub must not bind them. cck keeps 19, for example `Ctrl+Alt+N` New session and `Ctrl+Alt+1`…`9`; read `cck/hub-app.json` for the full list before you pick a combo.

**Known gap (macOS, accepted).** On macOS `hub.appByNumber` defaults to `ctrl+alt+{n}` (Option+digit types a character there), which overlaps cck's kept `ctrl+alt+1`…`9`. `userKeys()` checks `keys.keeps` against user combos only, not the defaults, so under the hub on macOS the hub takes those keys and cck's "Go to tab N" does not fire. Leave it as is unless asked.

## Testing gotcha

`public/sw.js` fetches every `/api/*` request itself, so a Playwright `page.route` mock of an `/api/*` route needs `serviceWorkers: 'block'`.
