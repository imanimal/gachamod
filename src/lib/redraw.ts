// Keeps the window drawn. On some PCs (seen with NVIDIA cards and more than one monitor) the window is left black on
// screen after another window takes focus: the page is fine, but nothing shows until it draws another frame, which
// moving the mouse over it did. So the page draws by itself: one frame a second while it is on screen, and every
// frame for two seconds after focus, size or screen changes (render.rs asks for those too, through `__gmRedraw`).
// A frame here is a change nobody can see: a corner pixel, and during the two seconds a sheet over the whole window,
// both black at under 2% and never in the way of the mouse. Owner: SYSTEM area.

const LAYER = "position:fixed;pointer-events:none;z-index:2147483647;background:#000;";
let dot: HTMLElement | null = null;
let sheet: HTMLElement | null = null;
let flip = false;
let until = 0;
let running = false;

function make(css: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = LAYER + css;
  document.body.appendChild(el);
  return el;
}

function frame() {
  flip = !flip;
  if (dot) dot.style.opacity = flip ? "0.02" : "0.01";
  if (sheet && sheet.style.display !== "none") sheet.style.opacity = flip ? "0.004" : "0.003";
}

function loop() {
  frame();
  if (performance.now() < until) { requestAnimationFrame(loop); return; }
  running = false;
  if (sheet) sheet.style.display = "none";
}

/** Draw every frame for the next two seconds. */
export function redraw() {
  until = performance.now() + 2000;
  if (running) return;
  running = true;
  if (sheet) sheet.style.display = "";
  requestAnimationFrame(loop);
}

/** Start it (once, when the window's page loads). */
export function installRedraw() {
  if (dot) return;
  dot = make("right:0;bottom:0;width:1px;height:1px;opacity:0.01");
  sheet = make("inset:0;opacity:0.003;display:none");
  (window as unknown as { __gmRedraw?: () => void }).__gmRedraw = redraw;
  window.setInterval(() => { if (document.visibilityState === "visible") frame(); }, 1000);
  for (const name of ["focus", "blur", "resize"]) window.addEventListener(name, redraw);
  document.addEventListener("visibilitychange", redraw);
  redraw();
}
