// The extras in Settings, Fun, all off until turned on: chill mode (the app's own words in lower case; names,
// descriptions and anything people wrote stay as written), the pity counter in Browse and seasonal touches. Also
// the Konami code (keyboard or controller), which reveals a hidden theme. Owner: SETTINGS/AI area.
import { pref } from "./prefs";
import { toast } from "../ui/toast";

const flag = (key: string, fallback: boolean) =>
  pref<boolean>(key, fallback, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

/** The app's own text in lower case (html[data-chill], styles/fun.css). */
export const chillPref = flag("fun.chill", false);
/** Count the mods opened in Browse since the last install. */
export const pityPref = flag("fun.pity", false);
/** Snow in late December, hearts on Valentine's Day. */
export const seasonalPref = flag("fun.seasonal", false);
/** The theme the Konami code reveals shows in Appearance. */
export const hiddenThemePref = flag("fun.hiddenTheme", false);

// ── pity counter ──

const PITY = 90;
const pityCount = pref<number>("fun.pityN", 0, (r) => { const n = Number.parseInt(r, 10); return Number.isFinite(n) && n >= 0 ? n : undefined; }, String);
export const usePityCount = () => pityCount.use();

/** A mod's page was opened in Browse. */
export function pityOpened() {
  if (!pityPref.get()) return;
  const n = pityCount.get() + 1;
  if (n >= PITY) {
    void pityCount.set(0);
    toast(`Hard pity reached. ${PITY} mods opened since your last install`);
  } else void pityCount.set(n);
}

/** Something was installed: the count starts over. */
export function pityReset() {
  if (pityCount.get() !== 0) void pityCount.set(0);
}

// ── seasonal touches ──

export type Season = "snow" | "hearts" | null;
export function season(d = new Date()): Season {
  const m = d.getMonth() + 1, day = d.getDate();
  if (m === 12 && day >= 20) return "snow";
  if (m === 2 && day === 14) return "hearts";
  return null;
}

// ── Konami code ──

export const HIDDEN_THEME = "clay";
const CODE = ["up", "up", "down", "down", "left", "right", "left", "right", "b", "a"];
let at = 0;
let found: ((first: boolean) => void) | null = null;

/** What happens when the code is entered (App sets it: show the theme, offer to use it). */
export function onKonami(f: (first: boolean) => void) { found = f; }

/** One press: "up", "down", "left", "right", "b" or "a". */
export function konamiPress(k: string) {
  if (k === CODE[at]) {
    at++;
    if (at < CODE.length) return;
    at = 0;
    const first = !hiddenThemePref.get();
    if (first) void hiddenThemePref.set(true);
    found?.(first);
    return;
  }
  // a third "up" still counts as the second one
  at = k !== "up" ? 0 : at === 2 ? 2 : 1;
}

/** Feed keyboard presses (not while typing). Returns a function that stops it. */
export function watchKonamiKeys(): () => void {
  const map: Record<string, string> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", b: "b", B: "b", a: "a", A: "a" };
  const h = (e: KeyboardEvent) => {
    const k = map[e.key];
    if (!k || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    konamiPress(k);
  };
  window.addEventListener("keydown", h, true);
  return () => window.removeEventListener("keydown", h, true);
}
