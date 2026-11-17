// Moving from other mod managers: their mods kept outside Mods, presets and details. Owner: MODTOOLS area.
// Rust: commands/migrate.rs over migrate.rs (docs/spec.md, "Moving from other managers").
import { call } from "../tauri";
import type { GameId, SidecarBack } from "./types";

/** Another manager found for a game. */
export interface OtherManager {
  /** "jasm", "xxmm", "peaky" ... (pass it back to `migrate.import`). */
  id: string;
  name: string;
  /** Its settings file or folder. */
  place: string;
  /** Its own folder of mods outside Mods. */
  library: string | null;
  /** Its mods gachamod already sees in Mods. */
  inside: number;
  /** Its mods outside Mods that gachamod can't see. */
  outside: number;
  /** Disk space a copy of those takes. */
  outsideBytes: number;
  presets: number;
  /** Open right now: import refuses until it closes. */
  running: boolean;
  notes: string[];
}

/** "copy" keeps the other manager working; "move" empties its folder and replaces its links with the real folders. */
export type MigrateMode = "copy" | "move";
export interface MigrateOptions { mode: MigrateMode; picked?: string | null }

export interface Placed { id: string; at: string; from: string; moved: boolean; link: string | null }
export interface MigrateUndo { game: GameId; manager: string; placed: Placed[]; profiles: number[]; sidecars: SidecarBack[]; turnedOff: string[] }
export interface MigrateResult { manager: string; added: string[]; profiles: string[]; notes: string[]; undo: MigrateUndo }

export const migrate = {
  /** `picked`: a folder or file the user chose (SkinSelectImpact's folder, Fairy's Secret Folder's backup). */
  detect: (game: GameId, picked?: string | null) => call<OtherManager[]>("migrate_detect", { game, picked: picked ?? null }),
  import: (game: GameId, manager: string, options: MigrateOptions) => call<MigrateResult>("migrate_import", { game, manager, options }),
  /** Takes an import back; returns notes about anything left where it is. */
  undo: (undo: MigrateUndo) => call<string[]>("migrate_undo", { undo }),
};
