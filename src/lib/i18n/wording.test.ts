// @ts-expect-error The app's tsconfig loads browser types only, so Node's modules have none here
import * as nodeFs from "node:fs";
import { describe, expect, it } from "vitest";
import { wordingProblems } from "../../../scripts/wording.mjs";
import { BACKEND } from "./backend";

const fs = nodeFs as unknown as {
  readdirSync(dir: URL, opts: { recursive: true; encoding: "utf8" }): string[];
  readFileSync(file: URL, encoding: "utf8"): string;
};

// Every line of the app's own text (what t(), tn() and tx() get, and the backend's messages) reads like a person
// wrote it: no em dashes, stock words, hype or dressing things up ("wears that game's theme"). The list and the
// reasons are in scripts/wording.mjs, which the release notes are checked against too.
const SRC = new URL("../../", import.meta.url);
const files = fs.readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .map((f) => f.replaceAll("\\", "/"))
  .filter((f) => /\.tsx?$/.test(f) && !/(^|\/)(demo|dev)\/|\.test\.tsx?$|fixtures/.test(f));

const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const lines = new Map<string, string>();
for (const f of files) {
  const text = fs.readFileSync(new URL(f, SRC), "utf8");
  for (const m of text.matchAll(new RegExp(String.raw`\b(?:t|tx|tb)\(\s*` + STR, "g"))) lines.set(m[1]!, f);
  for (const m of text.matchAll(new RegExp(String.raw`\btn\([^,]+,\s*` + STR + String.raw`,\s*` + STR, "g"))) { lines.set(m[1]!, f); lines.set(m[2]!, f); }
}
for (const k of BACKEND) lines.set(k, "lib/i18n/backend.ts");

describe("the app's text", () => {
  it("reads like a person wrote it", () => {
    expect(lines.size).toBeGreaterThan(500);
    const bad = [...lines].flatMap(([line, f]) => wordingProblems(line).map((p) => `${f}: ${line}\n    ${p}`));
    expect(bad).toEqual([]);
  });
});
