// A row that scrolls sideways: the mouse wheel scrolls it, its arrow buttons move it a screenful of whole items at a
// time, and it says whether there is more to the left or right for those arrows. Owner: BROWSE area.
//
// A wheel gesture belongs to whatever it started over. Scrolling the page down past a row keeps scrolling the page,
// however fast or bumpy the wheel is, because the row only slid under a pointer that stayed put. The row takes the
// wheel when a gesture starts on it, as soon as the pointer moves onto it, or with Shift. A row that runs out of
// room mid-gesture stops there instead of throwing the rest of a fast spin at the page; a gesture that starts at its
// end goes on to the page, and turning the wheel back brings it to the row again.
//
// A row always rests exactly on its first or last item, never a pixel or two short of it (which cuts off the item's
// outline): the glide lands on the edge, and a scroll heading for an end that stops just short of it goes the rest of
// the way.
import { useCallback, useEffect, useState, type RefObject } from "react";
import { glideTarget, glideTo } from "../../lib/smoothScroll";

/** A gap this long between wheel events starts a new gesture. Free-spinning and "jumpy" wheels send events closer
 *  together than this while they turn. */
const GESTURE_GAP = 450;
/** The pointer moving this far from where a gesture started means it was aimed at something new. */
const MOVED = 6;
/** Resting this close to an end counts as the end. */
const EDGE = 2;
/** A scroll heading for an end that stops this close to it goes the rest of the way, so the first or last item is
 *  never left partly hidden. */
const SNAP = 24;

let lastWheel = -Infinity;
/** Where the pointer was when the current gesture started. */
let anchor = { x: 0, y: 0 };
/** What the current gesture scrolls: a row, "page", or null before anything claimed it. */
let owner: HTMLElement | "page" | null = null;
/** The row that handed the current gesture to the page because it was at its end, and which way the wheel went. */
let passed: { row: HTMLElement; dir: number } | null = null;
let wired = false;
function wireGestures() {
  if (wired) return;
  wired = true;
  // capture runs before any row's handler: a pause or a pointer that moved starts a new gesture nobody owns yet
  window.addEventListener("wheel", (e) => {
    const moved = Math.abs(e.clientX - anchor.x) + Math.abs(e.clientY - anchor.y) > MOVED;
    if (e.timeStamp - lastWheel > GESTURE_GAP || moved) { owner = null; passed = null; anchor = { x: e.clientX, y: e.clientY }; }
    lastWheel = e.timeStamp;
  }, { capture: true, passive: true });
  // bubbling ends after the rows: a gesture no row claimed is the page's
  window.addEventListener("wheel", () => { if (owner === null) owner = "page"; }, { passive: true });
}

export function useSideScroll(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > EDGE;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // a folded page header leaves rows that scroll themselves alone (kit.css)
    el.dataset.sideScroll = "";
    measure();
    wireGestures();
    const wheel = (e: WheelEvent) => {
      // sideways wheels and touchpad swipes scroll it on their own (lib/smoothScroll)
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max < 1) return;
      const dir = Math.sign(e.deltaY);
      // the page (or another row) owns this gesture and the row just slid under the pointer. Shift always means
      // sideways, and so does turning the wheel back on the row that handed the gesture on
      const back = passed?.row === el && passed.dir !== dir;
      if (!e.shiftKey && !back && owner !== null && owner !== el) return;
      const at = glideTarget(el, "x");
      if (dir < 0 ? at <= 0.5 : at >= max - 0.5) {
        if (owner === el) { e.preventDefault(); return; }
        owner = "page";
        passed = { row: el, dir };
        return;
      }
      owner = el;
      passed = null;
      e.preventDefault();
      glideTo(el, "x", at + (e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY));
    };
    // which way it last moved, so a stop just short of an end moves onto that end and never back off it
    let prev = el.scrollLeft, heading = 0, still = 0;
    const scroll = () => {
      if (el.scrollLeft !== prev) heading = Math.sign(el.scrollLeft - prev);
      prev = el.scrollLeft;
      measure();
      // once it has stopped moving (scrollend doesn't fire for every kind of scroll, so a timer decides)
      clearTimeout(still);
      still = window.setTimeout(settle, 120);
    };
    const settle = () => {
      const p = el.scrollLeft, max = el.scrollWidth - el.clientWidth;
      if (heading < 0 && p > 0 && p <= SNAP) glideTo(el, "x", 0);
      else if (heading > 0 && p < max && p >= max - SNAP) glideTo(el, "x", max);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("scroll", scroll, { passive: true });
    // the row's own size, and its items' (a font or picture that loads late changes how wide they are)
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("scroll", scroll);
      clearTimeout(still);
      ro.disconnect();
    };
  }, [ref, measure, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { measure(); }, [measure, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Move a screenful of whole items: the item cut off at the far side comes to the near side, so nothing is skipped. */
  const page = useCallback((dir: -1 | 1) => {
    const el = ref.current;
    if (el) glideTo(el, "x", pageStop(el, dir));
  }, [ref]);

  return { ...edges, page };
}

/** An item's left and right in the row's scroll coordinates (where its first item starts at its left padding). */
function span(row: HTMLElement, item: Element) {
  const r = item.getBoundingClientRect();
  const left = r.left - row.getBoundingClientRect().left - row.clientLeft + row.scrollLeft;
  return { left, right: left + r.width, width: r.width };
}

function pageStop(row: HTMLElement, dir: -1 | 1): number {
  const at = glideTarget(row, "x"), w = row.clientWidth;
  const cs = getComputedStyle(row);
  const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
  // separators and other slivers don't count as items
  const items = [...row.children].map((c) => span(row, c)).filter((s) => s.width > 8);
  if (dir > 0) {
    const cut = items.find((s) => s.right > at + w - padR + 0.5);
    const to = cut ? cut.left - padL : at + w;
    return to > at + 1 ? to : at + w * 0.8;
  }
  const cut = [...items].reverse().find((s) => s.left < at + padL - 0.5);
  const to = cut ? cut.right + padR - w : at - w;
  return to < at - 1 ? to : at - w * 0.8;
}

/** Bring an item of a sideways row into view by scrolling the row only, never the page. "nearest" moves it just in,
 *  leaving room to see the next one; "center" puts it in the middle, but only when it isn't already in view, so a
 *  click on a visible item doesn't pull the row out from under the pointer. */
export function reveal(row: HTMLElement, item: Element, how: "nearest" | "center" = "nearest") {
  const at = glideTarget(row, "x"), w = row.clientWidth;
  if (row.scrollWidth - w < 1) return;
  const s = span(row, item);
  const room = Math.min(32, Math.max(0, (w - s.width) / 2));
  const out = s.left < at + room || s.right > at + w - room;
  if (!out) return;
  if (how === "center") glideTo(row, "x", s.left - (w - s.width) / 2);
  else glideTo(row, "x", s.left < at + room ? s.left - room : s.right + room - w);
}

/** Arrow keys step focus between the row's items (and Home, End), and the row follows. */
export function rowKeys(e: React.KeyboardEvent<HTMLElement>, itemSelector: string) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const row = e.currentTarget;
  const items = [...row.querySelectorAll<HTMLElement>(itemSelector)];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const to = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : i + (e.key === "ArrowRight" ? 1 : -1);
  const t = items[Math.max(0, Math.min(items.length - 1, to))];
  if (!t || t === items[i]) return;
  e.preventDefault();
  // a row that scrolls sideways glides to the item; one that wraps (an open grid) lets the browser bring it into view
  if (row.scrollWidth - row.clientWidth >= 1 && getComputedStyle(row).overflowX !== "visible") {
    t.focus({ preventScroll: true });
    reveal(row, t);
  } else t.focus();
}
