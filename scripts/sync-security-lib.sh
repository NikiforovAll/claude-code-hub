#!/usr/bin/env bash
# Copy the canonical security helpers into each submodule that needs them.
#
# These are independent npm packages and cannot import from each other, so the
# helpers are duplicated rather than extracted. Sharing them via a fifth npm
# package would put a release-ordering dependency in front of every future
# security fix, which is the opposite of what a security fix needs.
#
# Run after editing anything in scripts/security-lib/. Pass --check to verify the
# copies are in sync without writing (use this in review / CI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/scripts/security-lib"

# package:destpath[,destpath...] — destpath is relative to the package root; the
# source is scripts/security-lib/<basename>. The shared test file skips whatever a
# given package does not ship, so every package can run the same one.
TARGETS=(
  ".:lib/net-guard.js"
  "cck:lib/open-editor.js,lib/contain.js,lib/net-guard.js,test/security.test.js"
  "marketplace:lib/open-editor.js,lib/contain.js,lib/net-guard.js,test/security.test.js"
  "memory:lib/open-editor.js,lib/net-guard.js,test/security.test.js"
  "cost:lib/net-guard.js,test/security.test.js"
)

CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

status=0
for entry in "${TARGETS[@]}"; do
  pkg="${entry%%:*}"
  IFS=',' read -ra files <<< "${entry#*:}"
  for f in "${files[@]}"; do
    dest="$ROOT/$pkg/$f"
    src="$SRC/$(basename "$f")"
    if (( CHECK )); then
      if ! diff -q "$src" "$dest" >/dev/null 2>&1; then
        echo "OUT OF SYNC: $pkg/$f"
        status=1
      fi
    else
      mkdir -p "$(dirname "$dest")"
      cp "$src" "$dest"
      echo "synced $pkg/$f"
    fi
  done
done

if (( CHECK )) && (( status == 0 )); then
  echo "all security-lib copies in sync"
fi
exit $status
