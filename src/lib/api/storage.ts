// Settings › Storage: where disk space goes and the cleanups it offers (src-tauri commands/storage.rs, gacha-core
// storage.rs). Owner: SYSTEM area.
import { call, listen } from "../tauri";
import type { GameId, ModChange } from "./types";

/** Something on disk. Keys and categories are listed in gacha-core storage.rs (`Item`, `category_of`). */
export interface StorageItem {
  key: string;
  /** "on", "off", "trash", "downloads", "backups", "loader", "others" or "app". */
  category: StorageCategory;
  bytes: number;
  /** Mods for mods, entries for the trash and backups, files for the rest. */
  count: number;
  path: string | null;
  /** The other manager's name, for "others". */
  name: string | null;
}

export type StorageCategory = "on" | "off" | "trash" | "downloads" | "backups" | "loader" | "others" | "app";

export interface StorageGame { game: GameId; bytes: number; items: StorageItem[] }

export interface StorageMod {
  id: string;
  game: GameId;
  name: string;
  character: string | null;
  enabled: boolean;
  bytes: number;
  files: number;
  path: string;
  installedAt: number;
  /** The mod's picture, a local path or a URL (ModEntry.preview). `thumb` is its small copy when there is one. */
  preview: string | null;
  thumb: string | null;
  nsfw: boolean;
}

export interface StorageCharacter { game: GameId; name: string | null; bytes: number; mods: number; enabled: number }

export interface StorageDuplicate {
  game: GameId;
  /** "same": the same files. "download": the same GameBanana file installed twice, with files that differ now. */
  kind: "same" | "download";
  keep: string;
  remove: string[];
  bytes: number;
}

export interface StorageReport {
  total: number;
  games: StorageGame[];
  app: StorageItem[];
  mods: StorageMod[];
  characters: StorageCharacter[];
  duplicates: StorageDuplicate[];
  trashDays: number;
  trashOverdue: number;
  keepArchives: boolean;
  /** Every folder was measured. False for the quick pass or a skipped measure. */
  complete: boolean;
  measuredAt: number;
}

/** What a measure is reading now. */
export interface StorageStep { step: "mods" | "data" | "loader" | "copies" | "others" | "xxmi"; game: GameId | null }

export const storage = {
  /** `full` false reads the library only (instant); true measures every folder and compares copies. */
  measure: (full: boolean) => call<StorageReport>("storage_measure", { full }),
  /** Stop a full measure; it comes back with what it has. */
  cancel: () => call<void>("storage_cancel"),
  /** Copies go to the app's trash, kept at least 10 minutes so Undo works. */
  removeCopies: (game: GameId, ids: string[]) => call<ModChange>("storage_remove_copies", { game, ids }),
  /** Kept archives of one game (or every game with null) go to the Recycle Bin. Returns the bytes moved. */
  recycleArchives: (game: GameId | null) => call<number>("storage_recycle_archives", { game }),
  onProgress: (cb: (s: StorageStep) => void) => listen<StorageStep>("storage-progress", cb),
};
