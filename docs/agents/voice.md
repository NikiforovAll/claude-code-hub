# Voice (experimental)

User guide: `website/src/content/docs/guides/voice.mdx`.

## Switch and keys

Off unless `config.json` has `voice: {enabled: true}` (also `provider`: `auto`, the default, `hex` or `browser`; `decider`, default `grammar`; `autoSubmit`, default `true`). Only then does the server load `lib/voice/` and the page bind `hub.voice` to `Ctrl+Shift+Space` (Hex keeps `Ctrl+Space` for plain dictation). `ext install voice` turns it on through `features/voice/feature.json` (see `docs/agents/extensions.md`), and `ext remove voice` sets `enabled: false`. The website lists it in the Extensions catalog through `website/src/content/extensions/voice.json`.

## Providers

`resolveProvider` in `lib/voice/index.js` turns `auto` into `hex` when `hexExe()` finds Hex, else `browser`, once at startup. `/api/config` carries `voice: {provider, auto}`. With `browser`, the server runs no speech: the page's `SpeechRecognition` hears the mic and posts the text so far to `POST /api/voice/text` (`{text}`, answered with `live()`), then `{text, final: true}` on release, answered with the command from `decide()`, so the grammar stays on the server. The page then follows the live path below. In browser mode `start`, `stop`, `dictate` and `cancel` answer `ok: false`, and the hub does not offer `voice.dictate`. When `auto` picked the browser, the page shows the `#voice-note` toast once (`localStorage` key `hub-voice-browser-noted`), because the browser's speech service is online.

## Hold to talk

Frames forward keydown only, so the press moves focus to `#voice-pill` on the hub page, the release (Space or Ctrl, or a window blur) lands there, and focus goes back to the frame. A window blur into a frame mid-hold (Kanban focusing the dialog) puts focus back on the pill instead of ending the hold. Work only while the key is held: ~5 posts a second.

## CLI path

`POST /api/voice/start` and `/stop` run the speech provider (`lib/voice/hex.js`, the Hex CLI's `dictation start|stop --print`); stop turns the text into a command: the grammar (`lib/voice/grammar.js`: "new session <prompt>" → `session.new`, which opens Kanban's dialog filled in), then the decider named in `voice.decider`, else `session.paste` (Kanban) with the text and `submit: "true"`, so a prompt is sent with no Enter press (`"false"` with `autoSubmit: false`).

## Live text

The page tries the live path first: it records the mic (`getUserMedia`, an AudioWorklet at 16 kHz, f32) and posts ~200 ms chunks to `POST /api/voice/stream/audio`; `lib/voice/hex-stream.js` relays them to Hex's local API (`/streams`, token from `%APPDATA%\hex\local-api.json`, kept in the hub) and each answer carries the text so far, split by `live()`. Once the text starts with "new session" the page invokes `session.new` at once, then sends the words (after the prefix, or all of them) to Kanban's `session.live` as they change, and on release a last `session.live` with `final` and `submit`. `stream/start` answering 501 (no local API or no `/streams`) or a refused mic sets `voiceStream = false` for the page's life and the CLI path takes over.

Backspace mid-hold (`voiceCancel`) cancels the stream and sends `session.live` with empty `text` and `cancel` (`"close"` when the hold opened the dialog); the state stays `cancelled` until the release, so the key's auto-repeat does not start a new hold.

## Dictate action and log

With voice on through Hex, the hub also handles the action `voice.dictate` itself (`{op: start|stop|cancel}`, listed in `welcome.actions`; stop answers `{ok, text}` from `POST /api/voice/dictate`, which skips the deciders): cck's New session mic uses it in place of the browser's speech API. Each stop or dictate appends a line to `<hub-dir>/voice.jsonl`.
