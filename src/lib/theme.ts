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
import { about, type GameState } from "./api";
import { jsonPref } from "./prefs";
import { t } from "./i18n";
import { BRAND_ACCENT, darkShade, onColor, rgb, THEMES, type Scheme, type SchemeChoice } from "./theme-info";
export { BRAND_ACCENT, darkShade, onColor, THEMES } from "./theme-info";
export type { AccentInfo, Scheme, SchemeChoice, ThemeInfo } from "./theme-info";

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
  if (pick && pick !== "auto" && (THEMES.some((th) => th.id === pick) || findCustom(pick))) return pick;
  return game.theme || "default";
}
export const themePick = (gameId: string): string => read(K.perGame(gameId)) ?? "auto";
export function setThemePick(game: GameState, id: string) { write(K.perGame(game.id), id === "auto" ? null : id); applyGameTheme(game); }
/** Set several games' picks at once ({ gameId: themeId or "auto" }), then apply the one on screen. */
export function setThemePicks(picks: Record<string, string>, current: GameState | null) {
  for (const [g, id] of Object.entries(picks)) write(K.perGame(g), id === "auto" ? null : id);
  applyGameTheme(current);
}

/** The accent picked for a theme that offers several (its first one when nothing is picked). */
export function accentPick(themeId: string): string {
  const list = THEMES.find((th) => th.id === themeId)?.accents ?? [];
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
  const info = THEMES.find((th) => th.id === themeId);
  const v = read(K.schemeOf(themeId)) ?? (themeId === "default" ? read(K.scheme) : null);
  return v === "dark" || v === "light" || v === "system" ? v : info?.native ?? "dark";
}
/** The scheme choice a theme shows with: the all-themes mode, or in "game" mode the theme's own. */
export function schemeChoiceFor(themeId: string): SchemeChoice {
  const m = schemeMode();
  return m === "game" ? ownSchemeChoice(themeId) : m;
}
const resolve = (c: SchemeChoice): Scheme => (c === "system" ? systemScheme() : c);

/** A <style> element the page's CSP lets in. A release build allows inline styles only with the nonce Tauri gives
 *  index.html's own <style>, so a new one carries that nonce. */
function newStyle(id: string): HTMLStyleElement {
  const el = document.createElement("style");
  el.id = id;
  const nonce = document.querySelector<HTMLStyleElement>("style[nonce]")?.nonce;
  if (nonce) el.nonce = nonce;
  return el;
}

/** Attributes that show theme `id` inside one element, e.g. `<div {...themeAttrs("zzz")}>` for a preview. Without a
    scheme it shows the one the user would see for that theme. */
export function themeAttrs(id: string, scheme?: Scheme): { "data-theme": string; "data-scheme": Scheme } {
  const info = THEMES.find((th) => th.id === id) ?? THEMES[0]!;
  const want = scheme ?? resolve(schemeChoiceFor(info.id));
  return { "data-theme": info.id, "data-scheme": info.schemes.includes(want) ? want : info.native };
}

/** Apply a game's theme to <html>: data-theme, data-scheme, data-game, data-motion, the accent variables, and a
    custom theme's tokens, CSS and layout when the game uses one. */
export function applyGameTheme(game: GameState | null) {
  lastGame = game;
  watchCustom();
  const pickId = themeFor(game);
  const custom = findCustom(pickId);
  const info = THEMES.find((th) => th.id === (custom ? custom.base : pickId)) ?? THEMES[0]!;
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
  const layout = Object.fromEntries(Object.entries(layoutPick()).filter(([k, v]) => LAYOUT_DEFAULTS[k as keyof LayoutPrefs] !== v));
  saveLook({
    theme: info.id, scheme, accent: accentPick(info.id), full: !custom && schemeMode() !== "game", motion: motion ? "full" : "reduced", vars, layout,
    custom: custom ? { id: custom.id, css, layout: custom.layout } : null,
    game: game ? { id: game.id, name: game.name, short: game.short, importer: game.importer, accent } : null,
  });
  state = { id: info.id, scheme, choice, mode: schemeMode(), accent, motion, custom: custom?.id ?? null };
  emit();
}

// gachamod setup wears the look on screen for repair and uninstall (src-setup/src/look.rs reads it from look.json in
// the data folder). Sent a moment after the last change, and only when it differs.
let lookTimer = 0;
let lookSent = "";
function saveLook(look: Record<string, unknown>) {
  clearTimeout(lookTimer);
  lookTimer = window.setTimeout(() => {
    const text = JSON.stringify(look);
    if (text === lookSent) return;
    lookSent = text;
    about.saveLook(look).catch(() => { lookSent = ""; });
  }, 1500);
}

/** Pick dark, light or system for the theme on screen now (each theme remembers its own; it shows while the
    all-themes mode is "game"). */
export function setScheme(choice: SchemeChoice, game: GameState | null) {
  const pickId = themeFor(game);
  const custom = findCustom(pickId);
  if (custom) {
    const list = customThemesPref.get().map((th) => (th.id === custom.id ? { ...th, scheme: choice } : th));
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
/** How Mods and a character's page are laid out, to feel like the mod manager someone used before:
 *  "cards" gachamod's own (filter chips over the cards, details slide in), "chars" a list of characters down the left,
 *  "panes" that list plus the picked mod's details always open on the right, "rows" one dense line per mod. */
export type ModsFormat = "cards" | "chars" | "panes" | "rows";
/** How the window is laid out. Missing fields mean the default (cozy, left, list, soft, both, cards). */
export interface LayoutPrefs { density?: Density; sidebar?: SidebarSide; nav?: NavStyle; corners?: Corners; buttons?: ButtonStyle; format?: ModsFormat }
export const LAYOUT_DEFAULTS: Required<LayoutPrefs> = { density: "cozy", sidebar: "left", nav: "list", corners: "soft", buttons: "both", format: "cards" };
const LAYOUT_VALUES: Record<keyof LayoutPrefs, readonly string[]> = {
  density: ["compact", "cozy", "roomy"], sidebar: ["left", "right"], nav: ["list", "grid"], corners: ["sharp", "soft", "round"],
  buttons: ["both", "icons", "text"], format: ["cards", "chars", "panes", "rows"],
};
/** Layout fields only the user sets: a custom theme can't carry them, so a theme never changes how Mods is laid out. */
const USER_ONLY: ReadonlyArray<keyof LayoutPrefs> = ["format"];

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
  const own = Object.fromEntries(Object.entries(custom?.layout ?? {}).filter(([k]) => !USER_ONLY.includes(k as keyof LayoutPrefs))) as LayoutPrefs;
  return { layout: { ...layoutPick(), ...own }, fromTheme: Object.keys(own) as Array<keyof LayoutPrefs>, themeName: custom?.name ?? null };
}

/** Change the layout. A field the game's custom theme sets is changed in that theme, so what's on screen changes. */
export function setLayout(patch: LayoutPrefs, game: GameState | null) {
  const custom = findCustom(themeFor(game));
  const mine: Record<string, string> = { ...layoutPick() };
  const theirs: Record<string, string> = { ...(custom?.layout ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v !== "string") continue;
    if (custom && k in theirs && !USER_ONLY.includes(k as keyof LayoutPrefs)) theirs[k] = v; else mine[k] = v;
  }
  const keep = Object.fromEntries(Object.entries(mine).filter(([k, v]) => LAYOUT_DEFAULTS[k as keyof LayoutPrefs] !== v));
  write(K.layout, Object.keys(keep).length ? JSON.stringify(keep) : null);
  if (custom && JSON.stringify(theirs) !== JSON.stringify(custom.layout)) {
    const list = customThemesPref.get().map((th) => (th.id === custom.id ? { ...th, layout: theirs as LayoutPrefs } : th));
    customCache = null;
    void customThemesPref.set(list).then(() => { customCache = null; applyGameTheme(lastGame); });
  }
  applyGameTheme(game);
}

/** Set data-density, data-sidebar, data-nav, data-corners, data-buttons and data-format on <html> (null clears them,
 *  which means the defaults). The format is always the user's own pick. */
export function applyLayout(layout: LayoutPrefs | null) {
  const r = document.documentElement;
  for (const k of Object.keys(LAYOUT_VALUES) as Array<keyof LayoutPrefs>) {
    const v = USER_ONLY.includes(k) ? layoutPick()[k] : layout?.[k];
    if (v && v !== LAYOUT_DEFAULTS[k] && LAYOUT_VALUES[k].includes(v)) r.setAttribute(`data-${k}`, v);
    else r.removeAttribute(`data-${k}`);
  }
}

/** The Mods layout picked in Settings, Appearance (or at the first start). Follows changes. */
export function useModsFormat(): ModsFormat {
  useTheme();
  return layoutPick().format;
}
/** Pick the Mods layout. */
export function setModsFormat(format: ModsFormat) { setLayout({ format }, lastGame); }

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
  "--font-num": { kind: "font", meaning: "numbers in stats and counters font family list" },
  "--dur": { kind: "time", meaning: "normal animation time, like 180ms" },
  "--dur-fast": { kind: "time", meaning: "hover feedback time" },
  "--dur-slow": { kind: "time", meaning: "time for panels coming in" },
  "--ease": { kind: "ease", meaning: "normal easing, like cubic-bezier(.2, .8, .2, 1)" },
};

/** Room for a stylesheet as full as a game theme's (those run 60 to 100 KB). */
export const CUSTOM_CSS_MAX = 160_000;
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
  customCache ??= customThemesPref.get().map((th) => validateCustomTheme(th).theme).filter((th): th is CustomTheme => !!th);
  return customCache.find((th) => th.id === id) ?? null;
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
  for (const [re, what] of BANNED) if (re.test(n)) return t("uses {what}", { what });
  for (const m of n.matchAll(/url\s*\(\s*(['"]?)([^'")]*)/g)) {
    const target = (m[2] ?? "").trim();
    if (!/^data:(image\/(png|jpe?g|gif|webp|svg\+xml|avif)|font\/(woff2?|ttf|otf))[;,]/.test(target) && !target.startsWith("#")) {
      return target ? t("loads {file} (only inline data: images and fonts are allowed)", { file: target.slice(0, 40) }) : t("loads a file (only inline data: images and fonts are allowed)");
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
  if (!spec) return t("{name} is not a theme token", { name });
  if (typeof raw !== "string" || !raw.trim()) return t("{name} has no value", { name });
  const v = raw.trim();
  if (v.length > 400 || /[;{}<>\\]/.test(v)) return t("{name}: the value has characters a token can't hold", { name });
  const bad = cssProblem(v);
  if (bad) return t("{name} {problem}", { name, problem: bad });
  switch (spec.kind) {
    case "color": return isColor(v) ? null : t("{name}: \"{value}\" is not a colour", { name, value: v.slice(0, 40) });
    case "length": return /^(?:0|\d+(?:\.\d+)?(?:px|rem|em|%))$/.test(v) ? null : t("{name}: use a size like 8px or .5rem", { name });
    case "time": return /^\d+(?:\.\d+)?m?s$/.test(v) ? null : t("{name}: use a time like 180ms", { name });
    case "ease": return /^(?:linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\(\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*\))$/.test(v) ? null : t("{name}: use cubic-bezier(a, b, c, d)", { name });
    case "font": return /^[\w\s"',.-]+$/.test(v) ? null : t("{name}: use a list of font names", { name });
    case "shadow": return PLAIN.test(v) && supports("box-shadow", v) ? null : t("{name}: not a box-shadow", { name });
    case "image": return v === "none" || (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/.test(v) && PLAIN.test(v) && supports("background-image", v)) ? null : t("{name}: use none or a CSS gradient", { name });
  }
}

/** Check a custom theme (from the editor, a file or the AI helper). Bad tokens, layout values and CSS are left out
    with a plain reason each; `theme` is null only when nothing is usable (no name, or an unknown base). */
export function validateCustomTheme(input: unknown): { theme: CustomTheme | null; problems: string[] } {
  const problems: string[] = [];
  if (!input || typeof input !== "object") return { theme: null, problems: [t("Not a theme")] };
  const o = input as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
  if (!name) return { theme: null, problems: [t("The theme has no name")] };
  const baseInfo = typeof o.base === "string" ? THEMES.find((th) => th.id === o.base) : undefined;
  if (!baseInfo) return { theme: null, problems: [t("Unknown base theme \"{base}\". Use one of: {ids}", { base: String(o.base), ids: THEMES.map((th) => th.id).join(", ") })] };
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
      const allowed = USER_ONLY.includes(k as keyof LayoutPrefs) ? undefined : (LAYOUT_VALUES as Record<string, readonly string[] | undefined>)[k];
      if (!allowed) problems.push(t("Layout has no \"{key}\" setting", { key: k }));
      else if (typeof v !== "string" || !allowed.includes(v)) problems.push(t("Layout {key} must be one of: {values}", { key: k, values: allowed.join(", ") }));
      else (layout as Record<string, string>)[k] = v;
    }
  }
  let css: string | undefined;
  if (typeof o.css === "string" && o.css.trim()) {
    const bad = o.css.length > CUSTOM_CSS_MAX ? t("it is longer than {n} characters", { n: CUSTOM_CSS_MAX }) : cssProblem(o.css);
    if (bad) problems.push(t("CSS left out: {problem}", { problem: bad })); else css = o.css;
  }
  const pkg = typeof o.pkg === "string" && /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(o.pkg) ? o.pkg : undefined;
  return { theme: { id, name, base: baseInfo.id, scheme, tokens, layout, ...(css ? { css } : {}), ...(pkg ? { pkg } : {}) }, problems };
}

// ── scoping a custom theme's CSS ──

/** Attributes that only the root element carries, so a selector starting with one means the root. */
const ROOT_ATTR = /^\[data-(?:theme|scheme|custom|motion|density|sidebar|nav|corners|buttons|game|accent|full)(?![\w-])/;

/** Split a selector list at its top-level commas (not inside (), [] or quotes). */
function splitSelectors(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** One selector made to need the custom theme: `.btn` gives `:root:root[data-custom] .btn`,
    `:root[data-scheme="light"] .x` gives `:root:root[data-custom][data-scheme="light"] .x`, `[data-motion="reduced"] *`
    gives `:root:root[data-custom][data-motion="reduced"] *`. The doubled :root outweighs the base theme's rules for
    the same part and base.css's root rules (corners, density). */
function scopeSelector(sel: string): string {
  const root = /^(?:(?::root|html)(?![\w-])|&)+/.exec(sel);
  if (root) return `:root:root[data-custom]${sel.slice(root[0].length)}`;
  if (ROOT_ATTR.test(sel)) return `:root:root[data-custom]${sel}`;
  return `:root:root[data-custom] ${sel}`;
}

let scoped = { from: "", to: "" };
/** A custom theme's CSS with every rule scoped to it, so `.btn { ... }` applies only while that theme is on and beats
    the base theme's own rules. Rules inside @media, @supports, @container and @layer are scoped too (nested rules
    follow their parent); @keyframes, @font-face and @property stay as written. The browser's own parser reads it, so
    what the page would drop is dropped here too. Without a parser (tests) the text comes back as it was. */
export function scopeCss(css: string): string {
  if (!css.trim() || typeof CSSStyleSheet === "undefined") return css;
  if (scoped.from === css) return scoped.to;
  let sheet: CSSStyleSheet;
  try { sheet = new CSSStyleSheet(); sheet.replaceSync(css); } catch { return css; }
  const walk = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSStyleRule) r.selectorText = splitSelectors(r.selectorText).map(scopeSelector).join(", ");
      // @media, @supports, @container, @layer, @starting-style; @scope's rules are relative to its own root
      else if (r instanceof CSSGroupingRule && r.constructor.name !== "CSSScopeRule") walk(r.cssRules);
    }
  };
  walk(sheet.cssRules);
  const out = Array.from(sheet.cssRules, (r) => r.cssText).join("\n");
  scoped = { from: css, to: out };
  return out;
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
  const css = `:root:root[data-custom="${theme.id}"] {\n${decl}\n}\n${scopeCss(theme.css ?? "")}`;
  el ??= newStyle(STYLE_ID);
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
  const info = THEMES.find((th) => th.id === theme.base) ?? THEMES[0]!;
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
