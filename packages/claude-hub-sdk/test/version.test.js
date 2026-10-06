const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const srcHash = require('../src-hash');
const { version } = require('../package.json');

// Each released version and the hash of its src/. A change to src/ needs a new version here, in
// package.json and in CHANGELOG.md, then `npm run sdk:sync` for each app.
const RELEASED = {
  '1.0.0': '17957c297dc7',
  '1.1.0': '0fed14faa670',
  '1.2.0': '62c7d9f477b2',
  '1.3.0': '4c9f3341a24d',
  '1.4.0': '7d559a8888ce',
};

describe('version', () => {
  it('names the current src with its own version', () => {
    const hash = srcHash();
    assert.equal(
      RELEASED[version],
      hash,
      `src changed (sha256 ${hash}) but the version is still ${version}. Bump it and record the hash`,
    );
  });

  it('has a CHANGELOG entry for the version', () => {
    assert.match(
      readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'),
      new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm'),
    );
  });
});
