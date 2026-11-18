// A GameBanana member's Uberstyle (the stylesheet GameBanana puts on their profile page) read into gachamod's own
// tokens for the creator page. Their CSS is never injected: uberTheme() reads it with the small parser below and
// keeps only colours, font names, one https picture and a few lengths, each checked and written out again here.
// uberVars() turns that into token overrides for .gb-creator that stay readable. Pure: no DOM, no network (the
// caller fetches the sheet from Member/UiConfig's _sUberstyleUrl). screens/browse/uberstyle.css draws the result.
import { BRAND_ACCENT, contrastOf, onColor, readableOn, type Scheme } from "./theme-info";

/** What an Uberstyle sets that the creator page can show. Colours are #rrggbb or #rrggbbaa; null when not set. */
export interface UberTheme {
  /** The page colour: behind the picture, or the whole page when there is no picture. */
  background: string | null;
  /** An https picture over the page colour (the plain URL), with its CSS background keywords. */
  image: string | null;
  imageRepeat: string | null;
  imageSize: string | null;
  imagePosition: string | null;
  imageAttachment: string | null;
  /** The colour GameBanana's content area (#BodyWrapper, #MainContent, #ContentGrid) lays over the page and picture.
   *  Usually see-through, like rgba(0,0,0,.8) over a wallpaper. */
  content: string | null;
  text: string | null;
  muted: string | null;
  link: string | null;
  linkHover: string | null;
  /** Module titles (.PageModule>h2), else h1 to h3, else the page title. */
  heading: string | null;
  /** Font lists like `"Motiva Sans", "Arial", sans-serif`. */
  font: string | null;
  headingFont: string | null;
  /** Module boxes (.PageModule>.Content, module>div.content). Fully transparent means the member hid the boxes. */
  panel: string | null;
  panelBorder: string | null;
  /** Corner size in px, 0 to 20. */
  panelRadius: number | null;
}

// ── a small CSS reader ──

export interface CssDecl { prop: string; value: string; important: boolean }
export interface CssRule { selectors: string[]; decls: CssDecl[]; nested: boolean }

const MAX_CSS = 1 << 20; // the largest real sheets are about 100 KB, most of it an embedded font
const MAX_RULES = 5000;
const MAX_DEPTH = 4;
const GROUPS = new Set(["media", "supports", "layer", "container", "document", "-moz-document", "scope"]);

/** The style rules in `css`, in order. Rules inside @media, @supports, @layer and @container come too, marked
 *  nested; @import, @font-face, @keyframes and the other at-rules are skipped. */
export function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  block(stripComments(css.slice(0, MAX_CSS)), false, 0, out);
  return out;
}

function stripComments(s: string): string {
  let out = "", q = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      out += c;
      if (c === "\\" && i + 1 < s.length) out += s[++i];
      else if (c === q || c === "\n") q = "";
    } else if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end < 0 ? s.length : end + 1;
      out += " ";
    } else {
      if (c === '"' || c === "'") q = c;
      out += c;
    }
  }
  return out;
}

/** Index of the first of `stops` outside strings (and outside brackets when `nesting`), or the end. A newline ends a
 *  string, as in CSS, so a stray quote can't swallow the rest of the sheet. */
function seek(s: string, from: number, stops: string, nesting = true): number {
  let depth = 0, q = "";
  for (let i = from; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === "\\") i++; else if (c === q || c === "\n") q = ""; continue; }
    if (depth === 0 && stops.includes(c)) return i;
    if (c === '"' || c === "'") q = c;
    else if (nesting && (c === "(" || c === "[")) depth++;
    else if (nesting && (c === ")" || c === "]")) depth = Math.max(0, depth - 1);
  }
  return s.length;
}

function closing(s: string, open: number): number {
  let depth = 0, q = "";
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === "\\") i++; else if (c === q || c === "\n") q = ""; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return s.length;
}

function block(s: string, nested: boolean, depth: number, out: CssRule[]): void {
  let i = 0;
  while (i < s.length && out.length < MAX_RULES) {
    const stop = seek(s, i, "{;}", false);
    if (stop >= s.length) return;
    const prelude = s.slice(i, stop).trim();
    // a statement (@import, @charset) or a stray brace
    if (s[stop] !== "{") { i = stop + 1; continue; }
    const end = closing(s, stop);
    const body = s.slice(stop + 1, end);
    i = end + 1;
    if (prelude.startsWith("@")) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
      const query = prelude.slice(name.length + 1).toLowerCase();
      const print = name === "media" && /\bprint\b/.test(query) && !/\b(screen|all)\b/.test(query);
      if (depth < MAX_DEPTH && GROUPS.has(name) && !print) block(body, true, depth + 1, out);
      continue;
    }
    if (prelude) out.push({ selectors: split(prelude, ","), decls: decls(body), nested });
  }
}

/** `s` split at `sep` outside strings and brackets, trimmed, empty parts dropped. */
function split(s: string, sep: string): string[] {
  const out: string[] = [];
  for (let i = 0; ;) {
    const j = seek(s, i, sep);
    const part = s.slice(i, j).trim();
    if (part) out.push(part);
    if (j >= s.length) return out;
    i = j + 1;
  }
}

function decls(body: string): CssDecl[] {
  const out: CssDecl[] = [];
  for (const part of split(body, ";")) {
    const k = part.indexOf(":");
    if (k < 1) continue;
    let prop = part.slice(0, k).trim();
    let value = part.slice(k + 1).trim();
    if (!/^(--[\w-]+|-?[a-zA-Z][\w-]*)$/.test(prop)) continue;
    if (!prop.startsWith("--")) prop = prop.toLowerCase();
    const imp = /!\s*important\s*$/i.exec(value);
    if (imp) value = value.slice(0, imp.index).trim();
    out.push({ prop, value: value.replace(/\s+/g, " "), important: !!imp });
  }
  return out;
}

// ── values: each reader returns a clean value, or undefined when the declaration can't be used ──

type RGBA = [number, number, number, number];
const CLEAR: RGBA = [0, 0, 0, 0];
const WHITE: RGBA = [255, 255, 255, 1];
const BLACK: RGBA = [0, 0, 0, 1];

const NAMED: Record<string, string> = Object.fromEntries(
  ("aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 " +
  "blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 " +
  "chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b " +
  "darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b " +
  "darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a " +
  "darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 " +
  "darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff " +
  "firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 " +
  "goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 " +
  "indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 " +
  "lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 " +
  "lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa " +
  "lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 " +
  "linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 " +
  "mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc " +
  "mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead " +
  "navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 " +
  "palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 " +
  "peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 " +
  "rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 " +
  "seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 " +
  "snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 " +
  "turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32")
    .split(" ").reduce<[string, string][]>((acc, w, i, all) => (i % 2 ? acc : [...acc, [w, all[i + 1]!]]), []),
);

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(%|deg|turn|rad|grad)?$/;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A colour as #hex (3, 4, 6, 8 digits), rgb[a]() or hsl[a]() with plain numbers, a colour name or transparent. */
function color(raw: string): RGBA | null {
  const v = raw.trim().toLowerCase();
  if (v.length > 64) return null;
  if (v === "transparent") return [...CLEAR];
  const named = NAMED[v];
  if (named) return color(`#${named}`);
  let m = /^#([0-9a-f]+)$/.exec(v);
  if (m) {
    const h = m[1]!;
    if (![3, 4, 6, 8].includes(h.length)) return null;
    const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
    const n = [0, 2, 4, 6].map((i) => parseInt(full.slice(i, i + 2) || "ff", 16));
    return [n[0]!, n[1]!, n[2]!, n[3]! / 255];
  }
  m = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(v);
  if (!m) return null;
  const parts = m[2]!.trim().split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const nums = parts.map((p) => NUM.exec(p));
  if (nums.some((n) => !n)) return null;
  const val = (i: number) => parseFloat(parts[i]!);
  const unit = (i: number) => nums[i]![1] ?? "";
  const alpha = parts.length === 4 ? clamp(unit(3) === "%" ? val(3) / 100 : val(3), 0, 1) : 1;
  if (m[1]!.startsWith("rgb")) {
    if ([0, 1, 2].some((i) => unit(i) !== "" && unit(i) !== "%")) return null;
    const ch = (i: number) => clamp(unit(i) === "%" ? val(i) * 2.55 : val(i), 0, 255);
    return [ch(0), ch(1), ch(2), alpha];
  }
  const turns: Record<string, number> = { "": 1 / 360, deg: 1 / 360, turn: 1, rad: 1 / (2 * Math.PI), grad: 1 / 400 };
  const hu = turns[unit(0)];
  if (hu === undefined || [1, 2].some((i) => unit(i) !== "" && unit(i) !== "%")) return null;
  const h = (((val(0) * hu) % 1) + 1) % 1, s = clamp(val(1), 0, 100) / 100, l = clamp(val(2), 0, 100) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    const x = ((t % 1) + 1) % 1;
    return 255 * (x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p);
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3), alpha];
}

function hex(c: RGBA): string {
  const ch = c.slice(0, 3).map((v) => Math.round(clamp(v, 0, 255)));
  const a = Math.round(clamp(c[3], 0, 1) * 255);
  return "#" + [...ch, ...(a < 255 ? [a] : [])].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** `top` drawn over `under`. */
function over(top: RGBA, under: RGBA): RGBA {
  const a = top[3] + under[3] * (1 - top[3]);
  if (a <= 0) return [...CLEAR];
  const ch = (i: number) => (top[i]! * top[3] + under[i]! * under[3] * (1 - top[3])) / a;
  return [ch(0), ch(1), ch(2), a];
}
/** `c` drawn over an opaque colour, so the result is opaque too. */
const flat = (c: RGBA, under: RGBA): RGBA => over(c, [under[0], under[1], under[2], 1]);
const mix = (a: RGBA, b: RGBA, t: number): RGBA => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t).concat(1) as RGBA;
const withAlpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a];

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-monospace", "ui-rounded", "emoji", "math", "fangsong"]);
// letters in any script (a member's 微软雅黑), digits, spaces, _ and -; never a quote, bracket, semicolon or backslash
const FONT_NAME = /^[\p{L}\p{N} _-]+$/u;

/** A font-family list, rebuilt: names quoted, generic families bare. Items that aren't plain names are dropped. */
function fontList(raw: string): string | undefined {
  if (raw.length > 400) return undefined;
  const names: string[] = [];
  for (const item of split(raw, ",")) {
    const quoted = /^(["'])(.*)\1$/.exec(item);
    const name = (quoted ? quoted[2]! : item).trim().replace(/\s+/g, " ");
    if (!name || name.length > 60 || !FONT_NAME.test(name)) continue;
    const low = name.toLowerCase();
    if (!quoted && /^(inherit|initial|unset|revert|revert-layer|default)$/.test(low)) continue;
    names.push(!quoted && GENERIC.has(low) ? low : `"${name}"`);
    if (names.length >= 8) break;
  }
  return names.length ? names.join(", ") : undefined;
}

/** The family part of a `font` shorthand: what follows the size, as in `600 11px 'Cinzel', serif`. */
function fontFromShorthand(raw: string): string | undefined {
  const m = /(?:^|\s)(?:\d*\.?\d+(?:px|em|rem|pt|%|vh|vw)|(?:xx?-)?(?:small|large)|medium|smaller|larger)(?:\/\S+)?\s+(.+)$/i.exec(raw);
  return m ? fontList(m[1]!) : undefined;
}

const URL_OK = /^https:\/\/[^\s"'()\\<>{};`]+$/;

/** The address in a url(...) token when it is a plain https link, else null. */
function httpsUrl(token: string): string | null {
  const m = /^url\(\s*(["']?)([\s\S]*?)\1\s*\)$/i.exec(token);
  if (!m) return null;
  const raw = m[2]!.trim();
  if (raw.length > 2048 || !URL_OK.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return null;
    return URL_OK.test(u.href) ? u.href : null;
  } catch {
    return null;
  }
}

/** A length in px, capped at `max`: px, em and rem (16px), or a bare 0. */
function px(raw: string, max: number): number | undefined {
  const m = /^(\d*\.?\d+)(px|em|rem)?$/i.exec(raw.trim());
  if (!m || (!m[2] && parseFloat(m[1]!) !== 0)) return undefined;
  const n = parseFloat(m[1]!) * (m[2] && m[2].toLowerCase() !== "px" ? 16 : 1);
  return Number.isFinite(n) ? Math.min(max, Math.round(n)) : undefined;
}

const MAX_LEN = 10000;
const lengthOk = (t: string, signed: boolean) => {
  const m = (signed ? /^-?(\d*\.?\d+)(px|%|em|rem|vh|vw)?$/ : /^(\d*\.?\d+)(px|%|em|rem|vh|vw)?$/).exec(t);
  return !!m && (!!m[2] || parseFloat(m[1]!) === 0) && parseFloat(m[1]!) <= MAX_LEN;
};
const posToken = (t: string) => /^(left|right|top|bottom|center)$/.test(t) || lengthOk(t, true);
const sizeToken = (t: string) => /^(cover|contain|auto)$/.test(t) || lengthOk(t, false);
const REPEAT = /^(repeat|repeat-x|repeat-y|no-repeat|space|round)$/;
const ATTACH = /^(fixed|scroll|local)$/;
const GRADIENT = /^(?:-webkit-|-moz-)?(?:repeating-)?(?:linear|radial|conic)-gradient\(([\s\S]*)\)$/;

/** One colour standing for a gradient: its stops averaged (weighted by their alpha). */
function gradientColor(args: string): RGBA | null {
  const stops: RGBA[] = [];
  for (const part of split(args, ",")) {
    for (const tok of split(part, " ")) {
      const c = color(tok);
      if (c) { stops.push(c); break; }
    }
  }
  if (!stops.length) return null;
  const weight = stops.reduce((s, c) => s + c[3], 0);
  if (weight <= 0) return [...CLEAR];
  const ch = (i: number) => stops.reduce((s, c) => s + c[i]! * c[3], 0) / weight;
  return [ch(0), ch(1), ch(2), weight / stops.length];
}

interface Bg {
  color: RGBA;
  url: string | null;
  /** gradient layers above the picture (a veil drawn in the background itself), as one colour */
  veil: RGBA | null;
  /** gradient layers when there is no picture, as one colour */
  gradient: RGBA | null;
  repeat: string; size: string; position: string; attachment: string;
}

/** A `background` shorthand, or a `background-image` list. Undefined when a browser would reject it too. */
function background(raw: string): Bg | undefined {
  if (raw.length > 4000) return undefined;
  const layers = split(raw, ",");
  if (!layers.length || layers.length > 12) return undefined;
  const out: Bg = { color: [...CLEAR], url: null, veil: null, gradient: null, repeat: "repeat", size: "auto", position: "0% 0%", attachment: "scroll" };
  // gradients above the picture, or all of them when there is none (those under a picture never show)
  const above: RGBA[] = [];
  for (const layer of layers) {
    const toks: string[] = [];
    for (const t of split(layer, " ")) toks.push(...(t.includes("(") ? [t] : t.split(/(\/)/).filter(Boolean)));
    let url: string | null | undefined, grad: RGBA | null = null, slash = false, attach = "";
    const pos: string[] = [], size: string[] = [], repeat: string[] = [];
    for (const raw of toks) {
      const t = raw.toLowerCase();
      if (t === "/") { slash = true; continue; }
      if (t.startsWith("url(")) { url = httpsUrl(raw); continue; }
      const g = GRADIENT.exec(t);
      if (g) { grad = gradientColor(g[1]!); continue; }
      if (/[;{}\\<>]/.test(t)) return undefined;
      if (t === "none" || /^(border|padding|content)-box$|^text$/.test(t)) continue;
      if (REPEAT.test(t)) { repeat.push(t); continue; }
      if (ATTACH.test(t)) { attach = t; continue; }
      if (slash) { if (!sizeToken(t)) return undefined; size.push(t); continue; }
      if (posToken(t)) { pos.push(t); continue; }
      const c = color(t);
      if (!c) return undefined;
      out.color = c;
    }
    if (pos.length > 4 || size.length > 2 || repeat.length > 2) return undefined;
    // a small gradient drawn once (`top left / 16px 2px no-repeat`) is an ornament, not a colour of the page
    const ornament = size.some((s) => /(px|em)$/.test(s)) && repeat.includes("no-repeat");
    if (url && !out.url) {
      out.url = url;
      out.repeat = repeat.join(" ") || "repeat";
      out.size = size.join(" ") || "auto";
      out.position = pos.join(" ") || "0% 0%";
      out.attachment = attach || "scroll";
    } else if (grad && !ornament && !out.url) above.push(grad);
  }
  // the first layer is drawn on top
  const stack = (cs: RGBA[]) => cs.reduceRight<RGBA | null>((acc, c) => (acc ? over(c, acc) : c), null);
  if (out.url) out.veil = stack(above);
  else out.gradient = stack(above);
  return out;
}

/** The first item of a comma list, checked token by token. */
const firstItem = (raw: string, ok: (t: string) => boolean, max: number): string | undefined => {
  const toks = split(split(raw, ",")[0] ?? "", " ").map((t) => t.toLowerCase());
  return toks.length && toks.length <= max && toks.every(ok) ? toks.join(" ") : undefined;
};

// ── which rules speak for what ──

/** One declaration that could speak for a value. `el` is which entry of the tier table its selector matched. */
interface Cand { prop: string; value: string; tier: number; el: number; nested: boolean; important: boolean; spec: number; order: number; from?: string }
type Tiers = Array<[RegExp, number]>;

// a member sheet is laid over GameBanana's own, so these values are GameBanana's look, not the member's choice:
// a sheet that copies the whole :root block from a tutorial still sets them
const GB_DEFAULTS: Record<string, string> = {
  "--DefaultTextColor": "#e2e2e2", "--DefaultGreyColor": "#999999", "--LinkColor": "#ffe033", "--LinkHoverColor": "#fd70e1",
  "--PageTitleColor": "#ffffff", "--ModuleDescriptionFontColor": "#707070", "--ModuleBorderColor": "#ffffff0d",
  "--DefaultTextFontFamily": '"Open Sans", sans-serif', "--ModuleTitleFontFamily": '"Open Sans", sans-serif',
  "--BodyBackground": "#131a20", "--BodyWrapperBackground": "#151d23",
};

const Q = String.raw`(?:[.#][\w-]+|\[[^\]]*\])*`;
const sel = (s: string) => new RegExp(`^(?:${s})$`);
const ROOT = sel(String.raw`(?::root|html|body)${Q}|\*`);
const BODY = sel(`body${Q}`), HTML = sel(`(?::root|html)${Q}`), ANY = sel(String.raw`\*`);
const BOX = String.raw`(?:\.pagemodule|module|modulegroup)`;
const PANEL_BOX = sel(String.raw`${BOX}[ >](?:div)?\.content`);
const PANEL = sel(BOX), RECORD = sel(String.raw`#submissionslist \.record`), COLUMN = sel("(?:row>)?column");
// GameBanana's page is body > #BodyWrapper > #MainContent > #MainContentWrapper > #ContentGrid > row > column,
// and sheets name these with or without their parents
const WRAP = "(?:(?:#bodywrapper|#maincontent|#maincontentwrapper)[ >])*";
const AREAS = sel(`${WRAP}(?:#bodywrapper|#maincontent|#maincontentwrapper|#contentgrid|(?:#contentgrid[ >])?(?:row>)?column)`);
const BOX_H = sel(String.raw`${BOX}[ >]h2`), H2 = sel("h2"), H13 = sel("h1|h3");
const TITLE = sel("(?:(?:#maincontentheader|#headlinewrapper|#headline)[ >])*#pagetitle");
const IN = String.raw`(?:${BOX}|\.richtext|#maincontent|\.content)[ >]`;
const LINK = sel(String.raw`a|a:link|a:any-link|\.linklike`), LINK_IN = sel(`${IN}(?:a|a:link)`), VISITED = sel("a:visited");
const HOVER = sel(String.raw`(?:a|a:link|a:any-link|\.linklike):hover`), HOVER_IN = sel(`${IN}a(?::link)?:hover`);
const MUTED = sel(String.raw`${BOX}[ >](?:p|div)?\.description|\.greycolor`), SMALL = sel("small|dt");

const PANELS: Tiers = [[PANEL_BOX, 0], [PANEL, 1], [RECORD, 1], [COLUMN, 2]];
const HEADINGS: Tiers = [[BOX_H, 0], [H2, 1], [H13, 2], [TITLE, 3]];
// the page from the bottom up, each drawn over the one before
const LAYERS: Array<{ tiers: Tiers; v?: string }> = [
  { tiers: [[BODY, 0], [HTML, 1]], v: "--BodyBackground" },
  { tiers: [[sel("#bodywrapper"), 0]] },
  { tiers: [[sel(`${WRAP}#maincontent`), 0], [sel(String.raw`#bodywrapper>\*`), 1]], v: "--BodyWrapperBackground" },
  { tiers: [[sel(`${WRAP}#maincontentwrapper`), 0]] },
  { tiers: [[sel(`${WRAP}#contentgrid`), 0]] },
];
const BG_PROPS = ["background", "background-color", "background-image", "background-repeat", "background-size", "background-position", "background-attachment"];
const VAR_TIER = 50;

/** A selector as the tier tables read it: lower case, single spaces, no spaces around combinators, and without a
 *  leading html/body/:root scope ("body #MainContent" is "#maincontent"). */
function norm(s: string): string {
  let out = s.toLowerCase().replace(/\s+/g, " ").replace(/ ?([>+~]) ?/g, "$1").trim();
  const scope = new RegExp(String.raw`^(?::root|html|body)${Q}[ >](?=\S)`);
  for (let k = 0; k < 3 && scope.test(out); k++) out = out.replace(scope, "");
  return out;
}

function specificity(s: string): number {
  const t = s.replace(/"[^"]*"|'[^']*'/g, "");
  const ids = (t.match(/#[\w-]+/g) ?? []).length;
  const cls = (t.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) ?? []).length;
  const els = (t.match(/(?:^|[\s>+~(,])[a-z][\w-]*|::[\w-]+/gi) ?? []).length;
  return ids * 1e4 + cls * 1e2 + els;
}

const rank = (a: Cand, b: Cand) =>
  a.tier - b.tier || +a.nested - +b.nested || +b.important - +a.important || b.spec - a.spec || b.order - a.order;

/** The best candidate `read` accepts. Undefined means "can't use this one, try the next". */
function pick<T>(cs: Cand[], read: (c: Cand) => T | undefined): T | undefined {
  for (const c of [...cs].sort(rank)) {
    const v = read(c);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** `var(--x)` replaced by the sheet's own value for --x (set on :root, html or body), or the fallback. */
function resolveVars(v: string, vars: Map<string, string>, depth = 0): string {
  if (!v.includes("var(") || depth > 4) return v;
  let out = "";
  for (let i = 0; ;) {
    const k = v.indexOf("var(", i);
    if (k < 0) return out + v.slice(i);
    const end = seek(v, k + 4, ")");
    if (end >= v.length) return out + v.slice(i);
    const inner = v.slice(k + 4, end);
    const comma = seek(inner, 0, ",");
    const got = vars.get(inner.slice(0, comma).trim()) ?? (comma < inner.length ? inner.slice(comma + 1).trim() : null);
    out += v.slice(i, k) + (got === null ? `var(${inner})` : resolveVars(got, vars, depth + 1));
    if (out.length > 4000) return v;
    i = end + 1;
  }
}

/** The values gachamod can show from a member's Uberstyle, or null when it sets nothing usable (a sheet that only
 *  @imports others, say: imports are never followed). */
export function uberTheme(css: string): UberTheme | null {
  const rules = cssRules(css).map((r, order) => ({ ...r, order, sels: r.selectors.map((s) => ({ s: norm(s), spec: specificity(s) })) }));

  // the sheet's own custom properties, cascaded
  const raw = new Map<string, Cand>();
  for (const r of rules) {
    const spec = Math.max(0, ...r.sels.filter((x) => ROOT.test(x.s)).map((x) => x.spec + 1)) - 1;
    if (spec < 0) continue;
    for (const [di, d] of r.decls.entries()) {
      if (!d.prop.startsWith("--")) continue;
      const c: Cand = { prop: d.prop, value: d.value, tier: 0, el: 0, nested: r.nested, important: d.important, spec, order: r.order * 1e4 + di };
      const was = raw.get(d.prop);
      if (!was || rank(c, was) < 0) raw.set(d.prop, c);
    }
  }
  const vars = new Map([...raw].map(([k, c]) => [k, c.value]));

  /** Candidates from rules whose selector is in `tiers`, for `props`; `fromVars` adds GameBanana variables read as
   *  the given property. The tier is the selector's, then the property's place in `props` when `byProp`. */
  const cands = (tiers: Tiers, props: string[], fromVars: Array<[string, string]> = [], byProp = true): Cand[] => {
    const out: Cand[] = [];
    for (const r of rules) {
      for (const x of r.sels) {
        const el = tiers.findIndex(([re]) => re.test(x.s));
        if (el < 0) continue;
        for (const [di, d] of r.decls.entries()) {
          const pi = props.indexOf(d.prop);
          if (pi < 0) continue;
          out.push({ prop: d.prop, value: resolveVars(d.value, vars), tier: tiers[el]![1] * 10 + (byProp ? pi : 0), el, nested: r.nested, important: d.important, spec: x.spec, order: r.order * 1e4 + di });
        }
      }
    }
    // GameBanana reads its variables on the first element of the table (body, #MainContent)
    fromVars.forEach(([name, prop], i) => {
      const c = raw.get(name);
      if (c) out.push({ ...c, prop, value: resolveVars(c.value, vars), tier: VAR_TIER + i, el: 0, from: name });
    });
    return out;
  };
  const isDefault = (c: Cand, v: string) => !!c.from && GB_DEFAULTS[c.from] === v;

  const bgCache = new Map<string, Bg | undefined>();
  const bgOf = (v: string) => (bgCache.has(v) ? bgCache.get(v) : (bgCache.set(v, background(v)), bgCache.get(v)));

  /** One background layer: its colour (gradients folded in) and picture. When the table names several elements
   *  (body and html, or the module box and its content box), the closest one that sets a background speaks for the
   *  layer, so one element's colour is never mixed with another's gradient. */
  const layer = (tiers: Tiers, v?: string) => {
    const all = cands(tiers, BG_PROPS, v ? [[v, "background"]] : [], false);
    const usable = (c: Cand) => (c.prop === "background" || c.prop === "background-image" ? !!bgOf(c.value) : c.prop === "background-color" ? !!color(c.value) : true);
    const el = [...all].sort(rank).find(usable)?.el;
    const cs = all.filter((c) => c.el === el);
    const sub = <T>(long: string, fromBg: (b: Bg) => T, fromLong: (value: string) => T | undefined) =>
      pick(cs.filter((c) => c.prop === "background" || c.prop === long), (c) => {
        if (c.prop !== "background") return fromLong(c.value);
        const b = bgOf(c.value);
        return b ? fromBg(b) : undefined;
      });
    const col = pick(cs.filter((c) => c.prop === "background" || c.prop === "background-color"), (c) => {
      const got = c.prop === "background" ? bgOf(c.value)?.color : color(c.value) ?? undefined;
      return got && isDefault(c, hex(got)) ? undefined : got;
    }) ?? null;
    const img = sub("background-image", (b) => b, (value) => bgOf(value));
    let colour = col;
    if (img?.gradient) colour = colour ? over(img.gradient, colour) : img.gradient;
    return {
      color: colour && colour[3] > 0.004 ? colour : null,
      url: img?.url ?? null,
      veil: img?.veil ?? null,
      repeat: sub("background-repeat", (b) => b.repeat, (value) => firstItem(value, (t) => REPEAT.test(t), 2)) ?? null,
      size: sub("background-size", (b) => b.size, (value) => firstItem(value, sizeToken, 2)) ?? null,
      position: sub("background-position", (b) => b.position, (value) => firstItem(value, posToken, 4)) ?? null,
      attachment: sub("background-attachment", (b) => b.attachment, (value) => firstItem(value, (t) => ATTACH.test(t), 1)) ?? null,
    };
  };

  // the page: find the top picture, then the colours over it (content) and under it (background)
  const layers = LAYERS.map((l) => layer(l.tiers, l.v));
  const stack = (ls: typeof layers) => ls.reduce<RGBA | null>((acc, l) => (l.color ? (acc ? over(l.color, acc) : l.color) : acc), null);
  const top = layers.map((l) => !!l.url).lastIndexOf(true);
  const pic = top >= 0 ? layers[top]! : null;
  const under = top >= 0 ? stack(layers.slice(0, top + 1)) : layers[0]!.color;
  let content = stack(layers.slice(top >= 0 ? top + 1 : 1));
  if (pic?.veil) content = content ? over(content, pic.veil) : pic.veil;

  const colourOf = (tiers: Tiers, fromVars: Array<[string, string]> = []) =>
    pick(cands(tiers, ["color"], fromVars), (c) => {
      const got = color(c.value);
      return got && got[3] >= 0.2 && !isDefault(c, hex(got)) ? hex(got) : undefined;
    }) ?? null;
  const fontOf = (tiers: Tiers, v: string) =>
    pick(cands(tiers, ["font-family", "font"], [[v, "font-family"]]), (c) => {
      const got = c.prop === "font" ? fontFromShorthand(c.value) : fontList(c.value);
      return got && !isDefault(c, got) ? got : undefined;
    }) ?? null;

  const panelLayer = layer(PANELS);
  const borderProps = ["border", "border-color", "border-top", "border-right", "border-bottom", "border-left",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color"];
  const noBorder = pick(cands(PANELS, ["border", "border-style", "border-width"]), (c) => {
    const toks = split(c.value.toLowerCase(), " ");
    if (toks.some((t) => t === "none" || t === "hidden") || (toks.length === 1 && px(toks[0]!, 1) === 0)) return true;
    return c.prop === "border" ? false : undefined;
  });
  const panelBorder = noBorder ? null : pick(cands(PANELS, borderProps, [["--ModuleBorderColor", "border-color"]]), (c) => {
    for (const t of split(c.value, " ")) {
      const got = color(t);
      if (got) return got[3] > 0.004 && !isDefault(c, hex(got)) ? hex(got) : undefined;
    }
    return undefined;
  }) ?? null;

  const theme: UberTheme = {
    background: under ? hex(under) : null,
    image: pic?.url ?? null,
    imageRepeat: pic?.repeat ?? null,
    imageSize: pic?.size ?? null,
    imagePosition: pic?.position ?? null,
    imageAttachment: pic?.attachment ?? null,
    content: content ? hex(content) : null,
    text: colourOf([[PANEL_BOX, 0], [PANEL, 1], [RECORD, 1], [BODY, 2], [HTML, 3], [AREAS, 3]], [["--DefaultTextColor", "color"]]),
    muted: colourOf([[MUTED, 0], [SMALL, 1]], [["--DefaultGreyColor", "color"], ["--ModuleDescriptionFontColor", "color"]]),
    link: colourOf([[LINK, 0], [LINK_IN, 1], [VISITED, 2]], [["--LinkColor", "color"]]),
    linkHover: colourOf([[HOVER, 0], [HOVER_IN, 1]], [["--LinkHoverColor", "color"]]),
    heading: colourOf(HEADINGS, [["--PageTitleColor", "color"]]),
    font: fontOf([[BODY, 0], [ANY, 0], [HTML, 1], [PANEL_BOX, 2], [PANEL, 2], [AREAS, 3]], "--DefaultTextFontFamily"),
    headingFont: fontOf(HEADINGS, "--ModuleTitleFontFamily"),
    panel: panelLayer.color ? hex(panelLayer.color) : panelLayer.url ? null : pick(cands(PANELS, ["background", "background-color"]), (c) => {
      // set, but to nothing: `background: 0` or `transparent` hides the boxes
      const got = c.prop === "background" ? bgOf(c.value)?.color : color(c.value) ?? undefined;
      return got ? hex(got) : undefined;
    }) ?? null,
    panelBorder,
    panelRadius: pick(cands(PANELS, ["border-radius"]), (c) => px(split(c.value, " ")[0] ?? "", 20)) ?? null,
  };
  return Object.values(theme).some((v) => v !== null) ? theme : null;
}

// ── tokens for the creator page ──

/** The theme the page is drawn in, as plain colours. uberVars() needs them to keep text readable; the caller can read
 *  them from the page (getComputedStyle) for a game theme. Without them it assumes the Default theme. */
export interface UberPalette { bg: string; surface: string; text: string; accent: string }

const PALETTES: Record<Scheme, UberPalette> = {
  dark: { bg: "#0c0e13", surface: "#13161d", text: "#eef0f5", accent: BRAND_ACCENT },
  light: { bg: "#f3f4f7", surface: "#ffffff", text: "#11141b", accent: "#5d4fd6" },
};

const h6 = (c: RGBA) => hex([c[0], c[1], c[2], 1]);
const contrast = (a: RGBA, b: RGBA) => contrastOf(h6(a), h6(b));
const isDark = (c: RGBA) => onColor(h6(c)) === "#ffffff";
/** Relative luminance, 0 to 1, to compare two colours (contrastOf gives the ratio; this gives the side). */
const lum = (c: RGBA) => contrast(c, BLACK) * 0.05 - 0.05;
const passes = (fg: RGBA, bgs: RGBA[], min: number) => bgs.every((b) => contrast(fg, b) >= min);

/** `c` moved toward white or black until it reads at `min` on every one of `bgs` (all on the same side). */
function fix(c: RGBA, bgs: RGBA[], min: number): RGBA {
  let x = c;
  for (let k = 0; k < 4 && !passes(x, bgs, min); k++) for (const b of bgs) x = color(readableOn(h6(x), h6(b), min))!;
  if (passes(x, bgs, min)) return x;
  return [WHITE, BLACK].sort((a, b) => Math.min(...bgs.map((g) => contrast(b, g))) - Math.min(...bgs.map((g) => contrast(a, g))))[0]!;
}

/** `c` mixed toward `toward` (which passes) just far enough to read at `min` on all of `bgs`. */
function settle(c: RGBA, toward: RGBA, bgs: RGBA[], min: number): RGBA {
  for (let i = 0; i <= 10; i++) {
    const x = mix(c, toward, i / 10);
    if (passes(x, bgs, min)) return x;
  }
  return toward;
}

/** The page over a picture veiled by `v` at alpha `a`, at its two extremes: a black picture and a white one. */
const veilEnds = (v: RGBA, a: number) => [flat(withAlpha(v, a), BLACK), flat(withAlpha(v, a), WHITE)];

/** A little over each minimum where the veil is concerned: it is written as 8-bit hex, which rounds. */
const VEIL_MARGIN = 0.03;

/** The least alpha, from `start` up, at which a veil of `v` keeps every colour in `needs` readable over any picture.
 *  Checked as written out (alpha in 255ths), so the result holds for the hex that reaches the page. */
function veilAlpha(v: RGBA, needs: Array<[RGBA, number]>, start: number): number {
  const c = color(h6(v))!;
  for (let a = clamp(start, 0, 1); ; a = Math.min(1, Math.round((a + 0.01) * 100) / 100)) {
    const q = Math.round(a * 255) / 255;
    if (a >= 1 || needs.every(([fg, min]) => passes(fg, veilEnds(c, q), min + VEIL_MARGIN))) return q;
  }
}

function withGeneric(list: string): string {
  return split(list, ",").some((n) => GENERIC.has(n)) ? list : `${list}, system-ui, sans-serif`;
}

function build(t: UberTheme, scheme: Scheme, given?: Partial<UberPalette>): { vars: Record<string, string>; scheme: Scheme } {
  const p = { ...PALETTES[scheme] };
  for (const k of Object.keys(p) as Array<keyof UberPalette>) {
    const c = given?.[k] ? color(given[k]!) : null;
    if (c) p[k] = h6(c);
  }
  const pBg = color(p.bg)!, pSurface = color(p.surface)!, pText = color(p.text)!, pAccent = color(p.accent)!;
  const C = (v: string | null) => (v ? color(v) : null);
  const vars: Record<string, string> = {};

  if (t.font) vars["--font"] = withGeneric(t.font);
  if (t.headingFont ?? t.font) vars["--font-display"] = withGeneric((t.headingFont ?? t.font)!);
  if (t.panelRadius !== null) {
    const r = t.panelRadius;
    Object.assign(vars, { "--radius": `${r}px`, "--radius-sm": `${Math.round(r * 0.7)}px`, "--radius-lg": `${Math.min(24, Math.round(r * 1.2))}px` });
  }

  const panel = C(t.panel);
  const pageSet = !!(t.background || t.image || t.content || (panel && panel[3] > 0.05));
  const link = C(t.link), linkHover = C(t.linkHover), heading = C(t.heading), muted = C(t.muted), text0 = C(t.text);

  if (!pageSet) {
    // only text colours: check them against the theme's own page and panels
    const bgs = [pBg, pSurface];
    if (text0) {
      const text = fix(flat(text0, pBg), bgs, 4.5);
      vars["--text"] = h6(text);
      vars["--text-2"] = h6(settle(mix(text, pBg, 0.25), text, bgs, 4.5));
      vars["--text-3"] = h6(settle(muted && contrast(muted, text) > 1.15 ? flat(muted, pBg) : mix(text, pBg, 0.42), text, bgs, 3));
    } else if (muted) vars["--text-3"] = h6(fix(flat(muted, pBg), bgs, 3));
    if (link) {
      const accent = flat(link, pBg), ink = fix(accent, bgs, 4.5);
      Object.assign(vars, { "--accent": h6(accent), "--on-accent": onColor(h6(accent)), "--accent-soft": hex(withAlpha(accent, 0.16)), "--accent-ink": h6(ink), "--ring": h6(ink) });
    }
    if (linkHover) vars["--uber-link-hover"] = h6(fix(flat(linkHover, pBg), bgs, 4.5));
    if (heading) vars["--uber-heading"] = h6(fix(flat(heading, pBg), [pBg], 3));
    return { vars, scheme };
  }

  // the page colour the text sits on, opaque: the content colour over the page colour over the theme's. With a
  // picture it becomes a veil over the picture, made just opaque enough that text reads whatever the picture holds.
  // The picture's own colours are never guessed: with no colour of the member's, the theme's --bg is the veil.
  const behind = C(t.background) ? flat(C(t.background)!, pBg) : null;
  let content = C(t.content);
  if (content && content[3] < 0.004) content = null;
  const pic = t.image && !(content && content[3] >= 0.98) ? t.image : null;
  const start = content ? content[3] : 0;
  let base: RGBA = content ? flat(content, behind ?? pBg) : behind ?? pBg;
  // which way the page moves to make room for a colour: away from it, darker for light text, lighter for dark
  const awayFrom = (fg: RGBA) => (lum(fg) > lum(base) ? BLACK : WHITE);
  if (pic && text0 && (behind || content) && start < 0.5) {
    // their page colour mostly hides behind the picture, so it gives way to the text they picked: skyblue behind a
    // wallpaper with white text turns a deeper blue rather than the text turning grey. Dark red text on black
    // can't be helped this way and gets lighter below. (With room for panels, a step toward the text.)
    const fg = withAlpha(text0, 1), away = awayFrom(fg), from = base;
    for (let i = 1; i <= 10 && contrast(fg, mix(base, fg, 0.1)) < 4.5; i++) base = mix(from, away, i / 10);
  }
  // a mid-tone page reads dark when their text is the lighter of the two
  const dark = text0 ? lum(withAlpha(text0, 1)) > lum(base) : isDark(base);

  let text = text0 ? flat(text0, base) : isDark(pBg) === dark ? pText : color(PALETTES[dark ? "dark" : "light"].text)!;
  text = fix(text, [base], 4.5);
  // a veil leaves at least a quarter of the picture showing, or as much as their own veil did
  const most = Math.max(start, 0.75);
  if (pic) {
    // a mid-tone veil would have to hide the picture to keep text readable on it, so it deepens away from the text
    const away = awayFrom(text), from = base;
    for (let i = 0; i <= 10; i++) {
      base = mix(from, away, i / 10);
      if (veilAlpha(base, [[text, 4.5]], start) <= most) break;
    }
  }
  const accent = link ? flat(link, base) : null;
  let ink = fix(accent ?? pAccent, [base], 4.5);
  let hover = linkHover ? fix(flat(linkHover, base), [base], 4.5) : null;
  let head = heading ? fix(flat(heading, base), [base], 3) : null;
  if (pic) {
    // colours that would still need a thicker veil move toward white (or black) instead
    const ends = veilEnds(base, most);
    const lift = (c: RGBA, min: number) => settle(c, lum(c) > lum(base) ? WHITE : BLACK, ends, min + VEIL_MARGIN);
    text = lift(text, 4.5);
    ink = lift(ink, 4.5);
    if (hover) hover = lift(hover, 4.5);
    if (head) head = lift(head, 3);
  }

  // panels: theirs, or a step up from the page; pulled toward the page until text and links read on them
  const surface0 = panel && panel[3] > 0.05 ? flat(panel, base) : dark ? mix(base, text, 0.045) : mix(base, WHITE, 0.75);
  const okOn = (s: RGBA) => passes(text, [s, mix(s, text, 0.05)], 4.5) && passes(ink, [s], 4.5) && (!hover || passes(hover, [s], 4.5));
  let surface = surface0;
  for (let i = 1; i <= 10 && !okOn(surface); i++) surface = mix(surface0, base, i / 10);
  const surface2 = mix(surface, text, 0.05);
  text = fix(text, [base, surface, surface2], 4.5);
  ink = fix(ink, [base, surface], 4.5);
  if (hover) hover = fix(hover, [base, surface], 4.5);

  // the veil: from their own alpha up, until text, links and headings read over a white or a black picture
  let pageBgs = [base];
  let veil = "";
  if (pic) {
    const needs: Array<[RGBA, number]> = [[text, 4.5], [ink, 4.5], ...(hover ? [[hover, 4.5]] as Array<[RGBA, number]> : []), ...(head ? [[head, 3]] as Array<[RGBA, number]> : [])];
    const a = veilAlpha(base, needs, start);
    pageBgs = veilEnds(base, a);
    veil = hex(withAlpha(base, a));
  }

  const onPage = [...pageBgs, surface];
  const text2 = settle(mix(text, base, 0.25), text, onPage, 4.5);
  const text3 = settle(muted && contrast(muted, text) > 1.15 ? flat(muted, base) : mix(text, base, 0.42), text, onPage, 3);
  const border = C(t.panelBorder);
  const line = border && border[3] > 0.05 ? flat(border, surface) : mix(surface, text, 0.1);

  Object.assign(vars, {
    "--bg": h6(base),
    "--bg-2": h6(dark ? mix(base, BLACK, 0.3) : mix(base, text, 0.04)),
    "--surface": h6(surface),
    "--surface-2": h6(surface2),
    "--surface-3": h6(mix(surface, text, 0.09)),
    "--raised": h6(mix(surface, text, 0.11)),
    "--line": h6(line),
    "--line-2": h6(mix(line, text, 0.15)),
    "--line-3": h6(fix(mix(surface, text, 0.45), [surface], 3)),
    "--text": h6(text),
    "--text-2": h6(text2),
    "--text-3": h6(text3),
    "--accent-ink": h6(ink),
    "--ring": h6(ink),
    "--hover": hex(withAlpha(text, 0.06)),
    "--img-bg": h6(surface2),
    "--tex": "none",
  });
  if (accent) Object.assign(vars, { "--accent": h6(accent), "--on-accent": onColor(h6(accent)), "--accent-soft": hex(withAlpha(accent, 0.16)) });
  if (hover) vars["--uber-link-hover"] = h6(hover);
  if (head) vars["--uber-heading"] = h6(head);
  vars["--uber-bg"] = pic
    ? `linear-gradient(${veil}, ${veil}), url("${pic}") ${t.imagePosition ?? "0% 0%"} / ${t.imageSize ?? "auto"} ${t.imageRepeat ?? "repeat"} ${t.imageAttachment ?? "scroll"}, ${h6(behind ?? base)}`
    : h6(base);
  return { vars, scheme: dark ? "dark" : "light" };
}

/** Custom properties to set as the inline style of `.gb-creator`, so the page wears the member's colours, fonts and
 *  picture through gachamod's own tokens. Every pairing stays readable: text and links 4.5:1 on the page and on
 *  panels, headings and faint text 3:1. `scheme` and `palette` describe the theme around the page; colours the
 *  member didn't set come from there. A page background goes in --uber-bg (see screens/browse/uberstyle.css). */
export function uberVars(theme: UberTheme, scheme: Scheme, palette?: Partial<UberPalette>): Record<string, string> {
  return build(theme, scheme, palette).vars;
}

/** Whether the page reads as dark or light once uberVars() is applied: a member's white page flips a dark theme.
 *  Set it as the page's color-scheme so scroll bars and form controls match. */
export function uberScheme(theme: UberTheme, scheme: Scheme, palette?: Partial<UberPalette>): Scheme {
  return build(theme, scheme, palette).scheme;
}
