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
  register: (id: string) => call<Integration[]>("integration_register", { id }),
};

export const about = {
  /** The app's data folder (database, trash, downloads). */
  dataDir: () => call<string>("app_data_dir"),
};
