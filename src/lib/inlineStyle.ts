// The safe part of a style="..." attribute in GameBanana HTML. Members with the Inline Styles unlock can write these
// in descriptions and posts. Nothing the author wrote is copied through: each kept property becomes one of the
// classes below, or a class plus a --gb* custom property built here from checked numbers, keywords and colours.
// src/screens/browse/gb-inline.css turns them into CSS that reads in every theme. Text colour is left to sanitizeHtml,
// which keeps it as class gb-fc with --gbc.
//
//   text-align        gb-left, gb-center, gb-right, gb-justify (block tags only)
//   font-weight       gb-bold, gb-regular
//   font-style        gb-italic, gb-upright
//   text-decoration   gb-under, gb-strike
//   text-transform    gb-upper, gb-lower, gb-caps
//   font-size         gb-size with --gbfs, .8em to 2em
//   font-family       gb-font with --gbff: GameBanana's font list, else a generic serif or cursive; gb-mono (the
//                     app's code font) for monospace
//   background        gb-bg with --gbbg, a plain colour only (no images or gradients)
//   border            gb-border with --gbbw (up to 4px) and --gbbs; gb-bc with --gbbc for its colour
//   border-radius     gb-round (the app's own radius)
//   padding           gb-pad with --gbp, up to 1.5em, only next to a background or border. Alone it was spacing
//                     around a background image, which is dropped.
//   width             gb-width with --gbw, images only (5% to 100%, or 16px to 2000px)
//
// Everything else is dropped: position, float, display, margins, heights, line-height, shadows, transforms, url(),
// var(), calc() and any declaration with a backslash escape or comment.

export interface InlineStyle {
  /** Class names from the fixed set above. */
  classes: string[];
  /** "--gbfs: 1.25em; --gbff: Georgia, serif", or "" when nothing was kept. */
  style: string;
}

/** Tags where text-align means something. */
const BLOCK = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "td", "th", "tr", "table", "blockquote", "caption", "pre", "center"]);
const ALIGN: Record<string, string> = { left: "gb-left", start: "gb-left", center: "gb-center", right: "gb-right", end: "gb-right", justify: "gb-justify" };
const TRANSFORM: Record<string, string> = { uppercase: "gb-upper", lowercase: "gb-lower", capitalize: "gb-caps" };
/** CSS size keywords in em. */
const SIZE_WORDS: Record<string, number> = { "xx-small": .5625, "x-small": .625, small: .8125, medium: 1, large: 1.125, "x-large": 1.5, "xx-large": 2, "xxx-large": 3, smaller: .83, larger: 1.2 };
/** <font size="1"> to "7". */
const FONT_TAG_SIZES = ["x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large"];
const MIN_EM = .8, MAX_EM = 2, MAX_PAD_EM = 1.5, MAX_BORDER_PX = 4;

/** GameBanana's editor fonts, each with fallbacks for machines that lack it. */
const PALATINO = "'Palatino Linotype', 'Book Antiqua', Palatino, serif";
const FONTS: Record<string, string> = {
  "arial": "Arial, Helvetica, sans-serif",
  "arial black": "'Arial Black', Gadget, sans-serif",
  "comic sans ms": "'Comic Sans MS', 'Comic Sans', cursive",
  "courier new": "'Courier New', Courier, monospace",
  "georgia": "Georgia, serif",
  "impact": "Impact, Haettenschweiler, sans-serif",
  "lucida console": "'Lucida Console', Monaco, monospace",
  "lucida sans unicode": "'Lucida Sans Unicode', 'Lucida Grande', sans-serif",
  "palatino linotype": PALATINO,
  "book antiqua": PALATINO,
  "tahoma": "Tahoma, Geneva, sans-serif",
  "times new roman": "'Times New Roman', Times, serif",
  "trebuchet ms": "'Trebuchet MS', Helvetica, sans-serif",
  "verdana": "Verdana, Geneva, sans-serif",
  "ms sans serif": "'MS Sans Serif', Geneva, sans-serif",
  "ms serif": "'MS Serif', 'New York', serif",
};
/** Generic families worth keeping. sans-serif is left out on purpose: the app's own font already is one. */
const GENERIC = new Set(["monospace", "serif", "cursive"]);
const BORDER_STYLES: Record<string, string> = { solid: "solid", dashed: "dashed", dotted: "dotted", double: "double", groove: "solid", ridge: "solid", inset: "solid", outset: "solid", none: "none", hidden: "none" };
const NOT_COLORS = new Set(["inherit", "initial", "unset", "revert", "currentcolor", "transparent", "none", "auto", "normal"]);

/** The declarations in order, names and values lowercased. A declaration with an escape or a comment is skipped,
 *  since it could read differently to the browser than to this parser. */
function declarations(style: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const part of style.slice(0, 4000).split(";")) {
    const i = part.indexOf(":");
    if (i < 1) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).replace(/\s*!\s*important\s*$/i, "").trim().toLowerCase();
    if (!/^[a-z-]{1,40}$/.test(prop) || !value || value.length > 300) continue;
    if (/[\\{}<>@]|\/\*|\*\//.test(value)) continue;
    out.push([prop, value]);
  }
  return out;
}

const round = (n: number) => String(Math.round(n * 100) / 100);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A length in em at 16px to the em. Percent only when `pct` gives what 100% is; a bare number only when it's 0. */
function toEm(v: string, pct?: number): number | null {
  const m = /^(-?(?:\d{1,6}(?:\.\d{1,6})?|\.\d{1,6}))(px|pt|em|rem|%)?$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case "px": return n / 16;
    case "pt": return n / 12;
    case "em": case "rem": return n;
    case "%": return pct === undefined ? null : n / 100 * pct;
    default: return n === 0 ? 0 : null;
  }
}

/** A colour in a shape that can't carry anything else: #hex, rgb()/hsl() numbers, or a colour word. Fully
 *  transparent colours count as none. */
export function cssColor(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) {
    const alpha = v.length === 5 ? v.slice(4) : v.length === 9 ? v.slice(7) : null;
    return alpha && /^0+$/.test(alpha) ? null : v;
  }
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(v);
  if (fn) {
    const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4 || !parts.every((p) => /^[+-]?(?:\d{1,5}(?:\.\d{1,6})?|\.\d{1,6})(?:%|deg)?$/.test(p))) return null;
    const alpha = parts[3];
    if (alpha !== undefined && parseFloat(alpha) === 0) return null;
    return `${fn[1]}(${parts.slice(0, 3).join(" ")}${alpha !== undefined ? ` / ${alpha}` : ""})`;
  }
  if (/^[a-z]{3,20}$/.test(v) && !NOT_COLORS.has(v)) return v;
  return null;
}

const TOKEN = /[a-z-]+\([^()]*\)|[^\s()]+/g;
/** Splits a shorthand value at spaces outside parentheses: "1px solid rgb(1, 2, 3)" is three tokens. A value with a
 *  stray bracket gives none. */
function tokens(v: string): string[] {
  return v.replace(TOKEN, "").trim() ? [] : v.match(TOKEN) ?? [];
}

function fontFamily(v: string): string | null {
  const names = v.split(",").map((s) => s.trim().replace(/^(["'])(.*)\1$/, "$2").trim().replace(/\s+/g, " "));
  const first = names[0];
  if (first && FONTS[first]) return FONTS[first]!;
  return names.find((n) => GENERIC.has(n)) ?? null;
}

function fontSize(v: string): number | null {
  const n = SIZE_WORDS[v] ?? toEm(v, 1);
  return n === null || n < 0 ? null : clamp(n, MIN_EM, MAX_EM);
}

function borderWidth(t: string): number | null {
  if (t === "thin") return 1;
  if (t === "medium") return 3;
  if (t === "thick") return MAX_BORDER_PX;
  const em = toEm(t);
  return em === null || em < 0 ? null : Math.min(MAX_BORDER_PX, Math.round(em * 16));
}

/** "10px 22px" as four sides in em (top, right, bottom, left), or null when any part isn't a plain length. */
function sides(v: string, read: (t: string) => number | null): number[] | null {
  const ts = tokens(v);
  if (ts.length < 1 || ts.length > 4) return null;
  const n = ts.map(read);
  if (n.some((x) => x === null)) return null;
  const [a, b = a, c = a, d = b] = n as number[];
  return [a!, b!, c!, d!];
}

const SIDE: Record<string, number> = { top: 0, right: 1, bottom: 2, left: 3 };
/** Four sides as CSS, written short when they pair up ("1px", "1px 2px"). */
function four([a, b, c, d]: string[]): string {
  if (a === b && b === c && c === d) return a!;
  return a === c && b === d ? `${a} ${b}` : `${a} ${b} ${c} ${d}`;
}

/** Classes and custom properties for the safe part of `style` on an element of `tag` (lowercase tag name after
 *  sanitizeHtml renames it, so "span" for <font>). */
export function inlineStyle(style: string | null, tag: string): InlineStyle {
  if (!style) return { classes: [], style: "" };
  const t = tag.toLowerCase();
  let align: string | undefined, weight: string | undefined, italic: string | undefined, transform: string | undefined;
  let deco: string[] | undefined, size: number | undefined, font: string | undefined, bg: string | undefined, width: string | undefined;
  let rounded = false, pad: number[] | undefined;
  const bw = [3, 3, 3, 3], bs = ["none", "none", "none", "none"];
  let bc: string | undefined;

  const border = (v: string, which: number[]) => {
    let w: number | undefined, s: string | undefined, c: string | undefined;
    for (const tok of tokens(v)) {
      const bwid = borderWidth(tok);
      if (bwid !== null) { w = bwid; continue; }
      if (BORDER_STYLES[tok]) { s = BORDER_STYLES[tok]; continue; }
      const col = cssColor(tok);
      if (col) { c = col; continue; }
      if (tok === "currentcolor" || tok === "transparent") continue;
      return; // something else: the browser would drop the whole declaration
    }
    for (const i of which) { bw[i] = w ?? 3; bs[i] = s ?? "none"; }
    bc = c;
  };

  for (const [prop, v] of declarations(style)) {
    switch (prop) {
      case "text-align":
        if (BLOCK.has(t) && ALIGN[v]) align = ALIGN[v];
        break;
      case "font-weight":
        if (v === "bold" || v === "bolder" || (/^\d{3}$/.test(v) && Number(v) >= 600)) weight = "gb-bold";
        else if (v === "normal" || v === "lighter" || (/^\d{3}$/.test(v) && Number(v) <= 400)) weight = "gb-regular";
        break;
      case "font-style":
        if (/^(italic|oblique)\b/.test(v)) italic = "gb-italic";
        else if (v === "normal") italic = "gb-upright";
        break;
      case "text-decoration":
      case "text-decoration-line": {
        const ts = tokens(v);
        deco = [...(ts.includes("underline") ? ["gb-under"] : []), ...(ts.includes("line-through") ? ["gb-strike"] : [])];
        break;
      }
      case "text-transform":
        transform = TRANSFORM[v] ?? (v === "none" ? undefined : transform);
        break;
      case "font-size": {
        const n = fontSize(v);
        if (n !== null) size = n;
        break;
      }
      case "font-family":
        font = fontFamily(v) ?? undefined;
        break;
      case "background":
      case "background-color": {
        const ts = tokens(v);
        const col = ts.length === 1 ? cssColor(ts[0]!) : null;
        if (col) bg = col;
        else if (ts.length === 1 && (v === "none" || v === "transparent")) bg = undefined;
        break;
      }
      case "border":
        border(v, [0, 1, 2, 3]);
        break;
      case "border-top": case "border-right": case "border-bottom": case "border-left":
        border(v, [SIDE[prop.slice(7)]!]);
        break;
      case "border-width": {
        const s = sides(v, borderWidth);
        if (s) s.forEach((x, i) => { bw[i] = x; });
        break;
      }
      case "border-style": {
        const ts = tokens(v);
        if (ts.length >= 1 && ts.length <= 4 && ts.every((x) => BORDER_STYLES[x])) {
          const [a, b = a, c = a, d = b] = ts.map((x) => BORDER_STYLES[x]!);
          [a, b, c, d].forEach((x, i) => { bs[i] = x!; });
        }
        break;
      }
      case "border-color": {
        const col = cssColor(v);
        if (col) bc = col;
        break;
      }
      case "border-radius": {
        const first = toEm(tokens(v)[0] ?? "", 1);
        if (first !== null) rounded = first > 0;
        break;
      }
      case "padding": {
        const s = sides(v, (x) => { const n = toEm(x); return n === null || n < 0 ? null : n; });
        if (s) pad = s;
        break;
      }
      case "padding-top": case "padding-right": case "padding-bottom": case "padding-left": {
        const n = toEm(v);
        if (n !== null && n >= 0) { pad = pad ? [...pad] : [0, 0, 0, 0]; pad[SIDE[prop.slice(8)]!] = n; }
        break;
      }
      case "width": {
        if (t !== "img") break;
        const pct = /^(\d{1,3}(?:\.\d{1,3})?)%$/.exec(v);
        if (pct) { width = `${round(clamp(Number(pct[1]), 5, 100))}%`; break; }
        const em = toEm(v);
        if (em !== null && em > 0) width = `${Math.round(clamp(em * 16, 16, 2000))}px`;
        break;
      }
    }
  }

  const classes: string[] = [];
  const vars: string[] = [];
  if (align) classes.push(align);
  if (weight) classes.push(weight);
  if (italic) classes.push(italic);
  if (deco) classes.push(...deco);
  if (transform) classes.push(transform);
  if (size !== undefined && Math.abs(size - 1) >= .03) { classes.push("gb-size"); vars.push(`--gbfs: ${round(size)}em`); }
  if (font === "monospace") classes.push("gb-mono");
  else if (font) { classes.push("gb-font"); vars.push(`--gbff: ${font}`); }
  if (bg) { classes.push("gb-bg"); vars.push(`--gbbg: ${bg}`); }
  const on = bw.map((w, i) => w > 0 && bs[i] !== "none");
  const hasBorder = on.some(Boolean);
  if (hasBorder) {
    classes.push("gb-border");
    vars.push(`--gbbw: ${four(bw.map((w, i) => on[i] ? `${w}px` : "0"))}`, `--gbbs: ${four(bs.map((s, i) => on[i] ? s : "none"))}`);
    if (bc) { classes.push("gb-bc"); vars.push(`--gbbc: ${bc}`); }
  }
  if (rounded && (bg || hasBorder)) classes.push("gb-round");
  if (pad && (bg || hasBorder) && pad.some((p) => p > 0)) {
    classes.push("gb-pad");
    vars.push(`--gbp: ${four(pad.map((p) => p > 0 ? `${round(Math.min(p, MAX_PAD_EM))}em` : "0"))}`);
  }
  if (width) { classes.push("gb-width"); vars.push(`--gbw: ${width}`); }
  return { classes, style: vars.join("; ") };
}

/** CSS for the old presentational attributes GameBanana descriptions still use, to put in front of the element's own
 *  style before calling inlineStyle (the style attribute wins, as in a browser). `tag` is the tag as written, so
 *  "font" for <font>.
 *  - <img width="30%"> or width="256": authors size pictures this way to put several in a row
 *  - <font size="1"> to "7" (or "+2") and <font face>
 *  - align on block tags (left, right, justify; sanitizeHtml already handles center) */
export function attrStyle(tag: string, attr: (name: string) => string | null): string {
  const t = tag.toLowerCase();
  const out: string[] = [];
  const width = attr("width")?.trim();
  if (width && t === "img") {
    if (/^\d{1,4}$/.test(width)) out.push(`width: ${width}px`);
    else if (/^\d{1,3}(?:\.\d{1,3})?%$/.test(width)) out.push(`width: ${width}`);
  }
  if (t === "font") {
    const m = /^([+-]?)([1-7])$/.exec(attr("size")?.trim() ?? "");
    if (m) {
      const n = Number(m[2]);
      const at = m[1] === "+" ? 3 + n : m[1] === "-" ? 3 - n : n;
      out.push(`font-size: ${FONT_TAG_SIZES[clamp(at, 1, 7) - 1]}`);
    }
    const face = attr("face")?.replace(/[;:]/g, " ").trim();
    if (face) out.push(`font-family: ${face}`);
  }
  const align = attr("align")?.trim().toLowerCase();
  if (align && t !== "table" && BLOCK.has(t) && ALIGN[align]) out.push(`text-align: ${align}`);
  return out.join("; ");
}
