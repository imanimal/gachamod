// Takes the GameBanana screenshots from the browser demo (npm run dev, http://localhost:1420) with headless Chrome.
// usage: node docs/gamebanana/shoot.mjs docs/gamebanana/shots [one-shot-name]
// Set CHROME to use another Chromium browser.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
const ONLY = process.argv[3];
const BROWSER = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9335;
const W = 1600, H = 900;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = join(process.env.TEMP || ".", "gm-shoot-chrome");
const browser = spawn(BROWSER, [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });

let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params }));
});
const js = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
  return r.result.value;
};

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
}

// Clicks the first button whose text is exactly one of the given labels.
const clickText = (labels) => js(`(() => { const want = ${JSON.stringify(labels)}; const b = [...document.querySelectorAll('button, [role=button]')].find((x) => want.includes(x.textContent.trim())); if (b) { b.click(); return true; } return false; })()`);

async function open(game, view, theme) {
  await send("Page.navigate", { url: "http://localhost:1420/" });
  await sleep(800);
  await js(`localStorage.clear(); localStorage.setItem('gm.game', ${JSON.stringify(game)}); localStorage.setItem('gm.view', ${JSON.stringify(view)}); ${theme ? `localStorage.setItem('gm.theme.${game}', ${JSON.stringify(theme)});` : ""} true`);
  await send("Page.reload");
  await sleep(3500);
  await clickText(["Start"]);
  await sleep(600);
  await clickText(["No thanks"]);
  await sleep(2500);
  await tidy();
}

// Takes first-run nudges (the tour toast, the chatbot card) off the screen.
const tidy = () => js(`(() => { for (const e of document.querySelectorAll('*')) { const c = e.getAttribute('class') || ''; if (/toast|ai-intro/.test(c) && /short tour|chatbot/i.test(e.textContent)) e.remove(); } return true; })()`);

async function shoot(name) {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 90 });
  writeFileSync(join(OUT, `${name}.jpg`), Buffer.from(r.data, "base64"));
  console.log("saved", name);
}

const SHOTS = [];
for (const g of ["gi", "zzz", "ww", "ef"]) {
  SHOTS.push({ name: `${g}-home`, game: g, view: "home" });
  SHOTS.push({ name: `${g}-browse`, game: g, view: "browse" });
  SHOTS.push({ name: `${g}-mods`, game: g, view: "library" });
}
SHOTS.push({ name: "zzz-default-home", game: "zzz", view: "home", theme: "default" });
SHOTS.push({ name: "hsr-theme-on-gi-home", game: "gi", view: "home", theme: "hsr" });
const openMod = `document.querySelectorAll('.mod-card')[3].querySelector('.mod-card-hit').click()`;
SHOTS.push({ name: "zzz-mod-drawer", game: "zzz", view: "library", act: openMod });
SHOTS.push({ name: "zzz-mod-keys", game: "zzz", view: "library", act: openMod,
  then: `[...document.querySelectorAll('.panel-t')].find((e) => e.textContent.startsWith('Toggles'))?.scrollIntoView({ block: 'start' })` });
SHOTS.push({ name: "zzz-mod-3d", game: "zzz", view: "library", act: openMod,
  then: `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'View in 3D')?.click()` });
SHOTS.push({ name: "zzz-browse-drawer", game: "zzz", view: "browse", act: `document.querySelector('.gb-card:not(.is-nsfw)')?.click()` });
SHOTS.push({ name: "zzz-profiles", game: "zzz", view: "profiles" });
SHOTS.push({ name: "zzz-characters", game: "zzz", view: "characters" });
SHOTS.push({ name: "zzz-tools", game: "zzz", view: "tools" });
SHOTS.push({ name: "zzz-downloads", game: "zzz", view: "downloads" });

try {
  await connect();
  for (const s of SHOTS) {
    if (ONLY && s.name !== ONLY) continue;
    await open(s.game, s.view, s.theme);
    if (s.act) { await js(s.act); await sleep(2500); }
    if (s.then) { await js(s.then); await sleep(3000); }
    await tidy();
    await shoot(s.name);
  }
} finally {
  try { ws?.close(); } catch { /* closing */ }
  browser.kill();
}
