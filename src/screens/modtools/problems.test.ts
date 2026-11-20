// @ts-expect-error The app's tsconfig loads browser types only, so Node's modules have none here
import * as nodeFs from "node:fs";
import { describe, expect, it } from "vitest";

const fs = nodeFs as unknown as {
  readdirSync(dir: URL, opts: { recursive: true; encoding: "utf8" }): string[];
  readFileSync(file: URL, encoding: "utf8"): string;
};

// Reads the source rather than importing problems.ts, which pulls in the app's store, API and screens.
// An "orfix" fix adds the missing ORFix call to a mod's inis. It goes through modtools.fix like "point" and "off",
// with a backup and Undo, and it is part of "Fix all".
const SRC = new URL("../../", import.meta.url);
const read = (f: string) => fs.readFileSync(new URL(f, SRC), "utf8").replaceAll("\r\n", "\n");
const problems = read("screens/modtools/problems.ts");

/** The text of one top-level declaration: from its first line to the next blank line. */
const block = (text: string, start: RegExp) => {
  const at = text.search(start);
  expect(at, `${start} is in problems.ts`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(at);
  const end = rest.indexOf("\n\n");
  return end < 0 ? rest : rest.slice(0, end);
};

describe("problem fixes of kind orfix", () => {
  it("are labelled Add ORFix call and explained", () => {
    expect(block(problems, /export function fixLabel/)).toContain('f.kind === "orfix") return t("Add ORFix call")');
    expect(block(problems, /export function fixHint/)).toContain(
      'f.kind === "orfix") return t("Adds the missing ORFix call to each part that needs it, which fixes wrong outline and reflection colors. A backup is kept and Undo puts it back")');
  });

  it("go in Fix all", () => {
    const auto = block(problems, /export const autoFixes/);
    expect(auto).toContain('p.fix.kind !== "keep"');
    expect(auto).not.toContain("orfix");
  });

  it("go through modtools.fix, with the backup and Undo the other fixes get", () => {
    const apply = block(problems, /export async function applyFix/);
    expect(apply).toContain("modtools.fix(game, m.modId, fix)");
    expect(apply).toContain("recordBackups(");
    expect(apply).not.toContain("orfix");
  });

  it("have no other way to modtools.fix in the app", () => {
    const files = fs.readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => /\.tsx?$/.test(f) && !/(^|\/)(demo|dev|api)\/|\.test\.tsx?$/.test(f));
    const callers = files.filter((f) => /\bmodtools\.fix\(/.test(read(f)));
    expect(callers).toEqual(["screens/modtools/problems.ts"]);
  });

  it("never download or run a fixer program", () => {
    expect(problems).not.toMatch(/fixMods|fixerOf|runFixerFixes|"fixer"/);
  });
});
