// The sha256 of every file in src/, cut to 12 hex. CRLF is dropped, so a Windows checkout hashes the same as CI.
// test/version.test.js records it per version, and sdk:sync stamps it on each app's copy.
const { createHash } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, 'src');

module.exports = function srcHash() {
  const h = createHash('sha256');
  for (const f of readdirSync(src).sort()) h.update(readFileSync(path.join(src, f), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 12);
};
