// @ts-expect-error The app's tsconfig loads browser types only, so Node's modules have none here
import * as nodeFs from "node:fs";
import { describe, expect, it } from "vitest";

const fs = nodeFs as unknown as {
  readdirSync(dir: URL, opts: { recursive: true; encoding: "utf8" }): string[];
  readFileSync(file: URL, encoding: "utf8"): string;
};

// Reads the source rather than importing settingsSearch.ts, which pulls in the app's store and API.
const SRC = new URL("../../", import.meta.url);
const tsx = fs.readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .map((f) => f.replaceAll("\\", "/"))
  .filter((f) => f.endsWith(".tsx"));
const markup = tsx.map((f) => fs.readFileSync(new URL(f, SRC), "utf8")).join("\n");
const search = fs.readFileSync(new URL("./settingsSearch.ts", import.meta.url), "utf8");

describe("settings search", () => {
  it("lists every setting row", () => {
    const rows = new Set([...markup.matchAll(/\bid="(set-[a-z0-9-]+)"/g)].map((m) => m[1]));
    const listed = new Set([...search.matchAll(/^\s*\["(set-[a-z0-9-]+)"/gm)].map((m) => m[1]));
    expect([...rows].filter((id) => !listed.has(id)).sort()).toEqual([]);
  });
});
