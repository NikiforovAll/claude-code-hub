#!/usr/bin/env node
// The perf harness and its data live in the private claude-code-hub-demo repo, so no session
// data is published with the hub. This forwards to it and points it at this checkout.
// Usage: npm run perf -- --scale M [--runs 7] [--save-baseline]
//        npm run perf:compare -- --scale M
//        npm run perf:report
//        npm run perf:world -- --scale M
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const hubDir = path.resolve(import.meta.dirname, '..');
const demoDir = path.resolve(process.env.HUB_DEMO_DIR ?? path.join(hubDir, '..', 'claude-code-hub-demo'));
const [tool, ...rest] = process.argv.slice(2);
const script = path.join(demoDir, 'perf', `${tool}.mjs`);

if (!fs.existsSync(script)) {
  console.error(`perf harness not found: ${script}`);
  console.error('It lives in the private claude-code-hub-demo repo. Clone it next to this one, or set HUB_DEMO_DIR.');
  process.exit(1);
}
const r = spawnSync(process.execPath, [script, ...rest], { cwd: demoDir, stdio: 'inherit', env: { ...process.env, HUB_DIR: hubDir } });
process.exit(r.status ?? 1);
