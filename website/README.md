# Claude Code Hub website

The landing page and docs for Claude Code Hub, published at https://nikiforovall.blog/claude-code-hub/. Built with Astro and Starlight.

## Commands

Run from this folder. Node 22.12 or later.

| Command | Action |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server with hot reload. It prints the local URL. |
| `npm run build` | Build the site to `dist/` |
| `npm run preview` | Serve the built site |

## Layout

- `src/pages/index.astro` is the landing page.
- `src/content/docs/` holds the docs pages. Add each new page to the `sidebar` in `astro.config.mjs`.
- `src/kit/` and `src/components/` are the design kit: layout, themes, `Shot`, `Lightbox`, `Keys`. The same kit is in the Kanban, Marketplace, Cost and Memory Diagnoser sites. Keep the copies the same.
- `public/shots/` holds the screenshots. Theme shots are named `themes/<palette>-<view>-<mode>.webp`, and pages find them by that name. To update a shot, replace the file and keep its name.
- `public/og.png` is the 1200×630 image for link previews.
- `src/content/extensions/<id>.json` is the extension registry: `{source, sha, official, order}`, added by pull request. The pages list entries by `order` (lowest first, entries without it last), then official ones, then by name. An official entry may leave out `sha`: the build then reads the commit at the tip of the repo's default branch (one `git ls-remote` per repo, which needs no token and has no API rate limit), and `ext install <id>`, which the hub resolves through `/extensions.json`, gets the latest code; a pinned entry installs at its `sha`. The build reads each `hub-app.json` from GitHub at that commit (cached in `node_modules/.cache/extensions`), checks it with the hub's `manifestError`, and makes `/extensions/`, `/extensions/<id>/` (`src/extensions/`) and `/extensions.json`, the index that the hub-builder skill reads. The build fails when a manifest cannot be read or has no `listing.tagline`. To preview a manifest that is not pushed yet, set `EXTENSIONS_LOCAL=<id>=<dir>,…` with folders relative to `website/`, for example `EXTENSIONS_LOCAL=inspector=../examples/inspector,swarm=../cck/extensions/swarm npm run dev`.

## Deploy

`.github/workflows/pages.yml` builds and deploys the site to GitHub Pages. `release.yml` calls it after each stable release publishes to npm. To deploy docs without a release, run it by hand from `main` (`gh workflow run pages.yml`).
