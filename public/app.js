let apps = {};
// bindings() builds it from apps and userKeys; setApps clears it.
let keymap = null;
// config.json `keys`, {actionId: combo | null}, from /api/config.
let userKeys = {};
const { comboOf, keyParts } = ClaudeHubKeys;
let activeApp = null;
// The app launcher's cursor starts here, so Ctrl+Alt+A then Enter goes back to the last tab.
let previousApp = null;
const iframes = {};
const loadedApps = new Set();
const guardedApps = new Set();
// App id → the topics its hub:hello subscribes to. An app is live from its hello until the next
// iframe load: e.source is the same WindowProxy across reloads, so a new document starts unknown.
const liveApps = new Map();
// Apps whose next document the hub loads from an action URL.
const linkLoads = new Set();
const HUB_PROTOCOLS = [1];
// Option+digit types a character on macOS (Option+5 is '[' on German layouts), so the tab numbers
// there are Control+Option+digit.
const IS_MAC = /^Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
// {theme: 'dark'|'light', colorTheme: '<id>', colorThemes: {<configDir>: '<id>'}} — survives hub
// reloads so late-loading iframes and fresh sessions get the last chosen theme. Light/dark is
// global; the color theme is per config dir, and colorTheme is the last one picked anywhere, which
// a dir that has never been themed inherits.
const themeState = loadThemeState();
// Keys themeState.colorThemes. Null until /api/config lands, so the first paint uses the fallback.
let activeConfigDir = null;
// {project, encoded, name} — the current project scope. Deliberately NOT persisted, unlike
// hub-theme: starting unset means there is nothing to race against each sub-app's own
// project self-restore on boot. Once set it never returns to null.
let projectState = null;
// Topic → {from, payload}: the last value of each topic an app published. Cleared with projectState.
const published = new Map();
// App id → the published topics it missed while hidden. It gets their last value when it comes on screen.
const missed = new Map();
const MAX_EVENT_CHARS = 16 * 1024;
// The config dir the hub falls back to (~/.claude). Stays out of the window title.
let defaultConfigDir = null;
// The app launcher's footer: the hub version from /api/config and its plugin from /api/apps/stats.
const hubInfo = { version: null, plugin: null };
// mode: 'project' (Ctrl+Alt+P), 'configDir' (Ctrl+Alt+W) or 'app' (Ctrl+Alt+A). One widget, three row sources.
const palette = {
  open: false,
  mode: 'project',
  projects: [],
  configDirs: { dirs: [], active: null },
  rows: [],
  sel: 0,
  query: '',
  confirmRestart: null,
  message: null,
};

function loadThemeState() {
  let state;
  try {
    state = JSON.parse(localStorage.getItem('hub-theme')) ?? {};
  } catch {
    state = {};
  }
  if (!state.colorThemes || typeof state.colorThemes !== 'object') state.colorThemes = {};
  return state;
}

// The color theme of the active config dir, falling back to the last one picked anywhere.
// An id the registry lacks shows as Ember everywhere, so the hub page and every app agree.
function activeColorTheme() {
  const id = themeState.colorThemes[activeConfigDir] ?? themeState.colorTheme;
  return id && hubThemes.length && !themeVars[id] ? 'ember' : id;
}

function osTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// Sub-apps disagree on their first-run default (marketplace follows the OS, the rest start dark),
// so an unset theme resolves to the OS preference here and reaches every iframe on load.
function themePayload() {
  return { theme: themeState.theme ?? osTheme(), colorTheme: activeColorTheme() };
}

function sendTheme(appId) {
  const payload = themePayload();
  const vars = themeVars[payload.colorTheme ?? 'ember']?.[payload.theme];
  sendTopic(appId, 'theme.changed', vars ? { ...payload, vars } : payload);
}

// {<themeId>: {dark, light}}, each a map of the apps' core CSS variables, from /api/config, which
// derives it from lib/themes.json — the same registry that generates each sub-app's themes.css.
// Empty until config arrives, and empty if the registry is unreadable; then the hub keeps
// index.html's colors.
let themeVars = {};
// The picker list that welcome carries.
let hubThemes = [];
// {<action>: {app, params, url, mode}} from the manifests, one handler each, from /api/config.
let actions = {};
// The hub page's names for the core variables. --bg is the apps' --bg-deep, so the loading screen
// hands off to an iframe without a flash of another color.
const HUB_VARS = {
  '--accent': '--accent',
  '--bg': '--bg-deep',
  '--surface': '--bg-surface',
  '--surface-hover': '--bg-hover',
  '--border': '--border',
  '--text': '--text-primary',
  '--text-dim': '--text-muted',
};
// The last applied variables, so the loading screen paints in the theme before /api/config lands.
const PALETTE_KEY = 'hub-palette';

// Paints the hub's own surfaces (loading screen, palette) in the active theme. The hub relays
// hub:theme to the sub-apps; this is what makes it apply to the hub's own chrome too.
function applyHubTheme() {
  const mode = themeState.theme ?? osTheme();
  const root = document.documentElement;
  root.classList.toggle('light', mode === 'light');
  const key = `${activeColorTheme()}/${mode}`;
  const core = themeVars[activeColorTheme()]?.[mode];
  let vars = core && Object.fromEntries(Object.entries(HUB_VARS).map(([hub, name]) => [hub, core[name]]));
  try {
    if (vars) localStorage.setItem(PALETTE_KEY, JSON.stringify({ key, vars }));
    else {
      const cached = JSON.parse(localStorage.getItem(PALETTE_KEY));
      if (cached?.key === key) vars = cached.vars;
    }
  } catch {}
  root.style.cssText = '';
  for (const [name, value] of Object.entries(vars ?? {})) root.style.setProperty(name, value);
}

// Claude's on-disk project-directory name: every non-alphanumeric character becomes a dash. The hub
// owns this transform so cost never has to convert anything; the inverse is lossy and not needed.
function encodeProjectPath(p) {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

function basename(p) {
  return p.split(/[/\\]/).filter(Boolean).pop() || p;
}

function parentOf(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i <= 0 ? '' : p.slice(0, i);
}

function originOf(appId) {
  return new URL(apps[appId].url).origin;
}

function postTo(appId, message) {
  // Before the iframe commits its src its contentWindow is still on the hub's own
  // origin, so a send addressed to the sub-app origin is refused and logged. The
  // app's hello brings the current state anyway, so skipping here loses nothing.
  if (!loadedApps.has(appId)) return;
  iframes[appId]?.contentWindow?.postMessage(message, originOf(appId));
}

function appIdOf(source) {
  return Object.keys(iframes).find((id) => iframes[id].contentWindow === source);
}

// The last value lives in themeState and projectState, so a replay after welcome is a send.
function sendTopic(appId, topic, payload) {
  if (liveApps.get(appId)?.has(topic)) postTo(appId, { type: 'hub:event', topic, payload });
}

// `worktrees` are the linked worktrees the projects provider folded into this repo.
function setProject(absPath, worktrees = []) {
  projectState = {
    project: absPath,
    encoded: encodeProjectPath(absPath),
    name: basename(absPath),
    worktrees: worktrees.map((p) => ({ path: p, encoded: encodeProjectPath(p) })),
  };
  for (const id of Object.keys(iframes)) sendProject(id);
}

function sendProject(appId) {
  if (!projectState) return;
  sendTopic(appId, 'project.changed', projectState);
}

// Protocol §10. A payload with a string `project` gets the hub's encoded form and short name, as in project.changed.
function onPublish(appId, { topic, payload }) {
  if (!apps[appId].publishes.includes(topic)) return;
  if (payload !== null && !isPlainObject(payload)) return;
  try {
    if (JSON.stringify(payload).length > MAX_EVENT_CHARS) return;
  } catch {
    return;
  }
  const event =
    typeof payload?.project === 'string'
      ? { ...payload, encoded: encodeProjectPath(payload.project), projectName: basename(payload.project) }
      : payload;
  published.set(topic, { from: appId, payload: event });
  for (const id of Object.keys(iframes)) {
    if (id === appId) continue;
    if (id === activeApp) sendTopic(id, topic, event);
    else if (liveApps.get(id)?.has(topic)) missed.set(id, (missed.get(id) ?? new Set()).add(topic));
  }
}

function sendPublished(appId) {
  missed.delete(appId);
  for (const [topic, { from, payload }] of published) if (from !== appId) sendTopic(appId, topic, payload);
}

function sendMissed(appId) {
  for (const topic of missed.get(appId) ?? []) {
    const last = published.get(topic);
    if (last && last.from !== appId) sendTopic(appId, topic, last.payload);
  }
  missed.delete(appId);
}

// Sub-apps can't detect this themselves: inactive iframes are display:none, and a nested
// document's visibilityState still follows the top-level tab. Used for polling/auto-refresh.
function postActiveTo(appId) {
  if (!liveApps.has(appId)) return;
  const active = appId === activeApp;
  if (active) sendMissed(appId);
  postTo(appId, { type: 'hub:active', active });
}

async function init() {
  // Twice: light/dark comes from localStorage and shouldn't wait on the fetch, the accent can't be
  // resolved until the registry arrives with it.
  applyHubTheme();
  showLoading();
  const res = await fetch('/api/config');
  const config = await res.json();
  userKeys = config.keys ?? {};
  hubInfo.version = config.version ?? null;
  setApps(config.apps);
  defaultConfigDir = config.defaultConfigDir ?? null;
  activeConfigDir = config.activeConfigDir ?? null;
  applyTitle(config.activeConfigDir);
  themeVars = config.themeVars ?? {};
  hubThemes = config.themes ?? [];
  actions = config.actions ?? {};
  applyHubTheme();
  buildIframes();
  const saved = storedTab();
  switchTab(apps[saved] ? saved : Object.keys(apps)[0]);
  listenMessages();
  listenKeys();
  bindPalette();
  registerSW();
  bindErrorToast();
  showUpdateToast();
}

// One key, overwritten by each dismissal: a dismissed version stays hidden until a newer one ships.
const UPDATE_DISMISSED_KEY = 'hub-update-dismissed';
const UPDATE_TOAST_MS = 10_000;

async function showUpdateToast() {
  let info;
  try {
    info = await sendJson('GET', '/api/update');
  } catch {
    return;
  }
  const latest = info.update?.latest;
  let dismissed = null;
  try {
    dismissed = localStorage.getItem(UPDATE_DISMISSED_KEY);
  } catch {}
  if (!latest || latest === dismissed) return;
  const toast = document.getElementById('update-toast');
  document.getElementById('update-latest').textContent = latest;
  document.getElementById('update-current').textContent = info.version;
  document.getElementById('update-notes').href = info.update.url;
  let timer = 0;
  const hide = () => {
    clearTimeout(timer);
    hideToast(toast);
  };
  const arm = () => (timer = setTimeout(hide, UPDATE_TOAST_MS));
  toast.addEventListener('mouseenter', () => clearTimeout(timer));
  toast.addEventListener('mouseleave', arm);
  document.getElementById('update-close').addEventListener('click', hide);
  document.getElementById('update-skip').addEventListener('click', () => {
    try {
      localStorage.setItem(UPDATE_DISMISSED_KEY, latest);
    } catch {}
    hide();
  });
  showToast(toast);
  arm();
}

function showToast(toast) {
  toast.classList.remove('leaving');
  toast.hidden = false;
}

// A show during the fade cancels the hide.
function hideToast(toast) {
  toast.classList.add('leaving');
  setTimeout(() => {
    if (toast.classList.contains('leaving')) toast.hidden = true;
  }, 200);
}

// Null on success. A 409 with live terminals asks for force: true on the next call.
async function requestRestart(id, force) {
  try {
    await sendJson('POST', `/api/apps/${encodeURIComponent(id)}/restart`, { force });
    return null;
  } catch (err) {
    const name = apps[id]?.name ?? id;
    const n = err.status === 409 && err.data?.terminals;
    if (!n) return { message: `${name} did not restart: ${err.message}` };
    const them = n === 1 ? 'it' : 'them';
    return { terminals: n, message: `${name} has ${n} live terminal${n === 1 ? '' : 's'}. A restart ends ${them}.` };
  }
}

const ERROR_TOAST_MS = 8_000;
let errorToastTimer = 0;

function hideErrorToast() {
  clearTimeout(errorToastTimer);
  hideToast(document.getElementById('error-toast'));
}

// A 401 means the hub_token cookie no longer matches the token file. Opening /?token=… sets a new
// cookie; reloading lands on the locked page, where the token can be pasted instead.
function showErrorToast(action, err) {
  const unauthorized = err.status === 401;
  document.getElementById('error-title').textContent = unauthorized ? `${action}: hub token rejected` : action;
  document.getElementById('error-detail').textContent = unauthorized
    ? `This browser has an old hub token. Open the link the hub printed in the terminal (${location.origin}/?token=…) to renew it.`
    : err.message;
  document.getElementById('error-actions').hidden = !unauthorized;
  showToast(document.getElementById('error-toast'));
  clearTimeout(errorToastTimer);
  if (!unauthorized) errorToastTimer = setTimeout(hideErrorToast, ERROR_TOAST_MS);
}

function bindErrorToast() {
  document.getElementById('error-close').addEventListener('click', hideErrorToast);
  document.getElementById('error-reload').addEventListener('click', () => location.reload());
}

// The hub has no visible chrome, so the window/tab title is the only place the active config dir
// shows. Only a non-default dir is named, and by basename alone — the PWA window prepends the
// manifest name, so a product name here would read as "Claude Code Hub - .claude-eom · Hub".
function applyTitle(dir) {
  document.title = dir && dir !== defaultConfigDir ? basename(dir) : 'Claude Code Hub';
}

// After a config-dir switch every child is a new process, possibly on a new port. Reloading each
// iframe from scratch also drops the sub-apps' in-memory project state, which belonged to the old
// dir; the hub's own projectState is cleared for the same reason.
function reloadIframes() {
  loadedApps.clear();
  projectState = null;
  published.clear();
  missed.clear();
  // A new element, because assigning src is only a fragment navigation when the app's URL
  // differs from the new one by the #t= fragment alone, and the old dir's document stays.
  for (const id of Object.keys(iframes)) replaceIframe(id);
}

function replaceIframe(id) {
  const old = iframes[id];
  liveApps.delete(id);
  linkLoads.delete(id);
  loadedApps.delete(id);
  const fresh = makeIframe(id);
  fresh.className = old.className;
  fresh.inert = old.inert;
  const focused = document.activeElement === old;
  old.replaceWith(fresh);
  iframes[id] = fresh;
  if (focused) fresh.focus();
}

// The old document stays live until the new one fires load, and a hub:action sent to it in between is lost.
function loadApp(id, src, { link = false } = {}) {
  liveApps.delete(id);
  if (link) linkLoads.add(id);
  else linkLoads.delete(id);
  iframes[id].src = src;
}

// The terminal token rides in the fragment so it never reaches a server log or a Referer.
function appSrc(id, path = '') {
  const token = apps[id].terminalToken;
  return apps[id].url + path + (token ? `#t=${token}` : '');
}

// From each app's manifest. Before /api/config lands there are none, and the first line is generic.
function loadingVerbs() {
  const own = apps[activeApp]?.loading?.verbs ?? [];
  const verbs = own.length ? own : Object.values(apps).flatMap((a) => a.loading?.verbs ?? []);
  return verbs.length ? verbs : ['Loading…'];
}

let loadingTimer = null;

function showLoading() {
  const verbs = loadingVerbs();
  const text = document.getElementById('loading-text');
  let i = Math.floor(Math.random() * verbs.length);
  text.textContent = verbs[i];
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    i = (i + 1 + Math.floor(Math.random() * (verbs.length - 1))) % verbs.length;
    text.textContent = verbs[i];
  }, 1200);
  document.getElementById('loading-overlay').classList.remove('fade-out');
}

function hideLoading() {
  clearInterval(loadingTimer);
  document.getElementById('loading-text').textContent = '';
  document.getElementById('loading-overlay').classList.add('fade-out');
}

function makeIframe(id) {
  const iframe = document.createElement('iframe');
  iframe.id = `iframe-${id}`;
  iframe.src = appSrc(id);
  iframe.className = 'hidden';
  iframe.allow = 'clipboard-write; microphone';
  iframe.addEventListener('load', () => onIframeLoad(id));
  return iframe;
}

function buildIframes() {
  const container = document.getElementById('iframe-container');
  for (const id of Object.keys(apps)) {
    iframes[id] = makeIframe(id);
    container.appendChild(iframes[id]);
  }
}

const TAB_KEY = 'hub-tab';

function storedTab() {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

function switchTab(appId) {
  if (!apps[appId]) return;
  if (appId !== activeApp) previousApp = activeApp;
  activeApp = appId;
  try {
    localStorage.setItem(TAB_KEY, appId);
  } catch {}

  for (const [id, iframe] of Object.entries(iframes)) {
    iframe.classList.toggle('hidden', id !== appId);
    postActiveTo(id);
  }

  if (loadedApps.has(appId)) hideLoading();
  else showLoading();

  iframes[appId]?.focus();
}

function onIframeLoad(appId) {
  liveApps.delete(appId);
  loadedApps.add(appId);
  guardedApps.delete(appId);
  if (appId === activeApp) hideLoading();
}

function onHello(appId, data) {
  const common = Array.isArray(data.protocol) ? HUB_PROTOCOLS.filter((v) => data.protocol.includes(v)) : [];
  if (!common.length) return;
  liveApps.set(appId, new Set(Array.isArray(data.subscribes) ? data.subscribes : []));
  postTo(appId, {
    type: 'hub:welcome',
    protocol: Math.max(...common),
    forward: Object.keys(bindings()),
    keys: actionKeys(),
    themes: hubThemes,
    actions: Object.keys(actions),
  });
  sendTheme(appId);
  // A document the hub loaded from an action URL got its project from that URL. The hub's own
  // project would undo the link, so it goes out only with the next change.
  if (!linkLoads.delete(appId)) sendProject(appId);
  sendPublished(appId);
  postActiveTo(appId);
}

// A url such as '@evil.example/' turns the app host into userinfo, and the token rides in the fragment.
function navigateApp(appId, url) {
  const src = appSrc(appId, url);
  if (!URL.canParse(src) || new URL(src).origin !== originOf(appId)) return;
  loadApp(appId, src, { link: true });
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function badParams(declared, params) {
  if (!isPlainObject(params)) return true;
  const given = Object.entries(params);
  if (given.some(([name, value]) => !Object.hasOwn(declared, name) || typeof value !== 'string')) return true;
  return Object.entries(declared).some(([name, type]) => type === 'string' && !Object.hasOwn(params, name));
}

// Null when the template names a param the call left out.
function fillUrl(template, params) {
  const slot = /\{([^}]+)\}/g;
  if ([...template.matchAll(slot)].some(([, name]) => !Object.hasOwn(params, name))) return null;
  return template.replace(slot, (_, name) => encodeURIComponent(params[name]));
}

// Protocol §7. The result does not wait for the handler: the hub queues nothing.
function onInvoke(appId, { id, action, params = {} }) {
  if (typeof id !== 'string') return;
  const reply = (result) => postTo(appId, { type: 'hub:result', id, ...result });
  const spec = typeof action === 'string' && Object.hasOwn(actions, action) ? actions[action] : null;
  if (!spec) return reply({ ok: false, reason: 'unhandled' });
  if (badParams(spec.params, params)) return reply({ ok: false, reason: 'bad-params' });
  const { app: handler, mode, url: template } = spec;
  switchTab(handler);
  if (mode === 'message' && liveApps.has(handler)) {
    postTo(handler, { type: 'hub:action', id, action, params });
  } else {
    // Setting src reloads the app, so a guarded app only gets the switch.
    const url = template && fillUrl(template, params);
    if (url && !guardedApps.has(handler)) navigateApp(handler, url);
  }
  reply({ ok: true, handledBy: handler });
}

function listenMessages() {
  window.addEventListener('beforeunload', (e) => {
    if (guardedApps.size) e.preventDefault();
  });
  window.addEventListener('message', (e) => {
    const appId = appIdOf(e.source);
    if (!appId || e.origin !== originOf(appId)) return;
    const data = e.data ?? {};
    if (data.type === 'hub:hello') {
      onHello(appId, data);
    } else if (data.type === 'hub:invoke') {
      onInvoke(appId, data);
    } else if (data.type === 'hub:publish') {
      onPublish(appId, data);
    } else if (data.type === 'hub:keydown') {
      handleForwardedKey(data);
    } else if (data.type === 'hub:closeGuard') {
      if (data.on === true) guardedApps.add(appId);
      else guardedApps.delete(appId);
    } else if (data.type === 'hub:terminalToken') {
      // This hub page may have outlived the restart too, so the cached token is not trusted.
      sendJson('GET', '/api/config')
        .then((cfg) => {
          const token = cfg.apps?.[appId]?.terminalToken;
          if (!token) return;
          apps[appId].terminalToken = token;
          postTo(appId, { type: 'hub:terminalToken', token });
        })
        .catch(() => {});
    } else if (data.type === 'hub:openExternal') {
      // In the installed PWA window a framed sub-app's own target=_blank opens
      // nothing, so the SDK hands external links up to the top frame instead.
      let url;
      try {
        url = new URL(String(data.url));
      } catch (_) {
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      window.open(url.href, '_blank', 'noopener');
    } else if (data.type === 'hub:theme') {
      // colorTheme is optional and sticky.
      if (data.theme !== 'light' && data.theme !== 'dark') return;
      const hasColor = typeof data.colorTheme === 'string' && /^[a-z0-9-]{0,32}$/.test(data.colorTheme);
      const changed = data.theme !== themeState.theme || (hasColor && data.colorTheme !== activeColorTheme());
      if (!changed) return;
      themeState.theme = data.theme;
      if (hasColor) {
        themeState.colorTheme = data.colorTheme;
        if (activeConfigDir) themeState.colorThemes[activeConfigDir] = data.colorTheme;
      }
      localStorage.setItem('hub-theme', JSON.stringify(themeState));
      applyHubTheme();
      // The sender gets the echo too, for the vars.
      for (const id of Object.keys(iframes)) sendTheme(id);
    }
  });
}

function handleForwardedKey(d) {
  const e = {
    key: d.key,
    code: d.code,
    ctrlKey: d.ctrl === true,
    altKey: d.alt === true,
    shiftKey: d.shift === true,
    metaKey: d.meta === true,
  };
  bindings()[comboOf(e)]?.run();
}

// The hub's actions and their default combos. hub.appByNumber is a pattern: {n} is the tab number,
// for the first nine. inPalette: the binding still fires while the palette is open. The ids are the
// keys of config.json `keys`, listed again in lib/keymap.js.
function hubActions() {
  return [
    { id: 'hub.projectPicker', combo: 'ctrl+alt+p', run: () => togglePalette('project'), inPalette: true },
    { id: 'hub.configDirPicker', combo: 'ctrl+alt+w', run: () => togglePalette('configDir'), inPalette: true },
    { id: 'hub.appLauncher', combo: 'ctrl+alt+a', run: () => togglePalette('app'), inPalette: true },
    { id: 'hub.prevApp', combo: 'ctrl+alt+ArrowLeft', run: () => cycleTab(-1) },
    { id: 'hub.nextApp', combo: 'ctrl+alt+ArrowRight', run: () => cycleTab(1) },
    {
      id: 'hub.appByNumber',
      combo: `${IS_MAC ? 'ctrl+alt' : 'alt'}+{n}`,
      run: (i) => switchTab(Object.keys(apps)[i]),
      count: 9,
    },
  ];
}

// The one keymap, combo → binding. Its combos are what welcome.forward lists for the apps.
// Built on first use after setApps, so a key press only looks a combo up. userKeys comes checked
// from the server: null unbinds an action, and a combo the user sets is taken from the action
// that has it by default.
function bindings() {
  if (keymap) return keymap;
  const tabs = Object.keys(apps).length;
  const own = (b) => Object.hasOwn(userKeys, b.id);
  const expand = (action) => {
    const combo = comboFor(action);
    if (!combo) return [];
    if (!action.count) return [[combo, { ...action, combo }]];
    return Array.from({ length: Math.min(action.count, tabs) }, (_, i) => {
      const c = combo.replace('{n}', i + 1);
      return [c, { ...action, combo: c, index: i, run: () => action.run(i) }];
    });
  };
  const entries = hubActions().flatMap(expand);
  const userCombos = new Set(entries.filter(([, b]) => own(b)).map(([c]) => c));
  keymap = Object.fromEntries(entries.filter(([c, b]) => own(b) || !userCombos.has(c)));
  return keymap;
}

function comboFor(action) {
  return Object.hasOwn(userKeys, action.id) ? userKeys[action.id] : action.combo;
}

// Action id → its combo, hub.appByNumber as its {n} pattern, or null when no key runs it. What
// welcome.keys lists for the apps' help.
function actionKeys() {
  const bound = new Set(Object.values(bindings()).map((b) => b.id));
  return Object.fromEntries(hubActions().map((a) => [a.id, bound.has(a.id) ? comboFor(a) : null]));
}

function setApps(list) {
  apps = list;
  keymap = null;
}

function appNumberCombo(i) {
  return Object.values(bindings()).find((b) => b.id === 'hub.appByNumber' && b.index === i)?.combo;
}

function comboLabel(combo) {
  return keyParts(combo, IS_MAC).join(IS_MAC ? '' : '+');
}

function cycleTab(delta) {
  const ids = Object.keys(apps);
  const idx = ids.indexOf(activeApp);
  const next = ids[(idx + delta + ids.length) % ids.length];
  switchTab(next);
}

function listenKeys() {
  document.addEventListener('keydown', (e) => {
    const binding = bindings()[comboOf(e)];
    if (binding?.inPalette) {
      e.preventDefault();
      binding.run();
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
    if (!binding) return;
    e.preventDefault();
    binding.run();
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
      worktrees: p.worktrees ?? [],
      worktreeNames: (p.worktrees ?? []).map((w) => basename(w).toLowerCase()),
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
// hits above parent-path hits, and within those an exact name, then a prefix, then a word start.
// Rank ties fall back to the recency order set in loadProjects.
// Returns {p, tier} so the renderer can mark the field that actually explains the match instead of
// re-deriving it.
const PATH_RANK = 4;

function projectRows(projects, q) {
  if (!q) return projects.slice(0, 100).map((p) => ({ p, tier: 0 }));
  const rankOf = (p) => {
    const name = p.name.toLowerCase();
    const at = name.indexOf(q);
    if (name === q) return 0;
    if (at === 0) return 1;
    if (at > 0) return /[^a-z0-9]/.test(name[at - 1]) ? 2 : 3;
    const path = p.path.toLowerCase();
    if (path.split(/[/\\]/).includes(q)) return PATH_RANK;
    if (path.includes(q)) return PATH_RANK + 1;
    if (p.worktreeNames.some((w) => w.includes(q))) return PATH_RANK + 2;
    return -1;
  };
  let out = projects.map((p) => ({ p, rank: rankOf(p) })).filter((x) => x.rank >= 0);
  if (out.length === 0) {
    // Subsequence only as a fallback — it would otherwise swamp real substring matches.
    out = projects
      .map((p) => {
        const rank = subseq(p.name.toLowerCase(), q) ? 0 : subseq(p.path.toLowerCase(), q) ? PATH_RANK : -1;
        return { p, rank };
      })
      .filter((x) => x.rank >= 0);
  }
  out.sort((a, b) => a.rank - b.rank || b.p.ts - a.p.ts);
  return out.slice(0, 100).map(({ p, rank }) => ({ p, tier: rank < PATH_RANK ? 0 : 1 }));
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

async function loadAppStats() {
  const { hub, apps: appStats } = await sendJson('GET', '/api/apps/stats');
  palette.appStats = appStats;
  hubInfo.plugin = hub.plugin;
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
    showErrorToast('Could not remove config dir', err);
    return;
  }
  if (dirPath in themeState.colorThemes) {
    delete themeState.colorThemes[dirPath];
    localStorage.setItem('hub-theme', JSON.stringify(themeState));
  }
  if (palette.open && palette.mode === 'configDir') renderPalette();
}

// Lucide icons (ISC license) for the names the built-in apps and the Inspector use. Any other
// manifest icon shows the app's first letter.
const APP_ICONS = {
  columns: [
    ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ['path', { d: 'M12 3v18' }],
  ],
  store: [
    ['path', { d: 'm2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7' }],
    ['path', { d: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8' }],
    ['path', { d: 'M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4' }],
    ['path', { d: 'M2 7h20' }],
    [
      'path',
      {
        d: 'M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7',
      },
    ],
  ],
  'dollar-sign': [
    ['line', { x1: 12, x2: 12, y1: 2, y2: 22 }],
    ['path', { d: 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' }],
  ],
  database: [
    ['ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }],
    ['path', { d: 'M3 5V19A9 3 0 0 0 21 19V5' }],
    ['path', { d: 'M3 12A9 3 0 0 0 21 12' }],
  ],
  'scan-search': [
    ['path', { d: 'M3 7V5a2 2 0 0 1 2-2h2' }],
    ['path', { d: 'M17 3h2a2 2 0 0 1 2 2v2' }],
    ['path', { d: 'M21 17v2a2 2 0 0 1-2 2h-2' }],
    ['path', { d: 'M7 21H5a2 2 0 0 1-2-2v-2' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['path', { d: 'm16 16-1.9-1.9' }],
  ],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function appIcon(app) {
  const shapes = APP_ICONS[app.icon];
  if (!shapes) return el('span', 'palette-icon letter', (app.name || '?').slice(0, 1).toUpperCase());
  const svg = svgNode('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  svg.append(...shapes.map(([tag, attrs]) => svgNode(tag, attrs)));
  const box = el('span', 'palette-icon');
  box.append(svg);
  return box;
}

function appRows(q) {
  const list = Object.entries(apps).map(([id, a], i) => ({ kind: 'app', id, app: a, index: i }));
  if (!q) return list;
  const hit = list.filter((r) => r.app.name.toLowerCase().includes(q) || r.id.includes(q));
  return hit.length ? hit : list.filter((r) => subseq(r.app.name.toLowerCase(), q));
}

// A click on the button runs the mode's rowKeys entry for `key`, the same as Ctrl+<key>.
function rowButton(className, glyph, key, title, label) {
  const btn = el('button', className, glyph);
  btn.type = 'button';
  btn.title = title;
  btn.setAttribute('aria-label', label);
  btn.dataset.rowKey = key;
  return btn;
}

// The footer shows palette.message, set by an action, else the mode's hint.
function drawPaletteHint() {
  const content = palette.message ?? PALETTE_MODES[palette.mode].hint ?? '';
  document.getElementById('palette-hint').replaceChildren(...[].concat(content));
}

function setPaletteHint(message) {
  palette.message = message;
  drawPaletteHint();
}

// The plugin in the active config dir: its version, or a ⚠ that copies the install command.
function pluginNode(p) {
  const problem = {
    missing: { label: 'plugin not installed', cause: `${p.id} is not installed in this config dir.` },
    disabled: {
      label: `plugin ${p.installed} is off`,
      cause: `${p.id} ${p.installed} is disabled. Enable it with /plugin in Claude Code.`,
      noCopy: true,
    },
    mismatch: {
      label: `plugin ${p.installed}`,
      cause: `${p.id} ${p.installed} is installed, this version ships ${p.bundled}.`,
    },
  }[p.state];
  if (!problem) return el('span', 'ver', `plugin ${p.installed}`);
  const badge = el('button', 'plugin-warn', `⚠ ${problem.label}`);
  badge.type = 'button';
  badge.title = problem.cause;
  badge.setAttribute('aria-label', problem.cause);
  if (problem.noCopy) return badge;
  badge.title += `\nClick to copy: ${p.installCommand}\nThen restart open sessions.`;
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    copyToHint(p.installCommand);
  });
  return badge;
}

async function copyToHint(text) {
  try {
    await navigator.clipboard.writeText(text);
    setPaletteHint(`Copied ${text}`);
  } catch (err) {
    setPaletteHint(`Could not copy ${text}: ${err.message}`);
  }
}

// The terminal provider answers 409 with a terminal count; the second Ctrl+R on the same app sends force.
async function restartFromPalette(id) {
  const force = palette.confirmRestart === id;
  palette.confirmRestart = null;
  setPaletteHint(`Restarting ${apps[id]?.name ?? id}…`);
  const failed = await withPaletteBusy(() => requestRestart(id, force));
  if (failed?.terminals) {
    palette.confirmRestart = id;
    setPaletteHint(`${failed.message} Press Ctrl+R again to restart.`);
    return;
  }
  if (failed) {
    setPaletteHint(failed.message);
    return;
  }
  closePalette();
  replaceIframe(id);
  switchTab(id);
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
      li.append(rowButton('palette-remove', '×', 'd', 'Remove from list (Ctrl+D)', `Remove ${row.path}`));
    },
    rowKeys: { d: (row) => removeConfigDir(row.path) },
    commit: commitConfigDir,
  },
  app: {
    placeholder: 'Search apps...',
    label: 'Switch app',
    get hint() {
      const keys = 'Enter switch · Ctrl+C copy the URL · Ctrl+R restart the app';
      if (!hubInfo.version) return keys;
      const plugin = hubInfo.plugin ? [pluginNode(hubInfo.plugin), ' · '] : [];
      return [`Claude Code Hub ${hubInfo.version} · `, ...plugin, keys];
    },
    empty: 'No matching app',
    rows: (_typed, q) => appRows(q),
    load: loadAppStats,
    initialSel(rows) {
      const prev = rows.findIndex((r) => r.id === previousApp);
      return prev < 0 ? 0 : prev;
    },
    fillRow(li, row, q) {
      li.append(appIcon(row.app), markedSpan('name', row.app.name, q), el('span', 'url', new URL(row.app.url).host));
      const s = palette.appStats?.[row.id];
      if (s?.version) li.append(el('span', 'ver', s.version));
      if (s?.plugin) li.append(pluginNode(s.plugin));
      if (s?.slowMs) {
        const badge = el('span', 'slow', 'slow port');
        badge.title = `Its port delays requests by up to ${(s.slowMs / 1000).toFixed(1)} s. Restart (Ctrl+R) moves it to a new port.`;
        li.append(badge);
      }
      const stats = el('span', 'stats', s?.rss ? `${Math.round(s.rss / 1048576)} MB · ${s.cpu}%` : '');
      stats.title = 'Memory and CPU of the app process. Child processes are not counted. 100% is one core.';
      li.append(stats);
      const combo = appNumberCombo(row.index);
      const key = row.id === activeApp ? 'active' : combo ? comboLabel(combo) : '';
      li.append(el('span', 'age', key));
      li.append(
        rowButton('palette-copy', '⧉', 'c', 'Copy the URL (Ctrl+C)', `Copy the URL of ${row.app.name}`),
        rowButton('palette-restart', '↻', 'r', 'Restart the app (Ctrl+R)', `Restart ${row.app.name}`),
      );
    },
    rowKeys: { c: (row) => copyToHint(apps[row.id].url), r: (row) => restartFromPalette(row.id) },
    commit(row) {
      closePalette();
      switchTab(row.id);
    },
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
  palette.confirmRestart = null;
  palette.message = null;
  input.value = '';
  input.placeholder = spec.placeholder;
  document.querySelector('#palette .palette-box').setAttribute('aria-label', spec.label);
  drawPaletteHint();
  document.getElementById('palette').hidden = false;
  // Ctrl+Alt+P usually arrives forwarded from a focused iframe. Without inert the sub-app can keep
  // or take focus back, and then Escape is handled inside it — the palette stays open and only the
  // sub-app's own focus visibly changes.
  setIframesInert(true);
  renderPalette();
  input.focus();
  // Stale-while-revalidate: the cached list renders instantly, recency refreshes when this lands.
  Promise.resolve(spec.load?.())
    .then(() => {
      if (!palette.open || palette.mode !== mode) return;
      drawPaletteHint();
      renderPalette();
    })
    .catch((err) => {
      if (err.status === 401) showErrorToast('Could not load the list', err);
      else console.warn(`${mode} list unavailable:`, err.message);
    });
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
  setProject(absPath, row.p?.worktrees);
}

async function sendJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
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
      showErrorToast('Could not add config dir', err);
      return;
    }
  }
  closePalette();
  // The server would no-op too, but the client would still reload every iframe.
  if (target === palette.configDirs.active) return;
  showLoading();
  try {
    setApps((await sendJson('POST', '/api/config-dirs/activate', { path: target })).apps);
    // The palette renders from this cache before its refetch lands, and initialSel keys off it.
    palette.configDirs.active = target;
    activeConfigDir = target;
    applyTitle(target);
    // Each iframe gets the new dir's color theme from its load handler; this repaints the palette.
    applyHubTheme();
    reloadIframes();
  } catch (err) {
    showErrorToast('Could not switch config dir', err);
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
    } else if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && ['c', 'd', 'r'].includes(e.key.toLowerCase())) {
      const run = PALETTE_MODES[palette.mode].rowKeys?.[e.key.toLowerCase()];
      // Ctrl+C with text selected in the input keeps the browser's copy.
      if (e.key.toLowerCase() === 'c' && (!run || input.selectionStart !== input.selectionEnd)) return;
      // Ctrl+D would otherwise bookmark the page in Chrome and Firefox.
      // Ctrl+R would otherwise reload the hub page.
      e.preventDefault();
      const row = palette.rows[palette.sel];
      if (run && row && row.kind !== 'literal') run(row);
    }
  });
  document.getElementById('palette-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-row-key]');
    const li = e.target.closest('.palette-row');
    if (btn) {
      e.stopPropagation();
      PALETTE_MODES[palette.mode].rowKeys[btn.dataset.rowKey](palette.rows[Number(li.dataset.idx)]);
      document.getElementById('palette-input').focus();
      return;
    }
    if (!li) return;
    palette.sel = Number(li.dataset.idx);
    commitPalette();
  });
  // Vimium eats Escape inside a text input and only blurs it, so the page never sees the key —
  // losing focus is the one signal left. Busy disables the input and Alt+Tab blurs the window;
  // neither is a dismissal.
  input.addEventListener('blur', () => {
    if (palette.open && !input.disabled && document.hasFocus()) closePalette();
  });
  document.getElementById('palette').addEventListener('mousedown', (e) => {
    if (e.target.id === 'palette') closePalette();
    else if (e.target !== input) e.preventDefault();
  });
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
}

init();
