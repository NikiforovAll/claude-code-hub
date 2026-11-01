# Voice (experimental)

User guide: `website/src/content/docs/guides/voice.mdx`.

## Switch and keys

Off unless `config.json` has `voice: {enabled: true}` (also `provider`: `auto`, the default, `hex` or `browser`; `decider`, default `grammar`). Only then does the server load `lib/voice/` and the page bind `hub.voice` to `Ctrl+Shift+Space` (Hex keeps `Ctrl+Space` for plain dictation). `ext install voice` turns it on through `features/voice/feature.json` (see `docs/agents/extensions.md`), and `ext remove voice` sets `enabled: false`. The website lists it in the Extensions catalog through `website/src/content/extensions/voice.json`.

## Providers

`resolveProvider` in `lib/voice/index.js` turns `auto` into `hex` when `hexExe()` finds Hex, else `browser`, once at startup. `/api/config` carries `voice: {provider, auto}`. With `browser`, the server runs no speech: the page's `SpeechRecognition` hears the mic and posts the text so far to `POST /api/voice/text` (`{text}`, answered with `live()`), then `{text, final: true}` on release, answered with the command from `decide()`, so the grammar stays on the server. The page then follows the live path below. In browser mode `start`, `stop`, `dictate` and `cancel` answer `ok: false`, and the hub does not offer `voice.dictate`. When `auto` picked the browser, the page shows the `#voice-note` toast once (`localStorage` key `hub-voice-browser-noted`), because the browser's speech service is online.

## Hold to talk

Frames forward keydown only, so the press moves focus to `#voice-pill` on the hub page, the release (Space or Ctrl, or a window blur) lands there, and focus goes back to the frame. A window blur into a frame mid-hold (Kanban focusing the dialog) puts focus back on the pill instead of ending the hold. Work only while the key is held: ~5 posts a second.

## CLI path

`POST /api/voice/start` and `/stop` run the speech provider (`lib/voice/hex.js`, the Hex CLI's `dictation start|stop --print`); stop turns the text into a command: the grammar (`lib/voice/grammar.js`: a command starts with the reserved word "hub" (`PREFIX`, with the forms speech services mishear), then a row of `COMMANDS`: "new session <prompt>" → `session.new`, which opens Kanban's dialog filled in; "add a task <subject>" → `task.add` on the board on screen; a row counts only when an app handles its action; "hub" with no row is `unknown`, never a paste), then the decider named in `voice.decider`, else `session.paste` (Kanban) with the text, a draft. The page adds `submit: "true"` only when the user pressed Enter during the hold (`voice.send`), else `"false"`.

## Task split

`decide` passes the subject of a `task.add` through `splitTask` (`lib/voice/split.js`), which never changes a word: 8 words or fewer stay the subject; longer text is cut at the first `,.;:!?` into subject and description. With no break and `voice.taskSplitModel` set (for example `"haiku"`), `askClaude` runs one plain `claude -p` (no tools, no MCP servers, no settings or hooks, its own system prompt, `--no-session-persistence` so no transcript and no board session, stdin closed, 15 s timeout) that answers the leading words. An answer that is not a prefix of the text is ignored and the text stays whole. The call adds ~3 s (more on a cold CLI) to the release, and only for a long task with no break. `CLAUDE_CONFIG_DIR` is the hub's active dir when it is not the default.

## Live text

The page tries the live path first: it records the mic (`getUserMedia`, an AudioWorklet at 16 kHz, f32) and posts ~200 ms chunks to `POST /api/voice/stream/audio`; `lib/voice/hex-stream.js` relays them to Hex's local API (`/streams`, token from `%APPDATA%\hex\local-api.json`, kept in the hub) and each answer carries the text so far, split by `live()`. Once the text starts with "hub, new session" the page invokes `session.new` at once, then sends the words (after the phrase, or all of them) to Kanban's `session.live` as they change, and on release a last `session.live` with `final` and `submit`. `stream/start` answering 501 (no local API or no `/streams`) or a refused mic sets `voiceStream = false` for the page's life and the CLI path takes over.

Once the text starts with the prefix, `live()` returns a label as `command` (the row's, else "Hub"): the page removes what it typed (`clearTyped`), shows the label and the rest in the pill, and runs the command on release. Drafts go to Kanban only while it is the active tab. On another tab the page sets `voice.bare` at the press and adds `?bare=1` to `text`, `stop`, `stream/audio` and `stream/finish`: the grammar takes a row without the prefix, and `decide` answers `unknown` in place of a paste, so an unmatched hold ends in a toast and never switches tabs just to type.

When the live text is the prefix alone, the page opens `#voice-help` at the bottom right: the rows of `COMMANDS` (`/api/config` carries them as `voice.commands`, with `say` and `help`) whose action an app handles, and what the tab does with other words. Words after the prefix close it. A release on the prefix alone keeps it open for 6 s in place of the "Didn't get that" toast. Only the live paths (stream and browser) open it.

Enter mid-hold sets `voice.send`, so the release sends the prompt; without it the prompt stays in the input box as a draft. A dialog that the hold opened is never started by it: focus lands on Start.

Backspace mid-hold (`voiceCancel`) cancels the stream and sends `session.live` with empty `text` and `cancel` (`"close"` when the hold opened the dialog); the state stays `cancelled` until the release, so the key's auto-repeat does not start a new hold.

## Dictate action and log

With voice on through Hex, the hub also handles the action `voice.dictate` itself (`{op: start|stop|cancel}`, listed in `welcome.actions`; stop answers `{ok, text}` from `POST /api/voice/dictate`, which skips the deciders): cck's New session mic uses it in place of the browser's speech API. Each stop or dictate appends a line to `<hub-dir>/voice.jsonl`.
