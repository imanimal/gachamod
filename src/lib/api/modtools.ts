// Mod internals (keys, variables, conflicts, problems), .gachamod packs and IMM. Owner: MODTOOLS area.
// Rust: commands/modtools.rs over ini.rs, pack.rs, imm.rs.
import { call, listen } from "../tauri";
import type { Backup } from "./common";
import { EVENTS, type GameId, type ModSource } from "./types";

export interface VarValue { ini: string; var: string; value: string }
export interface KeyVar { var: string; values: string[] }
export interface KeyBinding {
  ini: string; section: string; key: string; label: string; back: string | null;
  kind: "cycle" | "toggle" | "hold" | "activate" | string; vars: KeyVar[]; condition: string | null;
  /** Every key line as written, and their readable forms ("Ctrl+Alt+J", "Pad A"). */
  keys: string[]; labels: string[];
}
export interface VarInfo { ini: string; var: string; persist: boolean; default: string | null; current: string | null; values: string[]; label: string;
  /** "switch" when the only values are 0 and 1. */
  kind: "switch" | "list" | string;
}
export interface Problem {
  kind: "missing_file" | "bad_ini" | "no_ini" | "no_key" | "missing_section" | "overlap" | string;
  detail: string; ini: string | null;
  /** "bad": part of the mod won't show or shows wrong. "warn": may not work, or only in a corner case (a boss, another
   *  skin). "info": harmless, or gachamod couldn't check it. */
  severity: "bad" | "warn" | "info" | string;
  /** A change gachamod can make that fixes it (modtools.fix). */
  fix: ProblemFix | null;
}
/** "point": in `ini`, the `filename = <from>` lines change to `<to>`, the same file found elsewhere in the mod.
 *  "keep": `ini` stays on and the other `inis` are renamed DISABLED_<name>. Set `ini` to the one to keep. */
export interface ProblemFix { kind: "point" | "keep" | string; ini: string | null; from: string | null; to: string | null; inis: string[] }
export interface ConflictRef { modId: string; name: string; shared: number }
export interface ModInspect {
  modId: string; inis: string[]; keys: KeyBinding[]; vars: VarInfo[]; hashCount: number;
  conflicts: ConflictRef[]; problems: Problem[]; readmes: Array<[string, string]>;
}
export interface ConflictGroup { mods: ConflictRef[]; hashes: string[]; character: string | null }
export interface ModProblems { modId: string; name: string; enabled: boolean; source: ModSource | null; problems: Problem[] }
export interface HashHit { modId: string; name: string; ini: string; section: string; enabled: boolean }

/** What goes in a .gachamod file: "links" (GameBanana links and settings only, a few KB), "unlinked" (links, plus the
 *  files of mods that have no link) or "files" (every mod's files, for a full copy). */
export type PackFiles = "links" | "unlinked" | "files";
/** "mods" (a selection), "profile" (one profile and its mods), "game" (a game's mods and profiles), "all" (every game). */
export type PackScope = "mods" | "profile" | "game" | "all";
export interface ExportRequest {
  game: GameId; modIds: string[]; profileId: number | null; scope: PackScope; files: PackFiles;
  /** Picked options and key edits. */
  includeVars: boolean; title: string | null; dest: string;
}
export interface ExportPlan {
  title: string; games: GameId[]; mods: number; linked: number; unlinked: number; unlinkedSize: number; totalSize: number;
  profiles: number; suggested: PackFiles;
  /** Names of mods without a link (up to 30). */
  unlinkedNames: string[];
  /** One "Name: https://gamebanana.com/mods/1" line per linked mod. */
  links: string;
}
export interface ExportResult { path: string; size: number; mods: number; links: number; inside: number; profiles: number }
export interface PackPreviewMod {
  index: number; game: GameId; name: string; character: string | null; relPath: string; size: number; enabled: boolean;
  existing: string | null; preview: string | null;
  /** "inside": its files are in the file; "download": from GameBanana; "missing": only its name is. */
  how: "inside" | "download" | "missing";
  gbModId: number | null; url: string | null;
}
export interface PreviewProfile { game: GameId; name: string; icon: string | null; color: string | null; description: string | null; active: boolean; mods: number }
export interface PreviewGame { game: GameId; name: string; ready: boolean; note: string | null; mods: number; profiles: number }
export interface PackPreview {
  path: string; manifestOk: boolean; format: number; game: GameId; kind: PackScope | string; title: string; createdAt: number;
  mods: PackPreviewMod[]; profile: PreviewProfile | null; profiles: PreviewProfile[]; games: PreviewGame[];
  /** Bytes of mod files inside, and about how much the linked mods take. */
  totalSize: number; downloadSize: number;
}
export interface ImportOptions { only: number[]; onExisting: "skip" | "replace" | "keep_both"; applyProfile: boolean }
export interface ImportResult {
  added: string[]; replaced: string[]; skipped: number;
  /** The profile switched to, and every profile made. */
  profileId: number | null; profiles: number[];
  /** Mods put in the download queue, and names of mods the file only names. */
  queued: number; missing: string[];
  notes: string[];
}

export interface ImmGame { game: GameId; config: string; mods: number; enabled: number; withSource: number }
export interface ImmInfo { found: boolean; dir: string | null; games: ImmGame[] }

/** One vertex buffer of a mod's model: little-endian f32 arrays in base64. */
export interface MeshBuffer { name: string; count: number; positions: string; normals: string | null; uvs: string | null }
/** One draw: u32 indices (base64) into a buffer, with its colour texture (an index into ModMesh.textures). */
export interface MeshPart { name: string; buffer: number; indices: string; texture: number | null }
/** What a mod draws with its toggles as they are now (gacha-core mesh.rs). Only the mod's own parts. */
export interface ModMesh {
  buffers: MeshBuffer[];
  parts: MeshPart[];
  /** Image data URLs. */
  textures: string[];
  /** "z" when the model stands along z (ZZZ). */
  up: "y" | "z";
  triangles: number;
  /** What couldn't be shown, in words. */
  notes: string[];
}

export const modtools = {
  inspect: (game: GameId, id: string) => call<ModInspect>("mod_inspect", { game, id }),
  /** The mod's model for the 3D view. Fails with a plain reason when it only changes textures or effects. */
  mesh: (game: GameId, id: string) => call<ModMesh>("mod_mesh", { game, id }),
  setVar: (game: GameId, id: string, value: VarValue) => call<void>("mod_set_var", { game, id, value }),
  conflicts: (game: GameId) => call<ConflictGroup[]>("conflicts_scan", { game }),
  lint: (game: GameId) => call<ModProblems[]>("lint_scan", { game }),
  /** Make a fix lint offered. The backup undoes it (backups.restore). */
  fix: (game: GameId, id: string, fix: ProblemFix) => call<Backup>("lint_fix", { game, id, fix }),
  hashLookup: (game: GameId, hash: string) => call<HashHit[]>("hash_lookup", { game, hash }),
};

// ── mod fixes after a game update (crates/gacha-core/src/fixes.rs) ──

/** A community fixer the bundled data comes from, or one gachamod links to. */
export interface FixSource { id: string; name: string; author: string; url: string; license: string; checked: string; used: string }
export interface ToolLink { name: string; url: string }
/** What a game update did to one installed mod. */
export interface ModHealthRow {
  modId: string; name: string; enabled: boolean;
  /** "broken": hashes gachamod can swap; "unfixable": needs more than a swap (`tool` is the fixer gachamod runs, if one is known); "fixed": gachamod fixed it. */
  status: "broken" | "unfixable" | "fixed";
  reasons: string[];
  since: string | null;
  tool: ToolLink | null;
  /** Hash lines a fix changes. */
  swaps: number;
}
export interface FixInfo { game: string; currentVersion: string; pairs: number; sources: FixSource[] }
export interface FixAll { changed: ModBackup[]; skipped: ModSkip[] }

export const fixes = {
  info: (game: GameId) => call<FixInfo>("fixes_info", { game }),
  health: (game: GameId) => call<ModHealthRow[]>("fixes_health", { game }),
  /** Each changed mod's backup undoes it (backups.restore). */
  apply: (game: GameId, ids: string[]) => call<FixAll>("fixes_apply", { game, ids }),
};

/** A fixer file downloaded from GameBanana or GitHub into the app's fixers folder (crates/gacha-core/src/fixers.rs). */
export interface FixerFile {
  toolId: number; fileId: number; tool: string; file: string;
  /** The folder it is in. */
  dir: string;
  /** The one program in it (an .exe, else a .bat or .py), or the folder. */
  main: string;
  at: number;
  /** The fix data's link, for a fixer from GitHub. */
  source?: string;
}
export interface FixerRequest { toolId: number; fileId: number; tool: string; file: string; url: string; md5?: string | null; source?: string }
/** What running a fixer on one mod did. Restoring `backup` undoes it; null when it changed nothing. */
export interface FixerRun {
  modId: string; name: string; backup: Backup | null;
  /** Files changed, added or removed. */
  changed: number;
  /** Still running at the time limit, so it was stopped. */
  stopped: boolean;
  output: string;
}

export const fixers = {
  list: (game: GameId) => call<FixerFile[]>("fixers_list", { game }),
  /** Only GameBanana links. */
  download: (game: GameId, req: FixerRequest) => call<FixerFile>("fixers_download", { game, req }),
  /** A fixer from GitHub: the newest release's Windows program, or one script file. */
  github: (game: GameId, source: string, tool: string) => call<FixerFile>("fixers_github", { game, source, tool }),
  /** Run a downloaded fixer on one mod from inside its folder, with a backup first. */
  run: (game: GameId, fileId: number, modId: string) => call<FixerRun>("fixers_run", { game, fileId, modId }),
};

// ── keys: rebinding, turning keys off, "only while on screen" and clashes (crates/gacha-core/src/keys.rs) ──

/** One `key =` or `back =` line of a key section. */
export interface KeyLine {
  /** "key", or "back" (steps a cycle backwards). */
  field: "key" | "back" | string;
  /** Its place among the section's lines of the same field. */
  index: number;
  /** As written ("ctrl VK_F6") and readable ("Ctrl+F6"). */
  value: string; label: string;
  /** The author's line when gachamod changed it. */
  original: string | null; originalLabel: string | null;
  off: boolean;
  /** A controller binding. */
  pad: boolean;
}
export interface KeyEntry {
  ini: string; section: string; kind: "cycle" | "toggle" | "hold" | "activate" | string;
  /** What it changes ("Jacket"). */
  name: string; vars: KeyVar[];
  /** The author's condition, without gachamod's part. */
  condition: string | null;
  lines: KeyLine[];
  /** All its lines are off. */
  off: boolean;
  /** It only works while the character is on screen. */
  onScreen: boolean;
}
/** "own": the mod does it itself; "on": gachamod did it; "partial": some files only; "off": keys work any time and
 *  the fix can be made; "cant": nothing found that draws the character; "global": no character (UI mods); "none". */
export type OnScreenState = "own" | "on" | "partial" | "off" | "cant" | "global" | "none";
export interface ModKeys {
  modId: string; inis: string[]; keys: KeyEntry[]; onScreen: OnScreenState | string; onScreenNote: string | null;
  /** gachamod changed or turned off some of the author's keys. */
  changed: boolean;
}
export interface KeyTarget { ini: string; section: string; field: string; index: number }
export interface DrawRef { ini: string; section: string }
/** The keys after an edit, the backup that undoes it (null when nothing changed) and a note when needed. */
export interface KeyEdit { keys: ModKeys; backup: Backup | null; note: string | null }
export interface ModBackup { modId: string; name: string; backup: Backup }
export interface ModSkip { modId: string; name: string; reason: string }
export interface OnScreenAll { changed: ModBackup[]; skipped: ModSkip[]; already: number }
/** A mod that has gachamod's on-screen check. `partial`: only some of its files. */
export interface OnScreenMod { modId: string; name: string; character: string | null; enabled: boolean; partial: boolean }
export interface ClashKey {
  modId: string; name: string; character: string | null; ini: string; section: string; field: string; index: number;
  value: string; label: string; what: string; onScreen: boolean;
  /** The automatic "only while on screen" fix can be made for this mod. */
  fixable: boolean;
}
export interface KeyClash { label: string; keys: ClashKey[] }
export interface SectionOutline { section: string; lines: string[] }
export interface IniOutline { ini: string; namespace: string | null; keys: string[]; sections: SectionOutline[] }

export const modKeys = {
  list: (game: GameId, id: string) => call<ModKeys>("keys_list", { game, id }),
  /** `binding`: held modifiers then keys, like "ctrl VK_F6" or "XB_LEFT_SHOULDER XB_A". */
  rebind: (game: GameId, id: string, target: KeyTarget, binding: string) => call<KeyEdit>("keys_rebind", { game, id, target, binding }),
  setOff: (game: GameId, id: string, ini: string, section: string, off: boolean) => call<KeyEdit>("keys_set_off", { game, id, ini, section, off }),
  /** Take every change gachamod made out of a mod (keys, toggles turned off, the on-screen check), using the copy of
   *  each ini kept from before the first change. */
  putBack: (game: GameId, id: string) => call<KeyEdit>("keys_put_back", { game, id }),
  /** `draw`: the sections that draw the character, when the automatic search can't tell (from the AI helper). */
  onScreen: (game: GameId, id: string, on: boolean, draw: DrawRef[] | null = null) => call<KeyEdit>("keys_on_screen", { game, id, on, draw }),
  onScreenAll: (game: GameId, on: boolean) => call<OnScreenAll>("keys_on_screen_all", { game, on }),
  onScreenMods: (game: GameId) => call<OnScreenMod[]>("keys_on_screen_mods", { game }),
  clashes: (game: GameId) => call<KeyClash[]>("keys_clashes", { game }),
  outline: (game: GameId, id: string) => call<IniOutline[]>("keys_outline", { game, id }),
};

export const packs = {
  plan: (req: Omit<ExportRequest, "dest" | "files" | "title">) => call<ExportPlan>("pack_plan", { req: { ...req, files: "", dest: "", title: null } }),
  export: (req: ExportRequest) => call<ExportResult>("pack_export", { req }),
  inspect: (path: string) => call<PackPreview>("pack_inspect", { path }),
  import: (path: string, opts: ImportOptions) => call<ImportResult>("pack_import", { path, opts }),
  onProgress: (cb: (p: { done: number; total: number }) => void) => listen<{ done: number; total: number }>(EVENTS.packProgress, cb),
};

export const imm = {
  detect: () => call<ImmInfo>("imm_detect"),
  takeover: (game: GameId) => call<ImportResult>("imm_takeover", { game }),
};
