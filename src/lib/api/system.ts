// Games, XXMI, launching, dev tools, Windows integration. Owner: SYSTEM area. Rust: commands/system.rs.
import { call, listen } from "../tauri";
import { EVENTS, type GameId, type GameState } from "./types";

export interface GamePaths { gameDir?: string | null; importerDir?: string | null; modsDir?: string | null; viaXxmi?: boolean }

export interface ImporterInfo {
  code: string; game: GameId | null; enabled: boolean; deployedVersion: string | null; latestVersion: string | null;
  gameFolder: string | null; importerDir: string | null;
}
export interface XxmiStatus {
  found: boolean; root: string | null; exe: string | null; config: string | null; version: string | null; latest: string | null;
  running: boolean; importers: ImporterInfo[];
}

export interface Hook { enabled: boolean; command: string; wait: boolean }
export interface MigotoConfig {
  hunting: boolean; dumpShaders: boolean; muteWarnings: boolean; logLevel: string; callsLogging: boolean; debugLogging: boolean; enforceRendering: boolean;
}
export interface LaunchConfig {
  via: "xxmi" | "direct";
  args: string;
  processPriority: string;
  windowMode: string;
  preLaunch: Hook;
  postLoad: Hook;
  customExe: string | null;
  extras: Record<string, unknown>;
  migoto: MigotoConfig;
  closeOnLaunch: boolean;
  /** Fields that can't be changed from here right now ("preLaunch", "migoto.callsLogging", "migoto" ...), with the
   *  reason to show beside them. Read only. */
  locked: Record<string, string>;
  /** XXMI Launcher can start this game. */
  xxmiAvailable: boolean;
}

export interface FolderUse { path: string | null; files: number; bytes: number }
export interface DevStatus {
  log: FolderUse; shaderCache: FolderUse; shaderFixes: FolderUse; frameDumps: FolderUse; d3dxIni: string | null; d3dxUserIni: string | null;
}

export interface Integration { id: string; label: string; supported: boolean; ours: boolean; owner: string | null }

export const games = {
  list: () => call<GameState[]>("games_list"),
  detect: () => call<GameState[]>("games_detect"),
  setPaths: (game: GameId, paths: GamePaths) => call<GameState[]>("game_set_paths", { game, paths }),
  setShown: (game: GameId, shown: boolean) => call<GameState[]>("game_set_shown", { game, shown }),
  launch: (game: GameId, vanilla = false) => call<void>("game_launch", { game, vanilla }),
  running: (game: GameId) => call<boolean>("game_running", { game }),
  /** The game's own icon at 256 px, taken from its exe and kept as a PNG in the app's data folder; null when the game
   *  folder isn't known. */
  icon: (game: GameId) => call<string | null>("game_icon", { game }),
  onState: (cb: (p: { game: GameId; running: boolean }) => void) => listen<{ game: GameId; running: boolean }>(EVENTS.gameState, cb),
};

export const xxmi = {
  status: () => call<XxmiStatus>("xxmi_status"),
  open: () => call<void>("xxmi_open"),
};

export const launchConfig = {
  get: (game: GameId) => call<LaunchConfig>("launch_config_get", { game }),
  set: (game: GameId, config: LaunchConfig) => call<LaunchConfig>("launch_config_set", { game, config }),
};

export const dev = {
  status: (game: GameId) => call<DevStatus>("dev_status", { game }),
  logTail: (game: GameId, lines = 400) => call<string>("dev_log_tail", { game, lines }),
  clearShaderCache: (game: GameId) => call<number>("dev_clear_shader_cache", { game }),
  clearFrameDumps: (game: GameId) => call<number>("dev_clear_frame_dumps", { game }),
  reload: (game: GameId) => call<void>("dev_reload", { game }),
  wipeUserConfig: (game: GameId) => call<void>("dev_wipe_user_config", { game }),
};

export const integrations = {
  get: () => call<Integration[]>("integrations_get"),
  /** On points it at this copy of gachamod (taking it from another program); off removes it until turned on again. */
  set: (id: string, on: boolean) => call<Integration[]>("integration_set", { id, on }),
};

export const about = {
  /** The app's data folder (database, trash, downloads). */
  dataDir: () => call<string>("app_data_dir"),
};

// ── settings file (commands/app.rs) ──

export interface ImportSummary {
  appVersion: string; exportedAt: number;
  /** Settings whose value changes. */
  settings: number;
  /** Games whose folders, rail visibility, theme or settings change. */
  games: string[];
  newProfiles: string[];
  replacedProfiles: string[];
  /** Paths in the file that aren't on this PC, skipped. */
  skippedPaths: string[];
  /** Mods named in profiles that this PC doesn't have. */
  missingMods: number;
  /** The window's own choices to apply (theme picks, colours, text size). */
  ui: Record<string, string>;
  /** The backup taken before applying (empty in a preview). */
  backup: string;
}

export const settingsFile = {
  /** Write the settings file. `ui`: the window's own stored choices. */
  export: (path: string, profiles: boolean, ui: Record<string, string>) =>
    call<{ games: number; profiles: number; settings: number }>("settings_export", { path, profiles, ui }),
  preview: (path: string) => call<ImportSummary>("settings_import_preview", { path }),
  /** Back up the current settings (with `ui`), then apply the file. */
  import: (path: string, ui: Record<string, string>) => call<ImportSummary>("settings_import", { path, ui }),
  /** Put back the settings from before an import; resolves to the window's choices from then. */
  undo: (backup: string) => call<Record<string, string>>("settings_import_undo", { backup }),
};

// ── gachamod's own updates (commands/app.rs) ──

export interface Release { version: string; name: string; url: string; notes: string; publishedAt: string | null }
export interface UpdateCheck {
  current: string;
  /** The update feed answered. */
  reachable: boolean;
  /** `release` is newer than this copy. */
  available: boolean;
  /** It's downloaded: it installs when gachamod closes, or now with `install`. */
  ready: boolean;
  release: Release | null;
}

export const appUpdate = {
  /** Never fails: no answer from the update feed is `reachable: false`. */
  check: () => call<UpdateCheck>("app_update_check"),
  /** What the last check found, without going online. */
  status: () => call<UpdateCheck>("app_update_status"),
  /** Download the update if it isn't yet, then run the installer, which closes gachamod and opens the new version. */
  install: () => call<void>("app_update_install"),
  onProgress: (cb: (p: { done: number; total: number | null }) => void) => listen<{ done: number; total: number | null }>("app-update-progress", cb),
  /** A newer version finished downloading in the background. */
  onReady: (cb: (p: { version: string }) => void) => listen<{ version: string }>("app-update-ready", cb),
};
