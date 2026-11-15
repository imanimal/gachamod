// Shell state other parts of the app can poke: the sidebar folded to an icon rail (remembered), the command palette
// and the shortcuts list. Owner: SHELL area.
import { useSyncExternalStore } from "react";
import { emitApp } from "../lib/store";
import { getTextSize } from "../lib/zoom";

type Sub = () => void;
function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<Sub>();
  return {
    get: () => value,
    set: (v: T) => { if (v === value) return; value = v; subs.forEach((f) => f()); },
    sub: (f: Sub) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}

// ── the sidebar ──

const SIDE_KEY = "gm.side.collapsed";
/** Set when the user opened the sidebar while the window was too narrow for it, so it stays open on narrow windows. */
const NARROW_OPEN_KEY = "gm.side.narrowOpen";
const readFlag = (key: string) => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };
const writeFlag = (key: string, on: boolean) => { try { localStorage.setItem(key, on ? "1" : "0"); } catch { /* storage unavailable */ } };
const side = store(readFlag(SIDE_KEY));
const narrowOpen = store(readFlag(NARROW_OPEN_KEY));

/** The window is too narrow for the full sidebar: it folds to the rail until the window is wider again. Measured in
 *  rem, so a bigger text size (lib/zoom.ts) folds it sooner, the same as a smaller window would. */
const NARROW_REM = 62;
/** Reads the saved text size, not the page's font size: this runs before the app applies the saved size. */
const isNarrow = () => typeof window !== "undefined" && window.innerWidth / getTextSize() < NARROW_REM;
const narrow = store(isNarrow());
if (typeof window !== "undefined") {
  const check = () => narrow.set(isNarrow());
  window.addEventListener("resize", check);
  window.addEventListener("pm-text-size", check);
}

const effective = () => side.get() || (narrow.get() && !narrowOpen.get());
const subAll = (f: Sub) => { const offs = [side.sub(f), narrow.sub(f), narrowOpen.sub(f)]; return () => offs.forEach((o) => o()); };
export const useSideCollapsed = () => useSyncExternalStore(subAll, effective);
export const sideCollapsed = () => effective();
export function setSideCollapsed(on: boolean) {
  side.set(on);
  writeFlag(SIDE_KEY, on);
}
/** Ctrl+B and the button at the top of the sidebar. On a narrow window this opens or folds it there and remembers
 *  that choice for narrow windows; on a wide one it sets the usual remembered state. */
export function toggleSide() {
  // folded now, so this click opens it
  const open = effective();
  if (narrow.get()) {
    narrowOpen.set(open);
    writeFlag(NARROW_OPEN_KEY, open);
    if (open && side.get()) setSideCollapsed(false);
    return;
  }
  setSideCollapsed(!open);
}

// ── the shortcuts list ──

const help = store(false);
export const useHelpOpen = () => useSyncExternalStore(help.sub, help.get);
export const setHelpOpen = (on: boolean) => help.set(on);
export const toggleHelp = () => help.set(!help.get());

// ── the command palette ──

/** Open the command palette, optionally with text typed in it. */
export const openPalette = (text?: string) => emitApp({ type: "palette", text });

// ── drawing a little attention to the search box ──

const intro = store(0);
export const useSearchIntro = () => useSyncExternalStore(intro.sub, intro.get);
/** Play the search box's opening animation again (it plays once when the app opens). */
export const introSearch = () => intro.set(intro.get() + 1);
