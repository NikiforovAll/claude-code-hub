// node server.js [port]; the board sets PORT when it starts the server
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const port = Number(process.argv[2] || process.env.PORT) || 4117;
const page = fs.readFileSync(path.join(__dirname, 'index.html'));
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const THROTTLE_MS = 300;

function git(cwd, args, okCodes = [0]) {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-optional-locks', ...args], { cwd, maxBuffer: 64 << 20, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      if (okCodes.includes(code)) resolve(stdout);
      else reject(new Error((stderr || err.message).trim()));
    });
  });
}

function folder(p) {
  if (!p || !path.isAbsolute(p) || !fs.existsSync(p)) throw new Error('No folder');
  return p;
}

function parseNumstat(out) {
  const map = new Map();
  const t = out.split('\0');
  for (let i = 0; i < t.length; i++) {
    if (!t[i]) continue;
    const [add, del, p] = t[i].split('\t');
    let file = p;
    if (p === '') {
      file = t[i + 2];
      i += 2;
    }
    map.set(file, add === '-' ? { binary: true } : { add: Number(add), del: Number(del) });
  }
  return map;
}

const pathField = (entry, n) => entry.split(' ').slice(n).join(' ');

function parseStatus(out) {
  const branch = { name: null, head: '', upstream: null, ahead: 0, behind: 0, detached: false, unborn: false };
  const groups = { conflict: [], staged: [], unstaged: [], untracked: [] };
  const t = out.split('\0');
  for (let i = 0; i < t.length; i++) {
    const e = t[i];
    if (e.startsWith('# ')) {
      const [, key, ...rest] = e.split(' ');
      const v = rest.join(' ');
      if (key === 'branch.oid') v === '(initial)' ? (branch.unborn = true) : (branch.head = v.slice(0, 7));
      else if (key === 'branch.head') v === '(detached)' ? (branch.detached = true) : (branch.name = v);
      else if (key === 'branch.upstream') branch.upstream = v;
      else if (key === 'branch.ab') [branch.ahead, branch.behind] = rest.map((n) => Math.abs(Number(n)));
    } else if (e[0] === '?') groups.untracked.push({ path: e.slice(2), code: '?' });
    else if (e[0] === 'u') groups.conflict.push({ path: pathField(e, 10), code: 'U' });
    else if (e[0] === '1' || e[0] === '2') {
      const xy = e.slice(2, 4);
      const file = pathField(e, e[0] === '1' ? 8 : 9);
      const from = e[0] === '2' ? t[++i] : null;
      if (xy[0] !== '.') groups.staged.push({ path: file, from, code: xy[0] });
      if (xy[1] !== '.') groups.unstaged.push({ path: file, code: xy[1] });
    }
  }
  return { branch, groups };
}

const toPosix = (p) => p.split(path.sep).join('/');
const inside = (root, p) => {
  const rel = path.relative(root, p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? toPosix(rel) : null;
};

function parseWorktrees(out) {
  return out
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const wt = { path: null, branch: null };
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) wt.path = line.slice(9);
        else if (line.startsWith('branch ')) wt.branch = line.slice(7).replace(/^refs\/heads\//, '');
        else if (line === 'bare') wt.path = null;
      }
      return wt;
    })
    .filter((wt) => wt.path);
}

async function status(root) {
  const [st, unstagedNum, stagedNum, log, unpushed, wts] = await Promise.all([
    git(root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']),
    git(root, ['diff', '--numstat', '-z']),
    git(root, ['diff', '--cached', '--numstat', '-z']),
    git(root, ['log', '-10', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%at%x1e']).catch(() => ''),
    git(root, ['rev-list', '--max-count=10', 'HEAD', '--not', '--remotes']).catch(() => ''),
    git(root, ['worktree', 'list', '--porcelain']).catch(() => ''),
  ]);
  const local = new Set(unpushed.split(/\s+/).filter(Boolean));
  const { branch, groups } = parseStatus(st);
  const sn = parseNumstat(stagedNum);
  const un = parseNumstat(unstagedNum);
  for (const f of groups.staged) Object.assign(f, sn.get(f.path));
  for (const f of groups.unstaged) Object.assign(f, un.get(f.path));
  const commits = log
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [full, hash, subject, author, at] = r.split('\x1f');
      return { hash, subject, author, at: Number(at), pushed: !local.has(full) };
    });
  const worktrees = parseWorktrees(wts);
  const main = worktrees[0]?.path;
  for (const wt of worktrees) Object.assign(wt, { rel: main && inside(main, wt.path), current: wt.path === root });
  return { root, branch, groups, commits, worktrees };
}

function diff(root, file, kind) {
  const base = ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '-M'];
  if (kind === 'untracked') return git(root, [...base, '--no-index', '--', '/dev/null', file], [0, 1]);
  if (kind === 'staged') return git(root, [...base, '--cached', '--', file]);
  return git(root, [...base, '--', file]);
}

const frame = (json) => `data: ${json}\n\n`;
const errorFrame = (err) => `retry: 10000\n${frame(JSON.stringify({ error: err.message }))}`;
const watches = new Map();

const MAX_KNOWN = 5000;
const DIRS_REFRESH_MS = 10_000;

async function ignoredDirs(root) {
  const out = await git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']);
  return new Set(out.split('\0').filter((p) => p.endsWith('/')));
}

function underDir(dirs, p) {
  for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) if (dirs.has(p.slice(0, i + 1))) return p.slice(0, i + 1);
  return null;
}

function checkIgnore(root, paths) {
  return new Promise((resolve) => {
    const child = execFile('git', ['check-ignore', '-z', '--stdin'], { cwd: root, windowsHide: true }, (_err, stdout) =>
      resolve(new Set(stdout.split('\0').filter(Boolean))),
    );
    child.stdin.end(paths.join('\0'));
  });
}

const remember = (set, p) => set.size < MAX_KNOWN && set.add(p);

async function openWatch(root) {
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).trim();
  const w = {
    clients: new Set(), last: '', running: false, dirty: false, timer: null,
    relevant: false, reset: false, pending: new Set(), dirs: new Set(), dirsAt: 0,
    tracked: new Set(), ignored: new Set(), snap: null, nested: new Map(), touched: new Set(),
  };
  const publish = () => {
    const s = w.snap;
    const json = JSON.stringify(s.error ? s : { ...s, worktrees: s.worktrees.map((wt) => ({ ...wt, touched: w.touched.has(wt.path) })) });
    if (json === w.last) return;
    w.last = json;
    for (const c of w.clients) c.write(frame(json));
  };
  ignoredDirs(root).then((d) => (w.dirs = d), () => {});
  // Changes git ignores never reach status; a batch of only those costs one check-ignore.
  const anyTracked = async (batch) => {
    const paths = [...batch];
    const ignored = await checkIgnore(root, paths);
    let kept = false;
    for (const p of paths) {
      if (ignored.has(p)) remember(w.ignored, p);
      else {
        remember(w.tracked, p);
        kept = true;
      }
    }
    if (!kept && Date.now() - w.dirsAt > DIRS_REFRESH_MS) {
      w.dirs = await ignoredDirs(root).catch(() => w.dirs);
      w.dirsAt = Date.now();
    }
    return kept;
  };
  w.run = async () => {
    clearTimeout(w.timer);
    w.timer = null;
    w.running = true;
    w.dirty = false;
    const batch = w.pending;
    let relevant = w.relevant;
    w.pending = new Set();
    w.relevant = false;
    try {
      if (w.reset) {
        w.reset = false;
        w.tracked.clear();
        w.ignored.clear();
        w.dirs = await ignoredDirs(root);
        w.dirsAt = Date.now();
      }
      if (!relevant && batch.size) relevant = await anyTracked(batch);
      if (relevant) {
        w.snap = await status(root);
        w.nested = new Map();
        for (const wt of w.snap.worktrees) {
          const rel = inside(root, wt.path);
          if (rel) w.nested.set(`${rel}/`, wt.path);
        }
      }
    } catch (err) {
      w.snap = { error: err.message };
    }
    w.running = false;
    if (w.snap) publish();
    if (w.dirty) schedule();
  };
  const schedule = () => {
    if (w.running) w.dirty = true;
    else if (!w.timer) w.timer = setTimeout(w.run, THROTTLE_MS);
  };
  const mark = () => {
    w.relevant = true;
    schedule();
  };
  w.kick = () => {
    w.relevant = true;
    if (w.running) w.dirty = true;
    else w.run();
  };
  // Objects and other worktrees' admin files never change this checkout's status.
  const onGit = (rel) => {
    if (rel === 'info/exclude') w.reset = true;
    if (!/^(objects\/|worktrees\/[^/]+\/.)/.test(rel)) mark();
  };
  const onRoot = (_ev, name) => {
    if (!name) return mark();
    const p = toPosix(name);
    const wt = w.nested.get(underDir(w.nested, p));
    if (wt) {
      if (w.touched.has(wt)) return;
      w.touched.add(wt);
      if (w.snap) publish();
      return;
    }
    if (p === '.git' || p.startsWith('.git/')) return onGit(p.slice(5));
    if (p.endsWith('.gitignore')) w.reset = true;
    if (w.reset || w.tracked.has(p)) return mark();
    if (w.ignored.has(p) || underDir(w.dirs, p)) return;
    w.pending.add(p);
    schedule();
  };
  w.watchers = [fs.watch(root, { recursive: true }, onRoot).on('error', () => {})];
  if (!inside(root, gitDir)) w.watchers.push(fs.watch(gitDir, { recursive: true }, (_ev, name) => (name ? onGit(toPosix(name)) : mark())).on('error', () => {}));
  return w;
}

async function subscribe(cwd, res) {
  let closed = false;
  let leave = () => {};
  res.on('close', () => {
    closed = true;
    leave();
  });
  let root, w;
  try {
    root = (await git(folder(cwd), ['rev-parse', '--show-toplevel'])).trim();
    if (!watches.has(root)) watches.set(root, openWatch(root));
    w = await watches.get(root);
  } catch (err) {
    if (root) watches.delete(root);
    return res.end(errorFrame(err));
  }
  leave = () => {
    w.clients.delete(res);
    if (w.clients.size) return;
    clearTimeout(w.timer);
    for (const x of w.watchers) x.close();
    watches.delete(root);
  };
  if (closed) return leave();
  w.clients.add(res);
  if (w.last) res.write(frame(w.last));
  else w.kick();
}

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json');

http
  .createServer(async (req, res) => {
    if (!allowedHosts.has(req.headers.host)) return json(res, 403, {});
    const url = new URL(req.url, 'http://x');
    const q = url.searchParams;
    try {
      if (url.pathname === '/') return send(res, 200, page, 'text/html; charset=utf-8');
      if (url.pathname === '/api/diff') return json(res, 200, { text: await diff(folder(q.get('root')), q.get('path'), q.get('kind')) });
      if (url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': open\n\n');
        return subscribe(q.get('cwd'), res);
      }
      json(res, 404, {});
    } catch (err) {
      json(res, 400, { error: err.message });
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}/`));
