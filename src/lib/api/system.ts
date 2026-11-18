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
  /** How XXMI loads DLLs into the game; null outside XXMI. */
  dll: DllConfig | null;
  closeOnLaunch: boolean;
  /** Fields that can't be changed from here right now ("preLaunch", "migoto.callsLogging", "migoto" ...), with the
   *  reason to show beside them. Read only. */
  locked: Record<string, string>;
  /** XXMI Launcher can start this game. */
  xxmiAvailable: boolean;
}

/** XXMI's own DLL settings (launch.rs DllConfig). `injectMode`: "HOOK", "DIRECT" or "SKIP". XXMI signs `libraries`
 *  and `unsafeMode`, so the form never changes them: `launchConfig.unsafeOff` turns Unsafe Mode off. */
export interface DllConfig { injectMode: string; injectLibraries: boolean; libraries: string; unsafeMode: boolean }

export interface FolderUse { path: string | null; files: number; bytes: number }
export interface DevStatus {
  log: FolderUse; shaderCache: FolderUse; shaderFixes: FolderUse; frameDumps: FolderUse; d3dxIni: string | null; d3dxUserIni: string | null;
}

export interface Integration { id: string; label: string; supported: boolean; ours: boolean; owner: string | null }

/** launch.rs KickCheck. `undone`: the player did the fix but XXMI's own d3d11.dll is back. `fixed`: GIMI's d3d11.dll
 *  isn't XXMI's own, so a fix looks done. `said`: the player said they did the fix. */
export interface KickCheck { warn: boolean; undone: boolean; fixed: boolean; said: boolean }

export const games = {
  list: () => call<GameState[]>("games_list"),
  detect: () => call<GameState[]>("games_detect"),
  setPaths: (game: GameId, paths: GamePaths) => call<GameState[]>("game_set_paths", { game, paths }),
  setShown: (game: GameId, shown: boolean) => call<GameState[]>("game_set_shown", { game, shown }),
  /** Resolves to a note when the player should know something (a community game started without its loader). */
  launch: (game: GameId, vanilla = false) => call<string | null>("game_launch", { game, vanilla }),
  /** Before a start: whether to warn that Genshin Impact's anti-cheat may stop it ("Illegal tool detected"). */
  kickCheck: (game: GameId, vanilla = false) => call<KickCheck>("game_kick_check", { game, vanilla }),
  /** The player did the fix from the community guide by hand (saves GIMI's d3d11.dll as it is), or takes it back. */
  kickFixDone: (done: boolean) => call<void>("game_kick_fix_done", { done }),
  running: (game: GameId) => call<boolean>("game_running", { game }),
  /** The game's own icon at 256 px, taken from its exe and kept as a PNG in the app's data folder; null when the game
   *  folder isn't known. */
  icon: (game: GameId) => call<string | null>("game_icon", { game }),
  onState: (cb: (p: { game: GameId; running: boolean }) => void) => listen<{ game: GameId; running: boolean }>(EVENTS.gameState, cb),
};

/** One step of installing XXMI and the mod loaders; `total` is the download's size when known. */
export interface SetupProgress { step: string; done: number; total: number | null }

export const xxmi = {
  status: () => call<XxmiStatus>("xxmi_status"),
  open: () => call<void>("xxmi_open"),
  /** Install XXMI Launcher and the mod loader of each game (every XXMI game found on this PC when none are given),
   *  then look for games again. Steps arrive through `onSetup`. */
  install: (games?: GameId[]) => call<GameState[]>("xxmi_install", { games: games ?? null }),
  /** Uninstall the mod loaders of `games`, or XXMI Launcher and every loader when none are given. Files go to the
   *  Recycle Bin; each Mods folder stays (`kept`). */
  uninstall: (games?: GameId[]) => call<{ games: GameState[]; kept: string[] }>("xxmi_uninstall", { games: games ?? null }),
  onSetup: (cb: (p: SetupProgress) => void) => listen<SetupProgress>("xxmi-setup", cb),
};

export const launchConfig = {
  get: (game: GameId) => call<LaunchConfig>("launch_config_get", { game }),
  set: (game: GameId, config: LaunchConfig) => call<LaunchConfig>("launch_config_set", { game, config }),
  /** Turn XXMI's Unsafe Mode off (only XXMI Launcher can turn it on). Resolves to the form as it now reads. */
  unsafeOff: (game: GameId) => call<LaunchConfig>("launch_unsafe_off", { game }),
};

export const dev = {
  status: (game: GameId) => call<DevStatus>("dev_status", { game }),
  logTail: (game: GameId, lines = 400) => call<string>("dev_log_tail", { game, lines }),
  clearShaderCache: (game: GameId) => call<number>("dev_clear_shader_cache", { game }),
  clearFrameDumps: (game: GameId) => call<number>("dev_clear_frame_dumps", { game }),
  reload: (game: GameId) => call<void>("dev_reload", { game }),
  /** False when there was nothing to clear. */
  wipeUserConfig: (game: GameId) => call<boolean>("dev_wipe_user_config", { game }),
  /** Put back the d3dx_user.ini the last wipe kept a copy of. */
  unwipeUserConfig: (game: GameId) => call<void>("dev_unwipe_user_config", { game }),
};

export const integrations = {
  get: () => call<Integration[]>("integrations_get"),
  /** On points it at this copy of gachamod (taking it from another program); off removes it until turned on again. */
  set: (id: string, on: boolean) => call<Integration[]>("integration_set", { id, on }),
};

export const about = {
  /** The app's data folder (database, trash, downloads). */
  dataDir: () => call<string>("app_data_dir"),
  /** The game a fresh install's setup was named for (gachamod-setup-zzz.exe), once. */
  setupGame: () => call<GameId | null>("setup_game"),
  /** Save the look on screen for gachamod setup, which shows it during repair and uninstall (lib/theme.ts sends it). */
  saveLook: (look: Record<string, unknown>) => call<void>("save_look", { look }),
  /** True when gachamod setup sits next to the app (installed copies). */
  setupAvailable: () => call<boolean>("setup_available"),
  /** Open gachamod setup for repair or uninstall. */
  openSetup: () => call<void>("setup_open"),
  /** Start over at the next start: the old data moves to a backup (gacha-core reset.rs). Then call relaunch. */
  reset: () => call<void>("app_reset"),
  /** Close gachamod and open it again. */
  relaunch: () => call<void>("app_relaunch"),
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
  missingNames?: string[];
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
  /** With updates set to only tell, a background check found a newer version (once per version). */
  onFound: (cb: (p: { version: string }) => void) => listen<{ version: string }>("app-update-found", cb),
};
