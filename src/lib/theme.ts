// Themes. A theme is a set of CSS tokens plus shape rules under [data-theme="<id>"] (styles/themes/*.css).
// Each game has a default theme (GameState.theme: Zenless Zone Zero uses "zzz", the rest "default"); the user can
// pick another per game in Settings (setting "theme.<game>": "auto" or a theme id). The default theme takes the
// game's brand colour as its accent. Scheme (dark or light) is global; a theme may be dark only.
// Any element can show another theme inside it with the attributes from themeAttrs() (Settings' previews).
// Owner: THEME area (docs/spec.md, "Themes").
import { useSyncExternalStore } from "react";
import type { GameState } from "./api";

export type Scheme = "dark" | "light";
export type SchemeChoice = Scheme | "system";

export interface AccentInfo { id: string; name: string; color: string }
export interface ThemeInfo { id: string; name: string; description: string; schemes: Scheme[]; accents?: AccentInfo[] }

export const THEMES: ThemeInfo[] = [
  { id: "default", name: "Default", description: "Dark or light, in the game's own colour", schemes: ["dark", "light"] },
  { id: "zzz", name: "New Eridu", description: "Zenless Zone Zero's menus: grey frames, black capsules, one bright accent", schemes: ["dark"],
    accents: [
      { id: "orange", name: "Orange", color: "#ff7a1c" }, { id: "lime", name: "Lime", color: "#d6f900" }, { id: "yellow", name: "Yellow", color: "#ffd21a" },
      { id: "cyan", name: "Cyan", color: "#35d3ff" }, { id: "pink", name: "Pink", color: "#ff6aa9" },
    ] },
];

/** gachamod's own colour, used when no game is set up. */
export const BRAND_ACCENT = "#8b7cff";

const K = { scheme: "gm.scheme", motion: "gm.motion", paint: "gm.paint", perGame: (g: string) => `gm.theme.${g}`, accent: (t: string) => `gm.accent.${t}` };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export interface ThemeState { id: string; scheme: Scheme; choice: SchemeChoice; accent: string; motion: boolean }
let state: ThemeState = { id: "default", scheme: "dark", choice: "dark", accent: BRAND_ACCENT, motion: true };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const subscribeTheme = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const themeState = () => state;
export const useTheme = () => useSyncExternalStore(subscribeTheme, themeState);

/** The theme id a game uses: the user's pick for it, else the game's default. */
export function themeFor(game: Pick<GameState, "id" | "theme"> | null): string {
  if (!game) return "default";
  const pick = read(K.perGame(game.id));
  return pick && pick !== "auto" && THEMES.some((t) => t.id === pick) ? pick : (game.theme || "default");
}
export const themePick = (gameId: string): string => read(K.perGame(gameId)) ?? "auto";
export function setThemePick(game: GameState, id: string) { write(K.perGame(game.id), id === "auto" ? null : id); applyGameTheme(game); }

/** The accent picked for a theme that offers several (its first one when nothing is picked). */
export function accentPick(themeId: string): string {
  const list = THEMES.find((t) => t.id === themeId)?.accents ?? [];
  const pick = read(K.accent(themeId));
  return list.find((a) => a.id === pick)?.id ?? list[0]?.id ?? "";
}
export function setAccentPick(themeId: string, accentId: string, game: GameState | null) { write(K.accent(themeId), accentId); applyGameTheme(game); }

const systemScheme = (): Scheme => (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

/** Attributes that show theme `id` inside one element, e.g. `<div {...themeAttrs("zzz")}>` for a preview. */
export function themeAttrs(id: string, scheme: Scheme = "dark"): { "data-theme": string; "data-scheme": Scheme } {
  const info = THEMES.find((t) => t.id === id) ?? THEMES[0]!;
  return { "data-theme": info.id, "data-scheme": info.schemes.includes(scheme) ? scheme : info.schemes[0]! };
}

// ── colour helpers ──

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
const toHex = (c: [number, number, number]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Black or white, whichever reads better on `hex` (text on a game's colour). */
export function onColor(hex: string): string {
  const c = rgb(hex);
  if (!c) return "#000";
  const l = luminance(c);
  return contrast(l, 0) >= contrast(l, 1) ? "#0c0e13" : "#ffffff";
}

/** A shade of `hex` dark enough to carry white text and to read as text on white (4.5:1). */
export function darkShade(hex: string): string {
  let c = rgb(hex);
  if (!c) return "#5d4fd6";
  for (let i = 0; i < 40 && contrast(luminance(c), 1) < 4.5; i++) c = c.map((v) => v * 0.93) as [number, number, number];
  return toHex(c);
}

/** Apply a game's theme to <html>: data-theme, data-scheme, data-game, data-motion and the accent variables. */
export function applyGameTheme(game: GameState | null) {
  const id = themeFor(game);
  const info = THEMES.find((t) => t.id === id) ?? THEMES[0]!;
  const choice = (read(K.scheme) as SchemeChoice | null) ?? "dark";
  const want = choice === "system" ? systemScheme() : choice;
  const scheme = info.schemes.includes(want) ? want : info.schemes[0]!;
  const r = document.documentElement;
  r.dataset.theme = info.id;
  r.dataset.scheme = scheme;
  r.dataset.game = game?.id ?? "";
  r.dataset.accent = accentPick(info.id);
  const accent = rgb(game?.accent ?? "") ? game!.accent : BRAND_ACCENT;
  const vars = { "--game-accent": accent, "--game-on-accent": onColor(accent), "--game-accent-dk": darkShade(accent) };
  for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v);
  const motion = read(K.motion) !== "0";
  r.dataset.motion = motion ? "full" : "reduced";
  // the pre-paint script in index.html reads this to colour the first frame
  write(K.paint, JSON.stringify({ game: game?.id ?? "", vars }));
  state = { id: info.id, scheme, choice, accent, motion };
  emit();
}

export function setScheme(choice: SchemeChoice, game: GameState | null) { write(K.scheme, choice); applyGameTheme(game); }
export function setMotion(on: boolean, game: GameState | null) { write(K.motion, on ? "1" : "0"); applyGameTheme(game); }

/** Follow the system's light/dark switch while the choice is "system". */
export function watchSystemScheme(current: () => GameState | null): () => void {
  const m = window.matchMedia("(prefers-color-scheme: light)");
  const h = () => { if ((read(K.scheme) ?? "dark") === "system") applyGameTheme(current()); };
  m.addEventListener("change", h);
  return () => m.removeEventListener("change", h);
}
