---
title: Security and the hub token
description: What the hub token protects, how the browser gets it, how to change it, and what changes when you expose the hub to a network.
---

## The hub token

The hub page and every `/api/*` route need a token. By default the hub listens on loopback only, but loopback is not a user boundary: any account on the machine can reach a loopback port. The hub API also hands out the terminal token, and the terminal can run any command.

- The token is in `~/.claude-hub/token`. The hub makes it on the first run, with file mode 600, and keeps it across restarts.
- The startup banner prints the URL with the token: `http://localhost:3540/?token=<token>`. `--open` opens that URL.
- When a request has the right token, the hub sets an `HttpOnly`, `SameSite=Strict` cookie named `hub_token` and redirects to the same URL without the token. The cookie lasts 400 days, so later visits and the installed app need no token.
- Without the token or the cookie, the page shows a locked screen, and the API answers `401`.

Scripts, styles, icons, and the web app manifest do not need the token. They hold no secrets, and Chrome fetches the manifest without cookies.

### Change the token

Delete `~/.claude-hub/token` and restart the hub. Every browser then needs the new URL from the banner once.

## The terminal token

The embedded terminal has its own token. The hub makes a new one each time it starts. It gives the token to Kanban in the URL fragment (`#t=…`), which the browser never sends to a server, so the token does not reach a server log or a `Referer` header. See [Embedded terminal](/claude-code-hub/guides/terminal/#the-terminal-token).

## The tools

The four tools have no login of their own. Each one checks every request:

- **Host.** A request must be addressed to `localhost` or a loopback address. This blocks DNS rebinding.
- **Origin.** A write request must come from the tool itself or from the hub.
- **Framing.** Only the hub and the tool's own pages can frame it. A page on the internet cannot.

The hub forwards `postMessage` messages only to and from the four tool origins, and each tool accepts messages only from the hub.

## Reach the hub from another machine

By default the hub binds to `127.0.0.1`. To reach it from another machine, set the bind address and add the host name you will use:

```bash
npx claude-code-hub --host 0.0.0.0 --allowed-hosts=my-box.local
```

The hub prints a warning when it listens on a non-loopback address. The hub page still needs the token, but the four tools have no login, so anyone who can reach their ports can use them. Do this only on a network you trust. The embedded terminal is off in this mode.
