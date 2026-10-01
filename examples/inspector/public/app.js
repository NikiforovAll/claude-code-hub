'use strict';

// #region STATE
const $ = (id) => document.getElementById(id);
const main = $('main');
const detail = $('detail');
const picker = $('picker');
const helpModal = $('helpModal');

const POLL_MS = 4000;
const LIVE_WINDOW_MS = 2 * 60 * 1000;
const IDLE_POLL_EVERY = 4;
const CALLS_SHOWN = 6;
const PROMPT_CLAMP = 600;

const state = {
  id: null,
  encoded: null,
  data: null,
  error: null,
  active: true,
  turn: null,
  tool: null,
  open: new Set(),
  range: null,
};
// #endregion STATE

// #region FORMAT
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function tokens(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)} K`;
  return `${(n / 1e6).toFixed(1)} M`;
}

function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const TIME = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });

function clock(iso) {
  const d = new Date(iso);
  const time = TIME.format(d);
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${DAY.format(d)}, ${time}`;
}

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const baseName = (p) => (p ? p.split(/[\\/]/).filter(Boolean).pop() : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

let toastTimer = null;
function toast(text, kind = '') {
  const el = $('toast');
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3500);
}
// #endregion FORMAT

// #region THEME
const COLOR_THEMES = [
  ['ember', 'Ember'],
  ['gruvbox', 'Gruvbox'],
  ['catppuccin', 'Catppuccin'],
  ['tokyo-night', 'Tokyo Night'],
  ['solarized', 'Solarized'],
  ['dracula', 'Dracula'],
  ['nord', 'Nord'],
  ['rose-pine', 'Rosé Pine'],
  ['everforest', 'Everforest'],
  ['kanagawa', 'Kanagawa'],
  ['one-dark', 'One Dark'],
  ['night-owl', 'Night Owl'],
  ['monokai', 'Monokai Pro'],
  ['github', 'GitHub'],
  ['ayu', 'Ayu'],
  ['vitesse', 'Vitesse'],
  ['synthwave', "Synthwave '84"],
];

function store(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setColorTheme(id) {
  if (!id || id === 'ember') delete document.body.dataset.colorTheme;
  else document.body.dataset.colorTheme = id;
  store('color-theme', id && id !== 'ember' ? id : null);
  syncThemeMenu();
}

function buildThemeMenu(themes = COLOR_THEMES) {
  $('themeMenu').innerHTML = themes
    .map(
      ([
        id,
        label,
      ]) => `<button type="button" role="menuitemradio" class="theme-menu-item theme-swatch-${esc(id)}" data-color-theme-id="${esc(id)}">
        <span class="theme-swatch theme-swatch-${esc(id)}"><i class="sw-bg"></i><i class="sw-accent"></i><i class="sw-ink"></i></span>${esc(label)}
      </button>`,
    )
    .join('');
  syncThemeMenu();
}

function syncThemeMenu() {
  const cur = document.body.dataset.colorTheme || 'ember';
  for (const el of document.querySelectorAll('.theme-menu-item')) {
    const on = el.dataset.colorThemeId === cur;
    el.classList.toggle('on', on);
    el.setAttribute('aria-checked', String(on));
  }
}

function toggleThemeMenu(force) {
  const menu = $('themeMenu');
  const open = menu.classList.toggle('open', force);
  $('themePickerBtn').setAttribute('aria-expanded', String(open));
}

function toggleTheme() {
  const light = document.body.classList.toggle('light');
  store('theme', light ? 'light' : 'dark');
}

if (stored('theme') === 'light') document.body.classList.add('light');
if (stored('color-theme')) document.body.dataset.colorTheme = stored('color-theme');
buildThemeMenu();
// #endregion THEME

// #region DATA
// The browser turns a 304 into a 200 with the stored body, so the ETag goes by hand and a 304 returns null.
async function getJson(url, etag) {
  const r = await fetch(url, { cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} });
  if (r.status === 304) return null;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || `HTTP ${r.status}`), { status: r.status });
  return body;
}

// The picker lists only the sessions opened here, so it reads no transcripts. The list lives in localStorage,
// which is empty when the hub gives the app a new port.
const TOUCHED_KEY = 'touched';
const TOUCHED_MAX = 10;

function touched() {
  try {
    const list = JSON.parse(stored(TOUCHED_KEY));
    return Array.isArray(list) ? list.filter((s) => s?.id) : [];
  } catch {
    return [];
  }
}

function saveTouched(list) {
  store(TOUCHED_KEY, list.length ? JSON.stringify(list.slice(0, TOUCHED_MAX)) : null);
}

function touch(data) {
  const entry = {
    id: data.id,
    encoded: data.encoded,
    title: data.meta.title,
    cwd: data.meta.cwd,
    at: new Date().toISOString(),
  };
  saveTouched([entry, ...touched().filter((s) => s.id !== data.id)]);
}

const forget = (id) => saveTouched(touched().filter((s) => s.id !== id));

const query = () => (state.encoded ? `?encoded=${encodeURIComponent(state.encoded)}` : '');

async function load({ manual = false } = {}) {
  const id = state.id;
  if (!id) return;
  const btn = $('refreshBtn');
  if (manual) btn.classList.add('loading');
  try {
    const data = await getJson(`/api/sessions/${encodeURIComponent(id)}${query()}`, state.data?.version);
    if (id !== state.id) return;
    state.error = null;
    if (data) {
      const stale = state.tool && toolStatus(state.data, state.tool) !== toolStatus(data, state.tool);
      if (!state.data) touch(data);
      state.encoded = data.encoded;
      state.data = data;
      render();
      if (stale) openTool(state.tool, { keepFocus: true });
    }
  } catch (err) {
    if (id !== state.id) return;
    if (state.data && !manual) return;
    if (state.data) toast(`Refresh failed: ${err.message}`, 'error');
    else {
      if (err.status === 404) forget(id);
      state.error = err.message;
      render();
    }
  } finally {
    btn.classList.remove('loading');
  }
}

function openSession(id, encoded = null) {
  if (picker.open) picker.close();
  if (!id || (id === state.id && (state.data || !state.error))) return;
  Object.assign(state, { id, encoded, data: null, error: null, turn: null, range: null });
  state.open.clear();
  closeDetail();
  const url = new URL(location.href);
  url.searchParams.set('session', id);
  url.searchParams.delete('encoded');
  history.replaceState(null, '', url);
  main.scrollTop = 0;
  render();
  load();
}

const isLive = () => !!state.data && Date.now() - new Date(state.data.meta.updated).getTime() < LIVE_WINDOW_MS;

// An idle session can start again at any time, so it is polled too, less often. An unchanged file answers 304.
let ticks = 0;
setInterval(() => {
  ticks += 1;
  if (!state.id || !state.active || document.visibilityState !== 'visible') return;
  if (isLive() || ticks % IDLE_POLL_EVERY === 0) load();
}, POLL_MS);
// #endregion DATA

// #region HUB_INTEGRATION
const hub = ClaudeHub.connect();

(function initHubTheme() {
  const getTheme = () => (document.body.classList.contains('light') ? 'light' : 'dark');
  const getColorTheme = () => document.body.dataset.colorTheme || 'ember';
  const report = hub.bindTheme({
    get: () => ({ theme: getTheme(), colorTheme: getColorTheme() }),
    set: ({ theme, colorTheme }) => {
      if (colorTheme !== getColorTheme()) setColorTheme(colorTheme);
      if (theme !== getTheme()) toggleTheme();
    },
  });
  new MutationObserver(report).observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'data-color-theme'],
  });
})();

hub.onThemes((themes) => buildThemeMenu(themes.map((t) => [t.id, t.label])));

// The hub replays Kanban's last session after welcome and before the first hub:active (protocol §4).
// A page opened on ?session= keeps its own session, so it skips that replay.
let pinnedByUrl = new URLSearchParams(location.search).has('session');
let settled = false;
hub.subscribe('session.changed', (s) => {
  if (!s?.sessionId || pinnedByUrl) return;
  openSession(s.sessionId, s.encoded);
});

hub.handle('session.inspect', ({ session }) => {
  if (session) openSession(session);
});

hub.onActive((active) => {
  state.active = active;
  settled = true;
  pinnedByUrl = false;
  if (active && state.id) load();
  else autoPick();
});

function settleAlone(status) {
  if (settled || (status !== 'standalone' && status !== 'unanswered')) return;
  settled = true;
  autoPick();
}

hub.onStatus((status) => {
  settleAlone(status);
  renderTopbar();
});
settleAlone(hub.status);

document.getElementById('githubLink').addEventListener('click', (e) => {
  if (!hub.inHub) return;
  e.preventDefault();
  hub.openExternal(e.currentTarget.href);
});
// #endregion HUB_INTEGRATION

// #region RENDER
function renderTopbar() {
  const btn = $('sessionBtn');
  const title = state.data?.meta.title || (state.id ? (state.error ? 'Not found' : 'Loading…') : 'No session');
  $('sessionName').textContent = title;
  btn.classList.toggle('is-live', !!state.data && isLive());
  btn.title = state.data && isLive() ? 'Live session. Open another session (o)' : 'Open a session (o)';
  $('costBtn').hidden = !(state.id && hub.can('session.cost'));
}

function render() {
  renderTopbar();
  if (!state.id) return renderEmpty();
  if (state.error) return renderError();
  if (!state.data) {
    main.innerHTML = '<p class="loading">Reading the transcript…</p>';
    return;
  }
  renderSession();
}

function sessionList() {
  const list = touched();
  if (!list.length) return '<p class="quiet">The sessions that you open show here.</p>';
  return `<h4 class="pick-label">Opened recently</h4><ul class="sessions">${list
    .map(
      (
        s,
      ) => `<li><button class="session${s.id === state.id ? ' is-current' : ''}" data-open="${esc(s.id)}" data-encoded="${esc(s.encoded ?? '')}">
        <span class="session-title">${esc(s.title || 'Untitled session')}</span>
        <span class="session-where">${esc(baseName(s.cwd) || s.encoded || s.id)}</span>
        <span class="session-when">${esc(ago(s.at))}</span>
      </button></li>`,
    )
    .join('')}</ul>`;
}

const SESSION_REF = /(?:([^\\/]+)[\\/])?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.jsonl)?$/i;

// Takes a session ID, or the path of its transcript, which also names the project folder.
function sessionRef(text) {
  const m = text
    .trim()
    .replace(/^["']|["']$/g, '')
    .match(SESSION_REF);
  if (!m) return null;
  return { id: m[2].toLowerCase(), encoded: m[3] ? m[1] : null };
}

function renderEmpty() {
  main.innerHTML = `<section class="empty">
    <p><button class="btn" data-act="pick">Open a session</button> <kbd>o</kbd></p>
  </section>`;
}

function renderError() {
  main.innerHTML = `<section class="empty">
    <h1>The transcript did not load</h1>
    <p>${esc(state.error)}. The session can be in another config dir, or its file was removed.</p>
    <p><button class="btn" data-act="pick">Open another session</button></p>
  </section>`;
}

function summary({ meta, totals }) {
  const parts = [
    plural(totals.turns, 'turn'),
    `${plural(totals.tools, 'tool call')}${totals.failed ? ` (${totals.failed} failed)` : ''}`,
  ];
  parts.push(`${tokens(totals.output)} tokens written`);
  if (totals.durationMs) parts.push(`${duration(totals.durationMs)} of work`);
  const where = [];
  if (meta.cwd) where.push(`in <b>${esc(baseName(meta.cwd))}</b>`);
  if (meta.gitBranch) where.push(`on <span class="branch">${esc(meta.gitBranch)}</span>`);
  if (meta.model) where.push(`with ${esc(meta.model.replace(/^claude-/, ''))}`);
  return `<p class="where">${where.join(' ')}</p><p class="totals">${esc(parts.join(', '))}.</p>`;
}

function bars(turns, peak) {
  return turns
    .map((t) => {
      const h = Math.max(3, Math.round((t.context / Math.max(1, peak)) * 100));
      const { failed } = t;
      const cls = state.turn === t.n ? 'bar is-sel' : 'bar';
      const label = `Turn ${t.n}: ${tokens(t.context)} context${failed ? `, ${plural(failed, 'failed tool call')}` : ''}`;
      return `${t.compactedBefore ? '<span class="cut" aria-hidden="true"></span>' : ''}<button class="${cls}" style="--h:${h}%" data-turn="${t.n}"${failed ? ` data-fails="${failed}"` : ''} title="${esc(label)}" aria-label="${esc(label)}"></button>`;
    })
    .join('');
}

function axis(turns, peak) {
  const first = turns[0];
  const last = turns[turns.length - 1];
  return `<span><b>Turn ${first.n}</b> ${esc(clock(first.at))}</span>
    <span>Context after each turn, peak ${esc(tokens(peak))}</span>
    <span>${esc(clock(last.at))} <b>Turn ${last.n}</b></span>`;
}

const statusOf = (t) => (t.ok === false ? 'fail' : t.ok ? 'ok' : 'wait');
const sizeOf = (t) => (t.ok == null ? '' : bytes(t.resultBytes));

function call(t) {
  const st = statusOf(t);
  const glyph = { ok: '✓', fail: '✕', wait: '•' }[st];
  const said = { ok: '', fail: ', failed', wait: ', no result yet' }[st];
  return `<li><button class="call st-${st}${state.tool === t.id ? ' is-sel' : ''}" data-tool="${esc(t.id)}" aria-label="${esc(`${t.name} ${t.summary}${said}`)}">
    <span class="glyph" aria-hidden="true">${glyph}</span><span class="name">${esc(t.name)}</span><span class="sum">${esc(t.summary)}</span><span class="size">${esc(sizeOf(t))}</span>
  </button></li>`;
}

function turnHtml(t) {
  const open = state.open.has(t.n);
  const shown = open || t.tools.length <= CALLS_SHOWN + 2 ? t.tools : t.tools.slice(0, CALLS_SHOWN);
  const more = t.tools.length - shown.length;
  const clamped = t.prompt.length > PROMPT_CLAMP && !open;
  const meta = [
    `<time datetime="${esc(t.at)}">${esc(clock(t.at))}</time>`,
    t.durationMs ? `<span>${esc(duration(t.durationMs))}</span>` : '',
    t.context ? `<span>${esc(tokens(t.context))} context</span>` : '',
    t.tokens.output ? `<span>${esc(tokens(t.tokens.output))} written</span>` : '',
    t.failed ? `<span class="fail">${t.failed} failed</span>` : '',
    t.queued ? '<span>queued</span>' : '',
    t.interrupted ? '<span class="warn">interrupted</span>' : '',
  ].join('');
  const expand = more > 0 ? `Show ${plural(more, 'more tool call')}` : clamped ? 'Show the full prompt' : '';
  return `${t.compactedBefore ? '<p class="compact">Context compacted here</p>' : ''}
  <article class="turn${state.turn === t.n ? ' is-sel' : ''}" id="turn-${t.n}" data-turn-row="${t.n}">
    <a class="turn-n" href="#turn-${t.n}" data-turn="${t.n}" aria-label="Turn ${t.n}">${t.n}</a>
    <div class="turn-body">
      <div class="turn-meta">${meta}</div>
      <p class="prompt${clamped ? ' is-clamped' : ''}">${esc(t.prompt)}</p>
      ${shown.length ? `<ol class="calls">${shown.map(call).join('')}</ol>` : ''}
      ${expand ? `<button class="more" data-expand="${t.n}">${expand}</button>` : ''}
      ${t.reply ? `<div class="reply"><div class="reply-who">Claude</div><p>${esc(t.reply)}</p></div>` : ''}
    </div>
  </article>`;
}

function renderSession() {
  const d = state.data;
  const atEnd = main.scrollHeight - main.scrollTop - main.clientHeight < 80 && main.scrollTop > 0;
  const focused = main.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  windowFor(d.turns.length);
  dragging = false;
  main.innerHTML = `<header class="head">
      <h1>${esc(d.meta.title || 'Untitled session')}</h1>
      ${summary(d)}
    </header>
    ${
      d.turns.length
        ? `<figure class="tide-wrap">
      <div class="tide" role="group" aria-label="Context size after each turn"></div>
      <figcaption class="tide-axis"></figcaption>
      ${brushHtml(d.turns.length)}
    </figure>`
        : ''
    }
    <div class="ledger"></div>`;
  initBrush(d.turns, d.totals.peak);
  renderView();
  if (atEnd && isLive()) main.scrollTop = main.scrollHeight;
  if (focused) main.querySelector(focused)?.focus({ preventScroll: true });
}

function renderView() {
  const d = state.data;
  const { start, end, total } = state.range;
  const turns = d.turns.slice(start, end);
  const ledger = main.querySelector('.ledger');
  if (!turns.length) {
    ledger.innerHTML = '<p class="quiet">This session has no prompts yet.</p>';
    return;
  }
  main.querySelector('.tide').innerHTML = bars(turns, d.totals.peak);
  main.querySelector('.tide-axis').innerHTML = axis(turns, d.totals.peak);
  layoutBrush();
  fitTide();
  if (dragging) return;
  ledger.innerHTML = `${start > 0 ? `<button class="more page" data-act="earlier">Show ${plural(Math.min(start, end - start), 'earlier turn')}</button>` : ''}
    ${turns.map(turnHtml).join('')}
    ${end < total ? `<button class="more page" data-act="later">Show ${plural(Math.min(total - end, end - start), 'later turn')}</button>` : ''}`;
  watchView();
}

function focusKey(el) {
  for (const key of ['tool', 'expand', 'turn']) {
    const hit = el.closest(`[data-${key}]`);
    if (hit) return `[data-${key}="${CSS.escape(hit.dataset[key])}"]`;
  }
  return null;
}

const toolStatus = (data, id) => {
  for (const t of data?.turns ?? []) for (const x of t.tools) if (x.id === id) return x.ok;
};

function fitTide() {
  const el = main.querySelector('.tide');
  if (!el) return;
  el.classList.remove('is-dense');
  if (el.scrollWidth > el.clientWidth) el.classList.add('is-dense');
  el.scrollLeft = el.scrollWidth;
}

let resizeTimer = null;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fitTide, 150);
});

let viewer = null;
function watchView() {
  viewer?.disconnect();
  const stick = main.querySelector('.tide-wrap')?.offsetHeight ?? 0;
  main.style.setProperty('--stick', `${stick}px`);
  const byTurn = new Map([...main.querySelectorAll('.bar')].map((b) => [b.dataset.turn, b]));
  viewer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) byTurn.get(e.target.dataset.turnRow)?.classList.toggle('in-view', e.isIntersecting);
    },
    { root: main, rootMargin: `-${stick}px 0px 0px 0px` },
  );
  for (const el of main.querySelectorAll('.turn')) viewer.observe(el);
}
// #endregion RENDER

// #region BRUSH
// A long session would put hundreds of turns in the page, so the tide and the ledger show a window of turns.
// The brush moves that window over the whole session. A window at the last turn stays there as new turns come in.
const WINDOW_PRESETS = [25, 50, 100, 200];
const WINDOW_DEFAULT = 50;
const WINDOW_MIN = 5;
// The ledger can hold hundreds of turns, so a drag redraws only the tide and the brush, and the ledger follows on release.
let dragging = false;

function clampRange(start, end, total) {
  const min = Math.min(WINDOW_MIN, total);
  const s = Math.max(0, Math.min(start, total - min));
  return { start: s, end: Math.max(s + min, Math.min(end, total)) };
}

function windowFor(total) {
  const prev = state.range;
  const want = prev?.size ?? WINDOW_DEFAULT;
  const size = Math.min(want, total);
  const start = !prev || prev.end === prev.total ? total - size : prev.start;
  state.range = { size: want, total, ...clampRange(start, start + size, total) };
}

function setWindow(start, end, size) {
  const r = state.range;
  const next = clampRange(start, end, r.total);
  r.size = size ?? next.end - next.start;
  if (next.start === r.start && next.end === r.end) return;
  Object.assign(r, next);
  renderView();
}

function slideWindow(start) {
  const r = state.range;
  const n = r.end - r.start;
  const s = Math.max(0, Math.min(start, r.total - n));
  setWindow(s, s + n, r.size);
}

function brushHtml(total) {
  if (total <= WINDOW_PRESETS[0]) return '';
  const presets = WINDOW_PRESETS.filter((n) => n < total)
    .map((n) => `<button type="button" class="brush-preset" data-size="${n}">${n}</button>`)
    .join('');
  return `<div class="brush">
    <div class="brush-track" tabindex="0" role="slider" aria-label="Turns shown" aria-valuemin="1" aria-valuemax="${total}">
      <svg class="brush-overview" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><polygon /><polyline /></svg>
      <div class="brush-marks" aria-hidden="true"></div>
      <div class="brush-window">
        <div class="brush-handle is-start" data-edge="start"></div>
        <div class="brush-handle is-end" data-edge="end"></div>
      </div>
    </div>
    <div class="brush-foot">
      <span class="brush-scope"></span>
      <span class="brush-presets" role="group" aria-label="Turns in the window">${presets}<button type="button" class="brush-preset" data-size="all">All</button></span>
    </div>
  </div>`;
}

function layoutBrush() {
  const track = main.querySelector('.brush-track');
  if (!track) return;
  const { start, end, total } = state.range;
  const size = end - start;
  const win = track.querySelector('.brush-window');
  win.style.left = `${(start / total) * 100}%`;
  win.style.width = `${(size / total) * 100}%`;
  const text = size === total ? `All ${total} turns` : `Turns ${start + 1} to ${end} of ${total}`;
  main.querySelector('.brush-scope').textContent = text;
  track.setAttribute('aria-valuenow', String(start + 1));
  track.setAttribute('aria-valuetext', text);
  for (const p of main.querySelectorAll('.brush-preset'))
    p.classList.toggle('on', (p.dataset.size === 'all' ? total : Number(p.dataset.size)) === size);
}

// Brings the first turn of a moved window into view, unless the page still shows the session header.
function toWindowStart() {
  const first = $(`turn-${state.range.start + 1}`);
  if (first && main.scrollTop > main.querySelector('.ledger').offsetTop - main.querySelector('.tide-wrap').offsetHeight)
    first.scrollIntoView({ block: 'start' });
}

function initBrush(turns, peak) {
  const track = main.querySelector('.brush-track');
  if (!track) return;
  const total = turns.length;
  const x = (i) => ((i + 0.5) / total) * 1000;
  const pts = turns.map((t, i) => `${x(i)},${100 - (t.context / Math.max(1, peak)) * 90}`).join(' ');
  track.querySelector('polyline').setAttribute('points', pts);
  track.querySelector('polygon').setAttribute('points', `${x(0)},100 ${pts} ${x(total - 1)},100`);
  track.querySelector('.brush-marks').innerHTML = turns
    .map(
      (t, i) =>
        `${t.compactedBefore ? `<span class="brush-cut" style="left:${(i / total) * 100}%"></span>` : ''}${t.failed ? `<span class="brush-fail" style="left:${((i + 0.5) / total) * 100}%"></span>` : ''}`,
    )
    .join('');

  const r = () => state.range;
  const span = () => r().end - r().start;
  const step = () => Math.max(1, Math.round(span() / 5));
  const moved = (fn) => {
    fn();
    toWindowStart();
  };

  // Pointer events outrun the frame rate, so a drag writes the window once per frame.
  let frame = 0;
  let pending = null;
  const later = (fn) => {
    pending = fn;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const fn = pending;
      pending = null;
      moved(fn);
    });
  };

  // Pointer capture keeps a fast drag alive after the cursor leaves the thin track.
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    track.focus({ preventScroll: true });
    const rect = track.getBoundingClientRect();
    const perPx = total / rect.width;
    const edge = e.target.dataset?.edge;
    const win = track.querySelector('.brush-window');
    if (!edge && e.target !== win) {
      const i = Math.floor((e.clientX - rect.left) * perPx);
      moved(() => slideWindow(i - Math.floor(span() / 2)));
    }
    const origin = { x: e.clientX, start: r().start, end: r().end };
    track.classList.add('dragging');
    track.setPointerCapture(e.pointerId);
    dragging = true;
    const move = (ev) => {
      const delta = Math.round((ev.clientX - origin.x) * perPx);
      if (edge === 'start') later(() => setWindow(origin.start + delta, origin.end));
      else if (edge === 'end') later(() => setWindow(origin.start, origin.end + delta));
      else later(() => slideWindow(origin.start + delta));
    };
    const up = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      dragging = false;
      if (pending) pending();
      pending = null;
      moved(renderView);
      track.classList.remove('dragging');
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', up);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  });

  track.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const d = (e.deltaY || e.deltaX) > 0 ? step() : -step();
      later(() => slideWindow(r().start + d));
    },
    { passive: false },
  );

  track.addEventListener('keydown', (e) => {
    const n = e.shiftKey ? span() : step();
    const to = { ArrowLeft: r().start - n, ArrowRight: r().start + n, Home: 0, End: total }[e.key];
    if (to == null) return;
    e.preventDefault();
    e.stopPropagation();
    moved(() => slideWindow(to));
  });

  for (const p of main.querySelectorAll('.brush-preset'))
    p.addEventListener('click', () => {
      if (p.dataset.size === 'all') return moved(() => setWindow(0, total, Infinity));
      const n = Number(p.dataset.size);
      const end = Math.min(total, Math.max(r().end, n));
      moved(() => setWindow(end - n, end, n));
    });
}
// #endregion BRUSH

// #region DETAIL
function closeDetail() {
  state.tool = null;
  detail.hidden = true;
  detail.innerHTML = '';
  for (const el of document.querySelectorAll('.call.is-sel')) el.classList.remove('is-sel');
}

const pretty = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

async function openTool(id, { keepFocus = false } = {}) {
  state.tool = id;
  for (const el of document.querySelectorAll('.call')) el.classList.toggle('is-sel', el.dataset.tool === id);
  detail.hidden = false;
  if (!keepFocus) detail.innerHTML = '<p class="loading">Loading the tool call…</p>';
  let t;
  try {
    t = await getJson(`/api/sessions/${encodeURIComponent(state.id)}/tools/${encodeURIComponent(id)}${query()}`);
  } catch (err) {
    if (state.tool === id) detail.innerHTML = `<p class="quiet">${esc(err.message)}</p>`;
    return;
  }
  if (state.tool !== id) return;
  const st = statusOf(t);
  const took = t.doneAt && t.at ? duration(new Date(t.doneAt) - new Date(t.at)) : null;
  detail.innerHTML = `<header class="detail-head">
      <h2>${esc(t.name)}</h2>
      <button class="iconbtn" data-act="close" aria-label="Close the tool call">✕</button>
    </header>
    <p class="detail-meta"><span class="st-${st}">${{ ok: 'Done', fail: 'Failed', wait: 'No result yet' }[st]}</span><span>turn ${t.turn}</span>${t.at ? `<span>${esc(clock(t.at))}</span>` : ''}${took ? `<span>took ${esc(took)}</span>` : ''}${t.ok == null ? '' : `<span>${esc(sizeOf(t))}</span>`}</p>
    <h3>Input</h3>
    <pre class="code">${esc(pretty(t.input))}</pre>
    <h3>Result</h3>
    ${t.result == null ? '<p class="quiet">Claude Code has not written a result for this call.</p>' : `<pre class="code${t.ok === false ? ' is-fail' : ''}">${esc(t.result || '(empty)')}</pre>`}`;
  if (!keepFocus) detail.querySelector('[data-act="close"]').focus({ preventScroll: true });
}
// #endregion DETAIL

// #region MODAL
function autoPick() {
  if (!settled || state.id || !state.active || picker.open || helpModal.open) return;
  const last = touched()[0];
  if (last) openSession(last.id, last.encoded);
  else showPicker();
}

function showPicker() {
  picker.innerHTML = `<div class="modal-header"><h3 id="pickerTitle">Open a session</h3><button class="modal-close" data-act="close-picker" aria-label="Close dialog">&#10005;</button></div>
    <div class="modal-body">
      ${hub.inHub ? '<p class="modal-desc">The Inspector also follows the session that you open in Kanban.</p>' : ''}
      <form class="pick-form" id="pickForm">
        <input id="pickInput" class="pick-input" aria-label="Session ID or transcript path" placeholder="Session ID or path to its .jsonl file" autocomplete="off" spellcheck="false">
        <button class="btn" type="submit">Open</button>
      </form>
      <p class="pick-error" id="pickError" hidden></p>
      ${sessionList()}
    </div>`;
  if (!picker.open) picker.showModal();
  $('pickInput').focus();
}

picker.addEventListener('submit', (e) => {
  e.preventDefault();
  const ref = sessionRef($('pickInput').value);
  const error = $('pickError');
  error.hidden = !!ref;
  if (!ref) {
    error.textContent =
      'Paste a session ID, such as 1f0c3a52-7d2e-4b8a-9c41-5e6f7a8b9c0d, or the path to its .jsonl file.';
    return;
  }
  openSession(ref.id, ref.encoded);
});

const SHORTCUTS = [
  [['j'], 'Next turn'],
  [['k'], 'Previous turn'],
  [['g'], 'First turn'],
  [['G'], 'Last turn'],
  [['o'], 'Open a session'],
  [['r'], 'Refresh'],
  [['t'], 'Toggle light and dark'],
  [['Esc'], 'Close the tool call or the dialog'],
  [['?'], 'Show this help'],
];

function showHelp() {
  $('helpShortcuts').innerHTML = SHORTCUTS.map(
    ([keys, label]) => `<dt>${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</dt><dd>${esc(label)}</dd>`,
  ).join('');
  helpModal.showModal();
}

for (const dlg of [picker, helpModal]) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
}
// #endregion MODAL

// #region EVENTS
function selectTurn(n) {
  state.turn = n;
  const r = state.range;
  if (r && (n <= r.start || n > r.end)) slideWindow(n - 1 - Math.floor((r.end - r.start) / 2));
  for (const el of document.querySelectorAll('.bar')) el.classList.toggle('is-sel', Number(el.dataset.turn) === n);
  const tideEl = main.querySelector('.tide');
  const bar = tideEl?.querySelector('.bar.is-sel');
  if (bar && (bar.offsetLeft < tideEl.scrollLeft || bar.offsetLeft > tideEl.scrollLeft + tideEl.clientWidth)) {
    tideEl.scrollLeft = bar.offsetLeft - tideEl.clientWidth / 2;
  }
  for (const el of document.querySelectorAll('.turn')) el.classList.toggle('is-sel', Number(el.dataset.turnRow) === n);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $(`turn-${n}`)?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#themePickerBtn')) toggleThemeMenu(false);
  const el = e.target.closest(
    '[data-turn],[data-tool],[data-expand],[data-open],[data-act],[data-color-theme-id],#themePickerBtn',
  );
  if (!el) return;
  if (el.dataset.colorThemeId) {
    setColorTheme(el.dataset.colorThemeId);
    toggleThemeMenu(false);
  } else if (el.id === 'themePickerBtn') {
    toggleThemeMenu();
  } else if (el.dataset.open) {
    e.preventDefault();
    openSession(el.dataset.open, el.dataset.encoded);
  } else if (el.dataset.tool) {
    if (state.tool === el.dataset.tool) closeDetail();
    else openTool(el.dataset.tool);
  } else if (el.dataset.expand) {
    state.open.add(Number(el.dataset.expand));
    renderSession();
  } else if (el.dataset.turn) {
    e.preventDefault();
    selectTurn(Number(el.dataset.turn));
  } else {
    act(el.dataset.act);
  }
});

async function act(name) {
  if (name === 'pick') showPicker();
  else if (name === 'close-picker') picker.close();
  else if (name === 'close-help') helpModal.close();
  else if (name === 'close') closeDetail();
  else if (name === 'help') showHelp();
  else if (name === 'theme') toggleTheme();
  else if (name === 'refresh') load({ manual: true });
  else if (name === 'earlier' || name === 'later') {
    const r = state.range;
    const n = r.end - r.start;
    slideWindow(name === 'earlier' ? r.start - n : r.end);
    $(`turn-${name === 'earlier' ? state.range.end : state.range.start + 1}`)?.scrollIntoView({ block: 'start' });
  } else if (name === 'cost') {
    const r = await hub.invoke('session.cost', { session: state.id });
    if (!r.ok) toast(`Cost did not open: ${r.reason}`, 'error');
  }
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  if (picker.open || helpModal.open) return;
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  if (e.key === 'Escape') {
    if ($('themeMenu').classList.contains('open')) return toggleThemeMenu(false);
    if (state.tool) return closeDetail();
    return;
  }
  if (e.key === 'Enter' && e.target.id === 'themePickerBtn') return toggleThemeMenu();
  const keys = { o: 'pick', r: 'refresh', t: 'theme', '?': 'help' };
  if (keys[e.key]) {
    e.preventDefault();
    return act(keys[e.key]);
  }
  const turns = state.data?.turns;
  if (!turns?.length) return;
  const n = turns.length;
  const at = state.turn;
  const next = { j: Math.min(n, (at ?? 0) + 1), k: Math.max(1, (at ?? n + 1) - 1), g: 1, G: n }[e.key];
  if (next == null) return;
  e.preventDefault();
  selectTurn(next);
});
// #endregion EVENTS

// #region INIT
const params = new URLSearchParams(location.search);
if (params.get('session')) openSession(params.get('session'), params.get('encoded'));
else render();
// #endregion INIT
