// Mod internals (keys, variables, conflicts, problems), .gachamod packs and IMM. Owner: MODTOOLS area.
// Rust: commands/modtools.rs over ini.rs, pack.rs, imm.rs.
import { call, listen } from "../tauri";
import { EVENTS, type GameId } from "./types";

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
  kind: "missing_file" | "bad_ini" | "no_ini" | "no_key" | "missing_section" | "duplicate_hash" | "old_hash" | string;
  detail: string; ini: string | null;
  /** "bad": won't load, "warn": may not work, "info". */
  severity: "bad" | "warn" | "info" | string;
}
export interface ConflictRef { modId: string; name: string; shared: number }
export interface ModInspect {
  modId: string; inis: string[]; keys: KeyBinding[]; vars: VarInfo[]; hashCount: number;
  conflicts: ConflictRef[]; problems: Problem[]; readmes: Array<[string, string]>;
}
export interface ConflictGroup { mods: ConflictRef[]; hashes: string[]; character: string | null }
export interface ModProblems { modId: string; name: string; problems: Problem[] }
export interface HashHit { modId: string; name: string; ini: string; section: string; enabled: boolean }

export interface PackedProfile { name: string; icon: string | null; color: string | null; banner: string | null; description: string | null }
export interface ExportRequest {
  game: GameId; modIds: string[]; profileId: number | null; includeVars: boolean; title: string | null; dest: string;
}
export interface ExportResult { path: string; size: number; mods: number }
export interface PackPreviewMod {
  index: number; name: string; character: string | null; relPath: string; size: number; enabled: boolean;
  existing: string | null; preview: string | null;
}
export interface PackPreview {
  path: string; manifestOk: boolean; game: GameId; kind: "mods" | "profile" | string; title: string; createdAt: number;
  mods: PackPreviewMod[]; profile: PackedProfile | null; totalSize: number;
}
export interface ImportOptions { only: number[]; onExisting: "skip" | "replace" | "keep_both"; applyProfile: boolean }
export interface ImportResult { added: string[]; replaced: string[]; skipped: number; profileId: number | null; notes: string[] }

export interface ImmGame { game: GameId; config: string; mods: number; enabled: number; withSource: number }
export interface ImmInfo { found: boolean; dir: string | null; games: ImmGame[] }

export const modtools = {
  inspect: (game: GameId, id: string) => call<ModInspect>("mod_inspect", { game, id }),
  setVar: (game: GameId, id: string, value: VarValue) => call<void>("mod_set_var", { game, id, value }),
  conflicts: (game: GameId) => call<ConflictGroup[]>("conflicts_scan", { game }),
  lint: (game: GameId) => call<ModProblems[]>("lint_scan", { game }),
  hashLookup: (game: GameId, hash: string) => call<HashHit[]>("hash_lookup", { game, hash }),
};

export const packs = {
  export: (req: ExportRequest) => call<ExportResult>("pack_export", { req }),
  inspect: (path: string) => call<PackPreview>("pack_inspect", { path }),
  import: (path: string, opts: ImportOptions) => call<ImportResult>("pack_import", { path, opts }),
  onProgress: (cb: (p: { done: number; total: number }) => void) => listen<{ done: number; total: number }>(EVENTS.packProgress, cb),
};

export const imm = {
  detect: () => call<ImmInfo>("imm_detect"),
  takeover: (game: GameId) => call<ImportResult>("imm_takeover", { game }),
};
