---
name: demo
description: Use when the user wants to demo a Claude Code Hub sub-app (marketplace, cck/kanban, cost, memory), capture product screenshots, or build a seeded demo dataset — isolates from the user's real ~/.claude data and captures high-quality (HQ) Playwright screenshots. Triggers on "demo the hub", "take screenshots", "screenshot demo", "seed demo data".
argument-hint: "[marketplace|cck|cost|memory]"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Demo

Run a sub-app against isolated, seeded demo data and capture HQ screenshots — never against the user's real `~/.claude`.

## Step 1: Isolate

Every sub-app reads its data root from `CLAUDE_CONFIG_DIR` (the official Claude Code env var; falls back to legacy `CLAUDE_DIR`, then `~/.claude`). All four submodules (cck, marketplace, cost, memory) support it in `server.js`.

Create a scratch seed dir at `<app>/.playwright-cli/seed-claude-dir/` (already gitignored via `.playwright-cli/`). Never seed inside the user's real `~/.claude`. Exception: if the app displays full file paths in its UI (e.g. memory's preview header), seed at a clean neutral path like `C:/demo/.claude` + `C:/demo/api-gateway` instead, and keep the seed script under `.playwright-cli/` for re-creation (see `memory/.playwright-cli/seed-memory.js`).

## Step 2: Seed demo data

Populate the seed dir with a believable "active system": open/pending/in-progress/blocked tasks, a live-looking subagent log, and (for cck) statusline stats. Copying a real session's transcript is fine with explicit user approval — ask first.

Exact directory layout and JSON schemas (task files, context-status/statusline, agent-activity): [reference/demo-data-schemas.md](reference/demo-data-schemas.md).

Validate every hand-written JSON file parses before starting the server — `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"`. A bash heredoc with `'EOF'` mangles `\U`/`\P` Windows-path escapes into invalid JSON that gets silently swallowed by the app's parsers, leaving the seeded field just missing with no error. Prefer writing JSON via a small `node -e` script over a heredoc whenever the content has Windows paths.

## Step 3: Start the app, headed

Start the target app with `CLAUDE_CONFIG_DIR` pointed at the seed dir, then drive it with `playwright-cli` in **headed** mode so the user can watch each step and confirm before you capture:

```bash
CLAUDE_CONFIG_DIR=<seed-dir> PORT=<preferred> node server.js
```

Ports fall back when busy — always re-read the actual bound port from server stdout, don't assume the requested one.

Confirm isolation before capturing anything: open the app and verify it shows only seeded sessions/tasks, nothing from the real `~/.claude`.

## Step 4: Capture HQ screenshots

`playwright-cli screenshot` hardcodes `scale: 'css'` — there is no flag to change it, and on a normal laptop this produces screenshots sized to the user's personal monitor at 1x, not a clean fixed resolution. Use this recipe instead:

1. Write a config file the browser session is opened with:

   ```json
   { "browser": { "contextOptions": { "viewport": { "width": 1920, "height": 1080 }, "deviceScaleFactor": 2 } } }
   ```

   Nest under `browser.contextOptions` — a top-level `contextOptions` is silently ignored.

2. Open the session with it: `playwright-cli --config=<path>.json open <url>`. The config applies at session-open time, not per-command — reuse the same session for every shot in the set.

3. Verify before capturing: `playwright-cli run-code "async page => await page.evaluate(() => ({w: innerWidth, h: innerHeight, dpr: devicePixelRatio}))"` — expect `{w:1920, h:1080, dpr:2}`.

4. Capture via `run-code`, not the `screenshot` command, so you can pass `scale: 'device'`:

   ```bash
   playwright-cli run-code "async page => { await page.screenshot({ path: '<out>.png', scale: 'device' }); }"
   ```

   This yields the true DPR-scaled output (3840×2160 for the config above) regardless of what monitor the agent or user is running.

5. Navigating a live page: cck (and other sub-apps with SSE-driven re-renders) invalidates `snapshot` refs within seconds. Use `page.getByText(...)` / `page.getByRole(...)` locators or `page.evaluate()` + `querySelector` in `run-code` instead of numbered refs from `snapshot`. Scope ambiguous locators (e.g. `{ exact: true }`, or a modal-specific selector) when multiple similar elements or modals can be open at once.

## Step 5: Name and order the set

Save shots as `NN-description.png` in the narrative order they'd appear in a README or gallery (e.g. `01-kanban.png`, `02-session-log.png`, `03-subagent-preview.png`, `04-session-info.png`, `05-tool-stats-impact.png`). When inserting or reordering a shot, renumber the whole set so the sequence stays logical — don't leave gaps or out-of-order numbers.

## Step 6: Clean up

Kill the demo server. Leave the seed dir in place under `.playwright-cli/` (gitignored) for future re-capture — don't commit it, and don't copy it into `assets/`.
