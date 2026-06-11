let apps = {};
let activeApp = null;
const iframes = {};
const loadedApps = new Set();
let allowedOrigins = new Set();
// {theme: 'dark'|'light', colorTheme: '<id>'} — survives hub reloads so
// late-loading iframes and fresh sessions get the last chosen theme.
const themeState = loadThemeState();

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

async function init() {
  const res = await fetch('/api/config');
  apps = (await res.json()).apps;
  allowedOrigins = new Set(Object.values(apps).map((a) => new URL(a.url).origin));
  buildIframes();
  switchTab(Object.keys(apps)[0]);
  listenMessages();
  listenKeys();
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
    iframes[appId].contentWindow?.postMessage(themeMessage(), new URL(apps[appId].url).origin);
  }
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
      if (data.key === 'ArrowLeft') cycleTab(-1);
      else if (data.key === 'ArrowRight') cycleTab(1);
      else {
        const digit = parseInt(data.key, 10);
        if (digit >= 1 && digit <= 9) switchByIndex(digit - 1);
      }
    } else if (data.type === 'hub:theme') {
      // Legacy senders pass only {theme}; colorTheme is optional and sticky.
      if (data.theme !== 'light' && data.theme !== 'dark') return;
      const hasColor = typeof data.colorTheme === 'string' && /^[a-z0-9-]{0,32}$/.test(data.colorTheme);
      const changed = data.theme !== themeState.theme || (hasColor && data.colorTheme !== themeState.colorTheme);
      if (!changed) return;
      themeState.theme = data.theme;
      if (hasColor) themeState.colorTheme = data.colorTheme;
      localStorage.setItem('hub-theme', JSON.stringify(themeState));
      for (const [id, iframe] of Object.entries(iframes)) {
        if (iframe.contentWindow === e.source) continue;
        iframe.contentWindow?.postMessage(themeMessage(), new URL(apps[id].url).origin);
      }
    }
  });
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

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
}

init();
