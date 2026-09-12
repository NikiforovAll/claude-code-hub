let apps = {};
let activeApp = null;
const iframes = {};
const loadedApps = new Set();
let allowedOrigins = new Set();
// {theme: 'dark'|'light', colorTheme: '<id>'} — survives hub reloads so
// late-loading iframes and fresh sessions get the last chosen theme.
const themeState = loadThemeState();
// {project, encoded, name} — the current project scope. Deliberately NOT persisted, unlike
// hub-theme: starting unset means there is nothing to race against each sub-app's own
// project self-restore on boot. Once set it never returns to null.
let projectState = null;
// mode: 'project' (Ctrl+Alt+P) or 'configDir' (Ctrl+Alt+W). One widget, two row sources.
const palette = {
  open: false,
  mode: 'project',
  projects: [],
  configDirs: { dirs: [], active: null },
  rows: [],
  sel: 0,
  query: '',
};

function loadThemeState() {
  try {
    return JSON.parse(localStorage.getItem('hub-theme')) ?? {};
  } catch {
    return {};
  }
}

function osTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// Sub-apps disagree on their first-run default (marketplace follows the OS, the rest start dark),
// so an unset theme resolves to the OS preference here and reaches every iframe on load.
function themeMessage() {
  return { type: 'hub:theme', theme: themeState.theme ?? osTheme(), colorTheme: themeState.colorTheme };
}

// {<themeId>: {dark, light}} from /api/config, which derives it from scripts/themes.json — the same
// registry that generates each sub-app's themes.css. Empty until config arrives, and empty if the
// registry is unreadable; either way the palette keeps the --accent from index.html.
let themeAccents = {};

// Paints the palette — the hub's only themed surface — in the active theme. The hub relays
// hub:theme to the sub-apps; this is what makes it apply to the hub's own chrome too.
function applyHubTheme() {
  const mode = themeState.theme ?? osTheme();
  document.documentElement.classList.toggle('light', mode === 'light');
  const pair = themeAccents[themeState.colorTheme];
  if (pair) document.documentElement.style.setProperty('--accent', pair[mode]);
}

// Claude's on-disk project-directory name. Matches memory/server.js encodeProjectPath. The hub
// owns this transform so cost never has to convert anything; the inverse is lossy and not needed.
function encodeProjectPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '-').replace(/\//g, '-');
}

function basename(p) {
  return p.split(/[/\\]/).filter(Boolean).pop() || p;
}

function parentOf(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i <= 0 ? '' : p.slice(0, i);
}

function projectMessage() {
  return {
    type: 'hub:project',
    project: projectState.project,
    encoded: projectState.encoded,
    name: projectState.name,
  };
}

function originOf(appId) {
  return new URL(apps[appId].url).origin;
}

function postTo(appId, message) {
  // Before the iframe commits its src its contentWindow is still on the hub's own
  // origin, so a send addressed to the sub-app origin is refused and logged. The
  // load handler posts the current state anyway, so skipping here loses nothing.
  if (!loadedApps.has(appId)) return;
  iframes[appId]?.contentWindow?.postMessage(message, originOf(appId));
}

// exceptWindow lets an echo of a sub-app's own message skip that sub-app.
function broadcast(message, exceptWindow) {
  for (const [id, iframe] of Object.entries(iframes)) {
    if (exceptWindow && iframe.contentWindow === exceptWindow) continue;
    postTo(id, message);
  }
}

function setProject(absPath) {
  projectState = { project: absPath, encoded: encodeProjectPath(absPath), name: basename(absPath) };
  broadcast(projectMessage());
}

function postProjectTo(appId) {
  if (!projectState) return;
  postTo(appId, projectMessage());
}

// Sub-apps can't detect this themselves: inactive iframes are display:none, and a nested
// document's visibilityState still follows the top-level tab. Used for polling/auto-refresh.
function postActiveTo(appId) {
  postTo(appId, { type: 'hub:active', active: appId === activeApp });
}

async function init() {
  // Twice: light/dark comes from localStorage and shouldn't wait on the fetch, the accent can't be
  // resolved until the registry arrives with it.
  applyHubTheme();
  const res = await fetch('/api/config');
  const config = await res.json();
  setApps(config.apps);
  themeAccents = config.themeAccents ?? {};
  applyHubTheme();
  buildIframes();
  switchTab(Object.keys(apps)[0]);
  listenMessages();
  listenKeys();
  bindPalette();
  registerSW();
}

function setApps(next) {
  apps = next;
  allowedOrigins = new Set(Object.values(apps).map((a) => new URL(a.url).origin));
}

// After a config-dir switch every child is a new process, possibly on a new port. Reloading each
// iframe from scratch also drops the sub-apps' in-memory project state, which belonged to the old
// dir; the hub's own projectState is cleared for the same reason.
function reloadIframes() {
  loadedApps.clear();
  projectState = null;
  // Assigning src navigates even when the URL is unchanged.
  for (const [id, iframe] of Object.entries(iframes)) iframe.src = apps[id].url;
}

function showLoading(text = '') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').classList.remove('fade-out');
}

function hideLoading() {
  document.getElementById('loading-text').textContent = '';
  document.getElementById('loading-overlay').classList.add('fade-out');
}

function buildIframes() {
  const container = document.getElementById('iframe-container');
  for (const [id, cfg] of Object.entries(apps)) {
    const iframe = document.createElement('iframe');
    iframe.id = `iframe-${id}`;
    iframe.src = cfg.url;
    iframe.className = 'hidden';
    iframe.allow = 'clipboard-write';
    iframe.addEventListener('load', () => onIframeLoad(id));
    container.appendChild(iframe);
    iframes[id] = iframe;
  }
}

function switchTab(appId) {
  if (!apps[appId]) return;
  activeApp = appId;

  for (const [id, iframe] of Object.entries(iframes)) {
    iframe.classList.toggle('hidden', id !== appId);
    postActiveTo(id);
  }

  if (loadedApps.has(appId)) hideLoading();
  else showLoading();

  iframes[appId]?.focus();
}

function onIframeLoad(appId) {
  loadedApps.add(appId);
  if (appId === activeApp) hideLoading();
  postTo(appId, themeMessage());
  postProjectTo(appId);
  postActiveTo(appId);
  // Posted twice: the shims gate their origin check on window.__HUB__, which they populate from
  // an async /hub-config fetch that resolves after this load event, so the first post can be
  // dropped. Safe to repeat — every shim's apply is idempotent.
  setTimeout(() => {
    postTo(appId, themeMessage());
    postProjectTo(appId);
    postActiveTo(appId);
  }, 400);
}

function listenMessages() {
  window.addEventListener('message', (e) => {
    if (!allowedOrigins.has(e.origin)) return;
    const data = e.data ?? {};
    if (data.type === 'hub:navigate') {
      if (!apps[data.app]) return;
      switchTab(data.app);
      if (data.url) iframes[data.app].src = apps[data.app].url + data.url;
    } else if (data.type === 'hub:keydown') {
      handleForwardedKey(data);
    } else if (data.type === 'hub:theme') {
      // Legacy senders pass only {theme}; colorTheme is optional and sticky.
      if (data.theme !== 'light' && data.theme !== 'dark') return;
      const hasColor = typeof data.colorTheme === 'string' && /^[a-z0-9-]{0,32}$/.test(data.colorTheme);
      const changed = data.theme !== themeState.theme || (hasColor && data.colorTheme !== themeState.colorTheme);
      if (!changed) return;
      themeState.theme = data.theme;
      if (hasColor) themeState.colorTheme = data.colorTheme;
      localStorage.setItem('hub-theme', JSON.stringify(themeState));
      applyHubTheme();
      broadcast(themeMessage(), e.source);
    }
  });
}

function handleForwardedKey(d) {
  // The modifier fields are new. A sub-app running an older service-worker-cached bundle sends
  // {key} only; it forwards nothing but the pre-existing bindings, and each of those is
  // unambiguous from the key alone, so normalize instead of dispatching twice.
  const alt = typeof d.alt === 'boolean' ? d.alt : true;
  const ctrl = typeof d.alt === 'boolean' ? d.ctrl : d.key.startsWith('Arrow');
  if (!alt || d.shift === true) return;
  if (!ctrl) {
    if (/^[1-9]$/.test(d.key)) switchByIndex(Number(d.key) - 1);
    return;
  }
  if (d.key === 'ArrowLeft') cycleTab(-1);
  else if (d.key === 'ArrowRight') cycleTab(1);
  else if (PALETTE_KEYS[d.key.toLowerCase()]) togglePalette(PALETTE_KEYS[d.key.toLowerCase()]);
}

// Ctrl+Alt+<letter> bindings. Sub-app shims forward every letter, so this is the one keymap.
const PALETTE_KEYS = { p: 'project', w: 'configDir' };

function cycleTab(delta) {
  const ids = Object.keys(apps);
  const idx = ids.indexOf(activeApp);
  const next = ids[(idx + delta + ids.length) % ids.length];
  switchTab(next);
}

function switchByIndex(idx) {
  const ids = Object.keys(apps);
  if (idx < ids.length) switchTab(ids[idx]);
}

function listenKeys() {
  document.addEventListener('keydown', (e) => {
    // Matches both cases: with Ctrl+Alt held, some layouts report AltGr-shifted characters.
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && PALETTE_KEYS[e.key.toLowerCase()]) {
      e.preventDefault();
      togglePalette(PALETTE_KEYS[e.key.toLowerCase()]);
      return;
    }
    // While the palette is open the input owns the keyboard — don't let tab shortcuts fire
    // mid-path (Alt+digit especially, since Windows paths contain digits). Escape still closes:
    // bound here as well as on the input so it works wherever focus landed in the hub document.
    if (palette.open) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      }
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
      const digit = parseInt(e.key, 10);
      if (digit >= 1 && digit <= 9) {
        e.preventDefault();
        switchByIndex(digit - 1);
        return;
      }
    }
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        cycleTab(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        cycleTab(1);
        return;
      }
    }
  });
}

async function loadProjects() {
  const list = await sendJson('GET', '/api/projects');
  // kanban sorts alphabetically; a picker wants most-recently-touched first.
  palette.projects = list
    .map((p) => ({
      path: p.path,
      name: basename(p.path),
      parent: parentOf(p.path),
      ts: p.modifiedAt ? Date.parse(p.modifiedAt) : 0,
    }))
    .sort((a, b) => b.ts - a.ts);
}

function subseq(text, q) {
  let i = 0;
  for (const ch of text) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

// Matches the full path so worktrees with opaque basenames stay reachable, but ranks basename
// hits above parent-path hits. Tier ties fall back to the recency order set in loadProjects.
// Returns {p, tier} so the renderer can mark the field that actually explains the match instead of
// re-deriving it.
function projectRows(projects, q) {
  if (!q) return projects.slice(0, 100).map((p) => ({ p, tier: 0 }));
  const tierOf = (p) => {
    if (p.name.toLowerCase().includes(q)) return 0;
    if (p.path.toLowerCase().includes(q)) return 1;
    return -1;
  };
  let out = projects.map((p) => ({ p, tier: tierOf(p) })).filter((x) => x.tier >= 0);
  if (out.length === 0) {
    // Subsequence only as a fallback — it would otherwise swamp real substring matches.
    out = projects
      .map((p) => {
        const tier = subseq(p.name.toLowerCase(), q) ? 0 : subseq(p.path.toLowerCase(), q) ? 1 : -1;
        return { p, tier };
      })
      .filter((x) => x.tier >= 0);
  }
  out.sort((a, b) => a.tier - b.tier || b.p.ts - a.p.ts);
  return out.slice(0, 100);
}

// The [start, end) slices of `lower` that q matched, mirroring the tiers in projectRows: one
// contiguous range for a substring hit, otherwise the subsequence positions, coalesced so adjacent
// letters share a range. Null when q is absent altogether.
function matchRanges(lower, q) {
  const at = lower.indexOf(q);
  if (at >= 0) return [[at, at + q.length]];
  const ranges = [];
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] !== q[qi]) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
    qi++;
  }
  return qi === q.length ? ranges : null;
}

// Marks the letters that made this row match, so a hit on an opaque basename explains itself.
// Returns nodes, never HTML — a project path must never be interpolated.
function markMatch(text, q) {
  const ranges = q ? matchRanges(text.toLowerCase(), q) : null;
  if (!ranges) return [document.createTextNode(text)];
  const nodes = [];
  let at = 0;
  for (const [from, to] of ranges) {
    if (from > at) nodes.push(document.createTextNode(text.slice(at, from)));
    nodes.push(el('mark', '', text.slice(from, to)));
    at = to;
  }
  if (at < text.length) nodes.push(document.createTextNode(text.slice(at)));
  return nodes;
}

function markedSpan(className, text, q) {
  const node = el('span', className);
  node.append(...markMatch(text, q));
  return node;
}

function looksLikePath(q) {
  return /[/\\:]/.test(q.trim());
}

function relAge(ts) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

async function loadConfigDirs() {
  palette.configDirs = await sendJson('GET', '/api/config-dirs');
}

// Removes a dir from the hub's list only; nothing on disk changes. The server refuses the active
// dir, whose row has no remove button.
async function removeConfigDir(dirPath) {
  try {
    palette.configDirs = await sendJson('DELETE', '/api/config-dirs', { path: dirPath });
  } catch (err) {
    console.warn('remove config dir failed:', err.message);
    return;
  }
  if (palette.open && palette.mode === 'configDir') renderPalette();
}

// `typed` is the trimmed query, `q` its lowercase form for matching.
const PALETTE_MODES = {
  project: {
    placeholder: 'Search projects or type a path...',
    label: 'Switch project',
    empty: 'No matching project',
    literalLabel: 'Use literal path',
    load: loadProjects,
    rows(typed, q) {
      const rows = projectRows(palette.projects, q).map((x) => ({
        kind: 'project',
        path: x.p.path,
        p: x.p,
        tier: x.tier,
      }));
      if (looksLikePath(typed)) rows.push({ kind: 'literal', path: typed });
      return rows;
    },
    fillRow(li, row, q) {
      // Only the field that ranked the row is marked — otherwise a one-letter query like "c"
      // would light up the "C:" drive letter on every row. Tier 0 is a basename hit.
      li.append(
        markedSpan('name', row.p.name, row.tier === 0 ? q : ''),
        markedSpan('parent', row.p.parent, row.tier === 0 ? '' : q),
        el('span', 'age', relAge(row.p.ts)),
      );
    },
    commit: commitProject,
  },
  configDir: {
    placeholder: 'Pick a Claude config dir or type a path to add...',
    label: 'Switch config dir',
    hint: 'Enter switch · Ctrl+D remove · type a path to add',
    empty: 'No matching config dir',
    literalLabel: 'Add config dir',
    load: loadConfigDirs,
    rows(typed, q) {
      const { dirs, active } = palette.configDirs;
      const rows = dirs
        .filter((d) => !q || d.toLowerCase().includes(q))
        .map((d) => ({ kind: 'dir', path: d, active: d === active }));
      if (looksLikePath(typed) && !dirs.some((d) => d.toLowerCase() === q)) rows.push({ kind: 'literal', path: typed });
      return rows;
    },
    // Enter on the default row must switch, so the cursor lands on the dir before the active one,
    // wrapping. With two dirs the palette then behaves like a toggle.
    initialSel(rows) {
      const active = rows.findIndex((r) => r.active);
      if (active < 0 || rows.length < 2) return 0;
      return (active - 1 + rows.length) % rows.length;
    },
    fillRow(li, row, q) {
      li.append(markedSpan('name', row.path, q));
      if (row.active) {
        li.append(el('span', 'age', 'active'));
        return;
      }
      const remove = el('button', 'palette-remove', '×');
      remove.type = 'button';
      remove.title = 'Remove from list (Ctrl+D)';
      remove.dataset.remove = row.path;
      li.append(remove);
    },
    commit: commitConfigDir,
  },
};

function renderPalette() {
  const list = document.getElementById('palette-list');
  const spec = PALETTE_MODES[palette.mode];
  const typed = palette.query.trim();
  const q = typed.toLowerCase();
  const rows = spec.rows(typed, q);
  palette.rows = rows;
  // sel is null until the first render that has rows: the cached list may be empty until load() lands.
  if (palette.sel === null && rows.length > 0) palette.sel = spec.initialSel?.(rows) ?? 0;
  palette.sel = Math.min(palette.sel, Math.max(0, rows.length - 1));
  if (rows.length === 0) {
    list.replaceChildren(el('li', 'palette-empty', spec.empty));
    return;
  }
  list.replaceChildren(
    ...rows.map((row, i) => {
      const li = el(
        'li',
        `palette-row${row.kind === 'literal' ? ' literal' : ''}${i === palette.sel ? ' selected' : ''}`,
      );
      li.dataset.idx = String(i);
      if (row.kind === 'literal') li.textContent = `${spec.literalLabel} -- ${row.path}`;
      else spec.fillRow(li, row, q);
      return li;
    }),
  );
  list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

// textContent throughout — paths are user data and the hub has no escaping helper.
function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function togglePalette(mode) {
  // Same shortcut again closes; the other shortcut swaps the open palette to its mode.
  if (palette.open && palette.mode === mode) closePalette();
  else openPalette(mode);
}

function openPalette(mode) {
  const input = document.getElementById('palette-input');
  const spec = PALETTE_MODES[mode];
  palette.open = true;
  palette.mode = mode;
  palette.query = '';
  palette.sel = null;
  input.value = '';
  input.placeholder = spec.placeholder;
  document.querySelector('#palette .palette-box').setAttribute('aria-label', spec.label);
  document.getElementById('palette-hint').textContent = spec.hint ?? '';
  document.getElementById('palette').hidden = false;
  // Ctrl+Alt+P usually arrives forwarded from a focused iframe. Without inert the sub-app can keep
  // or take focus back, and then Escape is handled inside it — the palette stays open and only the
  // sub-app's own focus visibly changes.
  setIframesInert(true);
  renderPalette();
  input.focus();
  // Stale-while-revalidate: the cached list renders instantly, recency refreshes when this lands.
  spec
    .load()
    .then(() => {
      if (palette.open && palette.mode === mode) renderPalette();
    })
    .catch((err) => console.warn(`${mode} list unavailable:`, err.message));
}

function closePalette() {
  palette.open = false;
  document.getElementById('palette').hidden = true;
  setIframesInert(false);
  iframes[activeApp]?.focus();
}

function setIframesInert(on) {
  for (const iframe of Object.values(iframes)) iframe.inert = on;
}

function movePaletteSel(delta) {
  const n = palette.rows.length;
  if (n === 0) return;
  palette.sel = (palette.sel + delta + n) % n;
  renderPalette();
}

async function commitPalette() {
  const row = palette.rows[palette.sel];
  if (row) await PALETTE_MODES[palette.mode].commit(row);
}

async function commitProject(row) {
  // List rows broadcast verbatim: kanban handed us this exact string and matches it with strict
  // ===. Only a typed path needs normalizing.
  const absPath = row.kind === 'project' ? row.path : await resolveTypedPath(row.path);
  if (!absPath) return;
  closePalette();
  setProject(absPath);
}

async function sendJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Disables the palette input for the duration of a request so Enter can't fire twice.
async function withPaletteBusy(fn) {
  const input = document.getElementById('palette-input');
  input.disabled = true;
  try {
    return await fn();
  } finally {
    input.disabled = false;
    if (palette.open) input.focus();
  }
}

async function commitConfigDir(row) {
  let target = row.path;
  if (row.kind === 'literal') {
    try {
      target = (await withPaletteBusy(() => sendJson('POST', '/api/config-dirs', { path: row.path }))).path;
    } catch (err) {
      console.warn('add config dir failed:', err.message);
      return;
    }
  }
  closePalette();
  // The server would no-op too, but the client would still reload every iframe.
  if (target === palette.configDirs.active) return;
  showLoading(`Switching to ${target}...`);
  try {
    setApps((await sendJson('POST', '/api/config-dirs/activate', { path: target })).apps);
    reloadIframes();
  } catch (err) {
    console.warn('config dir switch failed:', err.message);
    hideLoading();
  }
}

// Returns the real on-disk path, or null when it can't be resolved (the palette stays open).
function resolveTypedPath(typed) {
  return withPaletteBusy(async () => {
    try {
      return (await sendJson('GET', `/api/resolve-path?path=${encodeURIComponent(typed)}`)).path;
    } catch (err) {
      console.warn('resolve-path failed:', err.message);
      return null;
    }
  });
}

function bindPalette() {
  const input = document.getElementById('palette-input');
  input.addEventListener('input', () => {
    palette.query = input.value;
    palette.sel = 0;
    renderPalette();
  });
  // Bound to the input rather than the document: the palette always owns focus while open.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitPalette();
    } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      movePaletteSel(1);
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      movePaletteSel(-1);
    } else if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'd') {
      // Ctrl+D would otherwise bookmark the page in Chrome and Firefox.
      e.preventDefault();
      const row = palette.rows[palette.sel];
      if (row?.kind === 'dir') removeConfigDir(row.path);
    }
  });
  document.getElementById('palette-list').addEventListener('click', (e) => {
    const remove = e.target.closest('.palette-remove');
    if (remove) {
      e.stopPropagation();
      removeConfigDir(remove.dataset.remove);
      document.getElementById('palette-input').focus();
      return;
    }
    const li = e.target.closest('.palette-row');
    if (!li) return;
    palette.sel = Number(li.dataset.idx);
    commitPalette();
  });
  document.getElementById('palette').addEventListener('mousedown', (e) => {
    if (e.target.id === 'palette') closePalette();
  });
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
}

init();
