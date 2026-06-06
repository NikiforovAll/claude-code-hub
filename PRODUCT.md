# Product

## Register

product

## Users

Developers who run Claude Code as a daily driver. Their context is a terminal-adjacent
workflow: many concurrent sessions, agents, and tasks across multiple projects. They open
these tools to *observe and steer* work already in motion — check what an agent is doing,
triage Kanban tasks, watch token cost, recall past memory, browse the marketplace. They are
power users who value information density and keyboard speed over hand-holding.

## Product Purpose

Claude Code Hub is a unified launcher that fuses four standalone tools — **Marketplace**,
**Kanban** (cck), **Cost**, and **Memory** — into a single chromeless PWA. Each is a real
submodule app with its own server; the hub stitches them behind one shell so the suite feels
like one product, not four tabs.

This file governs the **shared design language for the whole suite**. The four sub-apps must
read as siblings: same palette, type system, surface hierarchy, and motion. Success is a user
moving between Kanban and Cost without feeling they changed apps.

The current direction is **modernization** — the existing design (dark-first, terracotta
accent, mono + serif pairing, warm light theme) is the foundation and source of inspiration,
not something to discard. We evolve it: calmer surfaces, earned hierarchy, less chrome.

## Brand Personality

Technical, dense, terminal-native. The voice of a precise developer tool: a serif heading
for editorial weight, monospace for everything data, and a single warm accent doing the
signalling. Confident and quiet — it shows state without shouting. Density is a feature, not
a flaw; whitespace is spent where it buys clarity, not sprinkled for "air".

## Anti-references

- **Childish / playful**: no bubbly radii, bright primary palettes, emoji-as-UI, or gamified
  flourishes. This is a professional instrument.
- **Glaring white surfaces**: stark `#fff` panels, harsh high-contrast borders, and the
  bright-card-on-canvas look we've been actively tuning away from. Separation comes from tone
  and elevation, not hard lines or brightness.

(Further anti-references TBD — the user is still forming opinions on the SaaS-clone and
chrome-heavy axes.)

## Design Principles

1. **One suite, one language.** A change to the shared system should land consistently across
   hub + all four sub-apps. Divergence between submodules is a bug.
2. **Evolve the existing identity.** The dark-first palette, terracotta accent, and mono+serif
   pairing are the brand. Improve their execution; don't reinvent the look.
3. **Quiet by default.** Content over chrome. The interface earns attention only where state
   changes. Borders are hairlines, surfaces lift subtly, nothing glares.
4. **Density without clutter.** Respect the power user — pack information, but resolve it with
   hierarchy (tone, weight, spacing rhythm), not with boxes around everything.
5. **Hierarchy through elevation, not outlines.** Separate regions with tonal steps and soft
   depth before reaching for a line. A border you *notice* is too strong.

## Accessibility & Inclusion

- Target **WCAG 2.1 AA**: body text ≥4.5:1, large/bold text ≥3:1, against its actual surface.
  The light theme's muted-gray-on-warm-near-white is the contrast risk to watch.
- Support both **dark and light** themes (manual toggle + `prefers-color-scheme`); neither is
  an afterthought.
- Honor **`prefers-reduced-motion`** for every animated transition.
- Keyboard-first navigation is core to the audience, not an add-on.
