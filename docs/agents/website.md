# Website

`website/` is an Astro + Starlight landing and docs site, published at https://nikiforovall.blog/claude-code-hub/. See `website/README.md`.

- It shares its design kit (`src/kit/`, `src/components/`) with the four sub-app sites; keep the copies the same.
- Screenshots come from `~/dev/claude-code-hub-demo` (`node export-site.mjs hub`).
- In every repo except cck, `website/public/shots` is in Git LFS, so a clone needs `git lfs` (the husky hooks call it, and `pre-push` uploads the files). cck keeps its shots in plain git, because its repo is a fork of another repo and GitHub takes no LFS uploads to a public fork.
- `.github/workflows/pages.yml` deploys the site after a stable release, or when run by hand. It pulls the LFS files through a cache, because LFS downloads count against the owner's monthly bandwidth.
