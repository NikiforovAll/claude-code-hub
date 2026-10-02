'use strict';

const REGISTRY_URL = 'https://registry.npmjs.org/claude-code-hub/latest';
const RELEASE_URL = 'https://github.com/NikiforovAll/claude-code-hub/releases/tag/v';
const TIMEOUT_MS = 3000;
const TTL_MS = 12 * 60 * 60 * 1000;

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(String(v));
  return m && { nums: m.slice(1, 4).map(Number), pre: Boolean(m[4]) };
}

// A stable release is newer than its own prereleases. A prerelease is never offered.
function isNewer(latest, current) {
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b || a.pre) return false;
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i];
  return b.pre;
}

async function fetchLatest() {
  const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).version;
}

function createUpdateCheck({ current, enabled = true, fetch = fetchLatest, now = Date.now, ttlMs = TTL_MS }) {
  let latest = null;
  let checkedAt = -Infinity;
  let inflight = null;

  function refresh() {
    if (!enabled) return Promise.resolve();
    if (inflight) return inflight;
    checkedAt = now();
    inflight = (async () => {
      latest = await fetch();
    })()
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  async function update() {
    if (now() - checkedAt >= ttlMs) refresh();
    await inflight;
    return isNewer(latest, current) ? { latest, url: RELEASE_URL + latest } : null;
  }

  return { refresh, update };
}

module.exports = { createUpdateCheck, isNewer };
