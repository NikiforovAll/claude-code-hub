# Demo data schemas (cck)

Layout under the resolved `CLAUDE_CONFIG_DIR`:

```
projects/<encoded-cwd>/<sessionId>.jsonl              transcript
projects/<encoded-cwd>/<sessionId>/subagents/         historical agent-compact summaries
projects/<encoded-cwd>/<sessionId>/tool-results/       "
tasks/<sessionId>/*.json                              kanban task files
.cck/agent-activity/<sessionId>/*.jsonl               live/recent subagent-log entries (used by the Agents Log panel)
.cck/context-status/<sessionId>.json                  statusline-integration data (session-info panel stats)
```

## Task JSON (`tasks/<sessionId>/<id>.json`)

```json
{
  "id": "1",
  "subject": "Fix session-log auto-scroll jitter",
  "description": "Message panel jumps to top when a new SSE event arrives mid-scroll...",
  "activeForm": "Fixing session-log auto-scroll jitter",
  "status": "pending",
  "blocks": [],
  "blockedBy": []
}
```

Field is `subject`, not `title` — using `title` renders a blank `#N` placeholder card with no description. `status` is one of `pending` / `in_progress` / `completed` / `blocked` (a `blocked` task lists the task it's waiting on in `blockedBy: ["<id>"]`).

## Context-status JSON (`.cck/context-status/<sessionId>.json`)

Drives the statusline stats shown in the Session Info ("i") modal — context window bar, cost, rate limits. Without this file the modal only shows Session/Project/Path/CWD/Branch/Tasks Dir.

```json
{
  "session_id": "<sessionId>",
  "transcript_path": "...",
  "cwd": "C:/Users/.../project",
  "prompt_id": "...",
  "effort": { "level": "medium" },
  "session_name": "...",
  "model": { "id": "claude-sonnet-5", "display_name": "Sonnet 5" },
  "workspace": { "current_dir": "...", "project_dir": "...", "added_dirs": ["..."], "repo": { "host": "github.com", "owner": "...", "name": "..." } },
  "version": "2.1.200",
  "output_style": { "name": "default" },
  "cost": { "total_cost_usd": 3.18, "total_duration_ms": 1985230, "total_api_duration_ms": 642110, "total_lines_added": 112, "total_lines_removed": 24 },
  "context_window": {
    "total_input_tokens": 58120,
    "total_output_tokens": 614,
    "context_window_size": 200000,
    "current_usage": { "input_tokens": 2, "output_tokens": 614, "cache_creation_input_tokens": 1840, "cache_read_input_tokens": 56280 },
    "used_percentage": 29,
    "remaining_percentage": 71
  },
  "exceeds_200k_tokens": false,
  "fast_mode": false,
  "thinking": { "enabled": true },
  "rate_limits": {
    "five_hour": { "used_percentage": 12, "resets_at": 1783336800 },
    "seven_day": { "used_percentage": 18, "resets_at": 1783764000 }
  }
}
```

All paths must use forward slashes or properly-escaped backslashes — see the JSON-validation note in `SKILL.md` Step 2.

The server watches this directory with chokidar (`ignoreInitial: false`), so a file present before server start is picked up on boot; a malformed one is silently dropped (parse failure is swallowed) with no error, and the modal just won't show stats. Always validate with `node -e "JSON.parse(...)"` before starting the server, not after seeing a missing field in the UI.

## Agent-activity (`.cck/agent-activity/<sessionId>/*.jsonl`)

This is the live subagent-log data source — distinct from the transcript's `subagents/` folder, which only feeds historical digest summaries. A session can have rich `Agent` tool calls in its transcript and still show "no subagent data" in the live log if this directory is empty. Copy real `.jsonl` files from a session confirmed to have entries here (check file count under `.cck/agent-activity/<sessionId>/` before picking a session to seed from).
