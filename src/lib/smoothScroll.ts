// The mouse wheel in every scrolling box of the window: which box a turn of the wheel scrolls, and smooth notches.
// Owner: skeleton.
//
// Which box. A wheel gesture stays with the box it started on, the way Firefox and Chromium latch a wheel to one
// scroller. Scrolling a page down past a list, a picture strip or a row of cards keeps scrolling the page, because
// they only slid under a pointer that stayed put, and so does going on a notch at a time with pauses shorter than
// HOLD. The gesture ends, and the box under the pointer takes the next notch, when the pointer moves, after a longer
// pause, on a click or key press, or when something covers the box (a drawer, a window). A box that runs out of
// room stops there instead of throwing the rest of a fast spin at the page; after a pause of GAP the next notch goes
// on to the box around it, unless the box has overscroll-behavior: contain. A row marked data-side-scroll
// (screens/browse/sideScroll.ts) takes an up-and-down wheel as left and right, and turning the wheel back on a row
// that handed the gesture on brings it back to the row.
//
// Smooth notches. A notched mouse wheel jumps a whole step at once (WebView2 doesn't animate it), which is hard to
// follow in a grid of pictures, so each notch here glides the same distance over a short ease instead. Off with
// Smooth scrolling off in Settings, Appearance (html[data-motion-scroll]): a notch then jumps, to the same box.
//
// Touchpads scroll by themselves, and Chromium already keeps each swipe on one box, so only their up-and-down
// swipes over a sideways row are handled here. Anything that handles the wheel itself (calls preventDefault first,
// like a Settings page turning or the 3D view zooming) is left alone and ends the gesture.

interface Run { target: number; last: number; raf: number; t: number }
const runs = new WeakMap<Element, { x?: Run; y?: Run }>();

type Axis = "x" | "y";

/** About 250 ms to settle: each 60 Hz frame closes this share of what's left. */
const EASE = 0.24;
/** A pause this long ends a spin: a box that ran out of room hands the next notch to the box around it. Free-spinning
 *  and "jumpy" wheels send notches closer together than this while they turn. */
const GAP = 450;
/** With the pointer still, a gesture keeps its box through pauses shorter than this, so scrolling a page a notch at a
 *  time never hands the wheel to something that came to rest under the pointer. Firefox holds a wheel for 1.5 s too. */
const HOLD = 1500;
/** The pointer moving this far from where a gesture started means it is aimed at something new. */
const MOVED = 6;

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

const isRow = (el: Element) => el instanceof HTMLElement && el.dataset.sideScroll !== undefined;

/** `el` scrolls along `axis` (its overflow lets it, and its content is bigger than it). */
function scrolls(el: Element, axis: Axis): boolean {
  const cs = getComputedStyle(el);
  const ov = axis === "y" ? cs.overflowY : cs.overflowX;
  if (ov !== "auto" && ov !== "scroll") return false;
  return (axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth) >= 1;
}

/** The axis a wheel turned this way moves `el` along: a sideways turn moves things sideways, and so does an
 *  up-and-down one on a sideways row (unless the row is laid out as a column right now). */
function axisOf(el: Element, sideways: boolean): Axis {
  return sideways || (isRow(el) && scrolls(el, "x")) ? "x" : "y";
}

/** `el` scrolls along `axis` and has room left that way, counting a glide still under way. */
function canScroll(el: Element, axis: Axis, dir: number): boolean {
  if (!scrolls(el, axis)) return false;
  const at = glideTarget(el, axis);
  const max = axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  return dir < 0 ? at > 0.5 : at < max - 0.5;
}

/** `el` scrolls along `axis` and keeps a wheel that reaches its end from going on to the box around it. */
function holdsOverscroll(el: Element, axis: Axis): boolean {
  if (!scrolls(el, axis)) return false;
  const cs = getComputedStyle(el);
  return (axis === "y" ? cs.overscrollBehaviorY : cs.overscrollBehaviorX) !== "auto";
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
 * once it arrives (true) or stops (false). */
export function scrollToElement(view: HTMLElement, el: Element, block: ScrollLogicalPosition, done?: (arrived: boolean) => void) {
  jumps.get(view)?.();
  const from = view.scrollTop;
  el.scrollIntoView({ block, behavior: "instant" });
  const goal = view.scrollTop;
  // where el sits in the page, to follow it if something above finishes loading and pushes it down mid-scroll
  const offset = () => el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
  const at = offset();
  let raf = 0, t0 = 0, over = false;
  const finish = (arrived: boolean) => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    for (const e of STOPPERS) view.removeEventListener(e, stop);
    if (jumps.get(view) === stop) jumps.delete(view);
    done?.(arrived);
  };
  const stop = () => finish(false);
  const d = goal - from;
  if (reduced() || Math.abs(d) < 1) { finish(true); return; }
  const near = Math.max(240, view.clientHeight * 0.6);
  const start = Math.abs(d) > near ? goal - Math.sign(d) * near : from;
  const dur = Math.min(240, 120 + Math.min(Math.abs(d), near) * 0.15);
  view.scrollTo({ top: start, behavior: "instant" });
  jumps.set(view, stop);
  for (const e of STOPPERS) view.addEventListener(e, stop, { passive: true });
  const step = (now: number) => {
    if (!t0) t0 = now;
    const p = Math.min(1, (now - t0) / dur);
    const target = Math.max(0, Math.min(view.scrollHeight - view.clientHeight, goal + offset() - at));
    view.scrollTo({ top: start + (target - start) * (1 - Math.pow(1 - p, 3)), behavior: "instant" });
    if (p < 1) { raf = requestAnimationFrame(step); return; }
    el.scrollIntoView({ block, behavior: "instant" });
    finish(true);
  };
  raf = requestAnimationFrame(step);
}

/** The nearest box around `el` that scrolls up and down. */
function scrollBox(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const ov = getComputedStyle(p).overflowY;
    if ((ov === "auto" || ov === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/** Jump to a section (a tag on a card, a "Files" link): scrollToElement in whatever box scrolls around `el`. Panels
 * above it that finish loading afterwards would push it away, so it stays put until the page has been still for a
 * moment, or the user scrolls, clicks or presses a key. */
export function jumpToElement(el: Element, block: ScrollLogicalPosition = "start") {
  const view = scrollBox(el);
  if (!view) { el.scrollIntoView({ block, behavior: "instant" }); return; }
  scrollToElement(view, el, block, (arrived) => { if (arrived) hold(view, el, block); });
}

function hold(view: HTMLElement, el: Element, block: ScrollLogicalPosition) {
  let quiet = 0;
  const stop = () => {
    watch.disconnect();
    window.clearTimeout(quiet);
    for (const e of STOPPERS) view.removeEventListener(e, stop);
    if (jumps.get(view) === stop) jumps.delete(view);
  };
  const watch = new ResizeObserver(() => {
    if (!el.isConnected) { stop(); return; }
    el.scrollIntoView({ block, behavior: "instant" });
    window.clearTimeout(quiet);
    quiet = window.setTimeout(stop, 1500);
  });
  jumps.set(view, stop);
  for (const e of STOPPERS) view.addEventListener(e, stop, { passive: true });
  for (const c of view.children) watch.observe(c);
  quiet = window.setTimeout(stop, 1500);
}

interface Gesture {
  /** What it scrolls. */
  box: Element;
  sideways: boolean;
  /** When its last wheel event came (event timeStamp). */
  last: number;
  /** Where the pointer was when it started. */
  x: number;
  y: number;
  /** A sideways row it went past because the row was at its end, and which way the wheel turned then. */
  passed: { row: Element; dir: number } | null;
}
let gesture: Gesture | null = null;
/** Where the wheel event being handled goes, worked out before any other handler sees it. */
let routed: { e: WheelEvent; box: Element | null; axis: Axis; d: number; sideways: boolean } | null = null;

/** The box under the pointer that a wheel turned this way scrolls: the innermost one with room left that way, or one
 *  at its end that keeps the wheel to itself. A select keeps the wheel too, for the browser to handle. */
function pick(from: Element | null, sideways: boolean, dir: number) {
  let passed: Gesture["passed"] = null;
  for (let el = from; el && el !== document.documentElement; el = el.parentElement) {
    if (el instanceof HTMLSelectElement) return { box: el, passed };
    const axis = axisOf(el, sideways);
    if (canScroll(el, axis, dir) || holdsOverscroll(el, axis)) return { box: el, passed };
    if (!passed && axis === "x" && !sideways) passed = { row: el, dir };
  }
  return { box: null, passed };
}

/** The nearest box around `box` with room left that way, for a gesture that ran `box` to its end. */
function outward(box: Element, sideways: boolean, dir: number): Element | null {
  if (holdsOverscroll(box, axisOf(box, sideways))) return null;
  for (let el = box.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    const axis = axisOf(el, sideways);
    if (canScroll(el, axis, dir)) return el;
    if (holdsOverscroll(el, axis)) return null;
  }
  return null;
}

/** Capture phase, before anything else sees the event: decide which box it goes to. */
function route(e: WheelEvent) {
  routed = null;
  if (e.ctrlKey || e.metaKey) return;
  const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
  const d = sideways ? e.deltaX || e.deltaY : e.deltaY;
  if (!d) return;
  const dir = Math.sign(d);
  const at = e.target instanceof Element ? e.target : null;
  const g = gesture;
  const gap = g ? e.timeStamp - g.last : Infinity;
  // the same gesture while the pointer stays put over its box, with no long pause and no change between sideways
  // and up-and-down (Shift)
  const held = !!g && !!at && g.sideways === sideways && gap < HOLD && g.box.contains(at)
    && Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) <= MOVED;
  if (!held) {
    const { box, passed } = pick(at, sideways, dir);
    gesture = box ? { box, sideways, last: e.timeStamp, x: e.clientX, y: e.clientY, passed } : null;
    routed = { e, box, axis: box ? axisOf(box, sideways) : "y", d, sideways };
    return;
  }
  g.last = e.timeStamp;
  if (g.passed && g.passed.dir !== dir && g.passed.row.contains(at) && canScroll(g.passed.row, "x", dir)) {
    // turning the wheel back on the row that handed the gesture on
    g.box = g.passed.row;
    g.passed = null;
  } else if (gap >= GAP && !canScroll(g.box, axisOf(g.box, sideways), dir)) {
    // it ran out of room and the spin paused: on to the box around it
    const next = outward(g.box, sideways, dir);
    if (next) {
      if (!sideways && axisOf(g.box, false) === "x") g.passed = { row: g.box, dir };
      g.box = next;
    }
  }
  routed = { e, box: g.box, axis: axisOf(g.box, sideways), d, sideways };
}

/** Bubble phase, after the page's own handlers: scroll the box, unless one of them took the wheel. */
function act(e: WheelEvent) {
  const r = routed;
  routed = null;
  if (!r || r.e !== e) return;
  // a Settings page turned, the 3D view zoomed: the next notch starts a new gesture
  if (e.defaultPrevented) { gesture = null; return; }
  const { box, axis, d, sideways } = r;
  if (!box || box instanceof HTMLSelectElement) return;
  if (!isNotch(e) && (sideways || axis === "y")) return;
  // a box that ran out of room still takes the notch, so the rest of a fast spin doesn't scroll the page
  e.preventDefault();
  if (canScroll(box, axis, Math.sign(d))) glide(box, axis, pixels(e, d, axis === "y" ? box.clientHeight : box.clientWidth));
}

/** The box a wheel event goes to, for a handler that decides something by it (a Settings page turns at its end only
 *  when the wheel goes to the page, not to a list on it). Null when nothing under the pointer can scroll that way,
 *  undefined when the event isn't one the wheel handling looks at (Ctrl held, no movement). */
export function wheelBox(e: WheelEvent): Element | null | undefined {
  return routed?.e === e ? routed.box : undefined;
}

/** Handle the mouse wheel everywhere in the window. Returns a function that stops it. */
export function installSmoothScroll(): () => void {
  const end = () => { gesture = null; };
  window.addEventListener("wheel", route, { capture: true, passive: true });
  window.addEventListener("wheel", act, { passive: false });
  window.addEventListener("pointerdown", end, { capture: true, passive: true });
  window.addEventListener("keydown", end, { capture: true, passive: true });
  return () => {
    window.removeEventListener("wheel", route, { capture: true });
    window.removeEventListener("wheel", act);
    window.removeEventListener("pointerdown", end, { capture: true });
    window.removeEventListener("keydown", end, { capture: true });
    gesture = null;
  };
}
