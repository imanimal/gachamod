// A game controller drives the whole app, so someone playing on a pad never needs the mouse. The standard layout
// (Xbox names; PlayStation's are the same places). Wired in App.tsx:
//   D-pad or left stick   move between keys and fields, by where they are on screen
//   A                     press          B   back / close        X   the focused mod's key (install, or its menu)
//   Y                     find (the screen's search, else the command palette)    LB, RB   previous, next view
//   LT, RT, right stick   scroll         View (Back) tapped   back a page      Menu (Start)   go to Play
//   View held with LB or RB   previous, next game        View held with Y   the newest message's button
//   right stick pressed in (R3)   the focused thing's right-click menu
//   both sticks pressed in (L3+R3)   back to the last theme, the way out of one that breaks the app
// Owner: SHELL area.
// It reads the pad only while this window has focus, so a pad used in the game never moves the app, and it polls
// only while a pad is connected and the window has focus.
import { focusSearch, focusToast, topLayer } from "./keys";
import { konamiPress } from "./fun";
import { glide } from "./smoothScroll";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="button"], iframe[data-ext]';

// Extension pages run in frames (screens/extensions/ExtensionFrame.tsx): moves and presses go into the frame, which
// hands focus back with moveFocusFrom when nothing in it lies that way.
type FrameNav = (frame: HTMLIFrameElement, msg: { dx?: number; dy?: number; enter?: boolean; press?: boolean }) => void;
let frameNav: FrameNav | null = null;
export function setFrameNav(f: FrameNav) { frameNav = f; }
const extFrame = (el: Element | null): HTMLIFrameElement | null => (el instanceof HTMLIFrameElement && el.dataset.ext ? el : null);

/** What `el` looks like on screen. A kit Toggle or Checkbox hides its input as a 1px box inside a label that draws
 *  the switch, so the label stands in for it when measuring and scrolling; focus still goes to the input. */
const shown = (el: HTMLElement): HTMLElement =>
  (el instanceof HTMLInputElement && el.parentElement?.matches(".toggle, .check") ? el.parentElement : el);

function candidates(): HTMLElement[] {
  const root = topLayer();
  const scope = root === document.querySelector(".app .view") ? document.querySelector(".app") ?? document : root;
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.closest(".bpane-view, [aria-hidden='true']")) return false;
    const box = shown(el);
    const r = box.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < window.innerHeight && getComputedStyle(box).visibility !== "hidden";
  });
}

/** Move focus to the nearest focusable thing in a direction. */
export function moveFocus(dx: number, dy: number) {
  const frame = extFrame(document.activeElement);
  if (frame && frameNav) { frameNav(frame, { dx, dy }); return; }
  moveFocusFrom(document.activeElement as HTMLElement | null, dx, dy);
}

/** Move focus from `cur` (an extension frame handing it back, or the focused element). */
export function moveFocusFrom(cur: HTMLElement | null, dx: number, dy: number) {
  const list = candidates();
  if (!cur || cur === document.body || !list.includes(cur)) { (list.find((e) => e.closest(".app .view")) ?? list[0])?.focus(); return; }
  const a = shown(cur).getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null, score = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = shown(el).getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const along = dx ? (bx - ax) * dx : (by - ay) * dy;
    if (along <= 4) continue;
    const across = dx ? Math.abs(by - ay) : Math.abs(bx - ax);
    const s = along + across * 2.2;
    if (s < score) { score = s; best = el; }
  }
  if (best) {
    best.focus({ preventScroll: true });
    shown(best).scrollIntoView({ block: "nearest", inline: "nearest" });
    const f = extFrame(best);
    if (f && frameNav) frameNav(f, { dx, dy, enter: true });
  }
}

const key = (k: string) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

export function installGamepad(opts: {
  nextView: (dir: 1 | -1) => void; nextGame?: (dir: 1 | -1) => void; play: () => void; back: () => void; menu: () => void; palette: () => void; themeBack?: () => void;
}): () => void {
  let raf = 0;
  const held = new Map<string, number>(); // button -> next repeat time
  // View is a shift for LB, RB and Y while held; on its own it goes back when let go
  let viewDown = false, viewUsed = false;
  const press = (name: string, now: number, on: boolean, fn: () => void, repeat = false) => {
    if (!on) { held.delete(name); return; }
    const next = held.get(name);
    if (next === undefined) { held.set(name, now + (repeat ? 380 : Infinity)); fn(); konamiPress(name); }
    else if (repeat && now >= next) { held.set(name, now + 110); fn(); }
  };
  // `jump` is a trigger press: it glides a big step the way the mouse wheel does. The right stick sends a small step
  // every frame, which has to land at once or the steps fight a smooth scroll still under way
  const scroll = (amount: number, jump = false) => {
    // the layer on top scrolls (a mod's page, a window), else the screen. The menu over a game has lists of its own
    const layers = document.querySelectorAll<HTMLElement>(".lightbox, .drawer-b, .dialog-b, .ov-detail");
    let el = layers[layers.length - 1] ?? document.querySelector<HTMLElement>(".app .view, .ov-scroll");
    // a screen of pages (Settings, Tools) scrolls the page showing, and turns to the next one at its end
    if (el?.matches(".app .view")) el = el.querySelector<HTMLElement>("[data-scroller]") ?? el;
    if (el?.dispatchEvent(new CustomEvent("padscroll", { detail: amount, bubbles: true, cancelable: true }))) {
      if (jump) glide(el, "y", amount); else el.scrollBy({ top: amount, behavior: "instant" });
    }
  };
  const tick = (now: number) => {
    // stop wherever focus left from (window blur doesn't fire when it leaves from inside an extension frame)
    if (!document.hasFocus()) { raf = 0; return; }
    raf = requestAnimationFrame(tick);
    if (document.visibilityState !== "visible") return;
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    if (!pad) return;
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    const ax = (i: number) => pad.axes[i] ?? 0;
    const used = pad.buttons.some((x) => x.pressed) || pad.axes.some((v) => Math.abs(v) > 0.5);
    if (used) document.documentElement.classList.add("kbd", "pad");
    press("up", now, b(12) || ax(1) < -0.6, () => moveFocus(0, -1), true);
    press("down", now, b(13) || ax(1) > 0.6, () => moveFocus(0, 1), true);
    press("left", now, b(14) || ax(0) < -0.6, () => moveFocus(-1, 0), true);
    press("right", now, b(15) || ax(0) > 0.6, () => moveFocus(1, 0), true);
    press("a", now, b(0), () => {
      const el = document.activeElement as HTMLElement | null;
      const f = extFrame(el);
      if (f && frameNav) frameNav(f, { press: true });
      else if (el && el !== document.body) el.click(); else moveFocus(0, 1);
    });
    press("b", now, b(1), () => { if (document.querySelector(".lightbox, .overlay, .popover")) key("Escape"); else opts.back(); });
    press("x", now, b(2), () => (document.activeElement?.closest("[data-pad-x]")?.querySelector("[data-pad-x-target]") as HTMLElement | null)?.click());
    if (b(8)) { if (!viewDown) { viewDown = true; viewUsed = false; konamiPress("view"); } }
    else if (viewDown) {
      viewDown = false;
      if (!viewUsed) { if (document.querySelector(".lightbox, .overlay, .popover")) key("Escape"); else opts.back(); }
    }
    const shifted = (fn: () => void, alone: () => void) => () => { if (viewDown) { viewUsed = true; fn(); } else alone(); };
    press("y", now, b(3), shifted(() => { focusToast(); }, () => { if (!focusSearch()) opts.palette(); }));
    press("lb", now, b(4), shifted(() => opts.nextGame?.(-1), () => opts.nextView(-1)));
    press("rb", now, b(5), shifted(() => opts.nextGame?.(1), () => opts.nextView(1)));
    press("lt", now, (pad.buttons[6]?.value ?? 0) > 0.3, () => scroll(-window.innerHeight * 0.6, true), true);
    press("rt", now, (pad.buttons[7]?.value ?? 0) > 0.3, () => scroll(window.innerHeight * 0.6, true), true);
    press("menu", now, b(9), opts.play);
    press("sticks", now, b(10) && b(11), () => opts.themeBack?.());
    // R3 alone opens the focused thing's menu; with L3 held it is the theme escape above
    press("r3", now, b(11) && !b(10), opts.menu);
    const rs = ax(3);
    if (Math.abs(rs) > 0.25) scroll(rs * 22);
  };
  // the loop runs only while a pad is connected and this window has focus: in a game, the app doesn't poll at all
  const connected = () => [...(navigator.getGamepads?.() ?? [])].some((p) => p && p.connected);
  const halt = () => { cancelAnimationFrame(raf); raf = 0; };
  const run = () => { if (!raf && document.hasFocus()) raf = requestAnimationFrame(tick); };
  const start = () => { if (connected()) run(); };
  const stop = () => { if (!connected()) halt(); };
  // tick() stops the loop once the document loses focus. Coming back by clicking into an extension frame
  // fires focusin on its iframe here but no window focus, so both restart it.
  window.addEventListener("gamepadconnected", run);
  window.addEventListener("gamepaddisconnected", stop);
  window.addEventListener("focus", start);
  document.addEventListener("focusin", start);
  start();
  return () => {
    halt();
    window.removeEventListener("gamepadconnected", run);
    window.removeEventListener("gamepaddisconnected", stop);
    window.removeEventListener("focus", start);
    document.removeEventListener("focusin", start);
  };
}
