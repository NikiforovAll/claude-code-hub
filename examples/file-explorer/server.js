// node server.js [port]; the board sets PORT when it starts the server
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.argv[2] || process.env.PORT) || 4118;
const pagePath = path.join(__dirname, 'index.html');
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const MAX_ENTRIES = 500;
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// One readdir per request, never a walk: a folder is read only when the user opens it.
async function list(dir) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('No folder');
  const abs = path.normalize(dir);
  const all = await fs.promises.readdir(abs, { withFileTypes: true });
  const entries = all
    .map((d) => ({ name: d.name, dir: d.isDirectory() }))
    .sort((a, b) => b.dir - a.dir || byName.compare(a.name, b.name));
  const parent = path.dirname(abs);
  return {
    path: abs,
    parent: parent === abs ? null : parent,
    sep: path.sep,
    entries: entries.slice(0, MAX_ENTRIES),
    more: Math.max(0, entries.length - MAX_ENTRIES),
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    if (!allowedHosts.has(req.headers.host)) return json(res, 403, {});
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/') {
        return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(await fs.promises.readFile(pagePath));
      }
      if (url.pathname === '/api/list') return json(res, 200, await list(url.searchParams.get('path')));
      json(res, 404, {});
    } catch (err) {
      json(res, 400, { error: err.code === 'ENOENT' ? 'Folder not found' : err.code === 'ENOTDIR' ? 'Not a folder' : err.message });
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}/`));
