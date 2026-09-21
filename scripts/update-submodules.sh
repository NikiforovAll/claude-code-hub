#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBMODULES=(marketplace cck cost memory)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'

stale=0
failed=0

for name in "${SUBMODULES[@]}"; do
  dir="$ROOT/$name"
  printf '%s%-12s%s ' "$BOLD" "$name" "$OFF"

  if [[ ! -d "$dir/.git" && ! -f "$dir/.git" ]]; then
    printf '%snot initialized — run: git submodule update --init%s\n' "$RED" "$OFF"
    failed=1
    continue
  fi

  if ! git -C "$dir" fetch -q origin 2>/dev/null; then
    printf '%sfetch failed%s\n' "$RED" "$OFF"
    failed=1
    continue
  fi

  branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
  dirty="$(git -C "$dir" status --porcelain)"

  if [[ -n "$dirty" ]]; then
    printf '%suncommitted changes — skipped%s\n' "$YELLOW" "$OFF"
    failed=1
    continue
  fi

  behind="$(git -C "$dir" rev-list --count HEAD..origin/main)"

  if [[ "$branch" == "main" && "$behind" == "0" ]]; then
    printf '%sup to date%s %s(%s)%s\n' "$GREEN" "$OFF" "$DIM" "$(git -C "$dir" rev-parse --short HEAD)" "$OFF"
    continue
  fi

  stale=1

  if (( CHECK_ONLY )); then
    printf '%sstale%s %s(branch: %s, %s behind origin/main)%s\n' "$YELLOW" "$OFF" "$DIM" "$branch" "$behind" "$OFF"
    continue
  fi

  before="$(git -C "$dir" rev-parse HEAD)"
  if ! git -C "$dir" checkout -q main 2>/dev/null; then
    printf '%scannot checkout main%s\n' "$RED" "$OFF"
    failed=1
    continue
  fi
  if ! git -C "$dir" merge -q --ff-only origin/main 2>/dev/null; then
    printf '%scannot fast-forward main%s\n' "$RED" "$OFF"
    failed=1
    continue
  fi
  after="$(git -C "$dir" rev-parse HEAD)"

  printf '%supdated%s %s(%s..%s)%s\n' "$GREEN" "$OFF" "$DIM" "${before:0:7}" "${after:0:7}" "$OFF"

  if [[ "$before" != "$after" ]] && git -C "$dir" diff --name-only "$before" "$after" | grep -q '^package-lock\.json$\|^package\.json$'; then
    printf '  %sdependencies changed — npm install%s\n' "$DIM" "$OFF"
    (cd "$dir" && npm install --silent) || { printf '  %snpm install failed%s\n' "$RED" "$OFF"; failed=1; }
  fi
done

if (( CHECK_ONLY )); then
  if (( stale )); then
    printf '\n%sSubmodules are stale. Run: npm run update%s\n' "$YELLOW" "$OFF"
    exit 1
  fi
  exit $failed
fi

exit $failed
