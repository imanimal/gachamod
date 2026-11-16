// Shared shapes that cross from Rust (crates/gacha-core/src/model.rs and friends). camelCase, as serde sends them.
// Change a shape only together with its Rust twin (docs/spec.md, "Shared contract").

export interface ApiError { kind: string; message: string }
export const errorText = (e: unknown): string =>
  typeof e === "object" && e && "message" in e ? String((e as ApiError).message) : String(e);
export const errorKind = (e: unknown): string =>
  typeof e === "object" && e && "kind" in e ? String((e as ApiError).kind) : "unknown";

export type GameId = string;

export interface GameState {
  id: GameId;
  name: string;
  short: string;
  /** "GIMI", "SRMI", "ZZMI", "WWMI", "HIMI", "EFMI", or "3DMigoto" for community loaders. */
  importer: string;
  /** XXMI Launcher supports this game's importer. */
  xxmi: boolean;
  gamebananaId: number;
  /** GameBanana category whose children are the characters. */
  gbCharacterCategory: number | null;
  accent: string;
  theme: string;
  installed: boolean;
  gameDir: string | null;
  importerDir: string | null;
  modsDir: string | null;
  viaXxmi: boolean;
  importerVersion: string | null;
  importerLatest: string | null;
  shown: boolean;
  running: boolean;
  modCount: number;
  enabledCount: number;
  /** The key that reloads mods in the game (d3dx.ini reload_config), like "F10". */
  reloadKey: string;
}

export interface ModSource {
  site: "gamebanana" | string;
  modId: number;
  fileId: number | null;
  url: string;
  submitter: string | null;
  fileName: string | null;
  remoteUpdated: number | null;
}

export interface ModEntry {
  id: string;
  game: GameId;
  name: string;
  folder: string;
  relPath: string;
  path: string;
  /** On as the player sees it. A live skin that isn't the one showing is off (see `standby`). */
  enabled: boolean;
  /** A live skin that isn't the one showing: its folder stays on so turning it on switches in game at once. */
  standby?: boolean;
  character: string | null;
  group: string | null;
  source: ModSource | null;
  version: string | null;
  installedAt: number;
  sizeBytes: number;
  fileCount: number;
  iniCount: number;
  preview: string | null;
  tags: string[];
  notes: string | null;
  favorite: boolean;
  nsfw: boolean;
  hasKeys: boolean;
  conflicts: number;
  updateAvailable: boolean;
  /** The preview is one the user picked (library.setPreview). Missing on rows from before it existed. */
  customPreview?: boolean;
  /** Folders inside it with their own inis, each switched on or off in its details (library.parts). */
  parts?: number;
  /** The mod this one is a sub-mod of: an add-on that goes with it. It never counts as clashing with it, turns off
   *  with it, and turning it on turns the parent on too. */
  parent?: string | null;
}

export interface ModChange { changed: ModEntry[]; removed: string[]; notes: string[] }

export interface Character {
  name: string;
  gbCategoryId: number | null;
  icon: string | null;
  modCount: number;
  enabledCount: number;
}

/** What an owned-characters import did (owned.rs). */
export interface OwnedImport {
  /** The game the characters went to. A file that clearly belongs to one game (a GOOD export) goes there. */
  game: GameId;
  /** What the file was read as, like "GOOD", "Enka.Network profile" or "list of names". */
  format: string;
  /** Newly marked as owned. Undo clears these. */
  added: string[];
  /** Found but already marked. */
  already: number;
  /** Names that matched no character. */
  unknown: string[];
}

/** Other mod managers' details found in a Mods folder (managers.rs): JASM, XXMM, FlairX, EMMM and others. */
export interface ForeignInfo {
  managers: Array<{ manager: string; mods: number }>;
  /** Mods whose details an import would add to (name, character, link, picture). */
  fillable: number;
}

/** A mod's details before an import changed them. Only for passing back to Undo. */
export interface SidecarBack { rel: string; sidecar: unknown }

export interface ForeignImport { changed: number; managers: string[]; undo: SidecarBack[]; notes: string[] }

export interface Profile {
  id: number;
  game: GameId;
  name: string;
  /** An emoji, or "char:<Character name>". */
  icon: string | null;
  color: string | null;
  banner: string | null;
  description: string | null;
  active: boolean;
  modCount: number;
  createdAt: number;
  updatedAt: number;
  /** In-game hotkey that switches to this profile, like "Ctrl+Alt+1". */
  hotkey: string | null;
}

/** `hotkey: ""` clears it. */
export interface ProfilePatch { name?: string; icon?: string; color?: string; banner?: string; description?: string; hotkey?: string }

/** Event names (model.rs, events). */
export const EVENTS = {
  libraryChanged: "library-changed",
  queue: "queue",
  variantsNeeded: "variants-needed",
  gameState: "game-state",
  deepLink: "deep-link",
  openFile: "open-file",
  toast: "toast",
  packProgress: "pack-progress",
  gbAccount: "gb-account",
  go: "app-go",
} as const;
