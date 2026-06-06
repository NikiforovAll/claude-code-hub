---
name: Claude Code Hub
description: A terminal-native observability suite — editorial serif over monospace data, one ember of warmth.
colors:
  ember: "#e86f33"
  ember-glow: "#f0a070"
  bg-deep: "#101114"
  bg-surface: "#16181c"
  bg-elevated: "#1e2025"
  bg-hover: "#282a30"
  border: "#363840"
  ink-primary: "#f0f1f3"
  ink-secondary: "#c2c4c9"
  ink-tertiary: "#9a9da5"
  ink-muted: "#7d808a"
  signal-success: "#3ecf8e"
  signal-warning: "#f0b429"
  signal-team: "#60a5fa"
  signal-plan: "#86a886"
  paper-deep: "#e8e6e3"
  paper-surface: "#efede9"
  paper-elevated: "#fbfaf9"
  paper-border: "#cfcbc4"
  paper-ink: "#0a0a0a"
  paper-ember-text: "#b85a20"
typography:
  display:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
  title:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  data:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-icon:
    backgroundColor: "{colors.bg-deep}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  button-icon-hover:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.ink-primary}"
  chip:
    backgroundColor: "{colors.bg-deep}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  chip-active:
    backgroundColor: "{colors.bg-deep}"
    textColor: "{colors.ember-glow}"
  card:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
    padding: "12px"
  input:
    backgroundColor: "{colors.bg-deep}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  input-focus:
    backgroundColor: "{colors.bg-deep}"
    textColor: "{colors.ink-primary}"
---

# Design System: Claude Code Hub

## 1. Overview

**Creative North Star: "The Lab Notebook"**

Claude Code Hub is the instrument a developer keeps open while many Claude Code sessions, agents, and tasks run at once. It reads like a working notebook, not an app: editorial serif section-heads (Playfair Display) sit directly above dense monospace data (IBM Plex Mono), a print-style contrast axis that signals "this is a record, kept precisely." The field is quiet and cool-neutral; a single terracotta ember marks what is live. Nothing else competes for the eye.

The system ships in two skins that are siblings, not opposites. The default is a **near-black instrument** (`#101114` field). The alternate is a **warm-paper notebook** (`#e8e6e3` field) for daylight work. Both carry the same ember accent, the same type pairing, and the same tonal-first depth model; only the neutral ramp inverts. A user switching themes should feel the lights change, not the product.

This system explicitly rejects the bright SaaS-dashboard look: stark white panels, high-contrast borders that box every region, hero-metric tiles, and identical card grids. It also rejects anything childish — bubbly radii, bright primary palettes, emoji-as-UI. Separation is earned through tone and spacing before any line is drawn, and the one accent stays rare on purpose.

**Key Characteristics:**
- Editorial serif headings over monospace data; no third typeface.
- Dark-first, with a warm-paper light theme as an equal sibling.
- One terracotta ember as the only non-functional saturated color.
- Tonal-first depth: surfaces lift by lightness step, not by shadow.
- Dense by design; whitespace spent for clarity, not decoration.

## 2. Colors

A cool-neutral field carrying one warm ember and a small set of functional status hues — nothing decorative.

### Primary
- **Ember Terracotta** (`#e86f33`): The single brand signal. Live-status dots, the active progress bar, the focus ring tint, the pinned-item mark. On any given screen it touches well under 10% of the surface; its rarity is what makes it read as "this is the thing that matters."
- **Ember Glow** (`#f0a070`): The accent's text-safe sibling on dark surfaces (assistant message text, accent labels) where `#e86f33` would not clear contrast. On the warm-paper theme this role shifts to a deeper **Ember Ink** (`#b85a20`) for the same reason.

### Tertiary (functional status, never decorative)
- **Signal Success** (`#3ecf8e`): Completed state, healthy thresholds.
- **Signal Warning** (`#f0b429`): Pending-permission, caution thresholds.
- **Signal Team** (`#60a5fa`): Team / multi-agent ownership.
- **Signal Plan** (`#86a886`): Plan / planning-mode markers.
- **Signal Danger** (`#ef5350` dark / `#c0392b` light): Error / destructive / failed state. The only red in the system; like the other signals it appears *only* bound to the condition it describes, never as decoration.

### Voice Accents
- **Antique Gold** (`#d9b667` dark / `#a8842f` light): Marks the *human* voice — the user's own messages in the session log carry a gold leading accent, distinct from the ember that marks the assistant. A muted, aged gold, never a bright yellow; it reads as "your hand" in the transcript without competing with the ember signal.

### Neutral (dark, canonical)
- **Field** (`#101114`): The deepest surface; the body canvas and inset wells (inputs, dropdowns).
- **Surface** (`#16181c`): Sidebar, panels, cards — the primary working surface, one step up from the field.
- **Elevated** (`#1e2025`): Nested elements that sit above a surface (badges, message bubbles, popovers).
- **Hover** (`#282a30`): Interactive hover wash.
- **Border** (`#363840`): Hairline dividers and rest-state strokes.
- **Ink Primary** (`#f0f1f3`) / **Secondary** (`#c2c4c9`) / **Tertiary** (`#9a9da5`) / **Muted** (`#7d808a`): The four-step text ramp, primary for content down to muted for timestamps and metadata.

### Neutral (warm-paper, light theme)
- **Paper Field** (`#e8e6e3`) → **Surface** (`#efede9`) → **Elevated** (`#fbfaf9`): The inverted ramp. Note the order matches dark: field is darkest, elevated lifts toward off-white. Elevated is a *warm* off-white (`#fbfaf9`), never pure `#ffffff`.
- **Paper Border** (`#cfcbc4`): A soft warm hairline, deliberately low-contrast against the surfaces it divides.
- **Paper Ink** (`#0a0a0a`): Near-black primary text.

### Named Rules
**The One Ember Rule.** The terracotta accent is the only saturated color allowed for non-functional use, and it stays under 10% of any screen. Status hues (success/warning/team/plan) appear *only* bound to data they describe, never as decoration.

**The No-Pure-White Rule.** In the light theme, no surface is `#ffffff`. The brightest allowed value is the warm elevated off-white `#fbfaf9`. Pure white glares against the warm field and breaks the notebook character.

## 3. Typography

**Display Font:** Playfair Display (with Georgia, serif fallback)
**Body / Data Font:** IBM Plex Mono (with ui-monospace, monospace fallback)
**Label Font:** IBM Plex Mono, uppercase + tracked

**Character:** A high-contrast pairing on a deliberate axis: a transitional serif with real stroke modulation for headings, against a single monospace for everything functional. The serif gives the product editorial weight and a "kept record" feel; the mono makes every number, path, token, and timestamp legible and aligned. There is no sans-serif and no third family.

### Hierarchy
- **Display** (Playfair, 500, ~22px, 1.2): View headers and the largest panel titles (e.g. the task title at the top of the board).
- **Title** (Playfair, 500, ~14px, 1.3): Panel and modal headings ("Session Log"), section titles that deserve editorial weight.
- **Body** (IBM Plex Mono, 400, 14px, 1.5): Default reading text and descriptions. Cap measure at 65–75ch in prose contexts.
- **Data** (IBM Plex Mono, 400, 12px, 1.5): The workhorse — session rows, task metadata, message bodies, the dense interior of the app.
- **Label** (IBM Plex Mono, 500, 11px, +0.08em, UPPERCASE): Section eyebrows and column headers ("SESSIONS", "PENDING", "IN PROGRESS"). Short only (≤4 words).

### Named Rules
**The Two-Voice Rule.** Serif speaks for structure (headings, titles); mono speaks for content and data. A heading in mono or a number in serif is a bug. Never introduce a third typeface to "add interest" — interest comes from weight and the serif/mono contrast.

## 4. Elevation

The system is **tonal-first**. Depth is conveyed almost entirely by the neutral ramp: `field → surface → elevated → hover` is a four-step lightness climb (inverted but identical in spirit on the warm-paper theme). A region reads as "above" another because it is one tonal step lighter, not because it casts a shadow. At rest, surfaces are flat.

Shadows exist, but only as a **response to state or true floating**, never as ambient decoration on resting cards.

### Shadow Vocabulary
- **Focus ring** (`box-shadow: 0 0 0 2px var(--accent-dim)`): The ember-tinted ring on focused inputs and interactive elements.
- **Ember glow** (`box-shadow: 0 0 12px var(--accent-glow)`): Reserved for live/active emphasis — the connection pulse, an active control.
- **Floating panel** (`box-shadow: -8px 0 24px rgba(0,0,0,0.15)`): The slide-in detail and session-log panels, which genuinely float above the board.
- **Modal** (`box-shadow: 0 16px 44px rgba(0,0,0,0.38), 0 4px 12px rgba(0,0,0,0.2)`): Dialogs lifted clear of everything beneath the backdrop, using a two-layer shadow (broad ambient + tight contact) for believable lift. The modal surface itself stays on `surface` — **not** `elevated`. A full-size dialog on the warm `elevated` off-white (`#fbfaf9`) glares; separation comes from the shadow and the dimmed backdrop, not from a brighter fill. (Elevated remains reserved for *small* nested elements per §2.)

### Named Rules
**The Flat-At-Rest Rule.** A resting card, row, or panel has no drop shadow. Shadows appear only for focus (ring), liveness (glow), or genuine float (panels, modals). If a static card has an ambient shadow, delete it and let the tonal step do the work.

## 5. Components

Components are **refined and restrained**: quiet at rest, state shown through subtle tone and border shifts rather than chrome. Default transition is `all 0.15s ease`; deliberate state changes use `cubic-bezier(0.4, 0, 0.2, 1)` at 0.2s.

### Buttons
- **Shape:** Gently squared (6px / `rounded.md`).
- **Icon buttons (primary affordance):** Transparent or `field` background, `ink-muted` glyph at rest. Hover lifts to `bg-hover` with `ink-primary` glyph and a hairline border. No filled "primary CTA" buttons in the app shell — this is a tool, not a funnel.
- **Hover / Focus:** Background and icon color shift together; focus shows the ember focus ring (`0 0 0 2px accent-dim`). Never a hard outline.

### Chips
- **Style:** `field` background, `ink-secondary` text, hairline border, small (2–8px padding, `rounded.sm`). Used for filters and activity counts.
- **State:** Active/selected chips tint toward the ember via `color-mix` (border and text pick up the accent at low percentage); unselected stay neutral. The fill never floods — the tint is a whisper.

### Cards / Containers
- **Corner Style:** 6px (`rounded.md`); session and task cards.
- **Background:** `surface`, one tonal step above the board field. Never `#ffffff` in light theme.
- **Shadow Strategy:** None at rest (see The Flat-At-Rest Rule). Selection is shown by an **ember ring** (`border-color: accent` + `box-shadow: 0 0 0 1px accent-dim, 0 0 12px accent-dim`) lifted to `elevated`, not a shadow. The same ember ring marks a selected session-log message — selection is one consistent ember treatment across the app. When a detail view closes, the item stays logically selected for keyboard nav but the ember ring is dimmed off; an explicit nav gesture (arrow keys, refocusing the board) restores it.
- **Border:** Hairline `border` at rest. In the light theme this is the soft `paper-border` (`#cfcbc4`), and panel-dividing borders are softened further to ~35% opacity via `color-mix` so they read as whispers, not lines.
- **Internal Padding:** 12px (`spacing.md`).

### Inputs / Fields
- **Style:** Inset `field` background (darker than the surface around them), hairline `border`, 6px radius. They read as wells cut into the surface.
- **Focus:** Ember focus ring (`0 0 0 2px accent-dim`); border does not jump to full accent.

### Code Surfaces
- **Style:** Code blocks, diff blocks, and inline code chips share one recessed recipe: a translucent neutral fill `color-mix(in srgb, var(--text-muted) N%, transparent)` over a hairline `color-mix(... border ...)` border (blocks ~8%, inline chips ~12%). The block is defined by its *outline*, not by being dark or stark white.
- **Never** a flat opaque gray (`rgba(127,127,127,0.15)` reads muddy on warm paper) and **never** the near-white `elevated` fill (glares; see The No-Pure-White Rule).
- **Syntax highlighting:** This neutral fill explicitly overrides the highlight.js theme background (`code.hljs`), so highlighted blocks match unhighlighted ones rather than imposing the library's own white panel. Token colors sit on the shared recessed surface.

### Navigation
- **Style:** Left sidebar, collapsible and drag-resizable. Section labels are tracked uppercase mono (Label role); session rows are dense Data-size mono. Active session is marked by ember, not by a filled background block. Cross-app navigation between the four sub-apps is keyboard-driven (`Ctrl+Alt+Arrow`) — the chrome stays invisible.

### Status Stripe (signature, under evolution)
The legacy pattern marks task/message kind with a colored `border-left` (2–3px) in a status hue. It is the current signature but it collides with the restrained direction. **For new components, do not add thick colored side-stripes** (see Don'ts); prefer a small leading dot, a tinted hairline, or a status chip. Existing stripes are being thinned toward 1px over time.

## 6. Do's and Don'ts

### Do:
- **Do** convey depth with the tonal ramp first (`field → surface → elevated → hover`); reach for a border only when tone is not enough.
- **Do** keep the ember under 10% of any screen, and bind every status hue to the data it describes.
- **Do** keep headings in Playfair and all data in IBM Plex Mono; weight and the serif/mono axis carry hierarchy.
- **Do** soften light-theme dividers (`color-mix(... var(--border) 35%, transparent)`) so panels separate without hard lines.
- **Do** show focus with the ember ring (`0 0 0 2px accent-dim`) and reserve glow/shadow for liveness and true floating.

### Don't:
- **Don't** use any `#ffffff` surface in the light theme — the warm elevated off-white `#fbfaf9` is the ceiling. (Anti-reference: "glaring white surfaces.")
- **Don't** box every region in a high-contrast border or drop an ambient shadow on a resting card. Separation is tonal; chrome is the enemy.
- **Don't** ship the bright SaaS-dashboard look: hero-metric tiles, identical icon-heading-text card grids, gradient accents. (Anti-reference: generic SaaS.)
- **Don't** go childish: bubbly radii, bright primary palettes, emoji-as-UI, gamified flourishes. (Anti-reference: "childish / playful.")
- **Don't** add a third typeface, set body copy in ALL CAPS, or put a number in the serif. Uppercase is for short tracked labels only.
- **Don't** use a colored `border-left`/`border-right` greater than 1px as an accent stripe on new components; use a leading dot, tinted hairline, or chip instead.
