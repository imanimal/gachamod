// The extras in Settings, Fun extras, all off until turned on: chill mode (the app's own words in lower case; names,
// descriptions and anything people wrote stay as written), the pull button (in Surprise me's place) and seasonal touches. Also
// the Konami code (keyboard or controller), which reveals a hidden theme. Owner: SETTINGS/AI area.
import { useSyncExternalStore } from "react";
import { pref } from "./prefs";
import { t } from "./i18n";

const flag = (key: string, fallback: boolean) =>
  pref<boolean>(key, fallback, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));
const count = (key: string) => pref<number>(key, 0, (r) => { const n = Number.parseInt(r, 10); return Number.isFinite(n) && n >= 0 ? n : undefined; }, String);

/** The app's own text in lower case (html[data-chill], styles/fun.css). */
export const chillPref = flag("fun.chill", false);
/** The theme the Konami code reveals shows in Appearance. */
export const hiddenThemePref = flag("fun.hiddenTheme", false);

// ── the pull button (screens/browse/Pull.tsx) ──

/** A button that opens a random mod, gacha style. It takes the place of Surprise me in Browse and on Home. */
export const pullPref = flag("fun.pull", false);
/** Pulls since the last 5 star. */
export const pullsSince = count("fun.pulls");
/** Every this many pulls without a 5 star, one is guaranteed. */
export const PULL_PITY = 10;

/** What each game calls a pull. */
const PULL_WORD: Record<string, string> = { gi: t("Wish"), hsr: t("Warp"), zzz: t("Signal Search"), ww: t("Convene"), ef: t("Headhunt"), hi3: t("Supply") };
export const pullWord = (game: string | null | undefined) => PULL_WORD[game ?? ""] ?? t("Pull");

// ── seasonal touches (ui/Seasonal.tsx) ──

export type Season = "winter" | "halloween" | "valentine" | "lunar";
export const SEASONS: Season[] = ["winter", "halloween", "valentine", "lunar"];
/** Off, by the calendar, or one season all year. */
export type SeasonPick = "off" | "date" | Season;
// "1" and "0" are from when this was an on/off switch, "snow" and "hearts" from the first season names
const OLD: Record<string, SeasonPick> = { "1": "date", "0": "off", snow: "winter", hearts: "valentine" };
export const seasonPref = pref<SeasonPick>("fun.seasonal", "off",
  (r) => OLD[r] ?? (r === "off" || r === "date" || (SEASONS as string[]).includes(r) ? r as SeasonPick : undefined), (v) => v);

/** Lunar New Year's day, as [month, day] by year. */
const LUNAR: Record<number, [number, number]> = {
  2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3], 2031: [1, 23],
  2032: [2, 11], 2033: [1, 31], 2034: [2, 19], 2035: [2, 8], 2036: [1, 28],
};
const DAY = 86_400_000;

/** The season the calendar says: Halloween from 24 October, winter from 20 December to 2 January, Valentine's Day on
 *  14 February, Lunar New Year for its first 15 days (to the Lantern Festival). */
export function season(d = new Date()): Season | null {
  const m = d.getMonth() + 1, day = d.getDate();
  if (m === 10 && day >= 24) return "halloween";
  if ((m === 12 && day >= 20) || (m === 1 && day <= 2)) return "winter";
  if (m === 2 && day === 14) return "valentine";
  const ny = LUNAR[d.getFullYear()];
  if (ny) {
    // rounded, so a clock change in between doesn't add or drop a day
    const since = Math.round((new Date(d.getFullYear(), m - 1, day).getTime() - new Date(d.getFullYear(), ny[0] - 1, ny[1]).getTime()) / DAY);
    if (since >= 0 && since < 15) return "lunar";
  }
  return null;
}
/** What shows now for a pick. */
export const seasonNow = (pick: SeasonPick): Season | null => (pick === "off" ? null : pick === "date" ? season() : pick);

// A season the dev console shows for this run only ("season halloween"), over the setting. null: the setting decides.
let preview: Season | "off" | null = null;
const previewSubs = new Set<() => void>();
export function previewSeason(s: Season | "off" | null) { preview = s; for (const f of previewSubs) f(); }
export const useSeasonPreview = () => useSyncExternalStore((f) => { previewSubs.add(f); return () => { previewSubs.delete(f); }; }, () => preview);

// ── Konami code ──

export const HIDDEN_THEME = "clay";
const CODE = ["up", "up", "down", "down", "left", "right", "left", "right", "b", "a"];
let at = 0;
let found: ((first: boolean) => void) | null = null;

/** Part of the code has been entered (the opening screen lets A and B through then instead of skipping). */
export const konamiBusy = () => at > 0;

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
    const el = e.target as HTMLElement | null;
    if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
    // B and A after the arrows belong to the code: they don't start a search (lib/keys.ts skips handled keys)
    if ((k === "b" || k === "a") && k === CODE[at]) e.preventDefault();
    konamiPress(k);
  };
  window.addEventListener("keydown", h, true);
  return () => window.removeEventListener("keydown", h, true);
}
