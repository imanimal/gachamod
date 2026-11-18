// What every theme is (names, schemes, accents) and the colour helpers, importing only i18n, so the setup window
// (src/setup) can use them without the app. lib/theme.ts applies themes. Owner: THEME area.
import { t } from "./i18n";

export type Scheme = "dark" | "light";
export type SchemeChoice = Scheme | "system";

export interface AccentInfo { id: string; name: string; color: string }
export interface ThemeInfo {
  id: string; name: string; schemes: Scheme[];
  /** What it looks like, in English, for the custom theme prompt (screens/ai/themeTask.ts). Not shown in the app. */
  look: string;
  /** The scheme the game's menus use, the default until the user picks one. */
  native: Scheme;
  accents?: AccentInfo[];
  /** Left out of Appearance until it's found (the Konami code; lib/fun.ts). */
  hidden?: boolean;
}

export const THEMES: ThemeInfo[] = [
  { id: "default", name: t("Default"), look: "Dark or light, in the game's colour", schemes: ["dark", "light"], native: "dark" },
  { id: "zzz", name: t("New Eridu"), look: "Zenless Zone Zero's menus: grey frames, black capsules, one bright accent", schemes: ["dark", "light"], native: "dark",
    accents: [
      { id: "orange", name: t("Orange"), color: "#ff7a1c" }, { id: "lime", name: t("Lime"), color: "#d6f900" }, { id: "yellow", name: t("Yellow"), color: "#ffd21a" },
      { id: "cyan", name: t("Cyan"), color: "#35d3ff" }, { id: "pink", name: t("Pink"), color: "#ff6aa9" },
    ] },
  { id: "gi", name: t("Teyvat"), look: "Genshin Impact's menus: cream paper pages, slate pills, gold rules", schemes: ["dark", "light"], native: "light",
    accents: [
      { id: "gold", name: t("Gold"), color: "#d3bc8e" }, { id: "anemo", name: t("Anemo"), color: "#74c2a8" },
      { id: "hydro", name: t("Hydro"), color: "#4cc2f1" }, { id: "pyro", name: t("Pyro"), color: "#ef7938" },
      { id: "electro", name: t("Electro"), color: "#af8ef3" }, { id: "dendro", name: t("Dendro"), color: "#a5c83b" },
      { id: "cryo", name: t("Cryo"), color: "#9fd6e3" },
    ] },
  { id: "hsr", name: t("Astral Express"), look: "Honkai: Star Rail's menus: dark glass, pale plates, gold", schemes: ["dark", "light"], native: "dark" },
  { id: "ww", name: t("Solaris"), look: "Wuthering Waves' menus: dark glass under a night sky, paper rows, gold", schemes: ["dark", "light"], native: "dark",
    accents: [
      { id: "gold", name: t("Gold"), color: "#fdd02c" }, { id: "glacio", name: t("Glacio"), color: "#6fd0f2" },
      { id: "havoc", name: t("Havoc"), color: "#e26aa5" }, { id: "aero", name: t("Aero"), color: "#5fe0b0" },
    ] },
  { id: "ef", name: t("Talos-II"), look: "Arknights: Endfield's menus: a light sheet on a charcoal stage, signal yellow", schemes: ["dark", "light"], native: "light",
    accents: [
      { id: "signal", name: t("Signal"), color: "#ffee00" }, { id: "orange", name: t("Orange"), color: "#ff8a1f" },
      { id: "lime", name: t("Lime"), color: "#c5e03a" }, { id: "cyan", name: t("Cyan"), color: "#3fd0f0" },
    ] },
  { id: "clay", name: t("Claude Desktop"), look: "Warm ivory or soft charcoal, a clay accent, serif titles", schemes: ["dark", "light"], native: "light", hidden: true },
];

/** gachamod's own colour, used when no game is set up. */
export const BRAND_ACCENT = "#8b7cff";

// ── colour helpers ──

export function rgb(hex: string): [number, number, number] | null {
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
