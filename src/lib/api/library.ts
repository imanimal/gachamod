// Library, characters and profiles. Owner: LIBRARY area. Rust: commands/library.rs, commands/profiles.rs.
import { call, listen } from "../tauri";
import { EVENTS, type Character, type GameId, type ModChange, type ModEntry, type Profile, type ProfilePatch } from "./types";

export interface MetaPatch {
  name?: string;
  character?: string;
  tags?: string[];
  notes?: string;
  favorite?: boolean;
  nsfw?: boolean;
  version?: string;
}

export interface CharacterRef { name: string; gbCategoryId?: number | null; icon?: string | null }

export interface TrashEntry {
  id: number;
  game: GameId;
  modId: string;
  name: string;
  originalRel: string;
  size: number;
  reason: "removed" | "replaced" | string;
  removedAt: number;
}

export interface SwitchReport { profile: Profile; change: ModChange; varsPending: boolean }

export const library = {
  scan: (game: GameId) => call<ModEntry[]>("library_scan", { game }),
  list: (game: GameId) => call<ModEntry[]>("library_list", { game }),
  get: (game: GameId, id: string) => call<ModEntry>("mod_get", { game, id }),
  setEnabled: (game: GameId, ids: string[], on: boolean) => call<ModChange>("mods_set_enabled", { game, ids, on }),
  updateMeta: (game: GameId, id: string, patch: MetaPatch) => call<ModEntry>("mod_update_meta", { game, id, patch }),
  move: (game: GameId, id: string, group: string | null) => call<ModEntry>("mod_move", { game, id, group }),
  remove: (game: GameId, ids: string[]) => call<ModChange>("mods_remove", { game, ids }),
  trash: (game: GameId) => call<TrashEntry[]>("trash_list", { game }),
  trashRestore: (id: number) => call<ModChange>("trash_restore", { id }),
  trashPurge: (id: number | null) => call<number>("trash_purge", { id }),
  markUpdates: (game: GameId, ids: string[]) => call<void>("mods_mark_updates", { game, ids }),
  /** Copy an image file into the mod's folder as preview.<ext>. Older preview files are kept under another name. */
  setPreview: (game: GameId, id: string, path: string) => call<ModEntry>("mod_set_preview", { game, id, path }),
  /** The same from image bytes (a paste, or a drop in the browser). `ext` is png, jpg, webp or gif. */
  setPreviewData: (game: GameId, id: string, data: Uint8Array, ext: string) =>
    call<ModEntry>("mod_set_preview_data", { game, id, data: Array.from(data), ext }),
  /** Remove the user's own preview and put the kept files back. */
  clearPreview: (game: GameId, id: string) => call<ModEntry>("mod_clear_preview", { game, id }),
  onChanged: (cb: (p: { game: GameId }) => void) => listen<{ game: GameId }>(EVENTS.libraryChanged, cb),
};

export const characters = {
  list: (game: GameId) => call<Character[]>("characters_list", { game }),
  sync: (game: GameId, list: CharacterRef[]) => call<void>("characters_sync", { game, list }),
};

export const profiles = {
  list: (game: GameId) => call<Profile[]>("profiles_list", { game }),
  create: (game: GameId, name: string, copyFrom: number | null) => call<Profile>("profile_create", { game, name, copyFrom }),
  update: (id: number, patch: ProfilePatch) => call<Profile>("profile_update", { id, patch }),
  remove: (id: number) => call<void>("profile_delete", { id }),
  activate: (id: number) => call<SwitchReport>("profile_activate", { id }),
  capture: (id: number) => call<Profile>("profile_capture", { id }),
};

/** A hotkey Windows wouldn't give the app because another app holds it. */
export interface HotkeyTaken { combo: string; reason: string }

/** In-game hotkeys that switch profiles. Settings: "hotkeys.enabled" ("0" is off), "hotkeys.next", "hotkeys.prev". */
export const hotkeys = {
  /** Register every hotkey again after a change. Returns the ones another app holds. */
  sync: () => call<HotkeyTaken[]>("hotkeys_sync"),
};
