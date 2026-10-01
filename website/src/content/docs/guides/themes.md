---
title: Make a custom color theme
description: Add your own color theme to the hub, or change the colors of a built-in one, with one JSON file.
---

The hub has 17 built-in color themes, each with a light and a dark mode. You can change a built-in theme or add your own. The hub sends the colors of the current theme to every tool in its tabs, so a custom theme reaches all the tools with no change to them.

## Where the file is

Put your themes in `themes.json` in the hub folder, `~/.claude-hub` by default (see [Run a second hub](/claude-code-hub/reference/configuration/#run-a-second-hub) for other folders). The file holds a JSON array of themes. The hub does not create it.

The hub reads the file each time the hub page loads. To apply an edit, reload the hub page. You do not have to restart the hub.

## Change a built-in theme

Use the id of the built-in theme. The entry starts from that theme, so it holds only the colors it changes, in one mode or both. This entry makes the default theme blue in dark mode:

```json
[
  { "id": "ember", "dark": { "ember": "#3b82f6", "emberGlow": "#93c5fd" } }
]
```

The built-in ids are `ember` (the default), `gruvbox`, `catppuccin`, `tokyo-night`, `solarized`, `dracula`, `nord`, `rose-pine`, `everforest`, `kanagawa`, `one-dark`, `night-owl`, `monokai`, `github`, `ayu`, `vitesse` and `synthwave`.

## Add a theme based on a built-in one

Give a new id and `"extends"` with a built-in id. The theme starts from that built-in theme, and its own colors win. A mode it leaves out comes from the base theme.

```json
[
  { "id": "deep-sea", "label": "Deep Sea", "extends": "nord", "dark": { "field": "#0b1220", "surface": "#111a2e" } }
]
```

The new theme shows at the end of the theme list, with its `label`.

## Add a theme from scratch

Give a new id and no `extends`. Then both `dark` and `light` must hold every color in the table below, except the two optional sidebar colors. The easiest start is to copy a built-in palette with the same feel and change it, so both modes keep their contrast. `lib/themes.json` in the hub package holds every built-in palette. For a global install, it is at `$(npm root -g)/claude-code-hub/lib/themes.json`.

## The colors

Each key is a color role. The hub maps it to the CSS variable that the tools read.

| Role | CSS variable | What it paints |
| --- | --- | --- |
| `ember` | `--accent` | The accent: active items, primary buttons, focus |
| `emberGlow` | `--accent-text` | The accent as text. It must be easy to read on `surface` |
| `emberDim` | `--accent-dim` | A faint accent fill, usually the accent at 0.18 to 0.25 alpha |
| `field` | `--bg-deep` | The page background |
| `surface` | `--bg-surface` | Panels and cards |
| `elevated` | `--bg-elevated` | Raised surfaces, such as dialogs |
| `hover` | `--bg-hover` | The hover state |
| `border` | `--border` | Borders and dividers |
| `ink1` | `--text-primary` | Main text |
| `ink2` | `--text-secondary` | Secondary text |
| `ink3` | `--text-tertiary` | Tertiary text |
| `inkMuted` | `--text-muted` | Muted text |
| `sidebar` | `--sidebar-bg` | Optional. The sidebar background |
| `sidebarItem` | `--sidebar-item-bg` | Optional. The background of a sidebar item |

The hub makes `--accent-glow` from `ember`. The swatch in the theme picker uses `surface`, `ember`, `ink1` and `border`.

A value is a hex color (`#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`), or an `rgb()`, `rgba()`, `hsl()`, `hsla()` or `oklch()` color.

A theme does not change the colors that the tools keep for themselves: status colors such as success, warning and error, chart colors, and fonts.

## The rules

- `id` is 1 to 32 characters: lowercase letters, digits and `-`.
- `label` is optional. It is the name in the theme picker. The default is the label of the base theme, else the id.
- An entry with a built-in id cannot have `extends`.
- Two entries cannot have the same id. The hub uses the first one.

## Check a theme

The hub skips an entry that breaks a rule, and prints why in its console. The message names the theme and the color role, for example:

```
[themes] skipped "deep-sea": dark.field is not a color: navy
```

A theme is ready when:

- The hub console shows no `skipped` line for it after you reload the hub page.
- It shows in the theme picker of each tool, and picking it changes the colors of every tool in light and dark mode.

A tool that runs on its own, outside the hub, uses only its built-in themes. Your file has an effect only in the hub.
