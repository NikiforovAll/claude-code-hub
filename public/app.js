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
const palette = { open: false, projects: [], rows: [], sel: 0, query: '' };

function loadThemeState() {
  try {
    return JSON.parse(localStorage.getItem('hub-theme')) ?? {};
  } catch {
    return {};
  }
}

function themeMessage() {
  return { type: 'hub:theme', theme: themeState.theme, colorTheme: themeState.colorTheme };
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

async function init() {
  const res = await fetch('/api/config');
  apps = (await res.json()).apps;
  allowedOrigins = new Set(Object.values(apps).map((a) => new URL(a.url).origin));
  buildIframes();
  switchTab(Object.keys(apps)[0]);
  listenMessages();
  listenKeys();
  bindPalette();
  registerSW();
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
  }

  const overlay = document.getElementById('loading-overlay');
  if (!loadedApps.has(appId)) {
    overlay.classList.remove('fade-out');
  } else {
    overlay.classList.add('fade-out');
  }

  iframes[appId]?.focus();
}

function onIframeLoad(appId) {
  loadedApps.add(appId);
  if (appId === activeApp) {
    document.getElementById('loading-overlay').classList.add('fade-out');
  }
  if (themeState.theme || themeState.colorTheme) {
    postTo(appId, themeMessage());
  }
  postProjectTo(appId);
  // Posted twice: the shims gate their origin check on window.__HUB__, which they populate from
  // an async /hub-config fetch that resolves after this load event, so the first post can be
  // dropped. Safe to repeat — every shim's apply is idempotent.
  setTimeout(() => postProjectTo(appId), 400);
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
  else if (d.key.toLowerCase() === 'p') togglePalette();
}

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
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      togglePalette();
      return;
    }
    // While the palette is open the input owns the keyboard — don't let tab shortcuts fire
    // mid-path (Alt+digit especially, since Windows paths contain digits).
    if (palette.open) return;
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
  const res = await fetch('/api/projects');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const list = await res.json();
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
function projectRows(projects, query) {
  const q = query.trim().toLowerCase();
  if (!q) return projects.slice(0, 100);
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
  return out.map((x) => x.p).slice(0, 100);
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

function renderPalette() {
  const list = document.getElementById('palette-list');
  const rows = projectRows(palette.projects, palette.query).map((p) => ({ kind: 'project', path: p.path, p }));
  if (looksLikePath(palette.query)) rows.push({ kind: 'literal', path: palette.query.trim() });
  palette.rows = rows;
  palette.sel = Math.min(palette.sel, Math.max(0, rows.length - 1));
  if (rows.length === 0) {
    list.replaceChildren(el('li', 'palette-empty', 'No matching project'));
    return;
  }
  list.replaceChildren(
    ...rows.map((row, i) => {
      const li = el(
        'li',
        `palette-row${row.kind === 'literal' ? ' literal' : ''}${i === palette.sel ? ' selected' : ''}`,
      );
      li.dataset.idx = String(i);
      if (row.kind === 'literal') {
        li.textContent = `Use literal path -- ${row.path}`;
      } else {
        li.append(
          el('span', 'name', row.p.name),
          el('span', 'parent', row.p.parent),
          el('span', 'age', relAge(row.p.ts)),
        );
      }
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

function togglePalette() {
  if (palette.open) closePalette();
  else openPalette();
}

function openPalette() {
  const input = document.getElementById('palette-input');
  palette.open = true;
  palette.query = '';
  palette.sel = 0;
  input.value = '';
  document.getElementById('palette').hidden = false;
  renderPalette();
  input.focus();
  // Stale-while-revalidate: the cached list renders instantly, recency refreshes when this lands.
  loadProjects()
    .then(() => {
      if (palette.open) renderPalette();
    })
    .catch((err) => console.warn('project list unavailable:', err.message));
}

function closePalette() {
  palette.open = false;
  document.getElementById('palette').hidden = true;
  iframes[activeApp]?.focus();
}

function movePaletteSel(delta) {
  const n = palette.rows.length;
  if (n === 0) return;
  palette.sel = (palette.sel + delta + n) % n;
  renderPalette();
}

async function commitPalette() {
  const row = palette.rows[palette.sel];
  if (!row) return;
  // List rows broadcast verbatim: kanban handed us this exact string and matches it with strict
  // ===. Only a typed path needs normalizing.
  const absPath = row.kind === 'project' ? row.path : await resolveTypedPath(row.path);
  if (!absPath) return;
  closePalette();
  setProject(absPath);
}

// Returns the real on-disk path, or null when it can't be resolved (the palette stays open).
async function resolveTypedPath(typed) {
  const input = document.getElementById('palette-input');
  input.disabled = true;
  try {
    const res = await fetch(`/api/resolve-path?path=${encodeURIComponent(typed)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data.path;
    console.warn('resolve-path failed:', data.error || res.status);
  } catch (err) {
    console.warn('resolve-path failed:', err.message);
  } finally {
    input.disabled = false;
    if (palette.open) input.focus();
  }
  return null;
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
    }
  });
  document.getElementById('palette-list').addEventListener('click', (e) => {
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
