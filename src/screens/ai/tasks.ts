// What the AI helper asks for, per task: the prompt (short and exact, with a JSON shape for the answer), what it
// shares, and how it reads the answer back. Answers are checked strictly: a reply that isn't the asked shape is
// refused with a plain reason, and single entries that don't fit (an unknown mod, a character the game doesn't
// have) are left out and listed. Nothing is applied until the user presses Apply, and every apply records Undo.
// Owner: SETTINGS/AI area.
import {
  characters, errorText, library, modKeys, type Backup, type DrawRef, type GameState, type IniOutline, type MetaPatch,
  type ModEntry,
} from "../../lib/api";
import { hideFromAi, neutralName, nothingToSendNote, type AiTask } from "../../lib/ai";
import { record } from "../../lib/history";
import { allGames, currentGame, emitApp, go } from "../../lib/store";
import { plural } from "../../ui/kit";
import { keysChanged, recordBackups } from "../../ui/KeyEditor";
import { ReplyError } from "./reply";
import { buildThemeTask } from "./themeTask";

// ── what a task gives the helper ──

export interface Goal { id: string; label: string; title?: string }
export interface PreviewRow { title: string; lines: Array<{ label: string; before?: string | null; after: string }>; note?: string }
export interface Preview {
  /** One line: "12 mods change". */
  summary: string;
  rows: PreviewRow[];
  /** Entries the reply had that can't be used, with why. */
  skipped: string[];
  /** The chatbot's words: an explanation, steps. */
  text: string[];
  /** Things to open: a Browse search, a GameBanana page, a folder. */
  links: Array<{ label: string; hint?: string; run: () => void }>;
  /** Make the change. Resolves to lines saying what changed (shown after, so nothing happens silently). */
  apply?: () => Promise<string[]>;
  /** Set when the answer stops partway, saying how to get the rest. What's there can be applied, and the chatbot's
   *  next answer can be pasted after it. */
  cut?: string;
}
export interface Built {
  prompt: string;
  /** What the prompt contains, in plain words, shown before copying. */
  shares: string[];
  /** How to take the answer out of the pasted reply, when it isn't one json block (parseReply). */
  parse?: (text: string) => unknown;
  read: (reply: unknown) => Preview;
}
export interface TaskInput { goal: string; text: string }
export interface TaskDef {
  title: (t: AiTask) => string;
  goals?: Goal[];
  defaultGoal?: string;
  /** A text box: required means the prompt can't be made without it. */
  text?: { label: string; placeholder: string; required: boolean; forGoal?: string };
  /** A line under the chatbot choice, for tasks that need more than a small model. */
  note?: string;
  build: (t: AiTask, input: TaskInput) => Promise<Built>;
}

export { CutOff, ReplyError, parseReply } from "./reply";

// ── reading replies ──

type Obj = Record<string, unknown>;
function obj(v: unknown, where: string, keys: string[]): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ReplyError(`${where} should be an object.`);
  const extra = Object.keys(v).filter((k) => !keys.includes(k));
  if (extra.length) throw new ReplyError(`${where} has fields that weren't asked for: ${extra.join(", ")}.`);
  return v as Obj;
}
function list(v: unknown, where: string, max: number): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ReplyError(`${where} should be a list.`);
  if (v.length > max) throw new ReplyError(`${where} has ${v.length} entries; at most ${max} make sense here.`);
  return v;
}
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
const optStr = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ── shared bits ──

function gameOf(t: AiTask): GameState {
  const g = (t.game && allGames().find((x) => x.id === t.game)) || currentGame();
  if (!g) throw new Error("Set up a game first.");
  return g;
}

const ANSWER_RULE = "Reply with exactly one code block marked json, shaped like the example, and nothing after it. Don't add fields.";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const cell = (s: string | null | undefined) => (s ?? "").replace(/[|\n\r]+/g, " ").trim() || "-";

/** The mods a task is about: the picked ones, else the whole library (capped). */
async function modsFor(t: AiTask, game: GameState, cap = 400): Promise<{ mods: ModEntry[]; total: number }> {
  const all = await library.list(game.id);
  const picked = t.modIds?.length ? all.filter((m) => t.modIds!.includes(m.id)) : all;
  return { mods: picked.slice(0, cap), total: picked.length };
}

async function roster(game: GameState): Promise<string[]> {
  try { return (await characters.list(game.id)).map((c) => c.name).filter(Boolean); } catch { return []; }
}

// ── mod edits (mods, custom) ──

const MOD_GOALS: Goal[] = [
  { id: "clean", label: "Tidy names", title: "Messy file-style names become short readable ones" },
  { id: "characters", label: "Set characters", title: "Fill in or fix which character each mod is for" },
  { id: "tags", label: "Add tags", title: "Up to 3 short tags each: outfit, recolor, hair ..." },
  { id: "other", label: "Something else", title: "Say what you want in your own words" },
];

const GOAL_TEXT: Record<string, string> = {
  clean: "Rename mods whose names are messy (file-style names like \"ellen_v2_FINAL\", version numbers, underscores, all caps, the creator's name) to short readable names like \"Ellen - Maid Outfit\". Leave names that are already fine alone.",
  characters: "Set the character for mods that have none or the wrong one, judging by the name and folder. Use only names from the character list. Skip mods that aren't for one character.",
  tags: "Give each mod up to 3 short lowercase tags for what it is, like outfit, recolor, hair, weapon, swimsuit, ui. Keep tags it already has unless they're wrong.",
};

const CHANGE_SHAPE = `{"changes":[{"mod":1,"name":"Ellen - Maid Outfit","character":"Ellen","tags":["outfit"],"why":"few words"}]}`;

// Mods that lib/ai.ts hideFromAi keeps out are left out of mod lists without a word, and nothing in a prompt says
// whether a mod is for adults: it doesn't matter for these jobs, and chatbots refuse a whole request over it.
const shareable = (mods: ModEntry[]) => mods.filter((m) => !hideFromAi(m));

function modTable(mods: ModEntry[]): string {
  return ["number | name | folder | character | tags", ...mods.map((m, i) =>
    `${i + 1} | ${cell(clip(m.name, 90))} | ${cell(clip(m.folder, 70))} | ${cell(m.character)} | ${cell(m.tags.join(", "))}`)].join("\n");
}

/** Read `changes` against the mods that were shared. */
function readChanges(raw: unknown, mods: ModEntry[], names: string[], game: GameState): { rows: PreviewRow[]; skipped: string[]; patches: Array<{ mod: ModEntry; patch: MetaPatch; why: string }> } {
  const rows: PreviewRow[] = [], skipped: string[] = [], patches: Array<{ mod: ModEntry; patch: MetaPatch; why: string }> = [];
  const byName = new Map(names.map((n) => [n.toLowerCase(), n]));
  const seen = new Set<number>();
  list(raw, "\"changes\"", 2000).forEach((c, i) => {
    const e = obj(c, `Change ${i + 1}`, ["mod", "name", "character", "tags", "why"]);
    const n = typeof e.mod === "number" ? e.mod : Number(e.mod);
    const mod = Number.isInteger(n) ? mods[n - 1] : undefined;
    if (!mod) { skipped.push(`Change ${i + 1}: there's no mod number ${String(e.mod)}.`); return; }
    if (seen.has(n)) { skipped.push(`Change ${i + 1}: ${mod.name} is listed twice; the first one counts.`); return; }
    seen.add(n);
    const patch: MetaPatch = {};
    const lines: PreviewRow["lines"] = [];
    const bad: string[] = [];
    if (e.name !== undefined) {
      const v = str(e.name, 120);
      if (!v) bad.push("the name is empty or too long");
      else if (v !== mod.name) { patch.name = v; lines.push({ label: "Name", before: mod.name, after: v }); }
    }
    if (e.character !== undefined) {
      if (e.character === null || e.character === "") {
        if (mod.character) { patch.character = ""; lines.push({ label: "Character", before: mod.character, after: "None" }); }
      } else {
        const v = typeof e.character === "string" ? (names.length ? byName.get(e.character.trim().toLowerCase()) : str(e.character, 60)) : null;
        if (!v) bad.push(`${game.short} has no character "${String(e.character)}"`);
        else if (v !== mod.character) { patch.character = v; lines.push({ label: "Character", before: mod.character, after: v }); }
      }
    }
    if (e.tags !== undefined) {
      const tags = Array.isArray(e.tags) ? e.tags.map((x) => str(x, 30)?.toLowerCase()).filter((x): x is string => !!x) : null;
      if (!tags || tags.length !== (e.tags as unknown[]).length || tags.length > 10) bad.push("the tags aren't a list of short words");
      else {
        const next = [...new Set(tags)];
        if (next.join("\n") !== mod.tags.join("\n")) { patch.tags = next; lines.push({ label: "Tags", before: mod.tags.join(", ") || "None", after: next.join(", ") || "None" }); }
      }
    }
    if (bad.length) { skipped.push(`${mod.name}: ${bad.join(", ")}.`); return; }
    if (!lines.length) return;
    const why = optStr(e.why, 160);
    rows.push({ title: mod.name, lines, note: why || undefined });
    patches.push({ mod, patch, why });
  });
  return { rows, skipped, patches };
}

function applyPatches(game: GameState, patches: Array<{ mod: ModEntry; patch: MetaPatch; why: string }>, label: string): () => Promise<string[]> {
  return async () => {
    const before = patches.map(({ mod, patch }) => {
      const back: MetaPatch = {};
      if (patch.name !== undefined) back.name = mod.name;
      if (patch.character !== undefined) back.character = mod.character ?? "";
      if (patch.tags !== undefined) back.tags = mod.tags;
      return { id: mod.id, back };
    });
    const run = async (items: Array<{ id: string; patch: MetaPatch }>) => {
      const failed: string[] = [];
      for (const it of items) { try { await library.updateMeta(game.id, it.id, it.patch); } catch (e) { failed.push(errorText(e)); } }
      emitApp({ type: "library-refresh", game: game.id });
      if (failed.length === items.length && items.length) throw new Error(failed[0]);
      return failed;
    };
    const failed = await run(patches.map((p) => ({ id: p.mod.id, patch: p.patch })));
    record({
      label,
      undo: () => run(before.map((b) => ({ id: b.id, patch: b.back }))),
      redo: () => run(patches.map((p) => ({ id: p.mod.id, patch: p.patch }))),
    });
    const out = patches.map(({ mod, patch, why }) => {
      const parts = [patch.name !== undefined ? `${mod.name} is now "${patch.name}"` : mod.name];
      if (patch.character !== undefined) parts.push(patch.character ? `character ${patch.character}` : "no character");
      if (patch.tags !== undefined) parts.push(`tags ${patch.tags.join(", ") || "none"}`);
      return `${parts.join(", ")}${why ? ` (${why})` : ""}`;
    });
    if (failed.length) out.push(`${plural(failed.length, "change")} didn't save: ${failed[0]}`);
    return out;
  };
}

const modsTask: TaskDef = {
  title: (t) => (t.modIds?.length ? `Edit ${plural(t.modIds.length, "mod")} with your chatbot` : "Edit your mods with your chatbot"),
  goals: MOD_GOALS,
  defaultGoal: "clean",
  text: { label: "What should change?", placeholder: "Put the outfit name first, like \"Maid Outfit (Ellen)\"", required: true, forGoal: "other" },
  async build(t, input) {
    const game = gameOf(t);
    const { mods: all, total } = await modsFor(t, game);
    const mods = shareable(all);
    if (!mods.length) throw new Error(all.length ? nothingToSendNote(all.length) : `${game.name} has no mods to edit yet.`);
    // the roster checks any character the answer sets; the prompt carries it only when characters are the point
    const names = await roster(game);
    const sendNames = (input.goal === "characters" || input.goal === "other") && names.length > 0;
    const ask = input.goal === "other" ? input.text.trim() : GOAL_TEXT[input.goal] ?? GOAL_TEXT.clean!;
    const prompt = [
      `I manage 3DMigoto mods for ${game.name} in a mod manager. ${ask}`,
      `My mods, one per line:\n${modTable(mods)}`,
      sendNames ? `${game.name} characters: ${names.join(", ")}.` : "",
      `List only mods that change, and only the fields that change. "mod" is the number from my list. ${ANSWER_RULE}`,
      "```json\n" + CHANGE_SHAPE + "\n```",
    ].filter(Boolean).join("\n\n");
    return {
      prompt,
      shares: [
        `Names, folder names, characters and tags of ${plural(mods.length, "mod")}${total > all.length ? ` (from the first ${all.length} of ${total})` : ""}`,
        ...(sendNames ? [`${game.name}'s character list`] : []),
        ...(input.goal === "other" && input.text.trim() ? ["What you typed"] : []),
      ],
      read(reply) {
        const r = obj(reply, "The answer", ["changes"]);
        const { rows, skipped, patches } = readChanges(r.changes, mods, names, game);
        const label = `Changed ${plural(patches.length, "mod")} with the AI helper`;
        return {
          summary: patches.length ? `${plural(patches.length, "mod")} change${patches.length === 1 ? "s" : ""}` : "Nothing to change",
          rows, skipped, text: [], links: [],
          apply: patches.length ? applyPatches(game, patches, label) : undefined,
        };
      },
    };
  },
};

const customTask: TaskDef = {
  title: (t) => (t.modIds?.length ? `Ask about ${plural(t.modIds.length, "mod")}` : "Ask your chatbot"),
  text: { label: "Your question or request", placeholder: "Which of these are duplicates? Or: rename these so the outfit comes first", required: true },
  async build(t, input) {
    const game = gameOf(t);
    const { mods: all, total } = t.modIds?.length ? await modsFor(t, game, 200) : { mods: [] as ModEntry[], total: 0 };
    const mods = shareable(all);
    if (all.length && !mods.length) throw new Error(nothingToSendNote(all.length));
    const names = mods.length ? await roster(game) : [];
    const prompt = [
      `I manage 3DMigoto mods for ${game.name} in a mod manager. ${input.text.trim()}`,
      mods.length ? `The mods this is about, one per line:\n${modTable(mods)}` : "",
      `Put your answer in "answer" (plain text, short). If I asked for changes to the mods, list them in "changes" with only the fields that change ("mod" is the number from my list). ${ANSWER_RULE}`,
      "```json\n" + `{"answer":"...","changes":[{"mod":1,"name":"New name","character":"Ellen","tags":["outfit"],"why":"few words"}]}` + "\n```",
    ].filter(Boolean).join("\n\n");
    return {
      prompt,
      shares: ["What you typed", ...(mods.length ? [`Names, folder names, characters and tags of ${plural(mods.length, "mod")}${total > all.length ? ` (from the first ${all.length})` : ""}`] : [])],
      read(reply) {
        const r = obj(reply, "The answer", ["answer", "changes"]);
        const { rows, skipped, patches } = mods.length ? readChanges(r.changes, mods, names, game) : { rows: [], skipped: [], patches: [] };
        const answer = optStr(r.answer, 6000);
        return {
          summary: patches.length ? `${plural(patches.length, "mod")} change${patches.length === 1 ? "s" : ""}` : answer ? "The chatbot's answer" : "Nothing in the answer",
          rows, skipped, text: answer ? answer.split(/\n+/) : [], links: [],
          apply: patches.length ? applyPatches(game, patches, `Changed ${plural(patches.length, "mod")} with the AI helper`) : undefined,
        };
      },
    };
  },
};

// ── keys that work off screen (applied by gachamod) ──

/** Prompt names for one mod's files or sections with explicit words swapped out (lib/ai.ts neutralName), and the
 *  way back for reading the answer. Two names that end up the same get a number. */
function aliases() {
  const to = new Map<string, string>(), from = new Map<string, string>();
  return {
    name(real: string): string {
      const known = to.get(real);
      if (known !== undefined) return known;
      const base = neutralName(real);
      let a = base;
      for (let n = 2; from.has(a.toLowerCase()); n++) a = `${base}${n}`;
      to.set(real, a); from.set(a.toLowerCase(), real);
      return a;
    },
    real: (shown: string) => from.get(shown.toLowerCase()) ?? shown,
  };
}
type Aliases = ReturnType<typeof aliases>;

const DRAW_SHAPE = `{"mods":[{"mod":1,"draw":[{"file":"Ellen.ini","section":"TextureOverrideEllenBodyPosition"}],"why":"few words"}]}`;

const keysTask: TaskDef = {
  title: (t) => (t.modIds && t.modIds.length > 1 ? `Toggles only while on screen for ${plural(t.modIds.length, "mod")}` : "Toggles only while on screen"),
  note: "This takes a strong chatbot, like Claude Opus 5.5. Weaker ones often pick the wrong sections. If a toggle stops working in game, Undo puts it back.",
  async build(t) {
    const game = gameOf(t);
    const { mods: picked } = await modsFor(t, game, 8);
    if (!picked.length) throw new Error("Pick the mod first.");
    const found = await Promise.all(picked.map(async (m) => ({
      mod: m,
      keys: await modKeys.list(game.id, m.id).catch(() => null),
      outline: await modKeys.outline(game.id, m.id).catch(() => [] as IniOutline[]),
    })));
    const todo = found.filter((f) => f.keys && f.keys.keys.length && !["own", "on", "global"].includes(f.keys.onScreen) && f.outline.some((o) => o.sections.length));
    if (!todo.length) throw new Error(picked.length === 1 ? "This mod's toggles already work only while it's on screen, or it has nothing to pick from." : "These mods' toggles already work only while they're on screen.");
    // hidden mods go without their names, and explicit words in file and section names are swapped out
    const items = todo.map((f) => ({ mod: f.mod, outline: f.outline, files: aliases(), sections: aliases() }));
    const blocks = items.map(({ mod, outline, files, sections }, i) => {
      const inis = outline.map((o) => [
        `  File ${files.name(o.ini)}${o.namespace ? ` (namespace ${neutralName(o.namespace)})` : " (no namespace)"}${o.keys.length ? `, key sections: ${o.keys.slice(0, 20).map(neutralName).join(", ")}` : ", no keys"}`,
        ...o.sections.slice(0, 60).map((s) => `    [${sections.name(s.section)}] ${neutralName(s.lines.join("; "))}`),
      ].join("\n"));
      return `Mod ${i + 1}${hideFromAi(mod) ? "" : `: ${mod.name}`}${mod.character ? ` (${mod.character})` : ""}\n${inis.join("\n")}`;
    });
    const prompt = [
      `These 3DMigoto mods for ${game.name} have hotkeys that also work while their character isn't on screen, so they clash with other mods using the same keys. gachamod can fix that itself once it knows which sections draw the character: it sets a flag in those sections, clears it every frame in [Present] and adds a condition on the key sections.`,
      "For each mod, pick the TextureOverride sections that run only while the character's model is drawn in the world: the body, position or blend buffer, or the main index buffer. Not a texture that can also show in menus, not a weapon on its own, not a section with override_vertex_count. The sections must be in the same file as the keys, or in a file that has a namespace. Leave out a mod if none fits.",
      blocks.join("\n\n"),
      `"mod" is the mod's number above, "file" and "section" exactly as listed (section without brackets). ${ANSWER_RULE}`,
      "```json\n" + DRAW_SHAPE + "\n```",
    ].join("\n\n");
    const mods = todo.map((f) => f.mod);
    return {
      prompt,
      shares: [`Names and a few lines (hashes, buffers, draw calls) of the override sections in ${plural(mods.length, "mod")}, and their key section names. No other file contents`,
        "Mod names and characters"],
      read: (reply) => readDraws(reply, game, items),
    };
  },
};

function readDraws(reply: unknown, game: GameState, mods: Array<{ mod: ModEntry; outline: IniOutline[]; files: Aliases; sections: Aliases }>): Preview {
  const r = obj(reply, "The answer", ["mods"]);
  const rows: PreviewRow[] = [], skipped: string[] = [];
  const picks: Array<{ mod: ModEntry; draw: DrawRef[] }> = [];
  const seen = new Set<number>();
  list(r.mods, "\"mods\"", 50).forEach((x, i) => {
    const e = obj(x, `Entry ${i + 1}`, ["mod", "draw", "why"]);
    const n = Number(e.mod);
    const it = Number.isInteger(n) ? mods[n - 1] : undefined;
    if (!it) { skipped.push(`Entry ${i + 1}: there's no mod number ${String(e.mod)}.`); return; }
    if (seen.has(n)) { skipped.push(`${it.mod.name} is listed twice; the first one counts.`); return; }
    seen.add(n);
    const draw: DrawRef[] = [];
    const before = skipped.length;
    list(e.draw, `${it.mod.name}'s sections`, 40).forEach((y, j) => {
      const d = obj(y, `${it.mod.name}, section ${j + 1}`, ["file", "section"]);
      const wantFile = typeof d.file === "string" ? it.files.real(d.file.trim().replaceAll("\\", "/")).toLowerCase() : "";
      const file = it.outline.find((o) => o.ini.toLowerCase() === wantFile);
      const want = typeof d.section === "string" ? it.sections.real(d.section.trim().replace(/^\[|\]$/g, "")).toLowerCase() : "";
      const sec = file?.sections.find((s) => s.section.toLowerCase() === want);
      if (!file || !sec) { skipped.push(`${it.mod.name}: ${String(d.file)} has no section ${String(d.section)}.`); return; }
      if (!draw.some((x) => x.ini === file.ini && x.section === sec.section)) draw.push({ ini: file.ini, section: sec.section });
    });
    if (!draw.length) { if (skipped.length === before) skipped.push(`${it.mod.name}: no section to use.`); return; }
    const keyFiles = it.outline.filter((o) => o.keys.length).map((o) => o.ini);
    const reach = (f: string) => draw.some((d) => d.ini === f) || draw.some((d) => it.outline.find((o) => o.ini === d.ini)?.namespace);
    const left = keyFiles.filter((f) => !reach(f));
    rows.push({
      title: it.mod.name,
      lines: draw.map((d) => ({ label: d.ini, after: `[${d.section}]` })),
      note: [optStr(e.why, 160), left.length ? `Toggles in ${left.join(", ")} will still work any time: none of these sections can reach them.` : ""].filter(Boolean).join(" ") || undefined,
    });
    picks.push({ mod: it.mod, draw });
  });
  return {
    summary: picks.length ? `Toggles of ${plural(picks.length, "mod")} will work only while on screen` : "Nothing to change",
    rows, skipped, text: [], links: [],
    apply: picks.length ? async () => {
      const done: Array<{ game: string; modId: string; backup: Backup }> = [];
      const out: string[] = [];
      for (const p of picks) {
        try {
          const edit = await modKeys.onScreen(game.id, p.mod.id, true, p.draw);
          if (edit.backup) done.push({ game: game.id, modId: p.mod.id, backup: edit.backup });
          keysChanged(game.id, p.mod.id);
          out.push(edit.backup ? `Toggles of ${p.mod.name} work only while on screen${edit.note ? `. ${edit.note}` : ""}` : `${p.mod.name}: ${edit.note ?? "nothing to change"}`);
        } catch (e) {
          out.push(`${p.mod.name} didn't change: ${errorText(e)}`);
        }
      }
      if (done.length) recordBackups(`Toggles of ${plural(done.length, "mod")} work only while on screen`, done);
      return out;
    } : undefined,
  };
}

// ── mod ideas ──

const GB_MOD = /^https?:\/\/(?:www\.)?gamebanana\.com\/mods\/(\d+)/i;

const recommendTask: TaskDef = {
  title: () => "Mod ideas from your chatbot",
  text: { label: "Anything in particular? (optional)", placeholder: "Swimsuits, or mods for characters I don't have mods for yet", required: false },
  async build(t, input) {
    const game = gameOf(t);
    const prompt = [
      `I use 3DMigoto mods from GameBanana for ${game.name}. Suggest mods I might like.`,
      t.detail ?? "",
      input.text.trim() ? `I'd like: ${input.text.trim()}` : "",
      `Give up to 12 ideas. Each is either a GameBanana search ("search": 1 to 4 words, like a character and an outfit type) or a GameBanana mod page you are sure exists ("url": https://gamebanana.com/mods/<number>), with "why" in a few words. ${ANSWER_RULE}`,
      "```json\n" + `{"ideas":[{"search":"Ellen swimsuit","why":"you collect Ellen mods"},{"url":"https://gamebanana.com/mods/123456","why":"few words"}]}` + "\n```",
    ].filter(Boolean).join("\n\n");
    return {
      prompt,
      shares: ["A summary of your mods: top characters, creators you keep and up to 40 mod names", ...(input.text.trim() ? ["What you typed"] : [])],
      read(reply) {
        const r = obj(reply, "The answer", ["ideas"]);
        const links: Preview["links"] = [], skipped: string[] = [];
        list(r.ideas, "\"ideas\"", 30).forEach((x, i) => {
          const e = obj(x, `Idea ${i + 1}`, ["search", "url", "why"]);
          const why = optStr(e.why, 140) || undefined;
          const search = str(e.search, 60);
          const url = typeof e.url === "string" ? GB_MOD.exec(e.url.trim()) : null;
          if (url) links.push({ label: `GameBanana mod ${url[1]}`, hint: why, run: () => go({ view: "browse", modId: Number(url[1]) }) });
          else if (search) links.push({ label: `Search "${search}"`, hint: why, run: () => go({ view: "browse", search }) });
          else skipped.push(`Idea ${i + 1}: not a search or a GameBanana mod link.`);
        });
        return { summary: links.length ? `${plural(links.length, "idea")}. Each opens in Browse` : "No ideas in the answer", rows: [], skipped, text: [], links };
      },
    };
  },
};

export const TASKS: Record<string, TaskDef> = {
  mods: modsTask,
  custom: customTask,
  "keys-offscreen": keysTask,
  recommend: recommendTask,
  theme: {
    title: () => "Make a theme with your chatbot",
    text: { label: "Describe the look", placeholder: "Enter text here...", required: true },
    build: (t, input) => buildThemeTask(t, input),
  },
};
