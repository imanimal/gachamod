// The tour: six short steps that light up one part of the window each (search, the game, the pages, profiles,
// Play, help). Offered once after the first setup (a toast) and always in the title bar's Help menu. Arrows or
// Enter move on, Escape closes; a controller's A presses the focused key and B closes. Owner: SHELL area.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/Icon";
import { endTour, useTourOpen } from "./state";

interface Step { sel: string; title: string; text: string }

const STEPS: Step[] = [
  { sel: ".tb-search", title: "Search anything", text: "Type a mod, a character, a setting or a page and press Enter. Ctrl+K opens it from anywhere." },
  { sel: ".side-game", title: "Your game", text: "Click it to switch games, open the Mods folder or change the game's settings." },
  { sel: ".side-nav", title: "Pages", text: "Mods is what you have installed. Browse finds new mods on GameBanana and installs them in one click." },
  { sel: ".side-prof", title: "Profiles", text: "A profile remembers which mods are on, so you can swap a whole set in one click." },
  { sel: ".side-foot", title: "Play", text: "Starts the game with your mods." },
  { sel: ".tb-help", title: "Help", text: "This tour and every keyboard and controller shortcut are here." },
];

const shown = (sel: string) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

export function Tour() {
  return useTourOpen() ? <TourRun /> : null;
}

function TourRun() {
  const [steps] = useState(() => STEPS.filter((s) => shown(s.sel)));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const step = steps[i];
  const last = i === steps.length - 1;
  const next = () => (last ? endTour() : setI(i + 1));
  const prev = () => setI(Math.max(0, i - 1));

  // where the lit part is, kept up to date while the window changes
  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => setRect(document.querySelector(step.sel)?.getBoundingClientRect() ?? null);
    document.querySelector(step.sel)?.scrollIntoView({ block: "nearest" });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step]);

  // the card goes beside the lit part where there is room: right, below, left, then above
  useLayoutEffect(() => {
    const c = card.current;
    if (!rect || !c) return;
    const w = c.offsetWidth, h = c.offsetHeight, gap = 14, pad = 12;
    const W = window.innerWidth, H = window.innerHeight;
    const clampX = (x: number) => Math.max(pad, Math.min(W - w - pad, x));
    const clampY = (y: number) => Math.max(pad, Math.min(H - h - pad, y));
    const spots = [
      { ok: rect.right + gap + w < W - pad, left: rect.right + gap, top: clampY(rect.top) },
      { ok: rect.bottom + gap + h < H - pad, left: clampX(rect.left + rect.width / 2 - w / 2), top: rect.bottom + gap },
      { ok: rect.left - gap - w > pad, left: rect.left - gap - w, top: clampY(rect.top) },
      { ok: true, left: clampX(rect.left + rect.width / 2 - w / 2), top: clampY(rect.top - gap - h) },
    ];
    const s = spots.find((p) => p.ok)!;
    setPos({ left: s.left, top: s.top });
  }, [rect]);

  // focus Next once the card is placed (a hidden card can't take focus), after the Help menu hands focus back
  const placed = pos !== null;
  useEffect(() => {
    if (!placed) return;
    const f = requestAnimationFrame(() => nextBtn.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(f);
  }, [i, placed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // the app's own shortcuts wait until the tour is over; Enter, Space and Tab still work on the focused key
      e.stopPropagation();
      if (e.key === "Enter" || e.key === " " || e.key === "Tab") return;
      e.preventDefault();
      if (e.key === "Escape") endTour();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!step) { endTour(); return null; }
  const pad = 6;
  const spot: CSSProperties | undefined = rect ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : undefined;

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label="Tour">
      <div className="tour-block" onClick={(e) => e.stopPropagation()} />
      {spot && <div className="tour-spot" style={spot} aria-hidden="true" />}
      <div ref={card} className="popover tour-card" style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}>
        <div className="tour-h">
          <b>{step.title}</b>
          <span className="tour-n">{i + 1} of {steps.length}</span>
          <button type="button" className="ibtn btn-ghost tour-x" aria-label="Close the tour" title="Close the tour (Esc)" onClick={endTour}><Icon name="x" /></button>
        </div>
        <p>{step.text}</p>
        <div className="tour-f">
          {i > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={prev} title="Back (Left arrow)"><span className="btn-t">Back</span></button>}
          <button ref={nextBtn} type="button" className="btn btn-primary btn-sm" onClick={next} title={last ? "Close the tour" : "Next (Right arrow)"}>
            <span className="btn-t">{last ? "Done" : "Next"}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
