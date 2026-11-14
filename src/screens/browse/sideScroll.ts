// A row that scrolls sideways: the mouse wheel scrolls it (when it can still move that way), and it says whether
// there is more to the left or right for its arrow buttons. Owner: BROWSE area.
import { useCallback, useEffect, useState, type RefObject } from "react";
import { glide } from "../../lib/smoothScroll";

export function useSideScroll(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      // let the page scroll once the row is at its end
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      glide(el, "x", e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener("wheel", wheel); el.removeEventListener("scroll", measure); ro.disconnect(); };
  }, [ref, measure, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { measure(); }, [measure, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Scroll by most of a screenful. */
  const page = useCallback((dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: "smooth" });
  }, [ref]);

  return { ...edges, page };
}

/** Arrow keys step focus between the row's items (and Home, End). */
export function rowKeys(e: React.KeyboardEvent<HTMLElement>, itemSelector: string) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(itemSelector)];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const to = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : i + (e.key === "ArrowRight" ? 1 : -1);
  const t = items[Math.max(0, Math.min(items.length - 1, to))];
  if (t && t !== items[i]) { e.preventDefault(); t.focus(); t.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); }
}
