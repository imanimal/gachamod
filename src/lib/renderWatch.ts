// What the page notices about its own drawing, for the rendering log (src-tauri render.rs, gacha-core render_log.rs):
// frames stopping while the window is on screen, drawing slowing down, the window's code stalling, WebGL contexts
// lost (the 3D view), and what the page sees of the screen and graphics card. render.rs asks `__gmRenderProbe` for
// the page's side when it checks a window. Owner: SYSTEM area.
import { pref } from "./prefs";
import { call, inTauri } from "./tauri";
import { currentRoute } from "./store";
import { installRedraw } from "./redraw";

/** Setting "render.log" (Settings, Feedback, and Appearance). */
export const renderLogPref = pref<boolean>("render.log", true, (r) => (r === "0" ? false : r === "1" ? true : undefined), (v) => (v ? "1" : "0"));

interface PageEvent { text: string; incident?: string; title?: string }

const queue: PageEvent[] = [];
let lastFrame = performance.now();
let sampling = false;
let watching = false;
let fps = 0;
let stalledAt: number | null = null;
let slowFor = 0;
let lastTick = performance.now();
let longTasks = 0;
let worstTask = 0;
let budget = 30;

function send(e: PageEvent) {
  if (!renderLogPref.get()) return;
  if (!e.incident && budget-- <= 0) return;
  queue.push(e);
  if (e.incident) flush();
}

function flush() {
  if (!queue.length) return;
  call<void>("render_events", { events: queue.splice(0, 50) }).catch(() => {});
}

function now() { return performance.now(); }
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function state(): string {
  return `Visible ${document.visibilityState}, focus ${document.hasFocus() ? "yes" : "no"}, screen "${currentRoute().view}", `
    + `theme ${document.documentElement.dataset.theme ?? "default"}, ${innerWidth}x${innerHeight} at ${devicePixelRatio}x`;
}

/** One sample a second instead of a frame loop: two frames in a row, timed. The gap between them gives the frame
 *  rate, and a sample still waiting means no frame came. */
function sample() {
  if (sampling) return;
  sampling = true;
  requestAnimationFrame((a) => {
    lastFrame = now();
    requestAnimationFrame((b) => {
      lastFrame = now();
      fps = Math.min(1000, Math.round(1000 / Math.max(1, b - a)));
      sampling = false;
    });
  });
}

function tick() {
  const t = now();
  const late = t - lastTick - 1000;
  lastTick = t;
  if (!renderLogPref.get()) { watching = false; return; }
  // just turned on: start counting from now, not from when it was turned off
  if (!watching) { watching = true; lastFrame = t; stalledAt = null; slowFor = 0; sample(); return; }
  sample();
  if (late > 2000) send({ text: `The window's code was busy or paused for ${secs(late)}. ${state()}` });
  const visible = document.visibilityState === "visible";
  const since = t - lastFrame;
  // the timer ran on time but no frame came: the page runs, its drawing doesn't
  if (visible && since > 4000 && late < 1000 && stalledAt === null) {
    stalledAt = lastFrame;
    send({ text: `No frame for ${secs(since)} while the page is visible. ${state()}`, incident: "frames", title: "The page stopped drawing frames while on screen" });
  } else if (stalledAt !== null && since < 1500) {
    send({ text: `Frames came back after ${secs(lastFrame - stalledAt)}. ${state()}` });
    stalledAt = null;
  }
  // a few frames a second for five seconds in a row while visible and nothing blocks the code
  if (visible && stalledAt === null && late < 500 && fps > 0 && fps < 10) {
    if (++slowFor === 5) send({ text: `Drawing slowed to ${fps} frames a second for 5 s. ${state()}` });
  } else slowFor = 0;
}

function webgl(): string {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "not available";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)}, ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return r;
  } catch (e) { return `failed (${String(e)})`; }
}

function environment(): string {
  const hdr = matchMedia("(dynamic-range: high)").matches ? "yes" : "no";
  return `Screen ${screen.width}x${screen.height} (${screen.availWidth}x${screen.availHeight} free), ${screen.colorDepth} bit, HDR ${hdr}, `
    + `pixel ratio ${devicePixelRatio}, page ${innerWidth}x${innerHeight}. WebGL: ${webgl()}. ${navigator.userAgent}`;
}

/** Connected game controllers and what they hold: one with a stuck stick or button moves the app by itself. */
function pads(): string[] {
  try {
    return [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected)
      .map((p) => `${p.id}: ${p.buttons.filter((b) => b.pressed).length} pressed, axes ${p.axes.map((a) => a.toFixed(1)).join(" ")}`);
  } catch { return []; }
}

/** The page's side of a check, as JSON (render.rs `probe`). */
function probe(): string {
  return JSON.stringify({
    visibility: document.visibilityState, focus: document.hasFocus(), lastFrameMsAgo: Math.round(now() - lastFrame), framesLastSecond: fps,
    stalled: stalledAt !== null, longTasks, worstTaskMs: Math.round(worstTask), screen: currentRoute().view,
    theme: document.documentElement.dataset.theme ?? "default", scheme: document.documentElement.dataset.scheme ?? "",
    size: `${innerWidth}x${innerHeight}`, pixelRatio: devicePixelRatio, canvases: document.querySelectorAll("canvas").length,
    classes: document.documentElement.className, layer: !!document.querySelector(".lightbox, .overlay"), pads: pads(),
  });
}

/** Start watching (once, before the window renders). `where` names the window ("main" or "overlay"). Also starts the
 *  page's own redraws (redraw.ts), which run whether or not the rendering log is on. */
export function installRenderWatch(where: "main" | "overlay") {
  if (!inTauri()) return;
  installRedraw();
  (window as unknown as { __gmRenderProbe?: () => string }).__gmRenderProbe = probe;
  // with the rendering log off, nothing here draws or waits on frames
  window.setInterval(tick, 1000);
  window.setInterval(flush, 2000);
  window.setInterval(() => { budget = 30; }, 60_000);
  // after the first paint, so the WebGL check doesn't hold it up
  window.setTimeout(() => send({ text: `${where} page started. ${environment()}` }), 3000);
  document.addEventListener("visibilitychange", () => send({ text: `Page ${document.visibilityState}` }));
  let ratio = devicePixelRatio;
  window.addEventListener("resize", () => {
    if (devicePixelRatio !== ratio) { send({ text: `Pixel ratio changed from ${ratio} to ${devicePixelRatio}` }); ratio = devicePixelRatio; }
  });
  // WebGL contexts lost: a graphics card reset or the GPU process restarting. The 3D view marks its own on close.
  document.addEventListener("webglcontextlost", (e) => {
    const c = e.target as HTMLCanvasElement | null;
    if (c?.dataset?.closing) return;
    send({ text: `A WebGL canvas lost its drawing context. ${state()}`, incident: "webgl", title: "A WebGL drawing context was lost" });
  }, true);
  document.addEventListener("webglcontextrestored", () => send({ text: "A WebGL canvas got its drawing context back" }), true);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        longTasks++;
        worstTask = Math.max(worstTask, e.duration);
        if (e.duration > 1000) send({ text: `A task in the window's code took ${Math.round(e.duration)} ms on screen "${currentRoute().view}"` });
      }
    }).observe({ type: "longtask", buffered: false });
  } catch { /* not supported */ }
}
