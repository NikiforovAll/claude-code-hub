---
description: Bump version, tag, push, and create a GitHub release with auto-generated notes
argument-hint: "[version e.g. 1.13.0 or rc4]"
---

# Release

Create a new release for this project.

## Inputs

- `$ARGUMENTS` — target version or shorthand. Examples:
  - `1.13.0` — full version
  - `rc4` — shorthand for next RC (e.g. if current is `1.19.0-rc.3`, becomes `1.19.0-rc.4`)
  - If not provided, ask the user.

## Steps

1. **Determine version**: Use `$ARGUMENTS` or ask user. Handle `rc<N>` shorthand by reading current version from `package.json` and replacing/appending the RC suffix. Validate it's different from the current version.

2. **Detect prerelease**: If version contains `-rc.`, `-alpha.`, `-beta.`, treat as prerelease.

3. **Check working tree**: Run `git status`. Warn and stop on tracked-file modifications. Ignore untracked-only state (e.g. `.vscode/`) and submodule pointer bumps (those get refreshed in step 4).

4. **Update submodules**: Ensure all submodules are initialized and fast-forwarded to their remote branch tips:
   ```
   git submodule sync
   git submodule update --init
   git submodule update --remote
   ```
   `submodule update --remote` leaves each submodule in detached HEAD at the remote branch tip. Re-attach by checking out the submodule's own default branch — it lands on the same commit, just attached. **Branch names differ per submodule** — detect each one with `git -C <submodule> symbolic-ref refs/remotes/origin/HEAD` (strips to `main` or `master`). Current mapping:
   ```
   git -C cck checkout main
   git -C marketplace checkout main
   git -C cost checkout main
   git -C memory checkout master
   ```
   Skip any submodule that had no changes.

5. **Bump version and commit everything in one commit**:
   - Run `npm version <version> --no-git-tag-version`
   - Update `package.json` dependency versions to match the submodule versions:
     - Read each submodule's `package.json` to get its current version
     - Update the corresponding `^x.y.z` ranges in the hub's `package.json` (fields: `claude-code-cost`, `claude-code-kanban`, `claude-code-marketplace`, `claude-code-memory-explorer`)
   - Stage and commit all changes together (include every submodule that moved):
   ```
   git add package.json package-lock.json marketplace cck cost memory
   git commit -m "🔖 chore: Bump version to <version>"
   git push origin HEAD
   ```
   If submodules have no changes, skip staging them.

7. **Tag & push tag**:
   ```
   git tag v<version>
   git push origin v<version>
   ```

8. **Generate release notes**: Collect commits since the previous tag using `git log --oneline <prev-tag>..HEAD`. Write a **user-facing summary** grouped by:
   - Features (✨) — describe what was added, not raw commit messages
   - Fixes (🐛)
   - Other notable changes
   Include a "Full Changelog" compare link at the bottom.

9. **Create GitHub release** (add `--prerelease` flag for RC/alpha/beta):
   ```
   gh release create v<version> --title "v<version>" --notes "<notes>" [--prerelease]
   ```

10. **Report**: Show the release URL to the user.
