# Change the hub keys

The hub's own keys (switch tools, open the palettes) live in the `keys` block of `<hub-dir>/config.json` (`--hub-dir`, else `CLAUDE_HUB_DIR`, else `~/.claude-hub`). Each tool's own keys are outside it. Page: `reference/shortcuts/#change-the-keys`.

## Steps

1. Map each key the user asks for to an action in [Actions](#actions), and check its combo against [Rules](#rules). When a combo breaks a rule, tell the user why and offer one that passes.
2. Read `config.json` and merge the entries into its `keys` block. Every other field stays byte for byte: the hub owns `configDirs`, `activeConfigDir` and `apps`.
3. Restart the hub: it reads `keys` once, at startup. When the tray runs it, the user picks Quit in the tray menu and starts the hub again.
4. Read the startup output, or `<hub-dir>/hub.log` when the tray started the hub. The hub logs each entry it drops as `<config.json path>: keys "<action>": … It keeps its default`. The reason is one of: not a combo, not a combo that ends in `+{n}`, `<combo> is kept by <app>`, `<combo> is already set for "<action>"`. An id that is not an action logs `keys "<id>" is not a hub action, ignored`.
5. Read `GET http://localhost:<port>/api/config?token=<token>` (the token is in `<hub-dir>/token`).

Done when the `keys` of `/api/config` holds every entry the user asked for, `null` ones too, and the startup output has no `config.json: keys` line. Then tell the user where to see it: each tool's help (`?`) shows the new hub keys and hides a hub row with no key, and the app launcher shows the tool-number keys.

To go back to the defaults, remove the `keys` block and restart.

## Example

```json
"keys": {
  "hub.projectPicker": "ctrl+alt+o",
  "hub.nextApp": "ctrl+alt+l",
  "hub.prevApp": "ctrl+alt+h",
  "hub.appByNumber": "ctrl+shift+{n}",
  "hub.configDirPicker": null
}
```

Ctrl+Alt+O opens the project palette, Ctrl+Alt+H and Ctrl+Alt+L move between tools, Ctrl+Shift+1 … 9 jumps to a tool by number, and the config-dir palette has no key. The app launcher keeps Ctrl+Alt+A.

## Actions

| Action | Default | Default on macOS |
| --- | --- | --- |
| `hub.projectPicker` | `ctrl+alt+p` | `ctrl+alt+p` |
| `hub.configDirPicker` | `ctrl+alt+w` | `ctrl+alt+w` |
| `hub.appLauncher` | `ctrl+alt+a` | `ctrl+alt+a` |
| `hub.prevApp` | `ctrl+alt+ArrowLeft` | `ctrl+alt+ArrowLeft` |
| `hub.nextApp` | `ctrl+alt+ArrowRight` | `ctrl+alt+ArrowRight` |
| `hub.appByNumber` | `alt+{n}` | `ctrl+alt+{n}` |

## Rules

- **Form.** One or more of `ctrl`, `alt`, `shift`, `meta`, then one key, joined by `+`. The key is a letter, a digit 1 to 9, or a `KeyboardEvent.key` name (`ArrowUp`, `F2`, `PageDown`). On macOS `alt` is Option and `meta` is Command. Modifiers and letters take any case and order (`"Alt+Ctrl+O"` reads as `ctrl+alt+o`); a key name keeps its case (`PageDown`).
- **`{n}`.** `hub.appByNumber` ends in `+{n}`, and the hub binds it for 1 to 9. It is the only action with `{n}`.
- **`null`** leaves the action with no key.
- **Taking a default.** A combo that is another action's default moves to the new action, and the other action has no key until it gets one: `"hub.nextApp": "ctrl+alt+a"` leaves the app launcher with no key. Say so to the user.
- **Kept keys.** An app keeps the combos in `keys.keeps` of its `hub-app.json`, and the hub refuses them. Kanban keeps `ctrl+alt+n`, `ctrl+alt+r` and `ctrl+alt+s`.
- **Tool keys.** A combo the hub binds never reaches the tool. Plain `ctrl+<key>` and `alt+<key>` combos belong to the tools and Claude Code's terminal (`ctrl+r`, `ctrl+c`, `alt+[`), so give the hub `ctrl+alt` or `ctrl+shift` combos.
- **AltGr.** On a layout with AltGr (Polish, German), a `ctrl+alt` letter that types a character stays text, and that hub key does nothing. Offer another letter or a `ctrl+shift` combo.
