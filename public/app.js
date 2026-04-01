let apps = {};
let activeApp = null;
const iframes = {};
const loadedApps = new Set();
let allowedOrigins = new Set();

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
}

function onIframeLoad(appId) {
  loadedApps.add(appId);
  if (appId === activeApp) {
    document.getElementById('loading-overlay').classList.add('fade-out');
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
    }
  });
}

function cycleTab(delta) {
  const ids = Object.keys(apps);
  const idx = ids.indexOf(activeApp);
  const next = ids[(idx + delta + ids.length) % ids.length];
  switchTab(next);
}

function listenKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); cycleTab(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); cycleTab(1); return; }
    }
  });
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
}

init();
