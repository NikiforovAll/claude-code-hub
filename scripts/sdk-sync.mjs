// Copies the SDK into an app as public/vendor/claude-hub-sdk.js, with a stamp line on top.
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
const src = readFileSync(join(sdkDir, 'src/client.js'), 'utf8');
const { version } = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'));
const hash = createHash('sha256').update(src).digest('hex').slice(0, 12);
const out = `// claude-hub-sdk ${version} (sha256 ${hash}). Copied by npm run sdk:sync in claude-code-hub. Do not edit.\n${src}`;

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
  const file = join(appDir, 'public/vendor/claude-hub-sdk.js');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out);
  console.log(`${target}: ${file}`);
}
process.exitCode = failed ? 1 : 0;
