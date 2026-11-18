// @ts-expect-error The app's tsconfig loads browser types only, so Node's modules have none here
import * as nodeFs from "node:fs";
import { describe, expect, it } from "vitest";

const fs = nodeFs as unknown as {
  readdirSync(dir: URL, opts: { recursive: true; encoding: "utf8" }): string[];
  readFileSync(file: URL, encoding: "utf8"): string;
};

// Something shown on hover must not also show on plain focus. A mouse press focuses the button under it, and
// dragging off before letting go leaves that focus behind, so the thing stays shown with the pointer somewhere else
// (the "..." on a mod card did this). :focus-visible doesn't help: after Escape gives focus back to a button the mouse
// pressed, Chrome counts it as keyboard focus. Gate it on the app's input mode, which a mouse move clears:
// `html:is(.kbd, .pad) .card:focus-within .more`.
const SRC = new URL("../", import.meta.url);
const css = fs.readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .map((f) => f.replaceAll("\\", "/"))
  .filter((f) => f.endsWith(".css"));

/** Rules where focus that a click leaves behind is meant to count, with why. */
const ALLOWED: Record<string, string> = {
  // a dimmed step lights up while you type in it, which is where a click puts you
  ".ai-step.dim:focus-within": "typing in a dimmed step",
};

/** A selector list split at its own commas, not the ones inside :is() or :has(). */
function split(sel: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { out.push(sel.slice(from, i).trim()); from = i + 1; }
  }
  out.push(sel.slice(from).trim());
  return out;
}

function* rules(text: string): Generator<string> {
  const flat = text.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of flat.matchAll(/([^{}]+)\{[^{}]*\}/g)) yield m[1]!.trim();
}

describe("hover-only things", () => {
  it("don't stay shown by focus a mouse press leaves", () => {
    const bad: string[] = [];
    for (const f of css) {
      for (const sel of rules(fs.readFileSync(new URL(f, SRC), "utf8"))) {
        const parts = split(sel);
        if (!parts.some((p) => p.includes(":hover"))) continue;
        for (const p of parts) {
          // :focus-within, bare :focus, :has(:focus...), or :focus-visible on one thing showing another
          if (!/:focus-within|:focus(?![-\w])|:has\(:focus|:focus-visible\)?\s+[.#\w[]/.test(p)) continue;
          if (/html:is\(\.kbd, ?\.pad\)|html\.(kbd|pad)|&\.(kbd|pad)\b/.test(p)) continue;
          if (Object.keys(ALLOWED).some((a) => p.startsWith(a))) continue;
          // a field's own ring while you type in it is focus, not hover
          if (/^\.search:focus-within$/.test(p)) continue;
          bad.push(`${f}: ${p}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
