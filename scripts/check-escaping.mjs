#!/usr/bin/env node
// Fails when an HTML attribute interpolates a template expression without routing it
// through an escaper — and, more usefully, when the number of such sites grows.
//
// Attribute context is the gap the div.textContent->innerHTML escapers left open: that
// trick escapes only & < >, so for years every `attr="${x}"` in these apps was breakable
// with a bare double quote. The escapers are fixed and the highest-risk sites are wrapped,
// but ~100 interpolations still reach an attribute with no escaper at all. Clearing those
// is tracked as a follow-up; this rule holds the line in the meantime.
//
// Each app runs the same check in its own `npm test` (test/escaping.test.js, synced by
// sync-security-lib.sh) against its own test/escaping-baseline.json, so a new site fails
// in the app before it is released. This copy is the hub's backstop over all four.
//
// Usage:
//   node scripts/check-escaping.mjs            fail if any file exceeds its baseline
//   node scripts/check-escaping.mjs --list     print every offender
//   node scripts/check-escaping.mjs --update   rewrite the baselines (only ever downward)

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { argv, exit } from 'node:process';

const { scan, HINT } = createRequire(import.meta.url)('./security-lib/escaping-scan.js');

const APPS = ['cck', 'cost', 'memory', 'marketplace'];
const FILE = 'public/app.js';
const baselinePath = (app) => `${app}/test/escaping-baseline.json`;

const found = {};
for (const app of APPS) {
  let src = '';
  try { src = readFileSync(`${app}/${FILE}`, 'utf8'); } catch {}
  found[app] = scan(src);
}

if (argv.includes('--list')) {
  for (const app of APPS) for (const o of found[app]) console.log(`${app}/${FILE}:${o.line}  ${o.attr}="\${${o.expr}}"`);
  console.log('');
}

if (argv.includes('--update')) {
  for (const app of APPS) {
    writeFileSync(baselinePath(app), `${JSON.stringify({ [FILE]: found[app].length }, null, 2)}\n`);
    console.log(`baseline written: ${app}/${FILE} ${found[app].length}`);
  }
  exit(0);
}

let failed = false;
for (const app of APPS) {
  const f = `${app}/${FILE}`;
  let limit;
  try {
    limit = JSON.parse(readFileSync(baselinePath(app), 'utf8'))[FILE] ?? 0;
  } catch {
    failed = true;
    console.log(`no baseline at ${baselinePath(app)} — run with --update to create one.`);
    continue;
  }
  const now = found[app].length;
  if (now > limit) {
    failed = true;
    console.log(`${f}: ${now} unescaped attribute interpolations, baseline ${limit} (+${now - limit})`);
    for (const o of found[app]) console.log(`  ${f}:${o.line}  ${o.attr}="\${${o.expr}}"`);
  } else if (now < limit) {
    console.log(`${f}: ${now} (baseline ${limit}) — improved, run --update to lock it in`);
  } else {
    console.log(`${f}: ${now} (at baseline)`);
  }
}

if (failed) {
  console.log(`\n${HINT}`);
  exit(1);
}
exit(0);
