// @ts-expect-error The app's tsconfig loads browser types only, so Node's modules have none here
import * as nodeFs from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_ANATOMY, anatomyText } from "./theme-anatomy";

const fs = nodeFs as unknown as {
  readdirSync(dir: URL, opts: { recursive: true; encoding: "utf8" }): string[];
  readFileSync(file: URL, encoding: "utf8"): string;
};

// every .ts, .tsx and .css file under src; markup leaves out the dev pages and this map and its test, which name
// every class themselves
const SRC = new URL("../", import.meta.url);
const files = fs.readdirSync(SRC, { recursive: true, encoding: "utf8" }).map((f) => f.replaceAll("\\", "/"));
const read = (list: string[]) => list.map((f) => fs.readFileSync(new URL(f, SRC), "utf8")).join("\n");
const code = read(files.filter((f) => /\.tsx?$/.test(f) && !f.startsWith("dev/") && !f.includes("theme-anatomy")));
const css = read(files.filter((f) => f.endsWith(".css")));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const classesIn = (sel: string) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!);

/** Drawn by a component: the name on its own, or built from a template (`t-${tone}` with "bad" somewhere). */
function inMarkup(name: string): boolean {
  if (new RegExp(`(?<![\\w-])${esc(name)}(?![\\w-])`).test(code)) return true;
  return [...name.matchAll(/-/g)].some((m) => {
    const head = name.slice(0, m.index), tail = name.slice(m.index + 1);
    return new RegExp(`(?<![\\w-])${esc(head)}-\\$\\{`).test(code) && new RegExp(`["'\`]${esc(tail)}["'\`]`).test(code);
  });
}
const inCss = (name: string) => new RegExp(`\\.${esc(name)}(?![\\w-])`).test(css);

describe("THEME_ANATOMY", () => {
  it("names only classes the app draws and styles", () => {
    const names = [...new Set(THEME_ANATOMY.flatMap((a) => a.parts.flatMap((p) => classesIn(p.sel))))];
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((n) => !inMarkup(n)).map((n) => `${n}: in no component`)).toEqual([]);
    expect(names.filter((n) => !inCss(n)).map((n) => `${n}: in no CSS file`)).toEqual([]);
  });
  it("has unique area ids and no empty parts", () => {
    const ids = THEME_ANATOMY.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of THEME_ANATOMY) {
      expect(a.parts.length).toBeGreaterThan(0);
      for (const p of a.parts) expect(p.sel.trim() && p.what.trim()).toBeTruthy();
    }
  });
  it("fits the prompt", () => {
    const n = anatomyText().length;
    expect(n).toBeGreaterThanOrEqual(6000);
    expect(n).toBeLessThanOrEqual(12000);
  });
});

// ── game theme contrast ──
// Each case reads one theme file, looks a name up through a chain of rules (first rule that sets it wins, like the
// cascade inside one element) and checks text against its fill at 4.5:1. Names are custom properties or plain
// properties (`color`, `background`); a value starting with # is used as written.

type Block = { path: string[]; decls: Record<string, string> };

/** Every rule in a (nested) stylesheet with its selector path and its own declarations. */
function blocks(source: string): Block[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Block[] = [], stack: Block[] = [];
  let buf = "", quote = "", paren = 0;
  const decl = () => {
    const t = buf.trim(), b = stack[stack.length - 1];
    buf = "";
    const i = t.indexOf(":");
    if (b && i > 0) b.decls[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  };
  for (const ch of text) {
    if (quote) { buf += ch; if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "(" || ch === ")") { paren += ch === "(" ? 1 : -1; buf += ch; continue; }
    if (paren > 0) { buf += ch; continue; }
    if (ch === "{") {
      const b: Block = { path: [...(stack[stack.length - 1]?.path ?? []), buf.trim().replace(/\s+/g, " ")], decls: {} };
      buf = "";
      stack.push(b);
      out.push(b);
    } else if (ch === ";") decl();
    else if (ch === "}") { decl(); stack.pop(); }
    else buf += ch;
  }
  return out;
}

/** A path segment ending in * matches any selector that starts with the rest. */
const segMatch = (want: string, got: string) => (want.endsWith("*") ? got.startsWith(want.slice(0, -1)) : got === want);

/** Reads one theme file, or several (later files may use tokens the earlier ones set). */
function scope(files: string | string[], chain: string[][]) {
  const file = [files].flat().join(" + ");
  const all = [files].flat().flatMap((f) => blocks(fs.readFileSync(new URL(`styles/themes/${f}`, SRC), "utf8")));
  const rules = chain.map((path) => {
    const hits = all.filter((b) => b.path.length === path.length && path.every((s, i) => segMatch(s, b.path[i]!)));
    if (!hits.length) throw new Error(`${file}: no rule at ${path.join(" > ")}`);
    return Object.assign({}, ...hits.map((b) => b.decls)) as Record<string, string>;
  });
  const color = (name: string, depth = 0): string => {
    if (name.startsWith("#")) return name;
    const raw = rules.find((r) => name in r)?.[name];
    if (raw === undefined || depth > 10) throw new Error(`${file}: ${name} is not set in ${chain.map((p) => p.at(-1)).join(", ")}`);
    const ref = raw.match(/^var\((--[\w-]+)\)$/);
    if (ref) return color(ref[1]!, depth + 1);
    if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) throw new Error(`${file}: ${name} is "${raw}", not a plain colour`);
    return raw;
  };
  return color;
}

function luminance(hex: string): number {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

const TEXT = ["--text", "--text-2", "--text-3"];
const TONES = ["--ok", "--warn", "--bad", "--info"];
const on = (texts: string[], fills: string[]) => texts.flatMap((t) => fills.map((f): [string, string] => [t, f]));

const GI = '[data-theme="gi"]', GIN = '[data-theme="gi"]:not([data-scheme="light"])', GIL = '[data-theme="gi"][data-scheme="light"]';
const EF = '[data-theme="ef"]', EFD = '[data-theme="ef"][data-scheme="dark"]';
const WW = '[data-theme="ww"]', WWL = '[data-theme="ww"][data-scheme="light"]';
const HSR = '[data-theme="hsr"]', HSRL = '[data-theme="hsr"][data-scheme="light"]';
const ZZ = '[data-theme="zzz"]', ZZL = '[data-theme="zzz"][data-scheme="light"]';
const EF_BADGES =[EF, ".badge.t-warn, .badge.t-ok, .badge.t-info"];

const CONTRAST: { name: string; file: string | string[]; chain: string[][]; pairs: [string, string][] }[] = [
  // Teyvat
  { name: "Teyvat page", file: "gi-kit.css", chain: [[GI]], pairs: on(TEXT, ["--bg"]) },
  { name: "Teyvat cream sheets", file: "gi-kit.css", chain: [[GI, ".side, .panel, .dialog*"], [GI]], pairs: on([...TEXT, ...TONES], ["--surface", "--surface-2"]) },
  // #4b5366 is the pop-up menu's own fill (.popover)
  { name: "Teyvat night sheets", file: ["gi-kit.css", "gi-night.css"], chain: [[GIN, ".side, .panel, .dialog*"], [GIN], [GI]], pairs: on([...TEXT, ...TONES], ["--surface", "--surface-2"]) },
  { name: "Teyvat drawers", file: "gi-kit.css", chain: [[GI, ".drawer, .drawer .panel, .popover*"], [GI]], pairs: on([...TEXT, ...TONES], ["--surface"]) },
  { name: "Teyvat pop-up menus", file: "gi-kit.css", chain: [[GI, ".popover"], [GI, ".drawer, .drawer .panel, .popover*"], [GI]], pairs: on([...TEXT, ...TONES], ["#4b5366"]) },
  ...["accent", "ok", "warn", "bad", "info"].map((t) => ({ name: `Teyvat ${t} badge`, file: "gi-kit.css", chain: [[GI, `.badge.t-${t}`], [GI]], pairs: [["color", "background"]] as [string, string][] })),
  { name: "Teyvat light page", file: "gi-kit.css", chain: [[GIL], [GI]], pairs: on([...TEXT, ...TONES], ["--bg", "--surface"]) },
  // Talos-II
  { name: "Talos-II sheets", file: "ef.css", chain: [[EF]], pairs: on([...TEXT, "--warn-ink"], ["--bg", "--surface", "--surface-2"]) },
  { name: "Talos-II stage", file: "ef.css", chain: [[EF, ":is(.titlebar*"], [EF]], pairs: on(TEXT, ["--bg", "--surface"]) },
  { name: "Talos-II name plates", file: "ef.css", chain: [[EF, ":is(.tile-body*"], [EF]], pairs: on(TEXT, ["--plate-2"]) },
  { name: "Talos-II dark sheets", file: "ef.css", chain: [[EFD], [EF]], pairs: on([...TEXT, "--warn-ink"], ["--bg", "--surface"]) },
  { name: "Talos-II ok badge", file: "ef.css", chain: [[EF, ".badge.t-ok"], EF_BADGES, [EF]], pairs: [["color", "background"]] },
  { name: "Talos-II tone badges", file: "ef.css", chain: [EF_BADGES, [EF]], pairs: [["color", "--warn"], ["color", "--info"]] },
  { name: "Talos-II dark tone badges", file: "ef.css", chain: [EF_BADGES, [EFD], [EF]], pairs: [["color", "--warn"], ["color", "--info"]] },
  { name: "Talos-II bad badge", file: "ef.css", chain: [[EF, ".badge.t-bad"], [EF]], pairs: [["#fff", "background"]] },
  // Solaris. Paper rows are #dadada and finished downloads #c8c8c8 (ww-screens.css); dialogs fade to #efefed.
  { name: "Solaris ink", file: "ww-kit.css", chain: [[WW, "&, :is(.card*"], [WW]], pairs: on(TEXT, ["--bg", "--surface"]) },
  { name: "Solaris paper", file: "ww-kit.css", chain: [[WW, ":is(.dialog*"], [WW]], pairs: on([...TEXT, ...TONES], ["--bg", "#efefed", "#dadada", "#c8c8c8"]) },
  { name: "Solaris light page", file: "ww-kit.css", chain: [[WWL, "&, :is(.popover*"], [WWL], [WW]], pairs: on(TEXT, ["--bg", "--surface"]) },
  // Astral Express
  { name: "Astral Express glass", file: "hsr.css", chain: [[`${HSR}, ${HSR} :is(.card*`], [HSR]], pairs: on(TEXT, ["--bg", "--surface"]) },
  { name: "Astral Express plates", file: "hsr.css", chain: [[`${HSR} :is(.dialog*`], [HSR]], pairs: [...on([...TEXT, ...TONES], ["--surface"]), ...on(TEXT, ["--surface-2"])] },
  { name: "Astral Express light page", file: "hsr.css", chain: [[HSRL], [HSR]], pairs: on([...TEXT, ...TONES], ["--bg", "--surface"]) },
  // New Eridu
  { name: "New Eridu sheets", file: "zzz.css", chain: [[ZZ]], pairs: on([...TEXT, ...TONES], ["--bg", "--surface", "--surface-2"]) },
  { name: "New Eridu light sheets", file: "zzz.css", chain: [[ZZL], [ZZ]], pairs: on([...TEXT, ...TONES], ["--bg", "--bg-2", "--surface", "--surface-2"]) },
  { name: "New Eridu tone tags", file: "zzz.css", chain: [[ZZ]], pairs: [["#0a0a0a", "--ok"], ["#0a0a0a", "--warn"], ["#0a0a0a", "--info"], ["--on-bad", "--bad"]] },
  { name: "New Eridu light tone tags", file: "zzz.css", chain: [[ZZL], [ZZ]], pairs: [["#fff", "--ok"], ["#fff", "--warn"], ["#fff", "--info"], ["--on-bad", "--bad"]] },
];

describe("game theme contrast", () => {
  it.each(CONTRAST)("$name reaches 4.5:1", ({ file, chain, pairs }) => {
    const color = scope(file, chain);
    const low = pairs
      .map(([t, f]) => ({ t, f, r: ratio(color(t), color(f)) }))
      .filter((p) => p.r < 4.5)
      .map((p) => `${p.t} ${color(p.t)} on ${p.f} ${color(p.f)}: ${p.r.toFixed(2)}`);
    expect(low).toEqual([]);
  });
});
