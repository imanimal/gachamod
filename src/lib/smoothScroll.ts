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
  const r: Run = { target, last: pos(), raf: 0, t: 0 };
  state[axis] = r;
  const step = (now: number) => {
    // a frame's timestamp can be older than the wheel event, so the first frame counts as one frame, never less
    const dt = r.t ? Math.max(1, Math.min(64, now - r.t)) : 16.7;
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

const jumps = new WeakMap<Element, () => void>();
const STOPPERS = ["wheel", "pointerdown", "keydown", "touchstart"] as const;

/** Scroll `view` to put `el` where scrollIntoView would (scroll padding and margins count), in the same short time
 * however far it is: a far target jumps to about a screen away and glides the rest. The browser's own smooth scroll
 * takes over a second across a long page. Wheel, key or pointer input stops it, and so does a newer jump. `done` runs
 * once it arrives or stops. */
export function scrollToElement(view: HTMLElement, el: Element, block: ScrollLogicalPosition, done?: () => void) {
  jumps.get(view)?.();
  const from = view.scrollTop;
  el.scrollIntoView({ block, behavior: "instant" });
  const goal = view.scrollTop;
  // where el sits in the page, to follow it if something above finishes loading and pushes it down mid-scroll
  const offset = () => el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
  const at = offset();
  let raf = 0, t0 = 0, over = false;
  const finish = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    for (const e of STOPPERS) view.removeEventListener(e, finish);
    if (jumps.get(view) === finish) jumps.delete(view);
    done?.();
  };
  const d = goal - from;
  if (reduced() || Math.abs(d) < 1) { finish(); return; }
  const near = Math.max(240, view.clientHeight * 0.6);
  const start = Math.abs(d) > near ? goal - Math.sign(d) * near : from;
  const dur = Math.min(240, 120 + Math.min(Math.abs(d), near) * 0.15);
  view.scrollTo({ top: start, behavior: "instant" });
  jumps.set(view, finish);
  for (const e of STOPPERS) view.addEventListener(e, finish, { passive: true });
  const step = (now: number) => {
    if (!t0) t0 = now;
    const p = Math.min(1, (now - t0) / dur);
    const target = Math.max(0, Math.min(view.scrollHeight - view.clientHeight, goal + offset() - at));
    view.scrollTo({ top: start + (target - start) * (1 - Math.pow(1 - p, 3)), behavior: "instant" });
    if (p < 1) { raf = requestAnimationFrame(step); return; }
    el.scrollIntoView({ block, behavior: "instant" });
    finish();
  };
  raf = requestAnimationFrame(step);
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
