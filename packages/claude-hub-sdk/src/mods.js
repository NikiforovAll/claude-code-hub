// Claude Code Hub SDK: the runtime of hub mods, shared by client.js and the hub page. mount() and
// sdk:sync put it in front of client.js; the hub page gets it inside /mods/hub.js.
// var, not const: the hub page and an app page each load it as a classic script.
var ClaudeHubModKit = (() => {
  'use strict';

  // "<mod id>:<name>". The id must be an installed mod's, so two mods cannot share a topic.
  const TOPIC_RE = /^([a-z0-9-]+):[\w.-]+$/;

  // The page's mod list is in win.ClaudeHubMods, ahead of this file. Each CSS file loads after the
  // page's own styles; each JS file is a deferred script, so it runs after a deferred app.js, in
  // list order. ?nomods in the page URL loads none: the safe mode for a mod that breaks the page.
  function createMods(win) {
    const doc = win.document;
    const off = /[?&]nomods(?:[=&]|$)/.test(win.location?.search ?? '');
    // Only an app's own tab, or the page on its own. A page nested in an app's page (cck's terminal,
    // a pane) is not what the mod was written for, and ?nomods reaches only the tabs.
    const nested = win.parent !== win.top;
    const assets = off || nested ? null : win.ClaudeHubMods;
    const list = assets?.mods ?? [];
    const ids = new Set(list.map((m) => m.id));
    const listeners = new Map();
    const wrappedNames = new Set();
    const outbox = new Map();
    let sender = null;
    const report = (what, err) => win.console?.error?.(`[hub mod] ${what}:`, err);

    function load() {
      if (!assets || !doc) return;
      const js = assets.js ?? [];
      // Mod code runs with the page's rights. connect-src stops fetch, XHR, WebSocket and beacons to
      // other hosts; it does not stop image or script loads or navigation, so it guards against a
      // careless mod, not a hostile one. Consent at install is the real boundary. A wider policy
      // (script-src, img-src) would break the apps' own inline scripts and remote images.
      if (js.length) {
        doc.head.appendChild(
          Object.assign(doc.createElement('meta'), {
            httpEquiv: 'Content-Security-Policy',
            content: "connect-src 'self'",
          }),
        );
      }
      const tags = [
        ...(assets.css ?? []).map((href) => Object.assign(doc.createElement('link'), { rel: 'stylesheet', href })),
        ...js.map((src) => Object.assign(doc.createElement('script'), { src, defer: true })),
      ];
      // document.write keeps a parser-inserted script deferred and in order; appendChild needs async off for that.
      if (!tags.length) return;
      if (doc.readyState === 'loading') doc.write(tags.map((t) => t.outerHTML).join(''));
      else
        for (const t of tags) {
          if (t.tagName === 'SCRIPT') t.async = false;
          (t.tagName === 'LINK' ? doc.head : doc.body).appendChild(t);
        }
    }

    // fn(original, ...args). When fn throws, the wrapper returns what original returned, and runs
    // original first if fn had not called it yet, so a broken mod leaves the app as it was.
    function wrap(name, fn) {
      const original = win[name];
      if (typeof original !== 'function') {
        report(`wrap(${name})`, new Error('the app has no such global function'));
        return false;
      }
      if (wrappedNames.has(name))
        win.console?.warn?.(`[hub mod] wrap(${name}): two mods wrap it; the later one runs outside the earlier`);
      wrappedNames.add(name);
      win[name] = function wrapped(...args) {
        let called = false;
        let result;
        const next = (...a) => {
          called = true;
          result = original.apply(this, a.length ? a : args);
          return result;
        };
        try {
          return fn.call(this, next, ...args);
        } catch (err) {
          report(`wrap(${name})`, err);
          return called ? result : original.apply(this, args);
        }
      };
      return true;
    }

    function on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    }

    function emit(event, detail) {
      for (const fn of listeners.get(event) ?? []) {
        try {
          fn(detail);
        } catch (err) {
          report(`on(${event})`, err);
        }
      }
    }

    // To the same mod's code on the hub page, as mod.on(topic) there with {app, data}. Before the
    // hub answers, only the latest data per topic waits.
    function send(topic, data) {
      const m = TOPIC_RE.exec(typeof topic === 'string' ? topic : '');
      if (!m || !ids.has(m[1])) {
        report(`send(${topic})`, new Error('the topic must be "<mod id>:<name>", with the id of an installed mod'));
        return false;
      }
      if (sender) sender({ type: 'hub:mod', topic, data });
      else outbox.set(topic, data);
      return true;
    }

    function connectSender(fn) {
      sender = fn;
      for (const [topic, data] of outbox) fn({ type: 'hub:mod', topic, data });
      outbox.clear();
    }

    load();
    return { mod: { list, wrap, on, emit, send }, connectSender };
  }

  return { createMods, TOPIC_RE };
})();

if (typeof module === 'object' && module.exports) module.exports = ClaudeHubModKit;
