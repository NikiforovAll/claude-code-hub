---
description: Release the hub last, after every sub-app is released and on npm; tag, GitHub release, CI publishes
argument-hint: "[version e.g. 1.13.0 or rc4]"
---

# Release

The hub ships **last**. It pins the sub-apps by npm version, and its release run installs them from npm with `npm ci`. So every submodule must sit on a released tag whose package is already on npm. The **gate** in step 3 enforces this. The tag push starts `.github/workflows/release.yml`, the only publisher: it publishes to npm through trusted publishing and deploys the docs site.

## Inputs

`$ARGUMENTS` is the target version or a shorthand. Ask the user when it is empty.

- `1.13.0` is a full version.
- `rc4` means the next RC: `1.19.0-rc.3` becomes `1.19.0-rc.4`.

A version with `-` is a **prerelease**. Its GitHub release gets `--prerelease`, the workflow publishes it to the `rc` dist-tag, and the docs deploy is skipped.

## Steps

1. **Version.** Resolve `$ARGUMENTS` against `package.json`. Done when you have a version different from the current one.

2. **Clean tree.** Run `git status`. Stop on modified tracked files. Untracked files and submodule pointer changes are fine, because step 3 resets the pointers.

3. **Gate: sub-apps first.** Move every submodule to its remote tip, attached to its default branch:
   ```
   git submodule sync && git submodule update --init --remote
   git -C <sub> symbolic-ref --short refs/remotes/origin/HEAD   # origin/<branch>
   git -C <sub> checkout <branch>
   ```
   A submodule with local commits (`git -C <sub> log origin/<branch>..HEAD` is not empty) stays ahead, because `--remote` does not rewind it. Stop and show those commits to the user: the hub would point at a commit that does not exist on the remote. The user picks one: push and release that sub-app, or reset it to `origin/<branch>`.

   Each submodule passes when both checks pass:
   ```
   git -C <sub> describe --tags --exact-match HEAD   # prints v<version>: HEAD is a release
   npm view <pkg>@<version> version                  # prints <version>: it is on npm
   ```
   - If `describe` fails, the sub-app has commits after its last release. Stop, have the user run `/release` in that repo, then run this step again.
   - If `npm view` prints nothing, that sub-app's release run is still going or failed. Check it with `gh -R NikiforovAll/<repo> run list --workflow release.yml --limit 1`. Wait for it or fix it.

   Done when all 4 submodules pass both checks.

4. **Bump and commit.**
   - Run `npm version <version> --no-git-tag-version`.
   - Set the exact versions (no `^`) of `claude-code-cost`, `claude-code-kanban`, `claude-code-marketplace` and `claude-code-memory-explorer` in `package.json` to each submodule's `package.json` version. The hub hands every app its SDK, so it must run only the app versions it was tested with. Older hubs pinned `^` ranges and still pick up any new minor, so an app change that needs the new hub SDK ships as a major.
   - Run `npm install`, so `package-lock.json` records those versions. `npm ci` fails on a lock that does not match `package.json`.
   - Commit and push:
     ```
     git add package.json package-lock.json cck marketplace cost memory
     git commit -m "🔖 chore: Bump version to <version>"
     git push origin HEAD
     ```

   Done when `npm ls claude-code-cost claude-code-kanban claude-code-marketplace claude-code-memory-explorer` shows the gate's versions, `npm pack --dry-run` lists `packages/claude-hub-sdk/src/client.js`, `server.js` and `stub.js`, and the push succeeded.

5. **macOS tray.** If `git diff --name-only <last tag> HEAD -- tray lib/tray.js` lists files, run `gh workflow run tray-macos.yml --ref <branch>` and `gh run watch <run-id> --exit-status`. Stop on a failure. Done when the run is green or nothing under the tray changed.

6. **Tag.** Run `git tag v<version> && git push origin v<version>`. This starts the release run.

7. **GitHub release.** The hub's own commits are mostly bumps, so the notes cover the sub-apps. For each sub-app that moved (for example "Kanban (→ v4.28.0): …"), group the changes under Features (✨), Fixes (🐛) and Other. Describe what changed for a user, not raw commit messages. End with a Full Changelog compare link.
   ```
   gh release create v<version> --title "v<version>" --notes "<notes>" [--prerelease]
   ```

8. **Watch the run.**
   ```
   gh run list --workflow release.yml --limit 1
   gh run watch <run-id> --exit-status
   ```
   If it fails, fix the cause and run it again from the tag: `gh workflow run release.yml --ref v<version>`. The publish step skips a version that is already on npm. Done when the run is green and `npm view claude-code-hub@<version> version` prints the version.

9. **Report** the GitHub release URL, the run URL and the published npm version.
