// Themes. A theme is a set of CSS tokens plus shape rules under [data-theme="<id>"] (styles/themes/*.css).
// Each game has a default theme (GameState.theme: Zenless Zone Zero uses "zzz", the rest "default"); the user can
// pick another per game in Settings (setting "theme.<game>": "auto" or a theme id). The default theme takes the
// game's brand colour as its accent. Every theme has dark and light; the scheme choice (dark, light or system) is kept
// per theme, and a theme nobody picked a scheme for uses its native one (THEMES[].native).
// Custom themes (made by hand or by the AI helper) sit on top of a theme: a base id, a scheme, token values, layout
// attributes and optional CSS, all validated before they reach the page (validateCustomTheme).
// Any element can show another theme inside it with the attributes from themeAttrs() (Settings' previews).
// Owner: THEME area (docs/spec.md, "Themes").
import { useSyncExternalStore } from "react";
import type { GameState } from "./api";
import { jsonPref } from "./prefs";

export type Scheme = "dark" | "light";
export type SchemeChoice = Scheme | "system";

export interface AccentInfo { id: string; name: string; color: string }
export interface ThemeInfo {
  id: string; name: string; description: string; schemes: Scheme[];
  /** The scheme the game's own menus use, the default until the user picks one. */
  native: Scheme;
  accents?: AccentInfo[];
}

export const THEMES: ThemeInfo[] = [
  { id: "default", name: "Default", description: "Dark or light, in the game's own colour", schemes: ["dark", "light"], native: "dark" },
  { id: "zzz", name: "New Eridu", description: "Zenless Zone Zero's menus: grey frames, black capsules, one bright accent", schemes: ["dark", "light"], native: "dark",
    accents: [
      { id: "orange", name: "Orange", color: "#ff7a1c" }, { id: "lime", name: "Lime", color: "#d6f900" }, { id: "yellow", name: "Yellow", color: "#ffd21a" },
      { id: "cyan", name: "Cyan", color: "#35d3ff" }, { id: "pink", name: "Pink", color: "#ff6aa9" },
    ] },
  { id: "gi", name: "Teyvat", description: "Genshin Impact's menus: cream paper pages, slate pills, gold rules", schemes: ["dark", "light"], native: "light",
    accents: [
      { id: "gold", name: "Gold", color: "#d3bc8e" }, { id: "anemo", name: "Anemo", color: "#74c2a8" },
      { id: "hydro", name: "Hydro", color: "#4cc2f1" }, { id: "pyro", name: "Pyro", color: "#ef7938" },
      { id: "electro", name: "Electro", color: "#af8ef3" }, { id: "dendro", name: "Dendro", color: "#a5c83b" },
      { id: "cryo", name: "Cryo", color: "#9fd6e3" },
    ] },
  { id: "hsr", name: "Astral Express", description: "Honkai: Star Rail's menus: dark glass, pale plates, gold", schemes: ["dark", "light"], native: "dark" },
  { id: "ww", name: "Solaris", description: "Wuthering Waves' menus: dark glass under a night sky, paper rows, gold", schemes: ["dark", "light"], native: "dark",
    accents: [
      { id: "gold", name: "Gold", color: "#fdd02c" }, { id: "glacio", name: "Glacio", color: "#6fd0f2" },
      { id: "havoc", name: "Havoc", color: "#e26aa5" }, { id: "aero", name: "Aero", color: "#5fe0b0" },
    ] },
  { id: "ef", name: "Talos-II", description: "Arknights: Endfield's menus: a light sheet on a charcoal stage, signal yellow", schemes: ["dark", "light"], native: "light",
    accents: [
      { id: "signal", name: "Signal", color: "#ffee00" }, { id: "orange", name: "Orange", color: "#ff8a1f" },
      { id: "lime", name: "Lime", color: "#c5e03a" }, { id: "cyan", name: "Cyan", color: "#3fd0f0" },
    ] },
];

/** gachamod's own colour, used when no game is set up. */
export const BRAND_ACCENT = "#8b7cff";

const K = { mode: "gm.schemeMode", scheme: "gm.scheme", schemeOf: (t: string) => `gm.scheme.${t}`, motion: "gm.motion", paint: "gm.paint", layout: "gm.layout", perGame: (g: string) => `gm.theme.${g}`, accent: (t: string) => `gm.accent.${t}` };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export interface ThemeState { id: string; scheme: Scheme; choice: SchemeChoice; mode: SchemeMode; accent: string; motion: boolean; custom: string | null }
let state: ThemeState = { id: "default", scheme: "dark", choice: "dark", mode: "game", accent: BRAND_ACCENT, motion: true, custom: null };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const subscribeTheme = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const themeState = () => state;
export const useTheme = () => useSyncExternalStore(subscribeTheme, themeState);

/** The theme id a game uses: the user's pick for it (a built-in theme or a custom one), else the game's default. */
export function themeFor(game: Pick<GameState, "id" | "theme"> | null): string {
  if (!game) return "default";
  const pick = read(K.perGame(game.id));
  if (pick && pick !== "auto" && (THEMES.some((t) => t.id === pick) || findCustom(pick))) return pick;
  return game.theme || "default";
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

/** Light or dark for every theme at once. "game" lets each theme use its own: what was picked for it, else the
    scheme its game's menus use (Teyvat and Talos-II light, the rest dark). */
export type SchemeMode = "game" | SchemeChoice;
export function schemeMode(): SchemeMode {
  const v = read(K.mode);
  return v === "dark" || v === "light" || v === "system" ? v : "game";
}
export function setSchemeMode(mode: SchemeMode, game: GameState | null) { write(K.mode, mode === "game" ? null : mode); applyGameTheme(game); }

/** A theme's own scheme choice, ignoring the all-themes mode: the user's pick for it, else its native scheme. The old
    global pick still counts for the Default theme. */
export function ownSchemeChoice(themeId: string): SchemeChoice {
  const info = THEMES.find((t) => t.id === themeId);
  const v = read(K.schemeOf(themeId)) ?? (themeId === "default" ? read(K.scheme) : null);
  return v === "dark" || v === "light" || v === "system" ? v : info?.native ?? "dark";
}
/** The scheme choice a theme shows with: the all-themes mode, or in "game" mode the theme's own. */
export function schemeChoiceFor(themeId: string): SchemeChoice {
  const m = schemeMode();
  return m === "game" ? ownSchemeChoice(themeId) : m;
}
const resolve = (c: SchemeChoice): Scheme => (c === "system" ? systemScheme() : c);

/** Attributes that show theme `id` inside one element, e.g. `<div {...themeAttrs("zzz")}>` for a preview. Without a
    scheme it shows the one the user would see for that theme. */
export function themeAttrs(id: string, scheme?: Scheme): { "data-theme": string; "data-scheme": Scheme } {
  const info = THEMES.find((t) => t.id === id) ?? THEMES[0]!;
  const want = scheme ?? resolve(schemeChoiceFor(info.id));
  return { "data-theme": info.id, "data-scheme": info.schemes.includes(want) ? want : info.native };
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

/** Apply a game's theme to <html>: data-theme, data-scheme, data-game, data-motion, the accent variables, and a
    custom theme's tokens, CSS and layout when the game uses one. */
export function applyGameTheme(game: GameState | null) {
  lastGame = game;
  watchCustom();
  const pickId = themeFor(game);
  const custom = findCustom(pickId);
  const info = THEMES.find((t) => t.id === (custom ? custom.base : pickId)) ?? THEMES[0]!;
  const choice = custom ? custom.scheme : schemeChoiceFor(info.id);
  const want = resolve(choice);
  const scheme = info.schemes.includes(want) ? want : info.native;
  const r = document.documentElement;
  r.dataset.theme = info.id;
  r.dataset.scheme = scheme;
  r.dataset.game = game?.id ?? "";
  r.dataset.accent = accentPick(info.id);
  // every theme dark or light (not each its game's own): themes whose own look mixes the two go all one way
  if (!custom && schemeMode() !== "game") r.dataset.full = ""; else delete r.dataset.full;
  const accent = rgb(game?.accent ?? "") ? game!.accent : BRAND_ACCENT;
  const vars = { "--game-accent": accent, "--game-on-accent": onColor(accent), "--game-accent-dk": darkShade(accent) };
  for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v);
  const motion = read(K.motion) !== "0";
  r.dataset.motion = motion ? "full" : "reduced";
  const css = injectCustom(custom);
  // the pre-paint script in index.html reads this to colour the first frame
  write(K.paint, JSON.stringify({ game: game?.id ?? "", vars, custom: custom ? { id: custom.id, base: custom.base, scheme: custom.scheme, css, layout: custom.layout } : null }));
  state = { id: info.id, scheme, choice, mode: schemeMode(), accent, motion, custom: custom?.id ?? null };
  emit();
}

/** Pick dark, light or system for the theme on screen now (each theme remembers its own; it shows while the
    all-themes mode is "game"). */
export function setScheme(choice: SchemeChoice, game: GameState | null) {
  const pickId = themeFor(game);
  const custom = findCustom(pickId);
  if (custom) {
    const list = customThemesPref.get().map((t) => (t.id === custom.id ? { ...t, scheme: choice } : t));
    customCache = null;
    void customThemesPref.set(list).then(() => { customCache = null; });
  } else write(K.schemeOf(pickId), choice);
  applyGameTheme(game);
}
export function setMotion(on: boolean, game: GameState | null) { write(K.motion, on ? "1" : "0"); applyGameTheme(game); }

/** Follow the system's light/dark switch while the current theme's choice is "system". */
export function watchSystemScheme(current: () => GameState | null): () => void {
  const m = window.matchMedia("(prefers-color-scheme: light)");
  const h = () => { if (state.choice === "system") applyGameTheme(current()); };
  m.addEventListener("change", h);
  return () => m.removeEventListener("change", h);
}

// ── layout ──

export type Density = "compact" | "cozy" | "roomy";
export type SidebarSide = "left" | "right";
export type NavStyle = "list" | "grid";
export type Corners = "sharp" | "soft" | "round";
/** What buttons show: an icon and their name, the icon alone (the name becomes its tip) or the name alone. */
export type ButtonStyle = "both" | "icons" | "text";
/** How the window is laid out. Missing fields mean the default (cozy, left, list, soft, both). */
export interface LayoutPrefs { density?: Density; sidebar?: SidebarSide; nav?: NavStyle; corners?: Corners; buttons?: ButtonStyle }
export const LAYOUT_DEFAULTS: Required<LayoutPrefs> = { density: "cozy", sidebar: "left", nav: "list", corners: "soft", buttons: "both" };
const LAYOUT_VALUES: Record<keyof LayoutPrefs, readonly string[]> = {
  density: ["compact", "cozy", "roomy"], sidebar: ["left", "right"], nav: ["list", "grid"], corners: ["sharp", "soft", "round"],
  buttons: ["both", "icons", "text"],
};

/** The layout the user picked in Settings (localStorage "gm.layout"), defaults filled in. */
export function layoutPick(): Required<LayoutPrefs> {
  let saved: Record<string, unknown> = {};
  try { const v: unknown = JSON.parse(read(K.layout) ?? "{}"); if (v && typeof v === "object") saved = v as Record<string, unknown>; } catch { /* not JSON */ }
  const out: Required<LayoutPrefs> = { ...LAYOUT_DEFAULTS };
  for (const k of Object.keys(LAYOUT_VALUES) as Array<keyof LayoutPrefs>) {
    const v = saved[k];
    if (typeof v === "string" && LAYOUT_VALUES[k].includes(v)) (out as Record<string, string>)[k] = v;
  }
  return out;
}

/** The layout on screen now: the user's pick with what the game's custom theme sets on top, which fields that
    theme sets, and its name. */
export function currentLayout(game: GameState | null): { layout: Required<LayoutPrefs>; fromTheme: Array<keyof LayoutPrefs>; themeName: string | null } {
  const custom = findCustom(themeFor(game));
  const own = custom?.layout ?? {};
  return { layout: { ...layoutPick(), ...own }, fromTheme: Object.keys(own) as Array<keyof LayoutPrefs>, themeName: custom?.name ?? null };
}

/** Change the layout. A field the game's custom theme sets is changed in that theme, so what's on screen changes. */
export function setLayout(patch: LayoutPrefs, game: GameState | null) {
  const custom = findCustom(themeFor(game));
  const mine: Record<string, string> = { ...layoutPick() };
  const theirs: Record<string, string> = { ...(custom?.layout ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v !== "string") continue;
    if (custom && k in theirs) theirs[k] = v; else mine[k] = v;
  }
  const keep = Object.fromEntries(Object.entries(mine).filter(([k, v]) => LAYOUT_DEFAULTS[k as keyof LayoutPrefs] !== v));
  write(K.layout, Object.keys(keep).length ? JSON.stringify(keep) : null);
  if (custom && JSON.stringify(theirs) !== JSON.stringify(custom.layout)) {
    const list = customThemesPref.get().map((t) => (t.id === custom.id ? { ...t, layout: theirs as LayoutPrefs } : t));
    customCache = null;
    void customThemesPref.set(list).then(() => { customCache = null; applyGameTheme(lastGame); });
  }
  applyGameTheme(game);
}

/** Set data-density, data-sidebar, data-nav, data-corners and data-buttons on <html> (null clears them, which means
 *  the defaults). */
export function applyLayout(layout: LayoutPrefs | null) {
  const r = document.documentElement;
  for (const k of Object.keys(LAYOUT_VALUES) as Array<keyof LayoutPrefs>) {
    const v = layout?.[k];
    if (v && v !== LAYOUT_DEFAULTS[k] && LAYOUT_VALUES[k].includes(v)) r.setAttribute(`data-${k}`, v);
    else r.removeAttribute(`data-${k}`);
  }
}

// ── custom themes ──

/** A theme made on top of a built-in one. `tokens` maps a token from THEME_TOKENS to a value, for example
    { "--accent": "#ff5c8a", "--radius": "6px" }. `css` is extra CSS for anything tokens can't say. */
export interface CustomTheme {
  /** "custom:" and a slug, e.g. "custom:pink-night". */
  id: string;
  name: string;
  /** A built-in theme id (THEMES). */
  base: string;
  scheme: SchemeChoice;
  tokens: Record<string, string>;
  layout: LayoutPrefs;
  css?: string;
  /** The extension package it came from (lib/extensions.ts keeps these in step with the package). */
  pkg?: string;
}

export type TokenKind = "color" | "length" | "shadow" | "font" | "time" | "ease" | "image";
/** The tokens a custom theme may set, what each means and what kind of value it takes (used in the AI helper's
    prompt and the editor). Game themes also draw their own materials; these shared tokens restyle what every theme
    has in common, and `css` can reach the rest. */
export const THEME_TOKENS: Record<string, { kind: TokenKind; meaning: string }> = {
  "--bg": { kind: "color", meaning: "window background" },
  "--bg-2": { kind: "color", meaning: "a deeper layer: sidebar, title bar, wells, inputs" },
  "--surface": { kind: "color", meaning: "panels and cards" },
  "--surface-2": { kind: "color", meaning: "raised or hovered surfaces, chips" },
  "--surface-3": { kind: "color", meaning: "a third layer, like a hovered row on --surface-2" },
  "--raised": { kind: "color", meaning: "the picked part of a segmented control" },
  "--line": { kind: "color", meaning: "hairlines between things" },
  "--line-2": { kind: "color", meaning: "stronger borders" },
  "--text": { kind: "color", meaning: "main text" },
  "--text-2": { kind: "color", meaning: "secondary text" },
  "--text-3": { kind: "color", meaning: "faint text for hints and labels (keep 4.5:1 on --surface)" },
  "--accent": { kind: "color", meaning: "the one bright colour: current view, primary buttons, toggles" },
  "--on-accent": { kind: "color", meaning: "text and icons on --accent" },
  "--accent-soft": { kind: "color", meaning: "accent at low alpha for picked backgrounds" },
  "--accent-ink": { kind: "color", meaning: "accent for text and icons on surfaces (must read on --surface)" },
  "--accent-2": { kind: "color", meaning: "a second highlight" },
  "--ok": { kind: "color", meaning: "success and on" },
  "--warn": { kind: "color", meaning: "warnings" },
  "--bad": { kind: "color", meaning: "errors and delete" },
  "--info": { kind: "color", meaning: "information" },
  "--on-bad": { kind: "color", meaning: "text on a --bad fill" },
  "--ring": { kind: "color", meaning: "keyboard and controller focus ring" },
  "--hover": { kind: "color", meaning: "wash for hovered rows and ghost buttons" },
  "--scrim": { kind: "color", meaning: "behind dialogs" },
  "--img-bg": { kind: "color", meaning: "behind pictures while they load" },
  "--radius": { kind: "length", meaning: "corners of panels and cards" },
  "--radius-sm": { kind: "length", meaning: "corners of buttons and fields" },
  "--radius-lg": { kind: "length", meaning: "corners of dialogs and banners" },
  "--radius-xs": { kind: "length", meaning: "corners of tags and key caps" },
  "--shadow": { kind: "shadow", meaning: "card shadow (a box-shadow value)" },
  "--shadow-lg": { kind: "shadow", meaning: "floating shadow for menus and dialogs" },
  "--tex": { kind: "image", meaning: "decorative background layer for banners: none or a CSS gradient" },
  "--font": { kind: "font", meaning: "body font family list" },
  "--font-display": { kind: "font", meaning: "headings font family list" },
  "--font-mono": { kind: "font", meaning: "monospace font family list" },
  "--dur": { kind: "time", meaning: "normal animation time, like 180ms" },
  "--dur-fast": { kind: "time", meaning: "hover feedback time" },
  "--dur-slow": { kind: "time", meaning: "time for panels coming in" },
  "--ease": { kind: "ease", meaning: "normal easing, like cubic-bezier(.2, .8, .2, 1)" },
};

export const CUSTOM_CSS_MAX = 24_000;
/** The user's custom themes. Pick one for a game with setThemePick(game, theme.id). */
export const customThemesPref = jsonPref<CustomTheme[]>("ui.customThemes", []);
let customCache: CustomTheme[] | null = null;
let lastGame: GameState | null = null;
let watching = false;
function watchCustom() {
  if (watching) return;
  watching = true;
  // the saved list loads after the first paint; apply again once it is in
  void customThemesPref.ready.then(() => { customCache = null; applyGameTheme(lastGame); });
}
function findCustom(id: string): CustomTheme | null {
  if (!id.startsWith("custom:")) return null;
  customCache ??= customThemesPref.get().map((t) => validateCustomTheme(t).theme).filter((t): t is CustomTheme => !!t);
  return customCache.find((t) => t.id === id) ?? null;
}

// never allowed in a token value or custom CSS: other files, scripts, old IE tricks, closing the style tag
const BANNED: Array<[RegExp, string]> = [
  [/@import/, "@import"], [/@charset|@namespace/, "@charset or @namespace"], [/expression\s*\(/, "expression()"],
  [/behaviou?r\s*:/, "behavior"], [/-moz-binding/, "-moz-binding"], [/javascript:|vbscript:/, "a script link"],
  [/<\/?\s*style|<!--|-->/, "HTML"], [/image-set\s*\(/, "image-set()"], [/(^|[^-\w])src\s*\(/, "src()"],
];

/** CSS with comments removed and escapes decoded, lower-cased: what the browser would read, for checking only. */
function normalise(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h: string) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; })
    .replace(/\\(.)/g, "$1")
    .toLowerCase();
}

/** Why a piece of CSS is not allowed, or null when it is fine. url() may only hold an inline image or font. */
function cssProblem(css: string): string | null {
  const n = normalise(css);
  for (const [re, what] of BANNED) if (re.test(n)) return `uses ${what}`;
  for (const m of n.matchAll(/url\s*\(\s*(['"]?)([^'")]*)/g)) {
    const target = (m[2] ?? "").trim();
    if (!/^data:(image\/(png|jpe?g|gif|webp|svg\+xml|avif)|font\/(woff2?|ttf|otf))[;,]/.test(target) && !target.startsWith("#")) {
      return `loads ${target.slice(0, 40) || "a file"} (only inline data: images and fonts are allowed)`;
    }
  }
  return null;
}

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:%|deg|turn|rad)?`;
const COLOR_FN = new RegExp(String.raw`^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*(?:none|${NUM})(?:\s*[,/]?\s*(?:none|${NUM})){2,3}\s*\)$`);
const NAMED = /^(?:transparent|currentcolor|black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|navy|teal|maroon|olive|lime|aqua|cyan|magenta|fuchsia|brown|crimson|coral|salmon|tomato|indigo|violet|khaki|beige|ivory|lavender|plum|orchid|tan|chocolate|sienna|peru|wheat|linen|snow|azure|whitesmoke|gainsboro|lightgray|lightgrey|darkgray|darkgrey|dimgray|dimgrey|slategray|slategrey)$/;
const isVarRef = (v: string) => {
  const m = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(v);
  return !!m && (m[1]! in THEME_TOKENS || /^--game-(accent|on-accent|accent-dk)$/.test(m[1]!));
};
/** Split at top-level commas (not inside parentheses). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

/** True for a colour we can read: #hex, rgb(), hsl(), oklch() and friends with plain numbers, a common name,
    var(--token), or color-mix() of those. */
export function isColor(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v) || NAMED.test(v) || COLOR_FN.test(v) || isVarRef(v)) return true;
  const mix = /^color-mix\(\s*in\s+(?:srgb|srgb-linear|oklab|oklch|lab|lch|hsl|hwb|display-p3)\s*,(.*)\)$/.exec(v);
  if (!mix) return false;
  const parts = splitTop(mix[1]!);
  return parts.length === 2 && parts.every((p) => isColor(p.trim().replace(/\s+\d+(?:\.\d+)?%$/, "")));
}
const supports = (prop: string, v: string) => (typeof CSS !== "undefined" && typeof CSS.supports === "function" ? CSS.supports(prop, v) : true);
const PLAIN = /^[\w\s#%.,()/-]+$/;

function tokenProblem(name: string, raw: unknown): string | null {
  const spec = THEME_TOKENS[name];
  if (!spec) return `${name} is not a theme token`;
  if (typeof raw !== "string" || !raw.trim()) return `${name} has no value`;
  const v = raw.trim();
  if (v.length > 400 || /[;{}<>\\]/.test(v)) return `${name}: the value has characters a token can't hold`;
  const bad = cssProblem(v);
  if (bad) return `${name} ${bad}`;
  switch (spec.kind) {
    case "color": return isColor(v) ? null : `${name}: "${v.slice(0, 40)}" is not a colour`;
    case "length": return /^(?:0|\d+(?:\.\d+)?(?:px|rem|em|%))$/.test(v) ? null : `${name}: use a size like 8px or .5rem`;
    case "time": return /^\d+(?:\.\d+)?m?s$/.test(v) ? null : `${name}: use a time like 180ms`;
    case "ease": return /^(?:linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\(\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*\))$/.test(v) ? null : `${name}: use cubic-bezier(a, b, c, d)`;
    case "font": return /^[\w\s"',.-]+$/.test(v) ? null : `${name}: use a list of font names`;
    case "shadow": return PLAIN.test(v) && supports("box-shadow", v) ? null : `${name}: not a box-shadow`;
    case "image": return v === "none" || (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/.test(v) && PLAIN.test(v) && supports("background-image", v)) ? null : `${name}: use none or a CSS gradient`;
  }
}

/** Check a custom theme (from the editor, a file or the AI helper). Bad tokens, layout values and CSS are left out
    with a plain reason each; `theme` is null only when nothing is usable (no name, or an unknown base). */
export function validateCustomTheme(input: unknown): { theme: CustomTheme | null; problems: string[] } {
  const problems: string[] = [];
  if (!input || typeof input !== "object") return { theme: null, problems: ["Not a theme"] };
  const o = input as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
  if (!name) return { theme: null, problems: ["The theme has no name"] };
  const baseInfo = typeof o.base === "string" ? THEMES.find((t) => t.id === o.base) : undefined;
  if (!baseInfo) return { theme: null, problems: [`Unknown base theme "${String(o.base)}". Use one of: ${THEMES.map((t) => t.id).join(", ")}`] };
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "theme";
  const id = typeof o.id === "string" && /^custom:[a-z0-9-]{1,40}$/.test(o.id) ? o.id : `custom:${slug}`;
  const scheme: SchemeChoice = o.scheme === "light" || o.scheme === "dark" || o.scheme === "system" ? o.scheme : baseInfo.native;

  const tokens: Record<string, string> = {};
  if (o.tokens && typeof o.tokens === "object") {
    for (const [k, v] of Object.entries(o.tokens as Record<string, unknown>)) {
      const bad = tokenProblem(k, v);
      if (bad) problems.push(bad); else tokens[k] = (v as string).trim();
    }
  }
  const layout: LayoutPrefs = {};
  if (o.layout && typeof o.layout === "object") {
    for (const [k, v] of Object.entries(o.layout as Record<string, unknown>)) {
      const allowed = (LAYOUT_VALUES as Record<string, readonly string[] | undefined>)[k];
      if (!allowed) problems.push(`Layout has no "${k}" setting`);
      else if (typeof v !== "string" || !allowed.includes(v)) problems.push(`Layout ${k} must be one of: ${allowed.join(", ")}`);
      else (layout as Record<string, string>)[k] = v;
    }
  }
  let css: string | undefined;
  if (typeof o.css === "string" && o.css.trim()) {
    const bad = o.css.length > CUSTOM_CSS_MAX ? `it is longer than ${CUSTOM_CSS_MAX.toLocaleString()} characters` : cssProblem(o.css);
    if (bad) problems.push(`CSS left out: ${bad}`); else css = o.css;
  }
  const pkg = typeof o.pkg === "string" && /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(o.pkg) ? o.pkg : undefined;
  return { theme: { id, name, base: baseInfo.id, scheme, tokens, layout, ...(css ? { css } : {}), ...(pkg ? { pkg } : {}) }, problems };
}

const STYLE_ID = "gm-custom-theme";
/** Put a custom theme's tokens and CSS into the page and set its layout; null takes them out. Returns the CSS used. */
function injectCustom(theme: CustomTheme | null): string {
  const r = document.documentElement;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!theme) {
    el?.remove();
    delete r.dataset.custom;
    applyLayout(layoutPick());
    return "";
  }
  const decl = Object.entries(theme.tokens).map(([k, v]) => `  ${k}: ${v};`).join("\n");
  const css = `:root:root[data-custom="${theme.id}"] {\n${decl}\n}\n${theme.css ?? ""}`;
  if (!el) { el = document.createElement("style"); el.id = STYLE_ID; }
  el.textContent = css;
  document.head.appendChild(el); // last in <head>, after the theme files
  r.dataset.custom = theme.id;
  applyLayout({ ...layoutPick(), ...theme.layout });
  return css;
}

/** Show a custom theme now (validated first), e.g. a preview while editing; null goes back to the game's own theme.
    Returns the problems found. To keep it: customThemesPref.set([...list, theme]) and setThemePick(game, theme.id). */
export function applyCustomTheme(input: CustomTheme | null): string[] {
  customCache = null;
  if (!input) { applyGameTheme(lastGame); return []; }
  const { theme, problems } = validateCustomTheme(input);
  if (!theme) return problems;
  const info = THEMES.find((t) => t.id === theme.base) ?? THEMES[0]!;
  const want = resolve(theme.scheme);
  const scheme = info.schemes.includes(want) ? want : info.native;
  const r = document.documentElement;
  r.dataset.theme = info.id;
  r.dataset.scheme = scheme;
  r.dataset.accent = accentPick(info.id);
  injectCustom(theme);
  state = { ...state, id: info.id, scheme, choice: theme.scheme, custom: theme.id };
  emit();
  return problems;
}
