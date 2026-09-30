# Custom themes

The hub is the theme source for every app in its tabs. It sends the colors of the current theme to each app, so a custom theme reaches all apps with no app change. Colors the apps own (`--success`, `--warning`, `--error`, chart colors, fonts) stay out of a theme.

## Where the file lives

`<hub-dir>/themes.json`, where the hub dir is `--hub-dir`, else `CLAUDE_HUB_DIR`, else `~/.claude-hub`. The file is a JSON array of themes. Create it when it is missing. The hub reads it on each page load, so an edit applies when the user reloads the hub page.

## Three kinds of entry

Each entry has an `id` (`^[a-z0-9-]{1,32}$`), a `label` for the picker, and a `dark` and a `light` object of colors.

1. **Tweak a built-in theme.** Use the built-in id. The entry starts from that theme, so it holds only the colors it changes, in either mode or both.
   ```json
   { "id": "ember", "dark": { "ember": "#3b82f6", "emberGlow": "#93c5fd" } }
   ```
2. **Base a new theme on a built-in one.** A new id plus `"extends": "<built-in id>"`. It starts from that theme, and its colors win. A mode it leaves out comes from the base.
   ```json
   { "id": "deep-sea", "label": "Deep Sea", "extends": "nord", "dark": { "field": "#0b1220", "surface": "#111a2e" } }
   ```
3. **New theme from scratch.** A new id with no `extends`. Both `dark` and `light` hold every required color below.

Built-in ids: `ember` (the default), `gruvbox`, `catppuccin`, `tokyo-night`, `solarized`, `dracula`, `nord`, `rose-pine`, `everforest`, `kanagawa`, `one-dark`, `night-owl`, `monokai`, `github`, `ayu`, `vitesse`, `synthwave`.

## Colors

The keys are palette roles. The hub maps each role to the CSS variable the apps read.

| Role | CSS variable | Paints |
|---|---|---|
| `ember` | `--accent` | The accent: active items, primary buttons, focus |
| `emberGlow` | `--accent-text` | Accent used as text, so it must read on `surface` |
| `emberDim` | `--accent-dim` | A faint accent fill, usually the accent at 0.18–0.25 alpha |
| `field` | `--bg-deep` | The page background |
| `surface` | `--bg-surface` | Panels and cards |
| `elevated` | `--bg-elevated` | Raised surfaces |
| `hover` | `--bg-hover` | The hover state |
| `border` | `--border` | Borders and dividers |
| `ink1` | `--text-primary` | Main text |
| `ink2` | `--text-secondary` | Secondary text |
| `ink3` | `--text-tertiary` | Tertiary text |
| `inkMuted` | `--text-muted` | Muted text |
| `sidebar` | `--sidebar-bg` | Optional. The sidebar background |
| `sidebarItem` | `--sidebar-item-bg` | Optional. A sidebar item background |

The hub derives `--accent-glow` from `ember`, and the picker swatch from `surface`, `ember`, `ink1` and `border`.

A value is a hex color (`#rgb`, `#rrggbb`, `#rrggbbaa`), or `rgb()`, `rgba()`, `hsl()`, `hsla()` or `oklch()`.

For a from-scratch theme, copy a built-in palette with the same feel and change it, so both modes keep their contrast. `lib/themes.json` in the hub package holds every built-in palette: `$(npm root -g)/claude-code-hub/lib/themes.json` for a global install.

## Check

The hub skips an entry that breaks a rule and prints why in its console, naming the theme and the role. A theme is done when:

- The hub console shows no skip line for it after a page reload.
- It shows in the theme picker of each tab, and picking it repaints every tab in both modes.
