# Liveness and slow ports

`npm test` runs the tests for both.

## Liveness

The hub spawns each app with an IPC channel. Fresh loopback connects fail in bursts on some Windows machines while the app is fine. After `MAX_ATTEMPTS` failed connects (HTTP or WebSocket), the hub pings the app over IPC. No pong in 3 s replaces it. A pong keeps it, and the request retries with backoff (up to 2 s apart) for up to 30 s more; if connects still fail, the hub replaces it too. A request body of 1 MB or less is kept, so a POST retries like a GET; a larger or chunked body is sent once. The error page and JSON `error` name the real cause: starting, restarting, or stopped (gave up after its restarts). Failed connects are logged as one count per app and error code every 5 min. The app servers keep idle sockets for 65 s (`KEEP_ALIVE_MS` in net-guard) and the hub agent drops them after 60 s, so few requests need a fresh connect.

On POSIX the hub stops an app with SIGTERM and sends SIGKILL after 3 s; on Windows it uses `taskkill /f /t`.

## Slow ports

Some loopback ports on Windows delay requests with TCP retransmit timing (0.3 s, 0.9 s, 2 s, 4.5 s …) while the app is idle; a restart moves the app to a new port and the delays stop. Every 30 s the hub sends each app of the active pool 5 probes, each a `GET /hub-config` plus an IPC ping at the same moment (`lib/port-health.js`). HTTP at 300 ms or more with a pong under 100 ms is a strike; both slow is a busy app and does not count. 3 strikes in 5 min on the same port flag the app (`slowMs` in `GET /api/apps/stats`), and the app launcher (`Ctrl+Alt+A`) shows a "slow port" badge on its row; `Ctrl+R` restarts it onto a new port.
