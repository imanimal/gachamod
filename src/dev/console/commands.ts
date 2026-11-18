// The console's commands. Typed ("managers zzz") or run by the buttons on the Flows tab, which show their command in
// a tip so it can be typed next time. Commands marked demo set up dummy data and only work in the browser demo; in the
// installed app they say so instead of running.
import { inTauri, demoEmit } from "../../lib/tauri";
import { currentGame, allGames, go, setGame, type View } from "../../lib/store";
import { LANGS, lang, setLangChoice, tb, type Lang } from "../../lib/i18n";
import { setModsFormat, type ModsFormat } from "../../lib/theme";
import { toast } from "../../ui/toast";
import { allLines, clearLines, print, push, show } from "./log";

export interface Command {
  name: string;
  /** Shown after the name in help and completion: "<view> [section]". */
  args?: string;
  help: string;
  demo?: boolean;
  /** Values for completing argument `i` (0 = the first after the name). */
  complete?: (i: number, args: string[]) => string[];
  run: (args: string[]) => void | Promise<void>;
}

const VIEWS: View[] = ["home", "browse", "characters", "library", "profiles", "downloads", "tools", "settings", "extensions"];
const FORMATS: ModsFormat[] = ["cards", "chars", "panes", "rows"];
const SCENARIO_KEYS = ["imm", "nrmm", "others", "running", "blockedSplit", "newChecks"] as const;
const gameIds = () => allGames().map((g) => g.id);
const onOff = (v: string | undefined, now: boolean) => (v === "on" || v === "1" || v === "true" ? true : v === "off" || v === "0" || v === "false" ? false : !now);

/** The console's view of what it shows; set by Console.tsx. */
export const view = { filter: "", level: "all" as "all" | "warn" | "error", calls: true, tab: "output" as "output" | "flows", set: (_: Partial<{ filter: string; level: "all" | "warn" | "error"; calls: boolean; tab: "output" | "flows" }>) => {} };

function game(id?: string): string | null {
  if (id) {
    if (!gameIds().includes(id)) { print(`No game "${id}". Games: ${gameIds().join(", ")}`, "warn"); return null; }
    setGame(id);
    return id;
  }
  return currentGame()?.id ?? null;
}

/** The demo's dummy data switches. Only demo commands use it, and exec() keeps those out of the installed app. */
const demoScenario = () => import("../../lib/demo/scenario");

export const COMMANDS: Command[] = [
  { name: "help", args: "[command]", help: "List the commands, or explain one", complete: () => COMMANDS.map((c) => c.name),
    run: ([name]) => {
      if (name) {
        const c = COMMANDS.find((x) => x.name === name);
        if (!c) { print(`No command "${name}"`, "warn"); return; }
        print(`${c.name}${c.args ? ` ${c.args}` : ""}: ${c.help}${c.demo ? " (demo only)" : ""}`);
        return;
      }
      const w = Math.max(...COMMANDS.map((c) => (c.name + (c.args ? ` ${c.args}` : "")).length));
      print(COMMANDS.map((c) => `${(c.name + (c.args ? ` ${c.args}` : "")).padEnd(w)}  ${c.help}${c.demo ? " (demo)" : ""}`).join("\n"));
    } },
  { name: "clear", help: "Empty the output", run: () => clearLines() },
  { name: "copy", help: "Copy the output (what the filters show) as text",
    run: async () => {
      const text = allLines().map((l) => `${new Date(l.at).toISOString().slice(11, 23)} ${l.level.padEnd(5)} ${l.source.padEnd(7)} ${l.text}${l.detail ? `\n    ${l.detail.replace(/\n/g, "\n    ")}` : ""}`).join("\n");
      await navigator.clipboard.writeText(text);
      print(`Copied ${allLines().length} lines`);
    } },
  { name: "filter", args: "[text]", help: "Show only lines with this text (nothing clears it)", run: (a) => view.set({ filter: a.join(" ") }) },
  { name: "level", args: "<all|warn|error>", help: "Show everything, or only warnings and errors", complete: () => ["all", "warn", "error"],
    run: ([l]) => view.set({ level: l === "warn" || l === "error" ? l : "all" }) },
  { name: "calls", args: "[on|off]", help: "Show every backend call that worked (failures always show)", complete: () => ["on", "off"],
    run: ([v]) => view.set({ calls: onOff(v, view.calls) }) },
  { name: "log", args: "[kb]", help: "Print the end of gachamod.log (new lines show by themselves)",
    run: async ([kb]) => {
      const { report } = await import("../../lib/api");
      const text = await report.logTail(Math.max(1, Number(kb) || 64) * 1024);
      if (!text.trim()) { print("gachamod.log is empty"); return; }
      for (const line of text.trimEnd().split(/\r?\n/)) {
        const lvl = / error /.test(line.slice(19, 27)) ? "error" : / warn /.test(line.slice(19, 27)) ? "warn" : "info";
        push(lvl, "backend", line);
      }
    } },
  { name: "go", args: "<view> [section]", help: "Open a page: go tools others, go settings appearance", complete: (i) => (i === 0 ? VIEWS : []),
    run: ([v, section]) => {
      if (!VIEWS.includes(v as View)) { print(`Views: ${VIEWS.join(", ")}`, "warn"); return; }
      go(section ? { view: v as View, section } : (v as View));
    } },
  { name: "game", args: "<id>", help: "Switch the current game", complete: () => gameIds(), run: ([id]) => { if (game(id)) print(`Game: ${id}`); } },
  { name: "games", help: "List the games and their Mods folders",
    run: () => print(allGames().map((g) => `${g.id.padEnd(5)} ${g.shown ? "shown " : "hidden"} ${g.modCount} mods  ${g.modsDir ?? "(no Mods folder)"}`).join("\n")) },
  { name: "reload", help: "Reload the window", run: () => location.reload() },

  { name: "scenario", args: "[name] [on|off]", demo: true, help: "What the demo pretends is on this PC; no name lists them",
    complete: (i) => (i === 0 ? [...SCENARIO_KEYS] : ["on", "off"]),
    run: async ([name, v]) => {
      const s = await demoScenario();
      if (!name) { print(Object.entries(s.scenario()).map(([k, x]) => `${k.padEnd(13)} ${x ? "on" : "off"}`).join("\n")); return; }
      if (!(SCENARIO_KEYS as readonly string[]).includes(name)) { print(`Scenarios: ${SCENARIO_KEYS.join(", ")}`, "warn"); return; }
      const key = name as (typeof SCENARIO_KEYS)[number];
      s.setScenario({ [key]: onOff(v, s.scenario()[key]) });
      print(`${key} ${s.scenario()[key] ? "on" : "off"}. Open the page again to see it`);
    } },
  { name: "reset", demo: true, help: "Put back every manager the demo moved mods out of, so the moves can run again",
    run: async () => { (await demoScenario()).resetMoves(); print("Every manager has its mods again"); } },
  { name: "managers", args: "[game]", help: "Open Tools > Share and import, Mods from other managers (zzz and gi have the most in the demo)", complete: () => gameIds(),
    run: ([id]) => {
      if (id && !game(id)) return;
      go({ view: "tools", section: "others" });
      if (inTauri()) print("Opened Tools > Share and import. It lists the managers really on this PC; the dummy ones are only in the browser demo (npm run dev)", "warn");
    } },
  { name: "firststart", args: "[fresh]", demo: true, help: "Start over as a first start; fresh also takes the mod loaders away (setup page)",
    complete: () => ["fresh"],
    run: ([f]) => {
      const url = new URL(location.href);
      if (f === "fresh") url.searchParams.set("fresh", ""); else url.searchParams.delete("fresh");
      location.href = url.toString();
    } },
  { name: "merged", args: "[game]", demo: true, help: "Open a merged mod (three outfits in one) to try its names and Split", complete: () => gameIds(),
    run: async ([id]) => {
      const g = game(id); if (!g) return;
      const { demoMergedMods } = await import("../../lib/demo/modtools");
      const m = demoMergedMods(g)[0];
      if (!m) { print(`No merged mod in ${g}`, "warn"); return; }
      go({ view: "library", modId: m.id });
      print(`Opened ${m.name}. Options shows the outfits by name; Split is in the Merged mod section`);
    } },
  { name: "addmod", demo: true, help: "Pretend a mod was copied into the Mods folder in Explorer (watching folders)",
    run: async () => {
      const g = game(); if (!g) return;
      const { demoDb, demoId, demoNow } = await import("../../lib/demo/db");
      const list = demoDb.mods.get(g) ?? [];
      const base = list[0]; if (!base) { print(`${g} has no mods to copy`, "warn"); return; }
      const name = `Hand-copied mod ${list.filter((m) => m.name.startsWith("Hand-copied")).length + 1}`;
      list.push({ ...base, id: demoId(), name, folder: name, relPath: name, path: `${base.path.replace(/[^\\]+$/, "")}${name}`, installedAt: demoNow(), source: null, enabled: true });
      demoDb.mods.set(g, list);
      watched(g, `Added ${name}`);
    } },
  { name: "delmod", demo: true, help: "Pretend the newest mod was deleted in Explorer (watching folders)",
    run: async () => {
      const g = game(); if (!g) return;
      const { demoDb } = await import("../../lib/demo/db");
      const list = demoDb.mods.get(g) ?? [];
      const gone = [...list].sort((a, b) => b.installedAt - a.installedAt)[0];
      if (!gone) { print("No mods left", "warn"); return; }
      demoDb.mods.set(g, list.filter((m) => m !== gone));
      watched(g, `Deleted ${gone.name}`);
    } },
  { name: "lang", args: "<auto|en|zh-CN|es|pt-BR|ru>", help: "Change the language (reloads)", complete: () => ["auto", ...LANGS.map((l) => l.id)],
    run: async ([l]) => {
      if (l !== "auto" && !LANGS.some((x) => x.id === l)) { print(`Languages: auto, ${LANGS.map((x) => x.id).join(", ")}`, "warn"); return; }
      const { settings } = await import("../../lib/api");
      setLangChoice(l as Lang | "auto", (v) => settings.set("ui.lang", v));
    } },
  { name: "layout", args: "<cards|chars|panes|rows>", help: "Switch the Mods layout and open Mods", complete: () => FORMATS,
    run: ([f]) => {
      if (!FORMATS.includes(f as ModsFormat)) { print(`Layouts: ${FORMATS.join(", ")}`, "warn"); return; }
      setModsFormat(f as ModsFormat);
      go("library");
    } },
  { name: "toast", args: "<text>", help: "Show a toast, translated like a backend message", run: (a) => { toast(a.join(" ") || "Hello from the console"); } },
  { name: "error", args: "<text>", help: "Show an error toast; places it names get their button", run: (a) => { toast(a.join(" ") || "Something went wrong", true); } },
  { name: "msg", args: "<english>", help: "Which backend pattern a message matches, and how it reads in the current language",
    run: async (a) => {
      const en = a.join(" ");
      const { BACKEND } = await import("../../lib/i18n/backend");
      const re = (p: string) => new RegExp(`^${p.split(/(\{\w+\})/).map((x) => (/^\{\w+\}$/.test(x) ? "(.+?)" : x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("")}$`, "s");
      const hit = BACKEND.find((p) => re(p).test(en));
      print(hit ? `Pattern: ${hit}` : "No backend pattern matches it whole (a sentence of it may still match)", hit ? "info" : "warn");
      if (lang === "en") print("The window is in English. lang ru (or zh-CN, es, pt-BR) shows the translation");
      else { const out = tb(en); print(out === en ? "Stays English: no translation for it" : `${lang}: ${out}`, out === en ? "warn" : "info"); }
    } },
  { name: "eval", args: "<js>", help: "Run JavaScript in the window and print the result",
    run: async (a) => { const r: unknown = await (0, eval)(a.join(" ")); print(show(r)); } },
];

/** A Mods folder changed on disk: with watching on, the backend's watcher tells the library; off, it waits. */
function watched(game: string, what: string) {
  void import("../../lib/demo/db").then(({ demoDb }) => {
    if (demoDb.settings.get("library.watch") === "0") {
      print(`${what}. Watching Mods folders is off, so Mods shows it after a rescan`, "warn");
      return;
    }
    demoEmit("app-log", { level: "info", text: `Watching ${game}'s Mods folder: ${what.toLowerCase()}, rescanning` });
    demoEmit("library-changed", { game });
    print(`${what}. Mods updates by itself`);
  });
}

/** Split a typed line into words; "quoted text" stays one word. */
export function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}

export async function exec(line: string) {
  const text = line.trim();
  if (!text) return;
  push("info", "you", `] ${text}`);
  const [name, ...args] = words(text);
  const c = COMMANDS.find((x) => x.name === name);
  if (!c) { print(`Unknown command "${name}". Type help`, "warn"); return; }
  if (c.demo && inTauri()) { print(`${c.name} sets up dummy data, so it only works in the browser demo (npm run dev)`, "warn"); return; }
  try { await c.run(args); } catch (e) { print(show(e), "error"); }
}

/** What Tab completes to, and the choices to show under the line. */
export function completions(line: string): string[] {
  const parts = line.split(" ");
  if (parts.length <= 1) return COMMANDS.map((c) => c.name).filter((n) => n.startsWith(parts[0] ?? ""));
  const c = COMMANDS.find((x) => x.name === parts[0]);
  if (!c?.complete) return [];
  const i = parts.length - 2;
  const typed = parts[parts.length - 1] ?? "";
  return c.complete(i, parts.slice(1)).filter((v) => v.toLowerCase().startsWith(typed.toLowerCase())).map((v) => [...parts.slice(0, -1), v].join(" "));
}
