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
