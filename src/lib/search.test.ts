// @ts-expect-error The app's tsconfig loads browser types only, so Node's modules have none here
import * as nodeFs from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreCommand } from "./search";

const fs = nodeFs as unknown as { readFileSync(file: URL, encoding: "utf8"): string };

// Reads the lists from the source rather than importing settingsSearch.ts, which pulls in the app's store and API.
const src = fs.readFileSync(new URL("../screens/settings/settingsSearch.ts", import.meta.url), "utf8");
const rows = [...src.matchAll(/^\s*\["(set-[a-z0-9-]+)", "[^"]+", shown\(t\("([^"]+)"\)\), "([^"]*)"/gm)]
  .map((m) => ({ id: m[1]!, title: m[2]!, keywords: `setting ${m[3]}` }));
const panels = [...src.matchAll(/^\s*\{ id: "([^"]+)", page: "[^"]+", label: shown\(t\("([^"]+)"\)\), icon: "[^"]+", keywords: "([^"]*)"/gm)]
  .map((m) => ({ id: m[1]!, title: m[2]!, keywords: `settings ${m[3]}` }));

/** The ids that score highest for a query (several on a tie). */
function top(query: string, list: typeof rows): string[] {
  const scored = list.map((r) => ({ id: r.id, s: scoreCommand(query, r) })).filter((r) => r.s > 0);
  const best = Math.max(0, ...scored.map((r) => r.s));
  return scored.filter((r) => r.s === best).map((r) => r.id);
}

describe("search matching", () => {
  it("passes over filler words but still needs a word that names something", () => {
    const intro = { title: "Opening screen", keywords: "intro splash" };
    expect(scoreCommand("turn off the intro", intro)).toBeGreaterThan(0);
    expect(scoreCommand("how do i disab", { title: "Interface animations", keywords: "animations" })).toBe(0);
    expect(scoreCommand("disable animat", { title: "Interface animations", keywords: "animations" })).toBeGreaterThan(0);
    expect(scoreCommand("intro disab", intro)).toBeGreaterThan(0);
    expect(scoreCommand("turn off", intro)).toBe(0);
    expect(scoreCommand("open", { title: "Open XXMI Launcher" })).toBeGreaterThan(0);
  });
});

describe("settings phrasings", () => {
  it("reads the lists", () => {
    expect(rows.length).toBeGreaterThan(50);
    expect(panels.length).toBeGreaterThan(30);
  });

  // what people type, and the single setting it should put first
  const ROWS: Array<[string, string]> = [
    ["launch animation", "set-intro"],
    ["launch screen", "set-intro"],
    ["turn off the intro", "set-intro"],
    ["skip intro", "set-intro"],
    ["splash screen", "set-intro"],
    ["boot animation", "set-intro"],
    ["startup animation", "set-intro"],
    ["teyvat intro", "set-intro"],
    ["disable animations", "set-motion"],
    ["reduce motion", "set-motion"],
    ["smooth scroll", "set-motion-scroll"],
    ["animated background", "set-motion-bg"],
    ["how do i change the language", "set-lang"],
    ["light mode", "set-scheme"],
    ["minimize to tray", "set-background"],
    ["after the game closes", "set-quickstart-after"],
    ["auto update", "set-app-updates"],
    ["font size", "set-text-size"],
    ["ui scale", "set-zoom"],
    ["delete zip after install", "set-archives"],
    ["auto reload", "set-pergame"],
    ["random skins", "set-shuffle"],
    ["how do i turn off ai", "set-ai-show"],
    ["log out", "set-gb-signin"],
    ["run as admin", "set-admin"],
    ["lowercase", "set-chill"],
    ["telemetry", "set-usage"],
    ["reset settings", "set-reset"],
    ["hardware acceleration", "set-gpu"],
    ["hw acceleration flickering", "set-gpu"],
    ["exit when closing", "set-background"],
    ["intro theme", "set-intro"],
    ["tutorial", "set-hints"],
    ["empty trash after days", "set-trash-days"],
    ["blocked creators", "set-creators-blocked"],
    ["dev console", "set-console"],
    ["one skin per character", "set-pergame"],
    ["single game", "set-only-game"],
  ];
  it.each(ROWS)("%s finds %s", (query, id) => {
    expect(top(query, rows)).toEqual([id]);
  });

  // panels that hold settings with no row of their own
  const PANELS: Array<[string, string]> = [
    ["fps unlocker", "launch"],
    ["force 120 fps", "launch"],
    ["windowed", "launch"],
    ["ray tracing", "launch"],
    ["keybinds cheat sheet", "shortcuts"],
    ["unzip", "installing"],
    ["close gachamod when the game starts", "launch"],
    ["move mods folder", "mod-folders"],
  ];
  it.each(PANELS)("%s finds the %s panel", (query, id) => {
    expect(top(query, panels)).toEqual([id]);
  });
});
