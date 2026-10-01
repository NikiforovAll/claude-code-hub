'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createParser } = require('./transcript');

const ID = /^[0-9a-f-]{36}$/i;
const ENCODED = /^(?!\.+$)[A-Za-z0-9._-]+$/;

function projectsDir() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function findFile(id, encoded) {
  if (!ID.test(id)) return null;
  const root = projectsDir();
  if (encoded && ENCODED.test(encoded)) {
    const file = path.join(root, encoded, `${id}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  for (const d of listDir(root)) {
    if (!d.isDirectory()) continue;
    const file = path.join(root, d.name, `${id}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

const CACHE_MAX = 8;
const CACHE_BYTES = 256 * 1024 * 1024;
const CHUNK = 4 * 1024 * 1024;
const LINE_MAX = 64 * 1024 * 1024;
const cache = new Map();
const queues = new Map();

const fresh = () => ({ parser: createParser(), offset: 0, rest: [], restLen: 0, skip: false });

// Each chunk read awaits, so a first read of a large transcript does not hold up other requests.
async function feed(entry, fh, to) {
  const buf = Buffer.alloc(Math.min(CHUNK, to - entry.offset));
  while (entry.offset < to) {
    const { bytesRead: n } = await fh.read(buf, 0, Math.min(buf.length, to - entry.offset), entry.offset);
    if (!n) break;
    entry.offset += n;
    let chunk = buf.subarray(0, n);
    let nl = chunk.indexOf(10);
    while (nl !== -1) {
      const head = chunk.subarray(0, nl);
      if (!entry.skip)
        entry.parser.line((entry.restLen ? Buffer.concat([...entry.rest, head]) : head).toString('utf8'));
      Object.assign(entry, { rest: [], restLen: 0, skip: false });
      chunk = chunk.subarray(nl + 1);
      nl = chunk.indexOf(10);
    }
    if (!chunk.length || entry.skip) continue;
    entry.restLen += chunk.length;
    if (entry.restLen > LINE_MAX) Object.assign(entry, { rest: [], restLen: 0, skip: true });
    else entry.rest.push(Buffer.from(chunk));
  }
}

function evict() {
  let total = 0;
  for (const e of cache.values()) total += e.parser.kept();
  for (const [file, e] of cache) {
    if (cache.size <= 1 || (cache.size <= CACHE_MAX && total <= CACHE_BYTES)) break;
    total -= e.parser.kept();
    cache.delete(file);
  }
}

// Claude Code only appends to a transcript, so a grown file is read from where the last read stopped.
async function step(file) {
  const st = await fs.promises.stat(file);
  let entry = cache.get(file);
  if (!entry || st.size < entry.offset) entry = fresh();
  if (st.size > entry.offset) {
    const fh = await fs.promises.open(file, 'r');
    try {
      await feed(entry, fh, st.size);
    } finally {
      await fh.close();
    }
  }
  entry.etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  cache.delete(file);
  cache.set(file, entry);
  evict();
  return { etag: entry.etag, parsed: entry.parser.result() };
}

// Reads of one file run one after another, so two requests never feed the same parser at once.
function load(file) {
  const run = (queues.get(file) ?? Promise.resolve()).catch(() => {}).then(() => step(file));
  queues.set(file, run);
  run
    .finally(() => {
      if (queues.get(file) === run) queues.delete(file);
    })
    .catch(() => {});
  return run;
}

module.exports = { findFile, load };
