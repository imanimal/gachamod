// A menu that floats by the button that opened it, above everything in the window: it is placed in the shell itself,
// so a card's rounded corners or a drawer's scrolling never clip it. It opens below the button, or
// above when there is more room there, stays inside the window, and closes on a click outside or Escape.
// From the keyboard: focus moves to the checked entry (or the first) when it opens, Up and Down move between entries,
// Tab goes round inside it, and focus goes back to the button when it closes.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]";
const ENTRIES = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const typing = (el: Element | null) => !!el && ((el as HTMLElement).isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
  || (el.tagName === "INPUT" && !["checkbox", "radio", "button"].includes((el as HTMLInputElement).type)));

export function Popover({ anchor, onClose, children, width = "21em", label, labelledBy, align = "end", role = "dialog" }: {
  anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: string;
  /** Its accessible name, like "Sort" or "Start options". */
  label?: string;
  /** The id of an element that names it, when there is no `label`. */
  labelledBy?: string;
  /** Line up with the button's right edge ("end", the default) or its left edge ("start"). */
  align?: "start" | "end";
  /** "menu" only when its children are the menu entries themselves (role menuitem or menuitemradio). A kit Menu
   *  inside carries its own menu role, so that Popover stays a dialog. */
  role?: "dialog" | "menu";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!anchor || !el || !anchor.isConnected) return;
      const a = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, pad = 8;
      const w = el.offsetWidth, h = el.scrollHeight;
      const left = Math.max(pad, Math.min(align === "start" ? a.left : a.right - w, vw - w - pad));
      const below = vh - a.bottom - pad - 6, above = a.top - pad - 6;
      const down = below >= Math.min(h, 360) || below >= above;
      const maxHeight = Math.max(160, down ? below : above);
      const top = down ? a.bottom + 6 : Math.max(pad, a.top - 6 - Math.min(h, maxHeight));
      setPos((p) => p && p.left === left && p.top === top && p.maxHeight === maxHeight ? p : { left, top, maxHeight });
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    // a dialog that is still sliding in moves the button: place again once it settles
    window.addEventListener("animationend", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); window.removeEventListener("animationend", place, true);
    };
  }, [anchor, align]);
  useEffect(() => {
    const me = ref.current;
    // a popover opened from inside this one (a Select's menu) is placed after it in the shell
    const nested = (el: Element | null) => !!me && !!el && el !== me && !!(me.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (me?.contains(t) || anchor?.contains(t)) return;
      const el = t instanceof Element ? t : t.parentElement;
      if (nested(el?.closest(".popover") ?? null)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // only the top popover closes, so one Escape (or B) shuts a Select's menu and leaves the popover it sits in
      const all = document.querySelectorAll(".popover");
      if (all[all.length - 1] !== me) return;
      e.stopPropagation();
      e.stopImmediatePropagation();
      // focus inside goes back to the button that opened it, so the keyboard and controller don't lose their place
      const inside = !!ref.current?.contains(document.activeElement);
      onClose();
      const back = anchor?.matches(FOCUSABLE) ? anchor : anchor?.querySelector<HTMLElement>(FOCUSABLE);
      if (inside && back?.isConnected) back.focus({ preventScroll: true });
    };
    document.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down, true); window.removeEventListener("keydown", key, true); };
  }, [anchor, onClose]);
  const entries = () => [...(ref.current?.querySelectorAll<HTMLElement>(ENTRIES) ?? [])].filter((el) => el.getClientRects().length > 0);
  // once placed, focus the checked entry or the first one, so the keyboard and controller start inside
  const placed = pos !== null;
  useEffect(() => {
    if (!placed || !ref.current || ref.current.contains(document.activeElement)) return;
    const on = ref.current.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled), [aria-selected="true"]:not(:disabled), [aria-pressed="true"]:not(:disabled)');
    (on ?? entries()[0])?.focus({ preventScroll: true });
  }, [placed]); // eslint-disable-line react-hooks/exhaustive-deps
  // picking an entry closes it: focus goes back to the button instead of the page
  useEffect(() => () => {
    window.setTimeout(() => {
      const a = document.activeElement;
      if (a && a !== document.body) return;
      const back = anchor?.matches(FOCUSABLE) ? anchor : anchor?.querySelector<HTMLElement>(FOCUSABLE);
      if (back?.isConnected) back.focus({ preventScroll: true });
    }, 0);
  }, [anchor]);
  const onKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    const k = e.key;
    if (k !== "ArrowDown" && k !== "ArrowUp" && k !== "Home" && k !== "End" && k !== "Tab") return;
    const at = document.activeElement;
    if (k !== "Tab" && typing(at)) return;
    const list = entries();
    if (!list.length) return;
    const i = list.indexOf(at as HTMLElement);
    const to = k === "Home" ? 0 : k === "End" ? list.length - 1
      : (k === "ArrowUp" || (k === "Tab" && e.shiftKey)) ? (i < 0 ? list.length - 1 : i - 1) : i + 1;
    e.preventDefault();
    list[(to + list.length) % list.length]?.focus();
  };
  const host = document.querySelector(".app") ?? document.body;
  return createPortal(
    <div ref={ref} className="popover" role={role} aria-label={label} aria-labelledby={label ? undefined : labelledBy}
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? 0, maxHeight: pos?.maxHeight, visibility: pos ? "visible" : "hidden" }}
      onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
      {children}
    </div>, host);
}
