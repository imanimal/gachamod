// Smooth wheel scrolling. A notched mouse wheel jumps a whole step at once (WebView2 doesn't animate it), which is
// hard to follow in a grid of pictures, so each notch here glides the same distance over a short ease instead.
// Touchpads already scroll smoothly and are left alone, and so is anything that handles the wheel itself (it calls
// preventDefault first). Off when Animations is off (html[data-motion]) or the system asks for less motion. Owner: skeleton.

interface Run { target: number; last: number; raf: number; t: number }
const runs = new WeakMap<Element, { x?: Run; y?: Run }>();

/** About 250 ms to settle: each 60 Hz frame closes this share of what's left. */
const EASE = 0.24;

const reduced = () => {
  const m = document.documentElement.dataset.motion;
  return m === "reduced" || m === "0" || matchMedia("(prefers-reduced-motion: reduce)").matches;
};

/** A mouse wheel notch rather than a touchpad: Chromium reports notches as multiples of 120 in wheelDelta. */
function isNotch(e: WheelEvent): boolean {
  if (e.deltaMode !== 0) return true;
  const w = (e as WheelEvent & { wheelDeltaY?: number; wheelDeltaX?: number });
  const raw = Math.abs(e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) ? w.wheelDeltaX ?? 0 : w.wheelDeltaY ?? 0);
  return raw >= 120 && raw % 120 === 0;
}

function pixels(e: WheelEvent, d: number, size: number): number {
  return e.deltaMode === 1 ? d * 40 : e.deltaMode === 2 ? d * size * 0.9 : d;
}

function canScroll(el: Element, axis: "x" | "y", dir: number): boolean {
  const cs = getComputedStyle(el);
  const ov = axis === "y" ? cs.overflowY : cs.overflowX;
  if (ov !== "auto" && ov !== "scroll") return false;
  const pos = axis === "y" ? el.scrollTop : el.scrollLeft;
  const max = axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  if (max < 1) return false;
  return dir < 0 ? pos > 0.5 : pos < max - 0.5;
}

/** Glide `el` by `delta` px along an axis. Notches that come quickly add up into one longer glide. */
export function glide(el: Element, axis: "x" | "y", delta: number) {
  const pos = () => (axis === "y" ? el.scrollTop : el.scrollLeft);
  const max = axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  if (reduced()) { el.scrollBy({ [axis === "y" ? "top" : "left"]: delta, behavior: "instant" }); return; }
  const state = runs.get(el) ?? {};
  runs.set(el, state);
  let run = state[axis];
  // something else moved it (the scrollbar, a key, a jump to a section): start from where it is now
  if (run && Math.abs(pos() - run.last) > 3) { cancelAnimationFrame(run.raf); run = undefined; }
  const from = run ? run.target : pos();
  const target = Math.max(0, Math.min(max, from + delta));
  if (run) { run.target = target; return; }
  const r: Run = { target, last: pos(), raf: 0, t: performance.now() };
  state[axis] = r;
  const step = (now: number) => {
    const dt = Math.min(64, now - r.t);
    r.t = now;
    const cur = pos();
    if (Math.abs(cur - r.last) > 3) { state[axis] = undefined; return; }
    const left = r.target - cur;
    const move = Math.abs(left) < 0.6 ? left : left * (1 - Math.pow(1 - EASE, dt / 16.7));
    el.scrollTo({ [axis === "y" ? "top" : "left"]: cur + move, behavior: "instant" });
    r.last = pos();
    // stuck at an edge or arrived
    if (Math.abs(r.target - r.last) < 0.6 || (Math.abs(r.last - cur) < 0.01 && Math.abs(move) >= 0.6)) { state[axis] = undefined; return; }
    r.raf = requestAnimationFrame(step);
  };
  r.raf = requestAnimationFrame(step);
}

/** Smooth the mouse wheel everywhere in the window. Returns a function that stops it. */
export function installSmoothScroll(): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || !isNotch(e)) return;
    const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const axis = sideways ? "x" : "y";
    const d = sideways ? (e.deltaX || e.deltaY) : e.deltaY;
    if (!d) return;
    for (let el = e.target instanceof Element ? e.target : null; el && el !== document.documentElement; el = el.parentElement) {
      if (el instanceof HTMLSelectElement) return;
      if (!canScroll(el, axis, d)) continue;
      e.preventDefault();
      glide(el, axis, pixels(e, d, axis === "y" ? el.clientHeight : el.clientWidth));
      return;
    }
  };
  window.addEventListener("wheel", onWheel, { passive: false });
  return () => window.removeEventListener("wheel", onWheel);
}
