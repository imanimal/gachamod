// What the AI helper asks for, per task: the prompt (short and exact, with a JSON shape for the answer), what it
// shares, and how it reads the answer back. Answers are checked strictly: a reply that isn't the asked shape is
// refused with a plain reason, and single entries that don't fit (an unknown mod, a character the game doesn't
// have) are left out and listed. Nothing is applied until the user presses Apply, and every apply records Undo.
// Owner: SETTINGS/AI area.
import {
  characters, errorText, library, modKeys, type Backup, type DrawRef, type GameState, type IniOutline, type MetaPatch,
  type ModEntry,
} from "../../lib/api";
import { hideFromAi, neutralName, nothingToSendNote, type AiTask, type JobFile } from "../../lib/ai";
import { modContext, type ModContext } from "./context";
import { record } from "../../lib/history";
import { allGames, currentGame, emitApp, go } from "../../lib/store";
import { keysChanged, recordBackups } from "../../ui/KeyEditor";
import { ReplyError } from "./reply";
import { buildThemeTask, themeToEdit } from "./themeTask";
import { gameName, gameShort } from "../../lib/games";
import { sentences, t, tb, tn } from "../../lib/i18n";

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
  /** Reference files, sent only when the chatbot answers in the app (context.ts). */
  files?: JobFile[];
}
/** `rich`: the chatbot answers in the app, so the prompt can be long and come with files. */
export interface TaskInput { goal: string; text: string; rich?: boolean }
export interface TaskDef {
  title: (task: AiTask) => string;
  goals?: Goal[];
  defaultGoal?: string;
  /** A text box: required means the prompt can't be made without it. */
  /** A text box. `examples`: one is shown at random as the placeholder, and Tab fills it in. */
  text?: { label: string; examples: string[]; required: boolean; forGoal?: string };
  /** A line under the chatbot choice, for tasks that need more than a small model. */
  note?: string;
  build: (task: AiTask, input: TaskInput) => Promise<Built>;
}

export { CutOff, ReplyError, parseReply } from "./reply";

// ── reading replies ──

type Obj = Record<string, unknown>;
function obj(v: unknown, where: string, keys: string[]): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ReplyError(t("{where} should be an object.", { where }));
  const extra = Object.keys(v).filter((k) => !keys.includes(k));
  if (extra.length) throw new ReplyError(t("{where} has fields that weren't asked for: {fields}.", { where, fields: extra.join(", ") }));
  return v as Obj;
}
function list(v: unknown, where: string, max: number): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ReplyError(t("{where} should be a list.", { where }));
  if (v.length > max) throw new ReplyError(t("{where} has {n} entries; at most {max} make sense here.", { where, n: v.length, max }));
  return v;
}
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
const optStr = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ── shared bits ──

function gameOf(task: AiTask): GameState {
  const g = (task.game && allGames().find((x) => x.id === task.game)) || currentGame();
  if (!g) throw new Error(t("Set up a game first."));
  return g;
}

const ANSWER_RULE = "Reply with exactly one code block marked json, shaped like the example, and nothing after it. Don't add fields.";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const cell = (s: string | null | undefined) => (s ?? "").replace(/[|\n\r]+/g, " ").trim() || "-";

/** The mods a task is about: the picked ones, else the whole library (capped). */
async function modsFor(task: AiTask, game: GameState, cap = 400): Promise<{ mods: ModEntry[]; total: number }> {
  const all = await library.list(game.id);
  const picked = task.modIds?.length ? all.filter((m) => task.modIds!.includes(m.id)) : all;
  return { mods: picked.slice(0, cap), total: picked.length };
}

async function roster(game: GameState): Promise<string[]> {
  try { return (await characters.list(game.id)).map((c) => c.name).filter(Boolean); } catch { return []; }
}

// ── mod edits (mods, custom) ──

const MOD_GOALS: Goal[] = [
  { id: "clean", label: t("Tidy names"), title: t("Messy file-style names become short readable ones") },
  { id: "characters", label: t("Set characters"), title: t("Fill in or fix which character each mod is for") },
  { id: "tags", label: t("Add tags"), title: t("Up to 3 short tags each: outfit, recolor, hair ...") },
  { id: "other", label: t("Something else"), title: t("Say what you want in your own words") },
];

const GOAL_TEXT: Record<string, string> = {
  clean: "Rename mods whose names are messy (file-style names like \"ellen_v2_FINAL\", version numbers, underscores, all caps, the creator's name) to short readable names like \"Ellen - Maid Outfit\". Leave names that are already fine alone.",
  characters: "Set the character for mods that have none or the wrong one, judging by the name and folder. Use only names from the character list. Skip mods that aren't for one character.",
  tags: "Give each mod up to 3 short lowercase tags for what it is, like outfit, recolor, hair, weapon, swimsuit, ui. Keep tags it already has unless they're wrong.",
};

/** What to look at for each goal when the mods' files come along. */
const RICH_GOAL_TEXT: Record<string, string> = {
  clean: "A good name says the character and what the mod is (outfit, hair, recolor, weapon), judging by the name, folder, what it draws and its readme. \"creator\" is who uploaded it to GameBanana: keep their name out of the mod's name.",
  characters: "Judge by the name, the folder, what it draws (section names usually start with the character) and its readme. A mod that draws several characters, or none, gets no character.",
  tags: "Judge by what it draws (hair, body, face, weapon or UI sections), its readme and its file names.",
  other: "Use what each mod draws, its readme and its files when they help.",
};

const CHANGE_SHAPE = `{"changes":[{"mod":1,"name":"Ellen - Maid Outfit","character":"Ellen","tags":["outfit"],"why":"few words"}]}`;

// Mods that lib/ai.ts hideFromAi keeps out are left out of mod lists without a word, and nothing in a prompt says
// whether a mod is for adults: it doesn't matter for these jobs, and chatbots refuse a whole request over it.
const shareable = (mods: ModEntry[]) => mods.filter((m) => !hideFromAi(m));

/** The mods as a numbered table. With `ctx` (the chatbot answers in the app) it also says what each mod draws and
 *  who made it. */
function modTable(mods: ModEntry[], ctx?: ModContext | null, creators = !!ctx): string {
  const head = `number | name | folder | character | tags${ctx ? " | draws" : ""}${creators ? " | creator" : ""}`;
  return [head, ...mods.map((m, i) =>
    `${i + 1} | ${cell(clip(m.name, 90))} | ${cell(clip(m.folder, 70))} | ${cell(m.character)} | ${cell(m.tags.join(", "))}`
    + (ctx ? ` | ${cell(ctx.draws.get(m.id))}` : "") + (creators ? ` | ${cell(m.source?.submitter)}` : ""))].join("\n");
}

const FILES_NOTE = "\"draws\" lists the ini sections each mod overrides, without the word TextureOverride. They usually name the character and the part, like EllenHair or BurniceBody. Each mod's files are in the reference files under mods/<number>/ (the number from my list): files.txt lists every file, and its ini and text files are there too. Use them when the name and folder don't settle it.";

/** Reads each mod's files for a job when the chatbot answers in the app. */
const contextFor = (rich: boolean | undefined, game: GameState, mods: ModEntry[]) => (rich && mods.length ? modContext(game, mods) : Promise.resolve(null));
const FILES_SHARE = () => t("Each mod's file list and the ini and text files (copies, read only)");

/** Read `changes` against the mods that were shared. */
function readChanges(raw: unknown, mods: ModEntry[], names: string[], game: GameState): { rows: PreviewRow[]; skipped: string[]; patches: Array<{ mod: ModEntry; patch: MetaPatch; why: string }> } {
  const rows: PreviewRow[] = [], skipped: string[] = [], patches: Array<{ mod: ModEntry; patch: MetaPatch; why: string }> = [];
  const byName = new Map(names.map((n) => [n.toLowerCase(), n]));
  const seen = new Set<number>();
  list(raw, "\"changes\"", 2000).forEach((c, i) => {
    const e = obj(c, t("Change {n}", { n: i + 1 }), ["mod", "name", "character", "tags", "why"]);
    const n = typeof e.mod === "number" ? e.mod : Number(e.mod);
    const mod = Number.isInteger(n) ? mods[n - 1] : undefined;
    if (!mod) { skipped.push(t("Change {n}: there's no mod number {mod}.", { n: i + 1, mod: String(e.mod) })); return; }
    if (seen.has(n)) { skipped.push(t("Change {n}: {name} is listed twice; the first one counts.", { n: i + 1, name: mod.name })); return; }
    seen.add(n);
    const patch: MetaPatch = {};
    const lines: PreviewRow["lines"] = [];
    const bad: string[] = [];
    if (e.name !== undefined) {
      const v = str(e.name, 120);
      if (!v) bad.push(t("the name is empty or too long"));
      else if (v !== mod.name) { patch.name = v; lines.push({ label: t("Name"), before: mod.name, after: v }); }
    }
    if (e.character !== undefined) {
      if (e.character === null || e.character === "") {
        if (mod.character) { patch.character = ""; lines.push({ label: t("Character"), before: mod.character, after: t("None") }); }
      } else {
        const v = typeof e.character === "string" ? (names.length ? byName.get(e.character.trim().toLowerCase()) : str(e.character, 60)) : null;
        if (!v) bad.push(t("{game} has no character \"{name}\"", { game: gameShort(game), name: String(e.character) }));
        else if (v !== mod.character) { patch.character = v; lines.push({ label: t("Character"), before: mod.character, after: v }); }
      }
    }
    if (e.tags !== undefined) {
      const tags = Array.isArray(e.tags) ? e.tags.map((x) => str(x, 30)?.toLowerCase()).filter((x): x is string => !!x) : null;
      if (!tags || tags.length !== (e.tags as unknown[]).length || tags.length > 10) bad.push(t("the tags aren't a list of short words"));
      else {
        const next = [...new Set(tags)];
        if (next.join("\n") !== mod.tags.join("\n")) { patch.tags = next; lines.push({ label: t("Tags"), before: mod.tags.join(", ") || t("None"), after: next.join(", ") || t("None") }); }
      }
    }
    if (bad.length) { skipped.push(t("{name}: {problems}.", { name: mod.name, problems: bad.join(", ") })); return; }
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
    // no toast: the helper's window lists every change and says Ctrl+Z undoes them
    record({
      label,
      undo: () => run(before.map((b) => ({ id: b.id, patch: b.back }))),
      redo: () => run(patches.map((p) => ({ id: p.mod.id, patch: p.patch }))),
    }, true);
    const out = patches.map(({ mod, patch, why }) => {
      const parts = [patch.name !== undefined ? t("{name} is now \"{next}\"", { name: mod.name, next: patch.name }) : mod.name];
      if (patch.character !== undefined) parts.push(patch.character ? t("character {name}", { name: patch.character }) : t("no character"));
      if (patch.tags !== undefined) parts.push(patch.tags.length ? t("tags {tags}", { tags: patch.tags.join(", ") }) : t("no tags"));
      return `${parts.join(", ")}${why ? ` (${why})` : ""}`;
    });
    if (failed.length) out.push(tn(failed.length, "{n} change didn't save: {error}", "{n} changes didn't save: {error}", { error: failed[0]! }));
    return out;
  };
}

const modsTask: TaskDef = {
  title: (task) => (task.modIds?.length ? tn(task.modIds.length, "Edit {n} mod with your chatbot", "Edit {n} mods with your chatbot") : t("Edit your mods with your chatbot")),
  goals: MOD_GOALS,
  defaultGoal: "clean",
  text: { label: t("What should change?"), examples: [t("Put the outfit name first, like \"Maid Outfit (Ellen)\""), t("Name recolors like \"Ellen - Red Recolor\""), t("Drop version numbers like v2 and FINAL from the names"), t("Tag every swimsuit mod with swimsuit"), t("Use the outfit's name from the game where you know it")], required: true, forGoal: "other" },
  async build(task, input) {
    const game = gameOf(task);
    const { mods: all, total } = await modsFor(task, game);
    const mods = shareable(all);
    if (!mods.length) throw new Error(all.length ? nothingToSendNote(all.length) : t("{game} has no mods to edit yet.", { game: gameName(game) }));
    // the roster checks any character the answer sets; the prompt carries it only when characters are the point
    const names = await roster(game);
    const sendNames = (input.goal === "characters" || input.goal === "other") && names.length > 0;
    const ask = input.goal === "other" ? input.text.trim() : GOAL_TEXT[input.goal] ?? GOAL_TEXT.clean!;
    const ctx = await contextFor(input.rich, game, mods);
    const prompt = [
      `I manage 3DMigoto mods for ${game.name} in a mod manager. ${ask}`,
      ctx ? RICH_GOAL_TEXT[input.goal] ?? RICH_GOAL_TEXT.other! : "",
      `My mods, one per line:\n${modTable(mods, ctx)}`,
      ctx ? FILES_NOTE : "",
      sendNames ? `${game.name} characters: ${names.join(", ")}.` : "",
      `List only mods that change, and only the fields that change. "mod" is the number from my list. ${ANSWER_RULE}`,
      "```json\n" + CHANGE_SHAPE + "\n```",
    ].filter(Boolean).join("\n\n");
    return {
      prompt,
      files: ctx?.files,
      shares: [
        total > all.length
          ? tn(mods.length, "Names, folder names, characters and tags of {n} mod (from the first {first} of {total})", "Names, folder names, characters and tags of {n} mods (from the first {first} of {total})", { first: all.length, total })
          : tn(mods.length, "Names, folder names, characters and tags of {n} mod", "Names, folder names, characters and tags of {n} mods"),
        ...(ctx ? [FILES_SHARE(), t("Who uploaded each mod to GameBanana")] : []),
        ...(sendNames ? [t("{game}'s character list", { game: gameName(game) })] : []),
        ...(input.goal === "other" && input.text.trim() ? [t("What you typed")] : []),
      ],
      read(reply) {
        const r = obj(reply, t("The answer"), ["changes"]);
        const { rows, skipped, patches } = readChanges(r.changes, mods, names, game);
        const label = tn(patches.length, "Changed {n} mod with the AI helper", "Changed {n} mods with the AI helper");
        return {
          summary: patches.length ? tn(patches.length, "{n} mod changes", "{n} mods change") : t("Nothing to change"),
          rows, skipped, text: [], links: [],
          apply: patches.length ? applyPatches(game, patches, label) : undefined,
        };
      },
    };
  },
};

const customTask: TaskDef = {
  title: (task) => (task.modIds?.length ? tn(task.modIds.length, "Ask about {n} mod", "Ask about {n} mods") : t("Ask your chatbot")),
  text: { label: t("Your question or request"), examples: [t("Which of these are duplicates?"), t("Rename these so the outfit comes first"), t("Sort these into outfits, recolors and hair"), t("Which characters have the most mods?"), t("Which of these look like two versions of the same mod?")], required: true },
  async build(task, input) {
    const game = gameOf(task);
    const { mods: all, total } = task.modIds?.length ? await modsFor(task, game, 200) : { mods: [] as ModEntry[], total: 0 };
    const mods = shareable(all);
    if (all.length && !mods.length) throw new Error(nothingToSendNote(all.length));
    const names = mods.length ? await roster(game) : [];
    const ctx = await contextFor(input.rich, game, mods);
    // nothing picked but the answer comes back here: the whole library goes along, so questions about it can be answered
    const library = !mods.length && input.rich ? shareable((await modsFor({ ...task, modIds: undefined }, game)).mods) : [];
    const prompt = [
      `I manage 3DMigoto mods for ${game.name} in a mod manager. ${input.text.trim()}`,
      mods.length ? `The mods this is about, one per line:\n${modTable(mods, ctx)}` : "",
      ctx ? FILES_NOTE : "",
      library.length ? `For context, the mods I have (you can't change these):\n${modTable(library, null, true)}` : "",
      `Put your answer in "answer" (plain text, short). If I asked for changes to the mods, list them in "changes" with only the fields that change ("mod" is the number from my list). ${ANSWER_RULE}`,
      "```json\n" + `{"answer":"...","changes":[{"mod":1,"name":"New name","character":"Ellen","tags":["outfit"],"why":"few words"}]}` + "\n```",
    ].filter(Boolean).join("\n\n");
    return {
      prompt,
      files: ctx?.files,
      shares: [t("What you typed"), ...(mods.length ? [total > all.length
        ? tn(mods.length, "Names, folder names, characters and tags of {n} mod (from the first {first})", "Names, folder names, characters and tags of {n} mods (from the first {first})", { first: all.length })
        : tn(mods.length, "Names, folder names, characters and tags of {n} mod", "Names, folder names, characters and tags of {n} mods")] : []),
      ...(ctx ? [FILES_SHARE()] : []),
      ...(library.length ? [tn(library.length, "Names, folders, characters, tags and creators of your {n} mod", "Names, folders, characters, tags and creators of your {n} mods")] : [])],
      read(reply) {
        const r = obj(reply, t("The answer"), ["answer", "changes"]);
        const { rows, skipped, patches } = mods.length ? readChanges(r.changes, mods, names, game) : { rows: [], skipped: [], patches: [] };
        const answer = optStr(r.answer, 6000);
        return {
          summary: patches.length ? tn(patches.length, "{n} mod changes", "{n} mods change") : answer ? t("The chatbot's answer") : t("Nothing in the answer"),
          rows, skipped, text: answer ? answer.split(/\n+/) : [], links: [],
          apply: patches.length ? applyPatches(game, patches, tn(patches.length, "Changed {n} mod with the AI helper", "Changed {n} mods with the AI helper")) : undefined,
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
  title: (task) => (task.modIds && task.modIds.length > 1 ? tn(task.modIds.length, "Toggles only while on screen for {n} mod", "Toggles only while on screen for {n} mods") : t("Toggles only while on screen")),
  note: t("This takes a strong chatbot, like Claude Opus 5.5. Weaker ones often pick the wrong sections. If a toggle stops working in game, Undo puts it back."),
  async build(task, input) {
    const game = gameOf(task);
    const { mods: picked } = await modsFor(task, game, 8);
    if (!picked.length) throw new Error(t("Pick the mod first."));
    const found = await Promise.all(picked.map(async (m) => ({
      mod: m,
      keys: await modKeys.list(game.id, m.id).catch(() => null),
      outline: await modKeys.outline(game.id, m.id).catch(() => [] as IniOutline[]),
    })));
    const todo = found.filter((f) => f.keys && f.keys.keys.length && !["own", "on", "global"].includes(f.keys.onScreen) && f.outline.some((o) => o.sections.length));
    if (!todo.length) throw new Error(picked.length === 1 ? t("This mod's toggles already work only while it's on screen, or it has nothing to pick from.") : t("These mods' toggles already work only while they're on screen."));
    // hidden mods go without their names, and explicit words in file and section names are swapped out
    const items = todo.map((f) => ({ mod: f.mod, outline: f.outline, files: aliases(), sections: aliases() }));
    const blocks = items.map(({ mod, outline, files, sections }, i) => {
      const inis = outline.map((o) => [
        `  File ${files.name(o.ini)}${o.namespace ? ` (namespace ${neutralName(o.namespace)})` : " (no namespace)"}${o.keys.length ? `, key sections: ${o.keys.slice(0, 20).map(neutralName).join(", ")}` : ", no keys"}`,
        ...o.sections.slice(0, 60).map((s) => `    [${sections.name(s.section)}] ${neutralName(s.lines.join("; "))}`),
      ].join("\n"));
      return `Mod ${i + 1}${hideFromAi(mod) ? "" : `: ${mod.name}`}${mod.character ? ` (${mod.character})` : ""}\n${inis.join("\n")}`;
    });
    const ctx = await contextFor(input.rich, game, todo.map((f) => f.mod));
    const prompt = [
      `These 3DMigoto mods for ${game.name} have hotkeys that also work while their character isn't on screen, so they clash with other mods using the same keys. gachamod can fix that itself once it knows which sections draw the character: it sets a flag in those sections, clears it every frame in [Present] and adds a condition on the key sections.`,
      "For each mod, pick the TextureOverride sections that run only while the character's model is drawn in the world: the body, position or blend buffer, or the main index buffer. Not a texture that can also show in menus, not a weapon on its own, not a section with override_vertex_count. The sections must be in the same file as the keys, or in a file that has a namespace. Leave out a mod if none fits.",
      blocks.join("\n\n"),
      ctx ? "Each mod's whole ini files are in the reference files under mods/<number>/ (the mod's number above). Read them when the outline isn't enough: what a section's draw and match lines do, which resources it uses, and how [Present] and the key sections are written." : "",
      `"mod" is the mod's number above, "file" and "section" exactly as listed (section without brackets). ${ANSWER_RULE}`,
      "```json\n" + DRAW_SHAPE + "\n```",
    ].filter(Boolean).join("\n\n");
    const mods = todo.map((f) => f.mod);
    return {
      prompt,
      files: ctx?.files,
      shares: [ctx ? tn(mods.length, "The ini and text files of {n} mod (copies, read only), with an outline of the override and key sections", "The ini and text files of {n} mods (copies, read only), with an outline of their override and key sections")
        : tn(mods.length, "Names and a few lines (hashes, buffers, draw calls) of the override sections in {n} mod, and their key section names. No other file contents", "Names and a few lines (hashes, buffers, draw calls) of the override sections in {n} mods, and their key section names. No other file contents"),
        t("Mod names and characters")],
      read: (reply) => readDraws(reply, game, items),
    };
  },
};

function readDraws(reply: unknown, game: GameState, mods: Array<{ mod: ModEntry; outline: IniOutline[]; files: Aliases; sections: Aliases }>): Preview {
  const r = obj(reply, t("The answer"), ["mods"]);
  const rows: PreviewRow[] = [], skipped: string[] = [];
  const picks: Array<{ mod: ModEntry; draw: DrawRef[] }> = [];
  const seen = new Set<number>();
  list(r.mods, "\"mods\"", 50).forEach((x, i) => {
    const e = obj(x, t("Entry {n}", { n: i + 1 }), ["mod", "draw", "why"]);
    const n = Number(e.mod);
    const it = Number.isInteger(n) ? mods[n - 1] : undefined;
    if (!it) { skipped.push(t("Entry {n}: there's no mod number {mod}.", { n: i + 1, mod: String(e.mod) })); return; }
    if (seen.has(n)) { skipped.push(t("{name} is listed twice; the first one counts.", { name: it.mod.name })); return; }
    seen.add(n);
    const draw: DrawRef[] = [];
    const before = skipped.length;
    list(e.draw, t("{name}'s sections", { name: it.mod.name }), 40).forEach((y, j) => {
      const d = obj(y, t("{name}, section {n}", { name: it.mod.name, n: j + 1 }), ["file", "section"]);
      const wantFile = typeof d.file === "string" ? it.files.real(d.file.trim().replaceAll("\\", "/")).toLowerCase() : "";
      const file = it.outline.find((o) => o.ini.toLowerCase() === wantFile);
      const want = typeof d.section === "string" ? it.sections.real(d.section.trim().replace(/^\[|\]$/g, "")).toLowerCase() : "";
      const sec = file?.sections.find((s) => s.section.toLowerCase() === want);
      if (!file || !sec) { skipped.push(t("{name}: {file} has no section {section}.", { name: it.mod.name, file: String(d.file), section: String(d.section) })); return; }
      if (!draw.some((x) => x.ini === file.ini && x.section === sec.section)) draw.push({ ini: file.ini, section: sec.section });
    });
    if (!draw.length) { if (skipped.length === before) skipped.push(t("{name}: no section to use.", { name: it.mod.name })); return; }
    const keyFiles = it.outline.filter((o) => o.keys.length).map((o) => o.ini);
    const reach = (f: string) => draw.some((d) => d.ini === f) || draw.some((d) => it.outline.find((o) => o.ini === d.ini)?.namespace);
    const left = keyFiles.filter((f) => !reach(f));
    rows.push({
      title: it.mod.name,
      lines: draw.map((d) => ({ label: d.ini, after: `[${d.section}]` })),
      note: sentences([optStr(e.why, 160), left.length ? t("Toggles in {files} will still work any time: none of these sections can reach them.", { files: left.join(", ") }) : ""].filter(Boolean)) || undefined,
    });
    picks.push({ mod: it.mod, draw });
  });
  return {
    summary: picks.length ? tn(picks.length, "Toggles of {n} mod will work only while on screen", "Toggles of {n} mods will work only while on screen") : t("Nothing to change"),
    rows, skipped, text: [], links: [],
    apply: picks.length ? async () => {
      const done: Array<{ game: string; modId: string; backup: Backup }> = [];
      const out: string[] = [];
      for (const p of picks) {
        try {
          const edit = await modKeys.onScreen(game.id, p.mod.id, true, p.draw);
          if (edit.backup) done.push({ game: game.id, modId: p.mod.id, backup: edit.backup });
          keysChanged(game.id, p.mod.id);
          // the backend's note is English: tb() shows it in the user's language
          const note = edit.note ? tb(edit.note) : null;
          out.push(edit.backup
            ? note ? t("Toggles of {name} work only while on screen. {note}", { name: p.mod.name, note }) : t("Toggles of {name} work only while on screen", { name: p.mod.name })
            : t("{name}: {note}", { name: p.mod.name, note: note ?? t("nothing to change") }));
        } catch (e) {
          out.push(t("{name} didn't change: {error}", { name: p.mod.name, error: errorText(e) }));
        }
      }
      // no toast: the helper's window lists every change and says Ctrl+Z undoes them
      if (done.length) recordBackups(tn(done.length, "Toggles of {n} mod work only while on screen", "Toggles of {n} mods work only while on screen"), done, { quiet: true });
      return out;
    } : undefined,
  };
}

// ── mod ideas ──

const GB_MOD = /^https?:\/\/(?:www\.)?gamebanana\.com\/mods\/(\d+)/i;

const recommendTask: TaskDef = {
  title: () => t("Mod ideas from your chatbot"),
  text: { label: t("Anything in particular? (optional)"), examples: [t("Swimsuits"), t("Mods for characters I don't have mods for yet"), t("Small recolors that keep the original look"), t("Outfits based on other games"), t("Hair and face mods")], required: false },
  async build(task, input) {
    const game = gameOf(task);
    // answered here: every mod goes along (with who made it), not just the summary
    const library = input.rich ? shareable((await modsFor({ ...task, modIds: undefined }, game)).mods) : [];
    const names = library.length ? await roster(game) : [];
    const prompt = [
      `I use 3DMigoto mods from GameBanana for ${game.name}. Suggest mods I might like.`,
      task.detail ?? "",
      library.length ? `Every mod I have, so you can see what I like and skip what I already have:\n${modTable(library, null, true)}` : "",
      names.length ? `${game.name} characters: ${names.join(", ")}.` : "",
      input.text.trim() ? `I'd like: ${input.text.trim()}` : "",
      `Give up to 12 ideas. Each is either a GameBanana search ("search": 1 to 4 words, like a character and an outfit type) or a GameBanana mod page you are sure exists ("url": https://gamebanana.com/mods/<number>), with "why" in a few words. ${ANSWER_RULE}`,
      "```json\n" + `{"ideas":[{"search":"Ellen swimsuit","why":"you collect Ellen mods"},{"url":"https://gamebanana.com/mods/123456","why":"few words"}]}` + "\n```",
    ].filter(Boolean).join("\n\n");
    return {
      prompt,
      shares: [library.length ? tn(library.length, "Names, folders, characters, tags and creators of your {n} mod", "Names, folders, characters, tags and creators of your {n} mods") : t("A summary of your mods: top characters, creators you keep and up to 40 mod names"),
        ...(names.length ? [t("{game}'s character list", { game: gameName(game) })] : []),
        ...(input.text.trim() ? [t("What you typed")] : [])],
      read(reply) {
        const r = obj(reply, t("The answer"), ["ideas"]);
        const links: Preview["links"] = [], skipped: string[] = [];
        list(r.ideas, "\"ideas\"", 30).forEach((x, i) => {
          const e = obj(x, t("Idea {n}", { n: i + 1 }), ["search", "url", "why"]);
          const why = optStr(e.why, 140) || undefined;
          const search = str(e.search, 60);
          const url = typeof e.url === "string" ? GB_MOD.exec(e.url.trim()) : null;
          if (url) links.push({ label: t("GameBanana mod {id}", { id: url[1]! }), hint: why, run: () => go({ view: "browse", modId: Number(url[1]) }) });
          else if (search) links.push({ label: t("Search \"{search}\"", { search }), hint: why, run: () => go({ view: "browse", search }) });
          else skipped.push(t("Idea {n}: not a search or a GameBanana mod link.", { n: i + 1 }));
        });
        return { summary: links.length ? tn(links.length, "{n} idea. Each opens in Browse", "{n} ideas. Each opens in Browse") : t("No ideas in the answer"), rows: [], skipped, text: [], links };
      },
    };
  },
};

const THEME_EXAMPLES = [
  t("Navy and gold with sharp corners"), t("Soft pastel pink with rounded cards"), t("Black and neon green, like an old terminal"),
  t("Warm paper and ink, like a notebook"), t("Frosted glass over a deep blue background"), t("Red and black, sharp and loud"),
  t("Forest green and wood brown, cozy"), t("High contrast black and white with big text"), t("Sunset orange fading into night blue"),
  t("Clean light grey, like a phone's settings"), t("Retro arcade: dark blue, pixel edges and bright yellow"), t("Cherry blossom pink on charcoal"),
];

const THEME_EDIT_EXAMPLES = [
  t("Make it darker"), t("Rounder corners and more space between things"), t("Use a teal accent instead"),
  t("Add a faint grid texture to the panels"), t("Make the text bigger and easier to read"), t("Give the buttons a sharper, flatter look"),
  t("Make a light version of it"), t("Tone down the glow and the gradients"),
];

export const TASKS: Record<string, TaskDef> = {
  mods: modsTask,
  custom: customTask,
  "keys-offscreen": keysTask,
  recommend: recommendTask,
  theme: {
    title: () => t("Make a theme with your chatbot"),
    text: { label: t("Describe the look"), examples: THEME_EXAMPLES, required: true },
    build: (task, input) => buildThemeTask(task, input),
  },
  "theme-edit": {
    title: (task) => t("Change {theme} with your chatbot", { theme: themeToEdit(task)?.name ?? t("the theme") }),
    text: { label: t("What should change?"), examples: THEME_EDIT_EXAMPLES, required: true },
    build: (task, input) => buildThemeTask(task, input),
  },
};
