// A full-window image viewer for a mod's gallery: arrow keys step, Escape closes (without closing the drawer under it).
// Owner: ONLINE area.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "../../ui/kit";
import { imageAt, type GbImage } from "../../lib/gamebanana";

export function Lightbox({ images, start, onClose }: { images: GbImage[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(Math.max(0, Math.min(start, images.length - 1)));
  const [broken, setBroken] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const n = images.length;
  const step = (d: number) => { setBroken(false); setI((x) => (x + d + n) % n); };

  useEffect(() => {
    boxRef.current?.querySelector<HTMLButtonElement>(".gb-lightbox-x")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); setBroken(false); setI((x) => (x + 1) % n); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); setBroken(false); setI((x) => (x - 1 + n) % n); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [n, onClose]);

  const img = images[i];
  if (!img) return null;
  const host = document.querySelector(".app") ?? document.body;
  return createPortal(
    <div ref={boxRef} className="overlay gb-lightbox" role="dialog" aria-modal="true" aria-label="Pictures"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gb-lightbox-bar">
        <span className="gb-lightbox-n">{i + 1} / {n}</span>
        {img.caption && <span className="gb-lightbox-cap">{img.caption}</span>}
        <IconButton className="gb-lightbox-x" icon="x" label="Close (Esc)" onClick={onClose} />
      </div>
      {broken
        ? <div className="gb-lightbox-img gb-img-broken">This picture didn't load</div>
        : <img key={img.full} className="gb-lightbox-img" src={img.full} alt={img.caption ?? ""} decoding="async"
            onError={(e) => { const fallback = imageAt(img, 800); if (fallback && e.currentTarget.src !== fallback) e.currentTarget.src = fallback; else setBroken(true); }} />}
      {n > 1 && <>
        <IconButton className="gb-lightbox-prev" icon="back" label="Previous (Left arrow)" onClick={() => step(-1)} />
        <IconButton className="gb-lightbox-next" icon="chevron" label="Next (Right arrow)" onClick={() => step(1)} />
      </>}
    </div>, host);
}
