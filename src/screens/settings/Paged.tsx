// Settings and Tools as pages: the pages listed on the left (in groups when a screen has many), one page on the right,
// which can hold a few panels that belong together. Scrolling past the end
// of a page slides the next one up into view, as if they were one long page, and scrolling up past the top brings
// back the one before. Ctrl+Page Down and Ctrl+Page Up turn pages from the keyboard, a controller's triggers and right
// stick do it at the ends of a page, and the list works with all three. A page, or anything with an id on one (a
// panel, a row), is a route: go({ view, section: "games" }) opens the page, section: "storage" or "set-trash-days"
// also scrolls to that panel or row and flashes it. A page that renders nothing stays out of the list.
// Owner: SETTINGS/AI area.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "../../ui/Icon";
import { Badge } from "../../ui/kit";
import { consumeRoute, useRoute } from "../../lib/store";
import { glide, scrollToElement } from "../../lib/smoothScroll";
import "./paged.css";

/** A page: its route id, its name and icon in the list, the group it's listed under (none for a short list), a
 *  hover tip when the name alone doesn't say what's on it, and a count of new items on it to show in the list. */
export interface PageInfo { id: string; label: string; icon: IconName; group?: string; tip?: string; count?: number }

type Dir = 1 | -1;

/** The page each screen was on, so coming back to it in this session opens the same one. */
const lastPage = new Map<string, string>();

/** How far a push past the edge goes before the page turns, so a light touch on a touchpad doesn't. A wheel notch is
 *  about 100. */
const TURN_AT = 50;
/** Wheel events further apart than this start a new gesture. */
const QUIET = 250;
/** A page that is still gliding to its end doesn't count as there yet. */
const SETTLE = 120;
/** Spinning the wheel down a long page stops at its end. Scrolling on turns the page once it has sat there this long,
 *  unless the scroll is only winding down (a touchpad gliding on after the fingers lift, a free-spinning wheel). */
const DWELL = 350;

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isField = (el: Element | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function atEdge(el: Element, dir: Dir): boolean {
  return dir > 0 ? el.scrollTop + el.clientHeight >= el.scrollHeight - 2 : el.scrollTop <= 1;
}

/** Something on the page that scrolls by itself (a log, a long list) and can still go that way. */
function innerScroll(target: EventTarget | null, page: Element, dir: Dir): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== page; el = el.parentElement) {
    if (el instanceof HTMLSelectElement) return true;
    const ov = getComputedStyle(el).overflowY;
    if ((ov === "auto" || ov === "scroll") && el.scrollHeight - el.clientHeight > 1 && !atEdge(el, dir)) return true;
  }
  return false;
}

export function Paged({ name, label, pages, fallback, onShow, children }: {
  /** Which screen this is, to remember its page. */
  name: string;
  /** What the list of pages is called, for screen readers. */
  label: string;
  pages: PageInfo[];
  /** The page a route id is on when nothing has that id (a row whose list is still loading, a panel that isn't shown). */
  fallback?: (id: string) => string | undefined;
  /** Called with the page showing whenever it changes, and with null when the screen closes. */
  onShow?: (id: string | null) => void;
  children: Record<string, ReactNode>;
}) {
  const route = useRoute();
  const [present, setPresent] = useState(() => pages.map((p) => p.id));
  const [active, setActive] = useState(() => {
    const s = route.section;
    const want = s ? (pages.some((p) => p.id === s) ? s : fallback?.(s)) : undefined;
    return want || lastPage.get(name) || pages[0]!.id;
  });
  const [turning, setTurning] = useState<{ from: string; dir: Dir } | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const bodies = useRef(new Map<string, HTMLElement>());
  const stage = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const shown = pages.filter((p) => present.includes(p.id));
  const current = shown.some((p) => p.id === active) ? active : shown[0]?.id ?? active;
  const cur = useRef(current);
  cur.current = current;
  const list = useRef(shown);
  list.current = shown;
  const moving = useRef(false);
  const showRef = useRef(onShow);
  showRef.current = onShow;
  useEffect(() => { showRef.current?.(current); }, [current]);
  useEffect(() => () => showRef.current?.(null), []);
  const after = useRef<(() => void) | null>(null);
  /** When the page last scrolled, and when the last turn finished: a page counts as at its end once both are a moment ago. */
  const movedAt = useRef(0);
  const turnedAt = useRef(0);

  const neighbour = useCallback((dir: Dir) => {
    const l = list.current;
    const i = l.findIndex((p) => p.id === cur.current);
    return i < 0 ? undefined : l[i + dir]?.id;
  }, []);

  /** Slide to a page: from below when it comes after this one, from above when before. It shows at its top, at its
   *  end (`at: "bottom"`, coming back up), or with `row` in the middle. */
  const turn = useCallback((to: string, o: { dir?: Dir; at?: "top" | "bottom"; row?: Element | null; focus?: boolean; then?: () => void } = {}) => {
    const from = cur.current;
    const el = els.current.get(to);
    if (!el || to === from) return;
    const ids = list.current.map((p) => p.id);
    const dir = o.dir ?? (ids.indexOf(to) > ids.indexOf(from) ? 1 : -1);
    // the pages are laid out while hidden, so the new one can be put in place before it moves in
    if (o.row) {
      // a row sits in the middle; a panel taller than the page starts at its top
      const r = o.row.getBoundingClientRect();
      const top = r.top - el.getBoundingClientRect().top + el.scrollTop;
      el.scrollTo({ top: top - Math.max(8, (el.clientHeight - r.height) / 2), behavior: "instant" });
    } else {
      el.scrollTo({ top: o.at === "bottom" ? el.scrollHeight : 0, behavior: "instant" });
    }
    lastPage.set(name, to);
    moving.current = true;
    after.current = () => {
      if (o.focus) el.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
      o.then?.();
    };
    cur.current = to;
    setTurning({ from, dir });
    setActive(to);
  }, [name]);

  const finish = useCallback(() => {
    if (!moving.current) return;
    moving.current = false;
    turnedAt.current = performance.now();
    setTurning(null);
    const then = after.current;
    after.current = null;
    then?.();
  }, []);
  // the slide's own end is what finishes a turn; this is for when it never comes (a hidden window)
  useEffect(() => {
    if (!turning) return;
    const t = window.setTimeout(finish, 900);
    return () => window.clearTimeout(t);
  }, [turning, finish]);

  const reveal = useCallback((page: string, row: Element | null) => {
    const flash = () => {
      if (!row) return;
      row.classList.remove("pg-flash");
      void (row as HTMLElement).offsetWidth;
      row.classList.add("pg-flash");
    };
    if (page !== cur.current) { turn(page, { row, then: flash }); return; }
    const el = els.current.get(page);
    if (!el) return;
    if (row) scrollToElement(el, row, row.getBoundingClientRect().height > el.clientHeight ? "start" : "center", flash);
    else el.scrollTo({ top: 0, behavior: "smooth" });
  }, [turn]);

  // pages whose part renders nothing stay out of the list, and come back when it renders something
  useLayoutEffect(() => {
    const check = () => {
      const next = pages.map((p) => p.id).filter((id) => (bodies.current.get(id)?.childElementCount ?? 0) > 0);
      setPresent((was) => (was.length === next.length && was.every((x, i) => x === next[i]) ? was : next));
    };
    check();
    const mo = new MutationObserver(check);
    for (const b of bodies.current.values()) mo.observe(b, { childList: true });
    return () => mo.disconnect();
  }, [pages]);

  // the page asked for left the list: settle on the one showing instead
  useEffect(() => { if (current !== active && !route.section) setActive(current); }, [current, active, route.section]);

  // a page or a row from the route. A row whose list is still loading may not be there yet, so it waits a moment.
  useEffect(() => {
    const id = route.section;
    if (!id) return;
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const isPage = pages.some((p) => p.id === id);
      const el = isPage ? null : document.getElementById(id);
      const page = isPage ? id : el?.closest<HTMLElement>("[data-page]")?.dataset.page;
      if ((!page || !list.current.some((p) => p.id === page)) && performance.now() - t0 < 1000) { raf = requestAnimationFrame(step); return; }
      consumeRoute(["section"]);
      const to = page ?? fallback?.(id);
      if (to && list.current.some((p) => p.id === to)) reveal(to, el);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [route.section, pages, fallback, reveal]);

  // the wheel, and a controller's triggers and right stick (lib/gamepad.ts sends "padscroll"), turn the page at its ends
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    let last = 0;
    let lastDir: Dir = 1;
    let startedAtEdge = false;
    let sum = 0;
    let speeds: number[] = [];
    /** The scroll is still going as fast as it was, not winding down. */
    const keepsUp = () => {
      if (speeds.length < 5) return true;
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      return avg(speeds.slice(-3)) >= avg(speeds.slice(0, 3)) * 0.85;
    };
    /** One push down or up. True when it turned the page or a turn is under way, so the scroll itself stops. */
    const push = (target: EventTarget | null, dy: number): boolean => {
      const now = performance.now();
      const dir: Dir = dy > 0 ? 1 : -1;
      const gap = now - last;
      const fresh = gap > QUIET || dir !== lastDir;
      last = now;
      lastDir = dir;
      if (fresh) { speeds = []; sum = 0; } else { speeds.push(Math.abs(dy) / Math.max(gap, 4)); if (speeds.length > 12) speeds.shift(); }
      if (moving.current) return true;
      const page = els.current.get(cur.current);
      if (!page || innerScroll(target, page, dir)) { sum = 0; startedAtEdge = false; return false; }
      const resting = now - Math.max(movedAt.current, turnedAt.current);
      const edge = atEdge(page, dir);
      if (fresh) startedAtEdge = edge && resting > SETTLE;
      if (!edge || resting < SETTLE || !(startedAtEdge || (resting > DWELL && keepsUp()))) { sum = 0; return false; }
      sum += Math.abs(dy);
      if (sum < TURN_AT) return false;
      const to = neighbour(dir);
      if (!to) return false;
      sum = 0;
      startedAtEdge = false;
      turn(to, { dir, at: dir > 0 ? "top" : "bottom" });
      return true;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || !e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const h = els.current.get(cur.current)?.clientHeight ?? 600;
      const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * h : e.deltaY;
      if (push(e.target, dy)) e.preventDefault();
    };
    const onPad = (e: Event) => { if (push(e.target, (e as CustomEvent<number>).detail)) e.preventDefault(); };
    const onScroll = () => { movedAt.current = performance.now(); };
    st.addEventListener("wheel", onWheel, { passive: false });
    st.addEventListener("padscroll", onPad);
    st.addEventListener("scroll", onScroll, true);
    return () => {
      st.removeEventListener("wheel", onWheel);
      st.removeEventListener("padscroll", onPad);
      st.removeEventListener("scroll", onScroll, true);
    };
  }, [neighbour, turn]);

  // Page Down and Page Up scroll the page and turn it at its ends; with Ctrl they turn it straight away
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || (e.key !== "PageDown" && e.key !== "PageUp")) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const inPage = !!t && !!stage.current?.contains(t);
      if (t && t !== document.body && !inPage && !nav.current?.contains(t)) return;
      const dir: Dir = e.key === "PageDown" ? 1 : -1;
      if (e.ctrlKey || e.metaKey) {
        const to = neighbour(dir);
        if (!to) return;
        e.preventDefault();
        turn(to, { dir, focus: inPage });
        return;
      }
      const page = els.current.get(cur.current);
      if (!page || e.shiftKey || isField(t) || (inPage && innerScroll(t, page, dir))) return;
      e.preventDefault();
      if (moving.current) return;
      if (!atEdge(page, dir)) { glide(page, "y", dir * page.clientHeight * 0.85); return; }
      const to = neighbour(dir);
      if (to) turn(to, { dir, at: dir > 0 ? "top" : "bottom", focus: inPage });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [neighbour, turn]);

  // arrow keys in the list go to the page above or below
  const navKey = (e: ReactKeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const btns = [...(nav.current?.querySelectorAll<HTMLButtonElement>(".pg-nav-i") ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const b = btns[i + step];
    if (i < 0 || !b?.dataset.to) return;
    e.preventDefault();
    b.focus();
    turn(b.dataset.to);
  };

  const groups: Array<[string, PageInfo[]]> = [];
  for (const p of shown) {
    const name = p.group ?? "";
    const g = groups.find((x) => x[0] === name);
    if (g) g[1].push(p); else groups.push([name, [p]]);
  }
  const onEnd = (e: AnimationEvent) => { if (e.target === e.currentTarget) finish(); };

  return (
    <div className="pg">
      <nav ref={nav} className="pg-nav" aria-label={label} onKeyDown={navKey}>
        {groups.map(([g, ps]) => (
          <div key={g} className="pg-g" role={g ? "group" : undefined} aria-label={g || undefined}>
            {g && <span className="pg-group" aria-hidden="true">{g}</span>}
            {ps.map((p) => (
              <button key={p.id} type="button" data-to={p.id} className={`pg-nav-i${p.id === current ? " on" : ""}`}
                aria-current={p.id === current ? "page" : undefined} title={p.tip} onClick={() => turn(p.id)}>
                <Icon name={p.icon} /><span>{p.label}</span>
                {p.count ? <span style={{ marginLeft: "auto" }}><Badge tone="bad" title={`${p.count} new since you last looked`}>{p.count}</Badge></span> : null}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div ref={stage} className="pg-stage">
        {pages.map((p) => {
          const on = p.id === current;
          const out = !on && turning?.from === p.id;
          const motion = turning && (on || out) ? (turning.dir > 0 ? " fwd" : " back") : "";
          return (
            <section key={p.id} data-page={p.id} aria-label={p.label} data-scroller={on ? "" : undefined}
              ref={(el) => { if (el) els.current.set(p.id, el); else els.current.delete(p.id); }}
              className={`pg-page${on ? " on" : ""}${out ? " out" : ""}${motion}`}
              inert={!on} aria-hidden={on ? undefined : true} onAnimationEnd={on ? onEnd : undefined}>
              <div className="pg-body" ref={(el) => { if (el) bodies.current.set(p.id, el); else bodies.current.delete(p.id); }}>
                {children[p.id]}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
