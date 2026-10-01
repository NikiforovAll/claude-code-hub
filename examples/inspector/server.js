#!/usr/bin/env node
'use strict';

const path = require('node:path');
const express = require('express');
const sessions = require('./lib/sessions');
const { overview, toolDetail, replyOf } = require('./lib/transcript');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3545);
const ALLOWED = new Set(
  ['localhost', '127.0.0.1', '[::1]', HOST, ...(process.env.ALLOWED_HOSTS || '').split(',')]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

const app = express();
app.disable('x-powered-by');

// A page on another site can reach a loopback server through DNS rebinding. The Host header gives it away.
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (ALLOWED.has(host)) return next();
  res.status(403).json({ error: `host ${host || '(none)'} is not allowed` });
});

if (process.env.HUB_SDK_SERVER) require(process.env.HUB_SDK_SERVER).mount(app);

function sessionFile(req, res) {
  const file = sessions.findFile(req.params.id, req.query.encoded);
  if (!file) res.status(404).json({ error: `no transcript for session ${req.params.id}` });
  return file;
}

// Express 4 does not catch a rejected promise from a handler.
const route = (fn) => (req, res, next) => fn(req, res).catch(next);

app.get(
  '/api/sessions/:id',
  route(async (req, res) => {
    const file = sessionFile(req, res);
    if (!file) return;
    const { etag, parsed } = await sessions.load(file);
    res.set({ ETag: etag, 'Cache-Control': 'no-cache' });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.json({ id: req.params.id, encoded: path.basename(path.dirname(file)), version: etag, ...overview(parsed) });
  }),
);

app.get(
  '/api/sessions/:id/tools/:toolId',
  route(async (req, res) => {
    const file = sessionFile(req, res);
    if (!file) return;
    const detail = toolDetail((await sessions.load(file)).parsed, req.params.toolId);
    if (!detail) return res.status(404).json({ error: `no tool call ${req.params.toolId}` });
    res.json(detail);
  }),
);

app.get(
  '/api/sessions/:id/turns/:n/reply',
  route(async (req, res) => {
    const file = sessionFile(req, res);
    if (!file) return;
    const reply = replyOf((await sessions.load(file)).parsed, Number(req.params.n));
    if (!reply) return res.status(404).json({ error: `no turn ${req.params.n}` });
    res.json(reply);
  }),
);

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, _req, res, _next) => {
  console.error(err);
  const gone = err.code === 'ENOENT';
  res
    .status(gone ? 404 : 500)
    .json({ error: gone ? 'the transcript was removed' : `read failed (${err.code || 'error'})` });
});

if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`Inspector running at http://localhost:${server.address().port}`);
  });
  server.keepAliveTimeout = 65_000;
  server.on('error', (err) => {
    console.error(`Inspector could not listen on ${HOST}:${PORT}: ${err.message}`);
    process.exit(1);
  });
}

module.exports = app;
