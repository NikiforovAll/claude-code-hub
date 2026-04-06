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

3. **Check working tree**: Run `git status`. If there are uncommitted changes, warn the user and stop.

4. **Update submodules**: Ensure all submodules are initialized and up to date, then pull latest commits:
   ```
   git submodule sync
   git submodule update --init
   git submodule update --remote
   git add marketplace cck cost
   git commit -m "chore: update submodules"
   ```
   If there are no submodule changes, skip the commit.

5. **Bump version**:
   ```
   npm version <version> --no-git-tag-version
   ```

6. **Commit & push** (push to current branch, not hardcoded `main`):
   ```
   git add package.json package-lock.json
   git commit -m "🔖 chore: Bump version to <version>"
   git push origin HEAD
   ```

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
