// Smooth wheel scrolling. A notched mouse wheel jumps a whole step at once (WebView2 doesn't animate it), which is
// hard to follow in a grid of pictures, so each notch here glides the same distance over a short ease instead.
// Touchpads already scroll smoothly and are left alone, and so is anything that handles the wheel itself (it calls
// preventDefault first). Off with Smooth scrolling off in Settings, Appearance (html[data-motion-scroll]). Owner: skeleton.

interface Run { target: number; last: number; raf: number; t: number }
const runs = new WeakMap<Element, { x?: Run; y?: Run }>();

/** About 250 ms to settle: each 60 Hz frame closes this share of what's left. */
const EASE = 0.24;

const reduced = () => document.documentElement.dataset.motionScroll === "off";

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
  glideTo(el, axis, glideTarget(el, axis) + delta);
}

/** Where `el` is gliding to along an axis, or where it is when it isn't gliding. */
export function glideTarget(el: Element, axis: "x" | "y"): number {
  const run = runs.get(el)?.[axis];
  const pos = axis === "y" ? el.scrollTop : el.scrollLeft;
  // something else moved it (the scrollbar, a key, a jump to a section): it is where it is now
  return run && Math.abs(pos - run.last) <= 3 ? run.target : pos;
}

/** Glide `el` to a scroll position along an axis. It lands on it exactly, and a target at or past either end lands
 *  on the very edge, never a pixel or two short of it. */
export function glideTo(el: Element, axis: "x" | "y", to: number) {
  const top = axis === "y";
  const pos = () => (top ? el.scrollTop : el.scrollLeft);
  const end = () => (top ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth);
  // scrollWidth and clientWidth are whole pixels, so the real end can be a fraction past end(): ask for a bit more
  // and the browser stops on the edge itself
  const set = (v: number) => el.scrollTo({ [top ? "top" : "left"]: v >= end() ? v + 2 : v, behavior: "instant" });
  const target = Math.max(0, Math.min(end(), to));
  if (reduced()) { set(target); return; }
  const state = runs.get(el) ?? {};
  runs.set(el, state);
  const run = state[axis];
  if (run && Math.abs(pos() - run.last) <= 3) { run.target = target; return; }
  if (run) cancelAnimationFrame(run.raf);
  const r: Run = { target, last: pos(), raf: 0, t: 0 };
  state[axis] = r;
  // a scroll position snaps to whole device pixels, so a step under one rounds back to where it was
  const px = Math.max(1, 1 / (window.devicePixelRatio || 1));
  const step = (now: number) => {
    // a frame's timestamp can be older than the wheel event, so the first frame counts as one frame, never less
    const dt = r.t ? Math.max(1, Math.min(64, now - r.t)) : 16.7;
    r.t = now;
    const cur = pos();
    if (Math.abs(cur - r.last) > 3) { state[axis] = undefined; return; }
    const left = r.target - cur;
    let move = left * (1 - Math.pow(1 - EASE, dt / 16.7));
    // the last couple of pixels go in one step, and no step is too small to move it: easing by fractions of a
    // pixel would creep forever just short of the target
    if (Math.abs(left) <= 2 * px) move = left;
    else if (Math.abs(move) < px) move = Math.sign(left) * px;
    set(cur + move);
    r.last = pos();
    // arrived, or it didn't move at all (an edge, or the content shrank under it)
    if (move === left || Math.abs(r.last - cur) < 0.01) { state[axis] = undefined; return; }
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
