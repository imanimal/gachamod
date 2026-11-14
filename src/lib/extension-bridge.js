// The page side of gachamod's extension API (docs/extensions.md). gachamod puts this script first in every
// extension page, so `window.gachamod` is there before the page's own scripts run. The page runs in a sandboxed
// frame: it talks to the app only through these messages, and the app checks each call against the package's
// permissions. It also gives the page the app's colours as CSS variables (--bg, --text, --accent ...), reports the
// page's height so the frame fits it, and lets a game controller and the app's shortcuts reach into the page.
// Owner: EXTENSIONS area. Plain JavaScript on purpose: the Rust side serves this exact file.
(() => {
  "use strict";
  if (window.gachamod) return;
  const host = window.parent;
  const pending = new Map();
  const handlers = new Map();
  let seq = 0;
  let context = null;
  let markReady;
  const ready = new Promise((r) => { markReady = r; });
  const post = (msg) => host.postMessage(Object.assign({ gachamod: 1 }, msg), "*");

  function call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      post({ type: "call", id, method, params: params === undefined ? null : params });
    });
  }
  function emit(name, data) {
    for (const f of handlers.get(name) || []) { try { f(data); } catch (e) { console.error(e); } }
  }

  // plain defaults in the app's colours; :where() keeps them easy to override
  const base = document.createElement("style");
  base.textContent = ":where(html){color-scheme:dark light}"
    + ":where(body){margin:0;padding:0;background:transparent;color:var(--text);font:14px/1.5 var(--font,system-ui,sans-serif)}"
    + ":where(a){color:var(--accent-ink)}:where(button,input,select,textarea){font:inherit;color:inherit}"
    + ":where(:focus-visible){outline:2px solid var(--ring);outline-offset:2px}";
  (document.head || document.documentElement).prepend(base);

  function applyTheme(t) {
    if (!t) return;
    const r = document.documentElement;
    for (const k of Object.keys(t.vars || {})) r.style.setProperty(k, t.vars[k]);
    r.dataset.scheme = t.scheme;
    r.style.colorScheme = t.scheme;
  }

  window.addEventListener("message", (e) => {
    if (e.source !== host) return;
    const m = e.data;
    if (!m || m.gachamod !== 1) return;
    if (m.type === "reply") {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
    } else if (m.type === "context") {
      context = m.context;
      applyTheme(m.theme);
      markReady(context);
      emit("context", context);
    } else if (m.type === "theme") {
      applyTheme(m.theme);
      emit("theme", m.theme);
    } else if (m.type === "pad") {
      pad(m);
    }
  });

  // the frame takes the page's height
  let lastHeight = 0;
  const report = () => {
    const h = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    if (h !== lastHeight) { lastHeight = h; post({ type: "size", height: h }); }
  };
  new ResizeObserver(report).observe(document.documentElement);
  window.addEventListener("load", report);

  // the app's shortcuts (Back, search, Ctrl+1 ...) still work while the page has focus, unless the page used the key
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const t = e.target;
    const typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    const fkey = /^F\d+$/.test(e.key);
    if (!(e.ctrlKey || e.altKey || e.metaKey || e.key === "Escape" || fkey)) return;
    if (typing && (e.ctrlKey || e.metaKey) && !e.altKey && /^[acvxyz]$/i.test(e.key)) return;
    post({ type: "key", key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
  });

  // a game controller moves between the page's buttons; past the last one it hands focus back to the app
  const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== "hidden";
  }
  function pad(m) {
    const cur = document.activeElement;
    if (m.press) {
      if (cur && cur !== document.body) cur.click();
      return;
    }
    const list = Array.from(document.querySelectorAll(FOCUSABLE)).filter(visible);
    const dx = m.dx || 0, dy = m.dy || 0;
    if (m.enter || !cur || cur === document.body || !list.includes(cur)) {
      const first = dy < 0 || dx < 0 ? list[list.length - 1] : list[0];
      if (first) { first.focus(); first.scrollIntoView({ block: "nearest" }); } else post({ type: "leave", dx, dy });
      return;
    }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, score = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const along = dx ? (bx - ax) * dx : (by - ay) * dy;
      if (along <= 4) continue;
      const s = along + (dx ? Math.abs(by - ay) : Math.abs(bx - ax)) * 2.2;
      if (s < score) { score = s; best = el; }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: "nearest" }); } else post({ type: "leave", dx, dy });
  }

  const wrapResponse = (r) => Object.assign({}, r, {
    ok: r.status >= 200 && r.status < 300,
    text: () => r.body,
    json: () => JSON.parse(r.body),
  });

  window.gachamod = {
    version: 1,
    /** Where the page is shown: { extension, slot, game, character }. */
    get context() { return context; },
    /** Resolves with the context once the app has sent it. */
    ready,
    /** "context" (game or character changed) or "theme". Returns a function that stops listening. */
    on(name, f) {
      const list = handlers.get(name) || [];
      list.push(f);
      handlers.set(name, list);
      return () => handlers.set(name, (handlers.get(name) || []).filter((x) => x !== f));
    },
    call,
    game: () => call("game"),
    characters: () => call("characters"),
    mods: (filter) => call("mods", filter || null),
    player: () => call("player"),
    fetch: (url, init) => call("fetch", { url: String(url), method: init && init.method, headers: (init && init.headers) || {}, body: init && init.body }).then(wrapResponse),
    readFile: (path) => call("readFile", { path }),
    readJson: (path) => call("readFile", { path }).then((t) => JSON.parse(t)),
    listDir: (path) => call("listDir", { path }),
    apps: () => call("apps"),
    openApp: (name) => call("openApp", { name }),
    openUrl: (url) => call("openUrl", { url: String(url) }),
    go: (route) => call("go", route),
    toast: (text, bad) => call("toast", { text: String(text), bad: !!bad }),
    storage: {
      get: (key) => call("storage.get", { key }),
      set: (key, value) => call("storage.set", { key, value }),
      remove: (key) => call("storage.set", { key, value: null }),
      all: () => call("storage.all"),
    },
  };
  post({ type: "ready" });
})();
