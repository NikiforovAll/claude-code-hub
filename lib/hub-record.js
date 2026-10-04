'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function recordFile(hubDir) {
  return path.join(hubDir, 'hub.json');
}

function readRecord(hubDir) {
  try {
    return JSON.parse(fs.readFileSync(recordFile(hubDir), 'utf8'));
  } catch {
    return null;
  }
}

function writeRecord(hubDir, port) {
  fs.writeFileSync(recordFile(hubDir), `${JSON.stringify({ pid: process.pid, port })}\n`);
}

function removeRecord(hubDir) {
  if (readRecord(hubDir)?.pid === process.pid) fs.rmSync(recordFile(hubDir), { force: true });
}

// A killed hub leaves its record behind, and its pid and port can be reused, so only a hub that
// accepts this hub dir's token counts as live. http.get with no agent, not fetch: the callers exit
// right after, and on Windows process.exit with an undici socket still closing trips a libuv assertion.
function liveHub(hubDir, token) {
  const record = readRecord(hubDir);
  if (!Number.isInteger(record?.port)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: record.port, path: `/api/config?token=${token}`, agent: false, timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200 ? record : null);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

module.exports = { writeRecord, removeRecord, liveHub };
