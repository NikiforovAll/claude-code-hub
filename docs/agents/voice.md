# Voice (experimental)

User guide: `website/src/content/docs/guides/voice.mdx`.

## Switch and keys

Off unless `config.json` has `voice: {enabled: true}` (also `provider`: `auto`, the default, `hex` or `browser`; `decider`, default `grammar`). Only then does the server load `lib/voice/` and the page bind `hub.voice` to `Ctrl+Shift+Space` (Hex keeps `Ctrl+Space` for plain dictation). `ext install voice` turns it on through `features/voice/feature.json` (see `docs/agents/extensions.md`), and `ext remove voice` sets `enabled: false`. The website lists it in the Extensions catalog through `website/src/content/extensions/voice.json`.

## Providers

`resolveProvider` in `lib/voice/index.js` turns `auto` into `hex` when `hexExe()` finds Hex, else `browser`, once at startup. `/api/config` carries `voice: {provider, auto}`. With `browser`, the server runs no speech: the page's `SpeechRecognition` hears the mic and posts the text so far to `POST /api/voice/text` (`{text}`, answered with `live()`), then `{text, final: true}` on release, answered with the command from `decide()`, so the grammar stays on the server. The page then follows the live path below. In browser mode `start`, `stop`, `dictate` and `cancel` answer `ok: false`, and the hub does not offer `voice.dictate`. When `auto` picked the browser, the page shows the `#voice-note` toast once (`localStorage` key `hub-voice-browser-noted`), because the browser's speech service is online.

## Hold to talk

Frames forward keydown only, so the press moves focus to `#voice-pill` on the hub page, the release (Space or Ctrl, or a window blur) lands there, and focus goes back to the frame. A window blur into a frame mid-hold (Kanban focusing the dialog) puts focus back on the pill instead of ending the hold. Work only while the key is held: ~5 posts a second.

## CLI path

`POST /api/voice/start` and `/stop` run the speech provider (`lib/voice/hex.js`, the Hex CLI's `dictation start|stop --print`); stop turns the text into a command: the grammar (`lib/voice/grammar.js`: a command starts with the reserved word "hub" (`PREFIX`, with the forms speech services mishear), then a row of `COMMANDS`: "new session <prompt>" → `session.new`, which opens Kanban's dialog filled in; "add a task <subject>" → `task.add` on the board on screen; "open session <name>" → `session.find`, which Kanban matches against its session list (`rankSessions`) and opens, else shows in its session picker; a row counts only when an app handles its action; "hub" with no row is `unknown`, never a paste), then the decider named in `voice.decider`, else `session.paste` (Kanban) with the text, a draft. The page adds `submit: "true"` only when the user pressed Enter during the hold (`voice.send`), else `"false"`.

## Task title

`decide` passes the words of a `task.add` through `titleTask` (`lib/voice/title.js`). 8 words or fewer are the subject as said. Longer text is the description as said, never cut, and gets a subject: with `voice.taskTitleModel` set (for example `"haiku"`), `askClaude` runs one plain `claude -p` (no tools, no MCP servers, no settings or hooks, its own system prompt, `--no-session-persistence` so no transcript and no board session, stdin closed, 15 s timeout) that writes a short title. An error (`is_error`, such as a failed login), an empty or multi-line answer, or one over 12 words falls back to the words before the first `,.;:!?`, else no subject. The call adds ~3–4 s (more on a cold CLI) to the release of a long task. `CLAUDE_CONFIG_DIR` is the hub's active dir when it is not the default, so that dir needs a Claude login.

## Live text

The page tries the live path first: it records the mic (`getUserMedia`, an AudioWorklet at 16 kHz, f32) and posts ~200 ms chunks to `POST /api/voice/stream/audio`; `lib/voice/hex-stream.js` relays them to Hex's local API (`/streams`, token from `%APPDATA%\hex\local-api.json`, kept in the hub) and each answer carries the text so far, split by `live()`. Once the text starts with "hub, new session" the page invokes `session.new` at once, then sends the words (after the phrase, or all of them) to Kanban's `session.live` as they change, and on release a last `session.live` with `final` and `submit`. `stream/start` answering 501 (no local API or no `/streams`) or a refused mic sets `voiceStream = false` for the page's life and the CLI path takes over.

Once the text starts with the prefix, `live()` returns a label as `command` (the row's, else "Hub"): the page removes what it typed (`clearTyped`), shows the label and the rest in the pill, and runs the command on release. Voice runs only what the app on screen handles, so a hold never switches tabs. The page keeps the tab at the press (`voice.app`) and adds `?app=<id>` to `text`, `stop`, `stream/audio` and `stream/finish`; `canIn` then counts an action only when that app handles it, for the rows and for the draft (`session.paste`). On a tab whose app handles no row and no paste (Cost today), the press shows "No voice commands on <app>" in the pill and starts no speech.

`#voice-help` opens at the bottom right on the press and stays for the whole hold: the rows of `COMMANDS` (`/api/config` carries them as `voice.commands`, with `say` and `help`) whose action the app on screen handles, and what it does with other words. Each line stays on one row (ellipsis), so a row's `help` should fit in about 45 characters. `live()` names the matched row (`action`), and the live paths light that row. A release on the prefix alone keeps the panel open for 6 s in place of the "Didn't get that" toast.

A `COMMANDS` row with `live` (today `task.add` → `task.live`, words as `description`) fills an app's dialog as the user speaks: once the live text matches the row and the app handles the dialog action, the page sends it the params from `live()` on each change, `pending` at the release, then the params from `decide()` (with the title) with `final` and `submit`. Backspace, or a release that turns into another command, sends `cancel`. Kanban's Add task dialog glows with a Listening badge and read-only fields during the hold, shows "Writing a title" when the final call takes over 300 ms, moves a short task up into Title, and stays open with Add focused, so the user saves it with Enter.

Enter mid-hold sets `voice.send`, so the release sends the prompt; without it the prompt stays in the input box as a draft. A dialog that the hold opened is never started by it: focus lands on Start. While `session.live` types into the New session dialog, Kanban gives it the same glow and Listening badge (shared `.voice-mic` and `.modal[data-voice]` CSS) and makes the Prompt read-only until the last call, a close, or 20 s with no call (`setModalVoice`, which the Add task dialog shares).

Backspace mid-hold (`voiceCancel`) cancels the stream and sends `session.live` with empty `text` and `cancel` (`"close"` when the hold opened the dialog); the state stays `cancelled` until the release, so the key's auto-repeat does not start a new hold.

## Dictate action and log

With voice on through Hex, the hub also handles the action `voice.dictate` itself (`{op: start|stop|cancel}`, listed in `welcome.actions`; stop answers `{ok, text}` from `POST /api/voice/dictate`, which skips the deciders): cck's New session mic uses it in place of the browser's speech API. Each stop or dictate appends a line to `<hub-dir>/voice.jsonl`.
