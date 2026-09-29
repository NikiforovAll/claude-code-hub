// Copies the SDK into an app, with a stamp line on top: the client as public/vendor/claude-hub-sdk.js
// and the server module as lib/vendor/claude-hub-sdk.js.
//
// Usage: node scripts/sdk-sync.mjs <app id | app dir> [...]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { APPS } = createRequire(import.meta.url)(join(root, 'lib/apps.js'));
const sdkDir = join(root, 'packages/claude-hub-sdk');
const { version } = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'));
const stamped = (file) => {
  const src = readFileSync(join(sdkDir, 'src', file), 'utf8');
  const hash = createHash('sha256').update(src).digest('hex').slice(0, 12);
  return `// claude-hub-sdk ${version} (sha256 ${hash}). Copied by npm run sdk:sync in claude-code-hub. Do not edit.\n${src}`;
};
const copies = [
  ['public/vendor/claude-hub-sdk.js', stamped('client.js')],
  ['lib/vendor/claude-hub-sdk.js', stamped('server.js')],
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
