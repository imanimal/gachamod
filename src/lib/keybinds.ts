// Keys a mod's GameBanana description lists ("F6: toggle jacket", "Numpad 1 / 2 - cycle hair"). Read from the
// description HTML so the drawer can show them in a Keys tab above the description, with a jump to the list in the
// description itself. The formats and traps are in docs/keybind-formats.md; the cases it must get right are in
// keybinds.fixtures.ts. Owner: KEYBINDS area.
//
// How it reads a description:
//   1. The HTML becomes lines (br, p, li, headings, table rows ...), keeping which characters are bold, the heading
//      level and where each line starts in the HTML (for the jump).
//   2. Each line is matched against the shapes authors use: key first ("H - jacket"), action first ("Jacket: H"),
//      "Action (Alt + 1)", "Press H to ...", "Hold Ctrl and press ...", "... with P", "Toggle key is H", tables,
//      and the Chinese, Japanese, Korean, Russian, Spanish, German and French forms.
//   3. A key is parsed as an expression: modifiers, then one base (letter, digit, symbol, F key, numpad, arrow,
//      named key, mouse, controller, VK_ name), with alternatives ("Z / X", "H or /") and ranges ("1-5").
//   4. Weak keys (a lone letter, digit or symbol) count only in a run of two or more key lines, under a keys heading,
//      or next to a control verb ("toggle", "hide", "切换" ...). That rule keeps out ":D", "Q: ..." and
//      "Press F to pay respects".
import { pref } from "./prefs";

export interface DescKey {
  /** Readable keys ("F6", "Ctrl+Alt+1", "Num 1 / Num 2", "Pad LB+RB+B"). */
  keys: string;
  /** What it does, as the author wrote it, trimmed ("Toggle jacket"). May be "" when the author only listed keys. */
  action: string;
}

export interface DescKeys {
  keys: DescKey[];
  /** The description HTML with an id ("gm-keys-1" ...) added where each list starts, for the jump. */
  html: string;
  /** The id of the first list, when keys were found. */
  anchor: string | null;
}

/** New installs get "keys only while the character is on screen" (Settings > Automatic). Off unless turned on. */
export const onScreenOnInstallPref = pref<boolean>("keys.onScreenOnInstall", false,
  (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

/** Find the keybinds in a description. Never throws; no keys found gives an empty list and the HTML unchanged. */
export function detectKeybinds(html: string): DescKeys {
  if (!html) return { keys: [], html, anchor: null };
  try {
    return detect(html);
  } catch {
    return { keys: [], html, anchor: null };
  }
}

// ── 1. lines ──

/** Stands for a wide space (two or more non-breaking spaces) that separates a key from its action. */
const GAP = "\u0007";

interface Line {
  text: string;
  bold: boolean[];
  /** Table cells, for a table row. */
  cells: string[] | null;
  heading: number;
  details: boolean;
  img: boolean;
  /** Where the line's content starts in the HTML. */
  offset: number;
}

const BLOCK = new Set(["br", "p", "div", "li", "ul", "ol", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "blockquote",
  "details", "summary", "pre", "table", "thead", "tbody", "tfoot", "center", "dl", "dt", "dd", "section", "article",
  "header", "footer", "figure", "figcaption", "caption"]);
const ROW_KEEP = new Set(["tr", "table", "thead", "tbody", "tfoot"]);
const ENTITIES: Record<string, string> = {
  nbsp: "\u00a0", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", larr: "←", rarr: "→", uarr: "↑", darr: "↓",
  hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", middot: "·", bull: "•", times: "×", ensp: " ", emsp: " ",
  thinsp: " ", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", star: "☆", hearts: "♥",
};
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;

function decode(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Fullwidth digits, letters and key punctuation to ASCII, arrow emoji to arrows, invisible marks out. Fullwidth
 *  brackets and commas stay: they belong to the author's text. */
function normChars(s: string): string {
  return s
    .replace(/[\uFE0F\u200B-\u200D\uFEFF]/g, "")
    .replace(/[⬆]/g, "↑").replace(/[⬇]/g, "↓").replace(/[⬅]/g, "←").replace(/[➡]/g, "→")
    .replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A\uFF0B\uFF1A\uFF1D\uFF0F\uFF5E\uFF1C\uFF1E\uFF3B\uFF3D\uFF0A\uFF0D]/g,
      (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u301C/g, "~")
    .replace(/\u3000/g, " ");
}

type Chars = Array<[string, boolean]>;

/** Collapse whitespace (a run with two or more non-breaking spaces becomes GAP) and trim, keeping the bold mask. */
function collapse(chars: Chars): { text: string; bold: boolean[] } {
  let text = "";
  const bold: boolean[] = [];
  for (let i = 0; i < chars.length;) {
    const [c, b] = chars[i]!;
    if (/[\s\u00a0]/.test(c)) {
      let j = i, nb = 0;
      while (j < chars.length && /[\s\u00a0]/.test(chars[j]![0])) { if (chars[j]![0] === "\u00a0") nb++; j++; }
      if (text && j < chars.length) { text += nb >= 2 ? GAP : " "; bold.push(b && chars[j]![1]); }
      i = j;
      continue;
    }
    text += c;
    bold.push(b);
    i++;
  }
  return { text, bold };
}

function toLines(html: string): Line[] {
  const lines: Line[] = [];
  let chars: Chars = [];
  let row: Chars[] | null = null;
  let cell: Chars | null = null;
  let bold = 0, details = 0, skip = 0, pre = 0;
  const heads: number[] = [];
  let pending = 0, offset = -1, lineHead = 0, lineDetails = false;

  const flush = () => {
    if (row) return;
    const { text, bold: mask } = collapse(chars);
    if (text) lines.push({ text, bold: mask, cells: null, heading: lineHead, details: lineDetails, img: false, offset: offset >= 0 ? offset : pending });
    chars = [];
    offset = -1;
  };
  const endRow = () => {
    if (!row) return;
    const cells = row.map((c) => collapse(c).text.replace(new RegExp(GAP, "g"), " ").trim());
    const shown = cells.filter(Boolean);
    if (shown.length) {
      const text = shown.join(" | ");
      lines.push({ text, bold: new Array<boolean>(text.length).fill(false), cells: shown, heading: 0, details: lineDetails, img: false, offset: offset >= 0 ? offset : pending });
    }
    row = null;
    cell = null;
    chars = [];
    offset = -1;
  };
  const addText = (raw: string, at: number) => {
    if (skip) return;
    const t = normChars(decode(raw));
    if (pre && t.includes("\n")) {
      const parts = t.split("\n");
      parts.forEach((p, k) => { if (k > 0) { flush(); pending = at; } addText2(p); });
      return;
    }
    addText2(t);
  };
  const addText2 = (t: string) => {
    const target = row ? cell : chars;
    if (!target) return;
    if (offset < 0 && /\S/.test(t.replace(/\u00a0/g, " "))) {
      offset = pending;
      lineHead = heads[heads.length - 1] ?? 0;
      lineDetails = details > 0;
    }
    for (const c of t) target.push([c === "\t" || c === "\r" || c === "\n" ? " " : c, bold > 0]);
  };

  let last = 0;
  TAG.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = TAG.exec(html));) {
    if (m.index > last) addText(html.slice(last, m.index), m.index);
    last = TAG.lastIndex;
    const name = (m[2] ?? "").toLowerCase();
    if (!name) continue; // a comment
    const close = m[1] === "/";
    const end = TAG.lastIndex;
    if (name === "script" || name === "style") { skip = Math.max(0, skip + (close ? -1 : 1)); continue; }
    if (name === "b" || name === "strong") { bold = Math.max(0, bold + (close ? -1 : 1)); continue; }
    if (name === "img" || name === "iframe" || name === "video") {
      if (row) continue;
      flush();
      lines.push({ text: "", bold: [], cells: null, heading: 0, details: details > 0, img: true, offset: m.index });
      pending = end;
      continue;
    }
    if (name === "td" || name === "th") {
      if (!row) continue;
      if (!close) { cell = []; row.push(cell); if (offset < 0) pending = end; } else cell = null;
      continue;
    }
    if (!BLOCK.has(name)) continue;
    if (row && !ROW_KEEP.has(name)) { if (cell) cell.push([" ", false]); continue; }
    if (name === "tr") {
      if (close) { endRow(); pending = end; continue; }
      endRow();
      flush();
      row = [];
      cell = null;
      offset = -1;
      pending = end;
      lineDetails = details > 0;
      continue;
    }
    if (row) endRow();
    flush();
    pending = end;
    if (/^h[1-6]$/.test(name)) { if (close) heads.pop(); else heads.push(Number(name[1])); }
    else if (name === "details") details = Math.max(0, details + (close ? -1 : 1));
    else if (name === "pre") pre = Math.max(0, pre + (close ? -1 : 1));
  }
  if (last < html.length) addText(html.slice(last), html.length);
  endRow();
  flush();
  return lines;
}

// ── 2. key expressions ──

type Kind = "letter" | "digit" | "symbol" | "range" | "fkey" | "num" | "arrow" | "dir" | "arrows" | "named" | "mouse" | "pad" | "mod";

interface Alt {
  mods: string[];
  base: string;
  kind: Kind;
  /** 0 weak (a lone letter, digit or symbol), 1 a word key (Space, Alt alone, "Up" alone), 2 strong. */
  lvl: number;
  /** For direction words and side mouse buttons: Left, Right, Up, Down, Middle. */
  side?: string;
  parts?: string[];
}

interface Expr {
  alts: Alt[];
  end: number;
  /** The whole key sat in quotes or brackets. */
  delimited: boolean;
  lvl: number;
}

const R = (src: string) => new RegExp(src, "iy");
function at(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}
const after = (m: RegExpExecArray) => m.index + m[0].length;
const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1).toLowerCase();

const GLYPH: Record<string, string> = { "↑": "Up", "↓": "Down", "←": "Left", "→": "Right" };
const QUOTES: Record<string, string> = { '"': '"', "“": "”", "”": "”", "'": "'", "‘": "’", "’": "’", "「": "」", "『": "』", "«": "»" };
const BRACKETS: Record<string, string> = { "[": "]", "(": ")", "【": "】", "（": "）", "{": "}" };
const MOD_NAME: Record<string, string> = { ctrl: "Ctrl", control: "Ctrl", ctl: "Ctrl", strg: "Ctrl", alt: "Alt", shift: "Shift" };
const MOD_ORDER = ["Ctrl", "Alt", "Shift"];
const NAMED: Array<[RegExp, string]> = [
  [/^space/i, "Space"], [/^tab/i, "Tab"], [/^(enter|return)/i, "Enter"], [/^esc/i, "Esc"], [/^backspace/i, "Backspace"],
  [/^del/i, "Delete"], [/^ins/i, "Insert"], [/^home/i, "Home"], [/^end/i, "End"], [/^(page\s*up|pg\s*up|pgup)/i, "PgUp"],
  [/^(page|pg)/i, "PgDn"], [/^caps/i, "Caps Lock"], [/^(print|prt)/i, "PrtSc"], [/^pause/i, "Pause"], [/^scroll/i, "Scroll Lock"],
];
const PUNCT_NAME: Record<string, string> = {
  minus: "-", hyphen: "-", dash: "-", comma: ",", period: ".", "full stop": ".", dot: ".", slash: "/", "forward slash": "/",
  "back slash": "\\", backslash: "\\", apostrophe: "'", quote: "'", equal: "=", equals: "=", plus: "+", semicolon: ";",
  tilde: "~", grave: "`", backtick: "`",
};
const NUM_WORD: Record<string, string> = { star: "*", asterisk: "*", plus: "+", minus: "-", slash: "/", period: ".", dot: ".", decimal: ".", enter: "Enter", del: "." };
const VK: Record<string, [Kind, string]> = {
  LEFT: ["arrow", "Left"], RIGHT: ["arrow", "Right"], UP: ["arrow", "Up"], DOWN: ["arrow", "Down"],
  MULTIPLY: ["num", "Num *"], ADD: ["num", "Num +"], SUBTRACT: ["num", "Num -"], DIVIDE: ["num", "Num /"], DECIMAL: ["num", "Num ."],
  SPACE: ["named", "Space"], RETURN: ["named", "Enter"], ESCAPE: ["named", "Esc"], TAB: ["named", "Tab"], BACK: ["named", "Backspace"],
  DELETE: ["named", "Delete"], INSERT: ["named", "Insert"], HOME: ["named", "Home"], END: ["named", "End"], PRIOR: ["named", "PgUp"],
  NEXT: ["named", "PgDn"], CAPITAL: ["named", "Caps Lock"], OEM_COMMA: ["symbol", ","], OEM_PERIOD: ["symbol", "."],
  OEM_MINUS: ["symbol", "-"], OEM_PLUS: ["symbol", "="], OEM_1: ["symbol", ";"], OEM_2: ["symbol", "/"], OEM_3: ["symbol", "`"],
  OEM_4: ["symbol", "["], OEM_5: ["symbol", "\\"], OEM_6: ["symbol", "]"], OEM_7: ["symbol", "'"], LBUTTON: ["mouse", "LMB"],
  RBUTTON: ["mouse", "RMB"], MBUTTON: ["mouse", "MMB"], CONTROL: ["mod", "Ctrl"], LCONTROL: ["mod", "Ctrl"], RCONTROL: ["mod", "Ctrl"],
  MENU: ["mod", "Alt"], LMENU: ["mod", "Alt"], RMENU: ["mod", "Alt"], SHIFT: ["mod", "Shift"], LSHIFT: ["mod", "Shift"], RSHIFT: ["mod", "Shift"],
};
const XB: Record<string, string> = {
  LEFT_TRIGGER: "LT", RIGHT_TRIGGER: "RT", LEFT_SHOULDER: "LB", RIGHT_SHOULDER: "RB", LEFT_THUMB: "LS", RIGHT_THUMB: "RS",
  A: "A", B: "B", X: "X", Y: "Y", START: "Start", BACK: "Back", DPAD_UP: "D-pad Up", DPAD_DOWN: "D-pad Down", DPAD_LEFT: "D-pad Left", DPAD_RIGHT: "D-pad Right",
};
const PAD_ABBR: Record<string, string> = { L1: "LB", R1: "RB", L2: "LT", R2: "RT" };

const RX = {
  vk: R("vk_([a-z0-9_]+)"),
  xb: R("xb_([a-z_]+)"),
  padPre: R("(?:xbox|gamepad|controller|pad)\\s+"),
  dpad: R("d-?pad\\s*(up|down|left|right)(?![a-z])"),
  padWord: R("(left|right)[\\s-]*(bumper|trigger|stick|shoulder)(?![a-z])"),
  padAbbr: /(LB|RB|LT|RT|LS|RS|L1|R1|L2|R2|L3|R3)(?![A-Za-z0-9])/y,
  padButton: R("([abxy])-button(?![a-z])"),
  padFace: R("([abxy])(?:\\s*button)?(?![a-z0-9])"),
  padMenu: R("(start|select|back|view|menu|options|share)(?![a-z])"),
  number: R("number\\s*(\\d)(?![\\d])"),
  num: R("(?:num(?:ber)?\\s*pad|numpad|num|keypad|kp|小键盘|小鍵盤|テンキー|ten\\s*key)\\s*(\\d(?![\\d])(?![.,]\\d)|star|asterisk|plus|minus|slash|period|dot|decimal|enter|del|[+\\-*/.](?![\\d]))(?![a-z])"),
  fkey: R("f(1[0-2]|[1-9])(?![0-9a-z])"),
  mouse: R("(left|right|middle)[\\s-]*(?:mouse(?:[\\s-]*(?:button|click))?|click|button\\s*click)(?![a-z])|([lrm])mb(?![a-z])|mouse\\s*([1-5])(?![0-9])|(?:mouse|scroll)\\s*wheel(?:\\s*(?:up|down))?(?![a-z])|wheel\\s*(?:up|down)(?![a-z])|scroll\\s*(?:up|down)(?![a-z])"),
  arrows: R("(?:arrow\\s*keys|arrows|arrow\\s*buttons|方向键)(?![a-z])"),
  arrowWord: R("(?:(up|down|left|right)(\\s*arrow(?:\\s*key)?s?)?|arrow\\s*(up|down|left|right))(?![a-z])"),
  glyphWord: R("\\s*(up|down|left|right)(?![a-z])"),
  arrowTail: R("\\s*arrow(?:\\s*key)?s?(?![a-z])"),
  punctName: R("(minus|hyphen|dash|comma|period|full\\s*stop|dot|forward\\s*slash|back\\s*slash|backslash|slash|apostrophe|quote|equals?|plus|semicolon|tilde|grave|backtick)\\s*key(?![a-z])"),
  named: R("(?:space\\s*bar|spacebar|space|tab|enter|return|escape|esc|backspace|delete|del|insert|ins|home|end|page\\s*up|pg\\s*up|pgup|page\\s*down|pg\\s*dn|pgdn|pg\\s*down|caps\\s*lock|capslock|print\\s*screen|prt\\s*sc|pause|scroll\\s*lock)(?![a-z])"),
  mod: R("[lr]?(ctrl|control|ctl|strg|alt|shift)(?![a-z])"),
  range: /(\d)(?:[-~]|\s+(?:~|to)\s+)(\d)(?![\d])(?![.,]\d)/iy,
  digit: /(\d)(?![\d])(?![.,:]\d)/y,
  letter: /([a-z])(?![a-z0-9_])(?!\.[a-z])(?!'[a-z])(?!-[a-z])/iy,
  symbol: /[/\-=,.;'[\]\\`~<>*+]/y,
  plus: /\s*[+&]\s*/y,
  modDash: /\s*-\s*/y,
  space: /\s+/y,
  altSep: R("\\s*(?:(/|&|\\band\\b|\\bund\\b|\\bet\\b|和)|(,|、)|(\\bor\\b|\\bou\\b|\\bo\\b|或者|或))\\s*"),
  note: /\s*[(（]\s*([^()（）]{1,40}?)\s*[)）]/y,
  keySuffix: R("\\s*(?:key|button|キー|键|鍵|키)(?![a-z])"),
};

interface Atom {
  end: number;
  kind: Kind | "sub";
  value: string;
  lvl: number;
  side?: string;
  pad?: boolean;
  sub?: Expr;
}

function atom(s: string, i: number, padCtx: boolean): Atom | null {
  const c = s[i];
  if (c === undefined) return null;
  let m: RegExpExecArray | null;
  const close = BRACKETS[c] ?? QUOTES[c];
  if (close) {
    const j = s.indexOf(close, i + 1);
    if (j > i + 1 && j - i <= 32) {
      const inner = s.slice(i + 1, j).trim();
      const e = inner ? parseExpr(inner, 0) : null;
      if (e && e.end === inner.length) return { end: j + 1, kind: "sub", value: "", lvl: e.lvl, sub: e };
    }
    if (c !== "[" && c !== "'") return null;
  }
  if ((m = at(RX.vk, s, i))) {
    const name = m[1]!.toUpperCase();
    const v = VK[name];
    if (v) return { end: after(m), kind: v[0], value: v[1], lvl: v[0] === "mod" ? 1 : 2 };
    let k: RegExpExecArray | null;
    if ((k = /^NUMPAD(\d)$/.exec(name))) return { end: after(m), kind: "num", value: `Num ${k[1]}`, lvl: 2 };
    if ((k = /^F(\d{1,2})$/.exec(name))) return { end: after(m), kind: "fkey", value: `F${k[1]}`, lvl: 2 };
    if (/^[A-Z0-9]$/.test(name)) return { end: after(m), kind: /\d/.test(name) ? "digit" : "letter", value: name, lvl: 2 };
    return null;
  }
  if ((m = at(RX.xb, s, i))) {
    const v = XB[m[1]!.toUpperCase()];
    return v ? { end: after(m), kind: "pad", value: v, lvl: 2, pad: true } : null;
  }
  if ((m = at(RX.dpad, s, i))) return { end: after(m), kind: "pad", value: `D-pad ${cap(m[1]!)}`, lvl: 2, pad: true };
  if ((m = at(RX.padWord, s, i))) {
    const side = m[1]!.toLowerCase() === "left" ? "L" : "R";
    const what = m[2]!.toLowerCase();
    return { end: after(m), kind: "pad", value: side + (what === "trigger" ? "T" : what === "stick" ? "S" : "B"), lvl: 2, pad: true };
  }
  if ((m = at(RX.padAbbr, s, i))) return { end: after(m), kind: "pad", value: PAD_ABBR[m[1]!] ?? m[1]!, lvl: 2, pad: true };
  if ((m = at(RX.padButton, s, i))) return { end: after(m), kind: "pad", value: m[1]!.toUpperCase(), lvl: 2, pad: true };
  if (padCtx) {
    if ((m = at(RX.padMenu, s, i))) return { end: after(m), kind: "pad", value: cap(m[1]!), lvl: 2, pad: true };
    if ((m = at(RX.padFace, s, i))) return { end: after(m), kind: "pad", value: m[1]!.toUpperCase(), lvl: 2, pad: true };
  }
  if ((m = at(RX.number, s, i))) return { end: after(m), kind: "digit", value: m[1]!, lvl: 0 };
  if ((m = at(RX.num, s, i))) {
    const v = m[1]!.toLowerCase();
    return { end: after(m), kind: "num", value: `Num ${NUM_WORD[v] ?? v}`, lvl: 2 };
  }
  if ((m = at(RX.fkey, s, i))) return { end: after(m), kind: "fkey", value: `F${m[1]}`, lvl: 2 };
  if ((m = at(RX.mouse, s, i))) {
    const side = (m[1] ?? m[2] ?? "").toLowerCase();
    const n = m[3];
    const value = side.startsWith("l") || n === "1" ? "LMB" : side.startsWith("r") || n === "2" ? "RMB" : side.startsWith("m") || n === "3" ? "MMB" : n ? `Mouse ${n}` : "Wheel";
    return { end: after(m), kind: "mouse", value, lvl: 2, side: m[1] ? cap(m[1]) : undefined };
  }
  const g = GLYPH[c];
  if (g) {
    let j = i + 1;
    const w = at(RX.glyphWord, s, j);
    if (w && cap(w[1]!) === g) j = after(w);
    const t = at(RX.arrowTail, s, j);
    if (t) j = after(t);
    return { end: j, kind: "arrow", value: g, lvl: 2, side: g };
  }
  if ((m = at(RX.arrows, s, i))) return { end: after(m), kind: "arrows", value: "Arrows", lvl: 1 };
  if ((m = at(RX.arrowWord, s, i))) {
    const dir = cap(m[1] ?? m[3]!);
    const strong = !!(m[2] || m[3]);
    return { end: after(m), kind: strong ? "arrow" : "dir", value: dir, lvl: strong ? 2 : 1, side: dir };
  }
  if ((m = at(RX.punctName, s, i))) {
    const v = PUNCT_NAME[m[1]!.toLowerCase().replace(/\s+/g, " ")];
    if (v) return { end: after(m), kind: "symbol", value: v, lvl: 1 };
  }
  if ((m = at(RX.named, s, i))) {
    const w = m[0];
    const v = NAMED.find(([re]) => re.test(w))?.[1] ?? cap(w);
    return { end: after(m), kind: "named", value: v, lvl: 1 };
  }
  if ((m = at(RX.mod, s, i))) return { end: after(m), kind: "mod", value: MOD_NAME[m[1]!.toLowerCase()]!, lvl: 1 };
  if ((m = at(RX.range, s, i))) return { end: after(m), kind: "range", value: `${m[1]}-${m[2]}`, lvl: 0 };
  if ((m = at(RX.digit, s, i))) return { end: after(m), kind: "digit", value: m[1]!, lvl: 0 };
  if ((m = at(RX.letter, s, i))) return { end: after(m), kind: "letter", value: m[1]!.toUpperCase(), lvl: 0 };
  if ((m = at(RX.symbol, s, i))) return { end: after(m), kind: "symbol", value: m[0], lvl: 0 };
  return null;
}

/** A separator character that, followed by a space, is not a key after a space-joined modifier ("Alt - Hold ..."). */
const SEP_CHARS = new Set(["-", "=", ":", "~", "|", ">", "–", "—"]);

interface Combo { alt: Alt; end: number; delimited: boolean }

/** One key: modifiers and a base ("Ctrl+Alt+1", "[ALT]+[SHIFT]+[R]", "Xbox LB + RT + X"), with any note after it. */
function parseCombo(s: string, i: number): Combo | null {
  let j = i;
  const mods: string[] = [];
  let base: Alt | null = null;
  let pad: string[] | null = null;
  let delimited = false;
  let atoms = 0;
  const pre = at(RX.padPre, s, j);
  if (pre) { pad = []; j = after(pre); }
  for (;;) {
    const a = atom(s, j, pad !== null);
    if (!a) break;
    let lastMod = false;
    if (a.kind === "sub") {
      const e = a.sub!;
      if (e.alts.length !== 1) {
        if (atoms === 0 && !pad) return { alt: e.alts[0]!, end: a.end, delimited: true, ...{ multi: e } } as Combo & { multi: Expr };
        break;
      }
      const alt = e.alts[0]!;
      if (alt.kind === "mod" && !pad) { mods.push(...alt.mods, alt.base); lastMod = true; }
      else if (alt.kind === "pad") { pad = pad ?? []; pad.push(...(alt.parts ?? [])); }
      else if (pad && alt.kind === "letter" && /^[ABXY]$/.test(alt.base)) pad.push(alt.base);
      else { if (base || pad) break; mods.push(...alt.mods); base = alt; }
      delimited = atoms === 0 ? e.delimited || true : delimited;
    } else if (a.kind === "mod" && !pad) {
      mods.push(a.value);
      lastMod = true;
    } else if (a.pad) {
      pad = pad ?? [];
      pad.push(a.value);
    } else {
      if (base || pad) break;
      base = { mods: [], base: a.value, kind: a.kind as Kind, lvl: a.lvl, side: a.side };
    }
    atoms++;
    j = a.end;
    if (base && !pad) break;
    // joiners: "+" or "&" always; after a modifier also " - " and a plain space
    const plus = at(RX.plus, s, j);
    if (plus && atom(s, after(plus), pad !== null)) { j = after(plus); continue; }
    if (lastMod) {
      const dash = at(RX.modDash, s, j);
      if (dash && dash[0].includes(" ")) {
        const b = atom(s, after(dash), false);
        if (b && b.kind !== "symbol" && b.kind !== "mod") { j = after(dash); continue; }
      }
      const sp = at(RX.space, s, j);
      if (sp) {
        const k = after(sp);
        const b = atom(s, k, false);
        if (b && !(b.kind === "symbol" && SEP_CHARS.has(s[k]!) && k + 1 < s.length && /\s/.test(s[k + 1]!))) { j = k; continue; }
      }
    }
    break;
  }
  if (atoms === 0) return null;
  let alt: Alt;
  if (pad) {
    if (!pad.length) return null;
    alt = { mods: [], base: pad.join("+"), kind: "pad", lvl: 2, parts: pad };
  } else if (base) {
    const ms = [...new Set([...mods, ...base.mods])];
    alt = { ...base, mods: ms, lvl: ms.length ? 2 : base.lvl };
  } else {
    const ms = [...new Set(mods)];
    alt = { mods: ms.slice(0, -1), base: ms[ms.length - 1]!, kind: "mod", lvl: 1 };
  }
  // a note right after the key: "(not Numpad)", "(Numpad Star)", "(Apostrophe Key)", "(→)"
  const note = at(RX.note, s, j);
  if (note) {
    const t = note[1]!.trim();
    if (/\b(not|no)\b|非|不是/i.test(t) && /num|小键盘|テンキー/i.test(t)) j = after(note);
    else if (/num\s*pad|numpad|keypad|小键盘|テンキー/i.test(t) && (alt.kind === "digit" || alt.kind === "symbol") && !alt.mods.length) {
      alt = { ...alt, kind: "num", base: `Num ${alt.base}`, lvl: 2 };
      j = after(note);
    } else if (/\bkey\b|キー|键|키/i.test(t) && t.length <= 24) j = after(note);
    else if (GLYPH[t] || /^(up|down|left|right)(\s*arrow)?$/i.test(t)) j = after(note);
  }
  return { alt, end: j, delimited };
}

/** A key with its alternatives: "Z / X", "H or /", "ALT+4, ALT+5", "CTRL/ALT+小键盘5", "← →". */
function parseExpr(s: string, i: number): Expr | null {
  const first = parseCombo(s, i) as (Combo & { multi?: Expr }) | null;
  if (!first) return null;
  if (first.multi) return { ...first.multi, end: first.end, delimited: true };
  const alts: Alt[] = [first.alt];
  const seps: string[] = [];
  let end = first.end;
  for (;;) {
    const prev = alts[alts.length - 1]!;
    // arrows written side by side: "← →"
    const sp = at(/\s+/y, s, end);
    if (prev.kind === "arrow" && !prev.mods.length && sp && GLYPH[s[after(sp)]!]) {
      const next = parseCombo(s, after(sp));
      if (next) { alts.push(next.alt); seps.push("/"); end = next.end; continue; }
    }
    const m = at(RX.altSep, s, end);
    if (!m) break;
    const kind = m[1] ? "/" : m[2] ? "," : "or";
    const next = parseCombo(s, after(m));
    if (!next) break;
    if (kind === "," && !(next.alt.mods.length && prev.mods.length) && !(next.alt.kind === prev.kind && next.alt.lvl === 2)) break;
    alts.push(next.alt);
    seps.push(kind);
    end = next.end;
  }
  // "CTRL/ALT+5": a modifier on its own borrows the next key
  for (let k = alts.length - 2; k >= 0; k--) {
    const a = alts[k]!, b = alts[k + 1]!;
    if (a.kind === "mod" && b.kind !== "mod" && b.kind !== "pad" && b.mods.length) alts[k] = { ...b, mods: [...a.mods, a.base] };
  }
  // "Left/Right arrow", "Left or right mouse button": the last word says what the others are
  const last = alts[alts.length - 1]!;
  if (last.kind === "arrow" || (last.kind === "mouse" && last.side)) {
    for (const a of alts) {
      if (a.kind !== "dir") continue;
      if (last.kind === "arrow") { a.kind = "arrow"; a.lvl = 2; }
      else { a.kind = "mouse"; a.base = a.side === "Left" ? "LMB" : a.side === "Right" ? "RMB" : "MMB"; a.lvl = 2; }
    }
  }
  // "Shift+Right/Left": later keys without modifiers share the first one's
  for (let k = 1; k < alts.length; k++) {
    const a = alts[k]!;
    if (a.mods.length || a.kind === "mod" || a.kind === "pad" || seps[k - 1] === "or") continue;
    const withMods = alts.slice(0, k).find((x) => x.mods.length && x.kind !== "mod");
    if (withMods) alts[k] = { ...a, mods: [...withMods.mods], lvl: 2 };
  }
  const lvl = Math.max(...alts.map((a) => (a.mods.length && a.kind !== "mod" ? 2 : a.lvl)));
  return { alts, end, delimited: first.delimited && alts.length === 1, lvl };
}

function fmtAlt(a: Alt): string {
  if (a.kind === "pad") return `Pad ${a.base}`;
  const mods = [...new Set(a.mods)].sort((x, y) => MOD_ORDER.indexOf(x) - MOD_ORDER.indexOf(y));
  return [...mods, a.base].join("+");
}
const fmt = (e: Expr) => [...new Set(e.alts.map(fmtAlt))].join(" / ");

// ── 3. line shapes ──

interface Entry {
  line: number;
  keys: string;
  action: string;
  lvl: number;
  /** A control verb is next to the key ("toggle", "hide", "切换" ...). */
  verb: boolean;
  /** Under a "Keys:" label on the same line. */
  label?: boolean;
  /** Found inside running text ("... use / for opening the menu ..."), not in a list. */
  sentence?: boolean;
}
type Found = Omit<Entry, "line">;

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const VERB = /\b(?:toggl\w*|switch\w*|swap\w*|cycl\w*|show\w*|hid(?:e|es|ing)\b|open\w*|clos(?:e|es|ing)\b|chang\w*|remov\w*|reset\w*|lock\w*|unlock\w*|next|prev\w*|enabl\w*|disabl\w*|turn\w*|select\w*|choos\w*|mov(?:e|es|ing)\b|zoom\w*|menu|brings? up|activat\w*|deactivat\w*|on\s*\/\s*off|off\s*\/\s*on|take off|put on|equip\w*)|切换|切換|开关|開關|显示|顯示|隐藏|隱藏|打开|打開|关闭|關閉|切り替え|切替|表示|켜기|끄기|전환|показ|скры|переключ|включ|выключ|mostrar|ocultar|cambiar|alternar|afficher|cacher|changer|basculer|an\/aus|ein\/aus|umschalten|wechseln/i;
const hasVerb = (s: string) => VERB.test(s);
const startsVerb = (s: string) => VERB.exec(s)?.index === 0;
const HEAD = /\b(?:toggles?|toggle\s+keys?|controls?|controles|keybinds?|key\s*binds?|hotkeys?|shortcuts?|keys|how\s+to\s+(?:toggle|use)|instructions?|usage|tasten|steuerung|teclas)\b|切换键|按键|快捷键|操作|キー|조작|단축키|키/i;

const PRESS = "press(?:ing)?|hold(?:ing)?|use|using|hit|tap|push|请按|按下|按|pulsa|presiona|pulse|appuyez\\s+sur|appuie\\s+sur|drücke|drücken\\s+sie|нажмите|нажми";
const PRESS_START = new RegExp(`(?:${PRESS})(?:\\s+|(?<=[按下])\\s*)`, "iy");
const PRESS_MID = new RegExp(`(?:^|[\\s,.;:!?(（，。：、])(?=(?:${PRESS})(?:\\s|(?<=[按下])))`, "giu");
const WORD_PREFIX = R("(?:数字键|数字|taste|tecla|touche)\\s*");
const SEP_PUNCT = /\s*(?:==>|=>|-->|->|→|⇒|➔|➜|--|—|–|-|:|=|~|\||>|》|»)\s*/y;
const SEP_TO = R("\\s*[,，]?\\s+(?:to|for|para|pour|um|чтобы|чтоб|in\\s+order\\s+to)\\s+|(?:で|を押して|を押すと)");
const SEP_DOT = /\.\s+/y;
const LABEL = R("(?:the\\s+)?(?:(?:toggle|switch)\\s+)?(?:keys?|hotkeys?|keybinds?|key\\s*binds?|buttons?|controls?)\\s*:\\s*|(?:切换键|按键|快捷键|键位)\\s*:\\s*");
const BULLET = /^(?:[•·◆◇■□●○♡♥❤★☆✦✧➤▶►✿❀✓✔※❥❣»▪▫◦⁃\p{Extended_Pictographic}]+|>>+|[-–—*](?=\s*[A-Za-z\u00C0-\u024F\u0400-\u04FF\u3040-\u30ff\u3400-\u9fff"“'[(]))\s*/u;
const NUMBERED = R(`\\d{1,2}\\s*[.)、]\\s*(?=(?:${PRESS}|数字键|小键盘|テンキー))`);

function normAction(a: string): string {
  let s = a.replace(new RegExp(GAP, "g"), " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^[\s\-–—:=~|>,，]+/, "").replace(/^(?:to|for|para|pour)\s+/i, "");
  s = s.replace(/^[^\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Greek}0-9("'“[]+/u, "");
  const wrapped = /^[(（]([^()（）]+)[)）]$/.exec(s.trim());
  if (wrapped) s = wrapped[1]!.trim();
  const end = /[.!?](?:\s+(?=[A-ZÀ-ÖØ-ÞА-ЯЁ\u3400-\u9fff]))|[。！？](?=.)/.exec(s);
  if (end) s = s.slice(0, end.index);
  // a long Chinese or Japanese action stops at its first comma: "可以打开界面，可以翻页 ..."
  if (CJK.test(s) && !/[A-Za-z]{3}/.test(s) && s.length > 24) {
    const c = s.search(/[，,。；;]/);
    if (c >= 2) s = s.slice(0, c);
  }
  s = s.replace(/[\s.。!！,，;；:：]+$/, "").trim();
  if (s && s[0] !== s[0]!.toUpperCase()) s = s[0]!.toUpperCase() + s.slice(1);
  return s;
}

interface Ctx { explicit?: "press" | "word" | null; label?: boolean; bold?: boolean[] }

/** "H - jacket", "Press H to ...", "数字键6 头发", "Hキーで ...": the key, then a separator, then the action. */
function keyFirst(t: string, i: number, ctx: Ctx = {}): Found[] | null {
  let j = i;
  let explicit = ctx.explicit ?? null;
  const pm = at(PRESS_START, t, j);
  if (pm && !/^hold/i.test(pm[0])) { explicit = "press"; j = after(pm); }
  const wm = at(WORD_PREFIX, t, j);
  if (wm) { explicit = "word"; j = after(wm); }
  const e = parseExpr(t, j);
  if (!e) return null;
  const keyStart = j;
  j = e.end;
  let suffixed = false;
  const sm = at(RX.keySuffix, t, j);
  if (sm) { suffixed = true; j = after(sm); }
  let sep: string | null = null;
  let m: RegExpExecArray | null;
  if ((m = at(SEP_PUNCT, t, j))) { sep = "punct"; j = after(m); }
  else if (t[j] === GAP) { sep = "gap"; j++; }
  else if ((m = at(SEP_TO, t, j))) { sep = "to"; j = after(m); }
  else if ((m = at(SEP_DOT, t, j))) { sep = "dot"; j = after(m); }
  else if (t[j] && CJK.test(t[j]!)) sep = "none";
  else if ((m = at(/\s+/y, t, j))) { sep = "space"; j = after(m); }
  else if (j >= t.length) sep = "end";
  else return null;
  const rest = t.slice(j);
  const action = normAction(rest);
  const lowA = e.alts.length === 1 && e.alts[0]!.kind === "letter" && /^[ai]$/.test(t.slice(keyStart, e.end).trim());
  if (explicit === "press" && lowA) return null;
  let next = e.end;
  while (next < t.length && /\s/.test(t[next]!)) next++;
  // bold counts when only the key is bold: "<b>H</b> toggles the hat", not a whole bold sentence
  const bold = !!ctx.bold && ctx.bold.slice(keyStart, e.end).some(Boolean)
    && ctx.bold.slice(keyStart, e.end).every((b, k) => b || /\s/.test(t[keyStart + k]!)) && !ctx.bold[next];
  // "A lot of ...", "I think ...": the words, not the keys
  const word = e.alts.length === 1 && e.alts[0]!.kind === "letter" && /^[ai]$/i.test(e.alts[0]!.base) && !e.delimited;
  if (sep === "dot" && e.lvl < 2 && explicit !== "press") return null;
  // "4款", "7种": a count in Chinese, unless a press word or "键" says it's a key
  if (sep === "none" && e.lvl < 1 && !explicit && !suffixed) return null;
  if (sep === "space" && word && !ctx.label && !suffixed && !bold) return null;
  if (sep === "space") {
    const ok = (e.lvl >= 2 && e.alts.some((a) => a.kind !== "mod")) || e.delimited || explicit === "word" || suffixed || ctx.label
      || (bold && /^[\p{L}]/u.test(rest)) || startsVerb(rest) || (explicit === "press" && e.lvl >= 1);
    if (!ok) return null;
  }
  if (sep === "end") return ctx.label ? [{ keys: fmt(e), action: "", lvl: e.lvl, verb: true, label: true }] : null;
  if (!action) return null;
  if (sep === "space" && e.lvl < 2 && !explicit && /^[a-z]/.test(rest) && !startsVerb(rest) && !e.delimited && !bold && !ctx.label && !suffixed) return null;
  return [{ keys: fmt(e), action, lvl: e.lvl, verb: hasVerb(rest) || hasVerb(t.slice(i, keyStart)), label: ctx.label }];
}

/** "Jacket: H", "Toggle form - [ALT]+[SHIFT]+[R]", "Open Key UI: 0 (see the readme)". */
function actionFirst(t: string, i: number): Found[] | null {
  const body = t.slice(i);
  const seps = [...body.matchAll(/\s*(?:=>|->|→|=|—|–|-|:|~|\|)\s*/g)].reverse();
  for (const m of seps) {
    const left = body.slice(0, m.index).trim();
    if (!left || left.length > 90) continue;
    const start = m.index! + m[0].length;
    const e = parseExpr(body, start);
    if (!e) continue;
    if (!/^(?:\s*[(（][^)）]*[)）])*\s*[.。!]?\s*$/.test(body.slice(e.end))) continue;
    const action = normAction(left);
    if (!action) continue;
    return [{ keys: fmt(e), action, lvl: e.lvl, verb: hasVerb(left) }];
  }
  return null;
}

/** "Hair toggle (Alt + right)". */
function parenShape(t: string, i: number): Found[] | null {
  const m = /^(.+?)\s*[(（]\s*([^()（）]{1,30}?)\s*[)）]\s*[.。]?\s*$/.exec(t.slice(i));
  if (!m) return null;
  const e = parseExpr(m[2]!, 0);
  if (!e || e.end !== m[2]!.length) return null;
  const action = normAction(m[1]!);
  return action ? [{ keys: fmt(e), action, lvl: e.lvl, verb: hasVerb(m[1]!) }] : null;
}

/** "Hold "Ctrl" and press "← →" to cycle ...". */
function holdShape(t: string, i: number): Found[] | null {
  const h = at(R("(?:hold(?:ing)?|keep)\\s+"), t, i);
  if (!h) return null;
  const e1 = parseExpr(t, after(h));
  if (!e1 || !e1.alts.every((a) => a.kind === "mod")) return null;
  const and = at(R("\\s*(?:and|then|\\+|&|,)\\s*(?:(?:press|tap|use|hit)\\s+)?"), t, e1.end);
  if (!and) return null;
  const e2 = parseExpr(t, after(and));
  if (!e2) return null;
  const mods = e1.alts.flatMap((a) => [...a.mods, a.base]);
  const alts = e2.alts.map((a) => ({ ...a, mods: [...mods, ...a.mods], lvl: 2 }));
  const sep = at(SEP_TO, t, e2.end) ?? at(SEP_PUNCT, t, e2.end);
  const rest = sep ? t.slice(after(sep)) : "";
  const action = normAction(rest);
  return [{ keys: fmt({ ...e2, alts }), action, lvl: 2, verb: hasVerb(rest) }];
}

/** "<b>H</b> toggles the jacket and <b>Y</b> toggles the hat." */
function boldMulti(t: string, bold: boolean[], i: number): Found[] | null {
  const segs: Array<{ start: number; end: number; e: Expr }> = [];
  for (let k = i; k < t.length;) {
    if (!bold[k]) { k++; continue; }
    let e2 = k;
    while (e2 < t.length && bold[e2]) e2++;
    let a = k, b = e2;
    while (a < b && /\s/.test(t[a]!)) a++;
    while (b > a && /\s/.test(t[b - 1]!)) b--;
    const seg = t.slice(a, b);
    const e = seg ? parseExpr(seg, 0) : null;
    if (e && e.end === seg.length) segs.push({ start: a, end: b, e });
    k = e2;
  }
  if (segs.length < 2) return null;
  const out: Found[] = [];
  for (let k = 0; k < segs.length; k++) {
    const raw = t.slice(segs[k]!.end, segs[k + 1]?.start ?? t.length).replace(/\s*(?:,|;|\band\b|\bund\b|\by\b|\bet\b|和|、)\s*$/i, "");
    const action = normAction(raw);
    if (!action || /^(?:or|\/)\b/i.test(raw.trim())) return null;
    out.push({ keys: fmt(segs[k]!.e), action, lvl: segs[k]!.e.lvl, verb: hasVerb(raw) });
  }
  return out;
}

/** "Toggle between jacket and no jacket with P." */
function withShape(t: string, i: number): Found[] | null {
  const body = t.slice(i);
  const ms = [...body.matchAll(/\s(?:with|using|via|by\s+pressing|by\s+using)\s+/gi)].reverse();
  for (const m of ms) {
    const left = body.slice(0, m.index);
    if (!hasVerb(left)) continue;
    const e = parseExpr(body, m.index! + m[0].length);
    if (!e || !/^\s*[.!。]?\s*$/.test(body.slice(e.end))) continue;
    if (e.alts.length === 1 && e.alts[0]!.kind === "letter" && /^[ai]$/.test(body.slice(m.index! + m[0].length, e.end).trim())) continue;
    return [{ keys: fmt(e), action: normAction(left), lvl: e.lvl, verb: true, sentence: true }];
  }
  return null;
}

/** "Toggle key is H for all variants." */
function keyIsShape(t: string, i: number): Found[] | null {
  const m = /\b(?:toggle\s+|switch\s+)?(?:key|hotkey|keybind|button)\s+is\s+/i.exec(t.slice(i));
  if (!m) return null;
  const e = parseExpr(t, i + m.index + m[0].length);
  if (!e) return null;
  return [{ keys: fmt(e), action: "", lvl: e.lvl, verb: true }];
}

/** `Keys : "," (Back) "." (Forward)` */
function multiPairs(t: string, i: number): Found[] | null {
  const out: Found[] = [];
  let j = i;
  for (;;) {
    const sp = at(/\s*/y, t, j);
    if (sp) j = after(sp);
    if (j >= t.length) break;
    const e = parseExpr(t, j);
    if (!e) return null;
    const m = at(/\s*[(（]([^()（）]{1,40})[)）]/y, t, e.end);
    if (!m) return null;
    out.push({ keys: fmt(e), action: normAction(m[1]!), lvl: e.lvl, verb: true, label: true });
    j = after(m);
  }
  return out.length ? out : null;
}

/** "Press H to toggle ..." in the middle of a sentence. */
function pressAnywhere(t: string, i: number): Found[] | null {
  PRESS_MID.lastIndex = i;
  for (let m: RegExpExecArray | null; (m = PRESS_MID.exec(t));) {
    const p = m.index + m[0].length;
    if (p <= i && i > 0) continue;
    const r = holdShape(t, p) ?? keyFirst(t, p, { explicit: "press" });
    if (r) return p > i ? r.map((f) => ({ ...f, sentence: true })) : r;
    if (PRESS_MID.lastIndex <= m.index) PRESS_MID.lastIndex = m.index + 1;
  }
  return null;
}

/** A table row: the cell that is a key, and the other cells as the action. */
function tableRow(L: Line): Found[] | null {
  const cells = L.cells!;
  const keys: Expr[] = [], rest: string[] = [];
  for (const c of cells) {
    const e = parseExpr(c, 0);
    if (e && !c.slice(e.end).trim()) keys.push(e);
    else rest.push(c);
  }
  if (!keys.length || !rest.length) return null;
  const action = normAction(rest.join(" - "));
  if (!action) return null;
  const all: Expr = { alts: keys.flatMap((e) => e.alts), end: 0, delimited: false, lvl: Math.max(...keys.map((e) => e.lvl)) };
  return [{ keys: fmt(all), action, lvl: all.lvl, verb: hasVerb(rest.join(" ")) }];
}

// filters: lines that are never key lines
const URL_RE = /https?:\/\/|www\.\w/i;
const INI_RE = /^\s*\[[a-z][\w.-]{3,}\]\s*$|^\s*\$\w+\s*=|^\s*(?:hash|back|type|condition|run|handling|drawindexed|format|stride|vb\d|ib|ps-t\d+|vs-t\d+)\s*=|\b\w+_\w+\s*=\s*\S|\bkey\s*=/i;
const LIKES_RE = /\b\d+\s*(?:likes?|❤|♥)/i;
const RELOAD_RE = /reload|refresh|apply|recarg|刷新|重载|重新加载/i;
const EMOTICON = /(^|\s)(?::D|:3|:P|:p|:\)|:\(|;\)|;-;|;_;|xD|XD|:O|:o|<3|\^\^|\^_\^|T_T|:'\)|:'\(|>_<|uwu|owo|:v)(?=\s|$|[!.,])/g;

function readLine(L: Line, qa: boolean): Found[] {
  if (L.img || L.details) return [];
  if (L.cells && L.cells.length >= 2) return tableRow(L) ?? [];
  let t = L.text;
  if (URL_RE.test(t) || INI_RE.test(t) || LIKES_RE.test(t)) return [];
  if (/\bF10\b/i.test(t) && RELOAD_RE.test(t)) return [];
  if (qa && /^\s*[QA]\s*[:.]/i.test(t)) return [];
  // same-length clean-up keeps the bold mask lined up
  t = t.replace(EMOTICON, (_m, sp: string, e: string) => sp + " ".repeat(e.length));
  t = t.replace(/^([=#~*_-])\1+/, (m) => " ".repeat(m.length)).replace(/([=#~*_-])\1+$/, (m) => " ".repeat(m.length));
  let i = 0;
  while (i < t.length && /\s/.test(t[i]!)) i++;
  const b = BULLET.exec(t.slice(i));
  if (b) i += b[0].length;
  const n = at(NUMBERED, t, i);
  if (n) i = after(n);
  t = t.replace(/\s+$/, "");
  if (i >= t.length) return [];
  if (t.length - i > 170) return pressAnywhere(t, i) ?? [];
  const label = at(LABEL, t, i);
  if (label) {
    const j = after(label);
    if (j >= t.length) return [];
    return multiPairs(t, j) ?? holdShape(t, j) ?? keyFirst(t, j, { label: true, bold: L.bold }) ?? [];
  }
  return holdShape(t, i) ?? boldMulti(t, L.bold, i) ?? keyFirst(t, i, { bold: L.bold }) ?? actionFirst(t, i) ?? parenShape(t, i)
    ?? pressAnywhere(t, i) ?? withShape(t, i) ?? keyIsShape(t, i) ?? [];
}

// ── 4. blocks, acceptance, anchors ──

const isLatin = (s: string) => /[A-Za-z]/.test(s) && !CJK.test(s);

function headingLike(L: Line): boolean {
  if (L.img || !L.text || L.text.length > 48) return false;
  if (/[:：]\s*$/.test(L.text) || (L.heading >= 1 && L.heading <= 4) || HEAD.test(L.text) || /^\s*(?:==|##|--|~~)/.test(L.text)) return true;
  const letters = [...L.text].map((c, k) => (/\S/.test(c) ? L.bold[k] : true));
  return letters.length > 0 && letters.every(Boolean);
}

function detect(html: string): DescKeys {
  const lines = toLines(html);
  const qa = lines.some((l) => /^\s*Q\s*[:.]/i.test(l.text));
  const entries: Entry[] = [];
  lines.forEach((L, k) => { for (const f of readLine(L, qa)) entries.push({ ...f, line: k }); });
  if (!entries.length) return { keys: [], html, anchor: null };

  // blocks: key lines at most two other lines apart
  const blocks: Entry[][] = [];
  for (const e of entries) {
    const b = blocks[blocks.length - 1];
    if (b && e.line - b[b.length - 1]!.line <= 3) b.push(e);
    else blocks.push([e]);
  }
  const kept: Array<{ block: number; e: Entry }> = [];
  blocks.forEach((b, n) => {
    const first = b[0]!.line;
    const lineCount = new Set(b.map((e) => e.line)).size;
    let headed = b.some((e) => e.label);
    for (let k = first - 1; k >= Math.max(0, first - 6) && !headed; k--) {
      const L = lines[k]!;
      if (L.text && L.text.length <= 48 && HEAD.test(L.text)) headed = true;
    }
    const bullets = new Set(b.filter((e) => /^[+\-*~>=.]$/.test(e.keys) && b.some((o) => o !== e && o.keys === e.keys && o.action !== e.action)).map((e) => e.keys));
    for (const e of b) if (!bullets.has(e.keys) && (e.lvl >= 2 || lineCount >= 2 || headed || e.verb)) kept.push({ block: n, e });
  });

  // the same key twice within three lines (one line in Chinese, one in English) is one entry, in English
  const out: Array<{ block: number; e: Entry }> = [];
  for (const k of kept) {
    const same = out.filter((o) => o.e.keys === k.e.keys);
    if (same.some((o) => o.e.action.toLowerCase() === k.e.action.toLowerCase())) continue;
    const lang = same.find((o) => isLatin(o.e.action) !== isLatin(k.e.action));
    if (lang) { if (isLatin(k.e.action)) lang.e = { ...lang.e, action: k.e.action }; continue; }
    if (k.e.sentence && same.length) continue;
    const listed = same.find((o) => o.e.sentence && !k.e.sentence);
    if (listed) { listed.e = k.e; listed.block = k.block; continue; }
    const twin = same.find((o) => Math.abs(o.e.line - k.e.line) <= 3 || isLatin(o.e.action) !== isLatin(k.e.action));
    if (!twin) { out.push(k); continue; }
    if (isLatin(k.e.action) && !isLatin(twin.e.action)) twin.e = { ...twin.e, action: k.e.action };
  }
  if (!out.length) return { keys: [], html, anchor: null };

  // anchors: the heading just above each list, else its first key line
  const marks = new Map<number, string>();
  const used = [...new Set(out.map((o) => o.block))];
  used.forEach((n, idx) => {
    const lineSet = new Set(blocks[n]!.map((e) => e.line));
    const first = Math.min(...out.filter((o) => o.block === n).map((o) => o.e.line));
    let at = first;
    for (let k = first - 1; k >= Math.max(0, first - 6); k--) {
      const L = lines[k]!;
      if (lineSet.has(k)) break;
      if (headingLike(L)) { at = k; break; }
    }
    const off = lines[at]!.offset;
    if (!marks.has(off)) marks.set(off, `gm-keys-${idx + 1}`);
  });
  let marked = html;
  for (const [off, id] of [...marks.entries()].sort((a, b) => b[0] - a[0])) {
    marked = `${marked.slice(0, off)}<span id="${id}" class="gm-keys-anchor"></span>${marked.slice(off)}`;
  }
  const first = [...marks.entries()].sort((a, b) => a[0] - b[0])[0];
  return {
    keys: out.map((o) => ({ keys: o.e.keys, action: o.e.action })),
    html: marked,
    anchor: first ? first[1] : null,
  };
}
