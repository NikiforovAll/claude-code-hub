// Copies the SDK stub into an app as public/vendor/claude-hub-sdk.js, with a stamp line on top. The app
// serves it only when run alone: under a hub, the hub hands the app its own SDK. The real client goes to
// test/vendor, so the app's tests run against it; it is not shipped.
//
// Usage: node scripts/sdk-sync.mjs <app id | app dir> [...]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { APPS } = require(join(root, 'lib/apps.js'));
const sdkDir = join(root, 'packages/claude-hub-sdk');
const { version } = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'));
const hash = require(join(sdkDir, 'src-hash.js'))();
const { bundle } = require(join(sdkDir, 'src/server.js'));
const stamped = (file) =>
  `// claude-hub-sdk ${version} (sha256 ${hash}). Copied by npm run sdk:sync in claude-code-hub. Do not edit.\n${bundle(file)}`;
const copies = [
  ['public/vendor/claude-hub-sdk.js', stamped('stub.js')],
  ['test/vendor/claude-hub-sdk.js', stamped('client.js')],
];

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('Usage: npm run sdk:sync -- <app id | app dir> [...]');
  process.exit(1);
}
let failed = false;
for (const target of targets) {
  const appDir = resolve(root, APPS.find((a) => a.id === target)?.dir ?? target);
  if (!existsSync(join(appDir, 'package.json'))) {
    console.error(`${target}: no package.json in ${appDir}`);
    failed = true;
    continue;
  }
  for (const [rel, out] of copies) {
    const file = join(appDir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, out);
    console.log(`${target}: ${file}`);
  }
}
process.exitCode = failed ? 1 : 0;
