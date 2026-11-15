// A picture that loads only once it's on screen (or 48 px from it). The browser's own lazy loading starts more than a
// screen early, which fetched thumbnails nobody scrolled to; here a hidden page or the far end of a sideways strip
// asks for nothing. One observer serves every picture. A picture shown once shows at once after that, so a list that
// re-renders doesn't blink. Owner: KIT area.
import { useEffect, useRef, useState, type ComponentProps } from "react";

const waiting = new Map<Element, () => void>();
let io: IntersectionObserver | null = null;

function watch(el: Element, show: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") { show(); return () => {}; }
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const f = waiting.get(e.target);
      waiting.delete(e.target);
      io?.unobserve(e.target);
      f?.();
    }
  }, { rootMargin: "48px" });
  waiting.set(el, show);
  io.observe(el);
  return () => { waiting.delete(el); io?.unobserve(el); };
}

const shownOnce = new Set<string>();

export function LazyImg({ src, ref: outer, ...rest }: ComponentProps<"img">) {
  const own = useRef<HTMLImageElement | null>(null);
  const [shown, setShown] = useState(() => !src || shownOnce.has(src));
  useEffect(() => {
    if (!src || shownOnce.has(src)) { setShown(true); return; }
    setShown(false);
    const el = own.current;
    if (!el) return;
    return watch(el, () => { shownOnce.add(src); setShown(true); });
  }, [src]);
  const setRef = (el: HTMLImageElement | null) => {
    own.current = el;
    if (typeof outer === "function") outer(el);
    else if (outer) outer.current = el;
  };
  return <img ref={setRef} {...rest} src={shown ? src : undefined} />;
}
