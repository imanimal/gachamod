// Library, characters and profiles. Owner: LIBRARY area. Rust: commands/library.rs, commands/profiles.rs.
import { call, listen } from "../tauri";
import { EVENTS, type Character, type ForeignImport, type ForeignInfo, type GameId, type ModChange, type ModEntry, type ModSource, type OwnedImport, type Profile, type ProfilePatch, type SidecarBack } from "./types";

export interface MetaPatch {
  name?: string;
  character?: string;
  tags?: string[];
  notes?: string;
  favorite?: boolean;
  nsfw?: boolean;
  version?: string;
  /** Make it a sub-mod of this mod (an id), or "" to make it a mod of its own again. */
  parent?: string;
}

/** A folder inside a mod with its own inis. `folder` is its name now (with DISABLED when off). */
export interface ModPart { folder: string; name: string; enabled: boolean; iniCount: number; sizeBytes: number }

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

/** A removed mod. Its files stay in the trash for a while (setting "trash.days", default 14); after that only its
 *  details stay: name, character, tags, notes, saved options, profiles it was in and the GameBanana link, so
 *  installing it again from GameBanana brings all of that back. */
export interface ArchiveEntry {
  /** "t<trash id>" while the files are in the trash, "a<archive id>" once only the details are kept. */
  key: string;
  trashId: number | null;
  archiveId: number | null;
  game: GameId;
  /** The mod's library id. A reinstall gets the same id back, so its profiles and saved options still fit. */
  modId: string;
  name: string;
  character: string | null;
  source: ModSource | null;
  /** A picture kept for the archive (a local file or a URL), or null. */
  preview: string | null;
  nsfw: boolean;
  tags: string[];
  favorite: boolean;
  sizeBytes: number;
  removedAt: number;
  /** When the files leave the trash (unix seconds); null once only the details are kept. */
  filesUntil: number | null;
  /** "removed" or "replaced" (an update kept the old copy). */
  reason: string;
  /** Saved option values are kept for it. */
  hasOptions: boolean;
}

/** Everything about a profile, to put it back after a delete (Undo). */
export interface ProfileSnapshot { profile: Profile; mods: Array<{ modId: string; enabled: boolean }>; vars: Array<{ modId: string; ini: string; var: string; value: string }> }

export const library = {
  scan: (game: GameId) => call<ModEntry[]>("library_scan", { game }),
  list: (game: GameId) => call<ModEntry[]>("library_list", { game }),
  get: (game: GameId, id: string) => call<ModEntry>("mod_get", { game, id }),
  /** Folders inside the mod with their own inis (an archive's several mods installed as one). Empty when there's
   *  nothing to switch. */
  parts: (game: GameId, id: string) => call<ModPart[]>("mod_parts", { game, id }),
  /** Turn one part on or off by its current folder name. Returns the mod with its new counts. */
  setPart: (game: GameId, id: string, folder: string, on: boolean) => call<ModEntry>("mod_set_part", { game, id, folder, on }),
  /** Make several mods the parts of one mod. The first one that is on keeps its id and details. */
  merge: (game: GameId, ids: string[]) => call<ModChange>("mods_merge", { game, ids }),
  /** `turnOffOthers`: the user's answer about the character's other mods that are on (true turns them off, false
   *  keeps them on). Left out, the "<game>.oneSkin" setting decides. Sub-mods go with their parent either way. */
  setEnabled: (game: GameId, ids: string[], on: boolean, turnOffOthers?: boolean) =>
    call<ModChange>("mods_set_enabled", { game, ids, on, turnOffOthers: turnOffOthers ?? null }),
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
  /** The user's own preview as bytes (empty when there's none), kept for Undo before it's replaced or reset. */
  customPreview: (game: GameId, id: string) => call<ArrayBuffer>("mod_custom_preview", { game, id }),
  /** Remove the user's own preview and put the kept files back. */
  clearPreview: (game: GameId, id: string) => call<ModEntry>("mod_clear_preview", { game, id }),
  /** Download an https picture (GameBanana's first image) and save it as the mod's preview.<ext>; preview files
   *  already there are kept as preview-original.<ext>. Not a custom preview: one the user picked stays in front. */
  fetchPreview: (game: GameId, id: string, url: string) => call<ModEntry>("mod_fetch_preview", { game, id, url }),
  /** Removed mods of one game (or every game with null), newest first: trash entries (files kept "trash.days" days,
   *  default 14) and archived ones (details only). Installing the same GameBanana mod again restores either. */
  archive: (game: GameId | null) => call<ArchiveEntry[]>("archive_list", { game }),
  /** Forget archived mods for good (their details, saved options and profile places). Keys from ArchiveEntry. */
  archiveForget: (keys: string[]) => call<number>("archive_forget", { keys }),
  onChanged: (cb: (p: { game: GameId }) => void) => listen<{ game: GameId }>(EVENTS.libraryChanged, cb),
};

export const characters = {
  list: (game: GameId) => call<Character[]>("characters_list", { game }),
  sync: (game: GameId, list: CharacterRef[]) => call<void>("characters_sync", { game, list }),
};

/** Characters the player has, per game. */
export const owned = {
  list: (game: GameId) => call<string[]>("owned_list", { game }),
  /** Returns the names that changed, so Undo can flip just those. */
  set: (game: GameId, names: string[], owned: boolean) => call<string[]>("owned_set", { game, names, owned }),
  /** An export's text (GOOD, SROD, ZOD, Enka, scanner files, any JSON) or a pasted list of names. */
  import: (game: GameId, text: string) => call<OwnedImport>("owned_import", { game, text }),
  importFile: (game: GameId, path: string) => call<OwnedImport>("owned_import_file", { game, path }),
  /** gachamod's own JSON for the list, which `import` reads back. */
  export: (game: GameId) => call<string>("owned_export", { game }),
  /** Returns how many characters the file lists. */
  exportFile: (game: GameId, path: string) => call<number>("owned_export_file", { game, path }),
  /** Reads the player's public Enka.Network profile by UID (gi, hsr, zzz): the characters on their showcase. */
  fetch: (game: GameId, uid: string) => call<OwnedImport>("owned_fetch", { game, uid }),
};

/** What other mod managers (JASM, XXMM, FlairX, EMMM, Fairy's Secret Folder ...) saved next to the mods. */
export const otherManagers = {
  /** Reads only. */
  detect: (game: GameId) => call<ForeignInfo>("foreign_detect", { game }),
  /** Adds their names, characters, links and pictures to mods that lack them, then rescans. */
  import: (game: GameId) => call<ForeignImport>("foreign_import", { game }),
  undo: (game: GameId, items: SidecarBack[]) => call<void>("foreign_undo", { game, items }),
};

export const profiles = {
  list: (game: GameId) => call<Profile[]>("profiles_list", { game }),
  create: (game: GameId, name: string, copyFrom: number | null) => call<Profile>("profile_create", { game, name, copyFrom }),
  update: (id: number, patch: ProfilePatch) => call<Profile>("profile_update", { id, patch }),
  remove: (id: number) => call<void>("profile_delete", { id }),
  activate: (id: number) => call<SwitchReport>("profile_activate", { id }),
  capture: (id: number) => call<Profile>("profile_capture", { id }),
  /** Library ids of the mods that are on in a profile. */
  members: (id: number) => call<string[]>("profile_members", { id }),
  /** Everything about a profile (before deleting it, for Undo). */
  snapshot: (id: number) => call<ProfileSnapshot>("profile_snapshot", { id }),
  /** Put a deleted profile back from a snapshot: the same id when it is free, a numbered name when another profile
   *  took it, active again when it was (no files change). */
  restore: (snapshot: ProfileSnapshot) => call<Profile>("profile_restore", { snapshot }),
  /** Put mods in a profile on, or (enabled false) keep them listed but off, without switching to it. On the active
   *  profile this is a normal toggle (files renamed, one skin per character) and `change` says what moved; on another
   *  profile only its list changes and `change` is empty. */
  setMods: (profileId: number, modIds: string[], enabled: boolean) => call<SwitchReport>("profile_set_mods", { profileId, modIds, enabled }),
};

/** A hotkey Windows wouldn't give the app because another app holds it. */
export interface HotkeyTaken { combo: string; reason: string }

/** In-game hotkeys that switch profiles. Settings: "hotkeys.enabled" ("0" is off), "hotkeys.next", "hotkeys.prev". */
export const hotkeys = {
  /** Register every hotkey again after a change. Returns the ones another app holds. */
  sync: () => call<HotkeyTaken[]>("hotkeys_sync"),
};
