// Logs, crash reports, usage counts, feedback, starting as administrator and the desktop shortcuts (src-tauri
// commands/report.rs).
// Owner: SYSTEM area.
import { call, listen } from "../tauri";
import { EVENTS } from "./types";

export interface ReportState {
  usage: boolean;
  crashes: boolean;
  /** False in a build made without the PostHog key: the switches still work, nothing is sent. */
  configured: boolean;
  logsDir: string | null;
  /** The random id counts carry, or null while none was made. */
  installId: string | null;
}

export type FeedbackKind = "problem" | "idea" | "other";
export interface Feedback { kind: FeedbackKind; text: string; contact?: string; logs: boolean; screen?: string; game?: string }

/** One usage event: a name the backend knows and a few short plain values (telemetry.rs drops anything else). */
export interface UsageEvent {
  name: "screen" | "click" | "setting" | "input" | "used" | "game launched" | "download queued" | "mods toggled" | "profile switched"
    | "profile made" | "extension installed";
  props: Record<string, string | number | boolean>;
}

export interface AdminState { elevated: boolean; always: boolean }

/** The rendering log (src-tauri render.rs): its folder and how many incident files it holds. */
export interface RenderState { on: boolean; dir: string | null; incidents: number }

/** What gachamod reads about a game's setup by itself (gacha-core gamecheck.rs). */
export interface CheckSetup {
  game: string;
  name: string;
  /** The loader: an XXMI importer code ("ZZMI") or "3DMigoto". */
  importer: string;
  viaXxmi: boolean;
  loaderVersion: string | null;
  xxmiVersion: string | null;
  windowMode: string | null;
  running: boolean;
  /** Null while the game isn't running. */
  gameAdmin: boolean | null;
  appAdmin: boolean;
  /** d3dx.ini check_foreground_window: "1" reads keys only while the game is in front. */
  foregroundCheck: string | null;
  reloadKey: string | null;
  liveGroups: number;
  menuStyle: "window" | "game" | "off";
  menuKey: string;
  menuPad: boolean;
}
/** What the game last saved for a live group, and when (ms since 1970). */
export interface SavedPick { value: number | null; savedAt: number | null }
/** Each step's answer and what gachamod saw, as short plain values. */
export type CheckSteps = Record<string, string | number | boolean>;
export interface CheckReport { game: string; steps: CheckSteps; notes?: string; contact?: string; logs: boolean }

export const gameCheck = {
  setup: (game: string) => call<CheckSetup>("game_check_setup", { game }),
  saved: (game: string, group: number) => call<SavedPick>("game_check_saved", { game, group }),
  /** "window" or "drawn" when gachamod opened the skin menu since `since`; null when it didn't (or the game took the key). */
  menu: (game: string, since: number) => call<string | null>("game_check_menu", { game, since }),
  send: (report: CheckReport) => call<void>("game_check_send", { report }),
};

export const report = {
  state: () => call<ReportState>("report_state"),
  set: (p: { usage?: boolean; crashes?: boolean }) => call<ReportState>("report_set", p),
  /** Forget the install id; the next count gets a new one. */
  resetId: () => call<ReportState>("report_reset_id"),
  events: (events: UsageEvent[]) => call<void>("telemetry_events", { events }),
  feedback: (feedback: Feedback) => call<void>("feedback_send", { feedback }),
  log: (lines: Array<{ level: "info" | "warn" | "error"; text: string }>) => call<void>("log_write", { lines }),
  uiError: (message: string, stack: string) => call<void>("report_ui_error", { message, stack }),
  /** The end of gachamod.log, at most `max` bytes. */
  logTail: (max = 200_000) => call<string>("log_tail", { max }),
  /** Each line as the backend writes it to gachamod.log. */
  onLog: (cb: (l: { level: "info" | "warn" | "error"; text: string }) => void) => listen<{ level: "info" | "warn" | "error"; text: string }>(EVENTS.appLog, cb),
};

export const rendering = {
  state: () => call<RenderState>("render_state"),
};

export const admin = {
  state: () => call<AdminState>("admin_state"),
  /** Start as administrator every time, from the next start. */
  setAlways: (on: boolean) => call<AdminState>("admin_set_always", { on }),
  /** Close and open again as administrator. Windows asks first; false when the player said no there. */
  restart: () => call<boolean>("app_restart_admin"),
};

/** The desktop shortcuts: gachamod, quickstart (gachamod://play, screens/home/quickstart.ts) and a quickstart for one
 *  game (gachamod://play/zzz). */
export type ShortcutKind = "app" | "quickstart";
export interface ShortcutState { app: boolean; quickstart: boolean; /** Games with a quickstart of their own. */ games: string[] }

export const shortcuts = {
  state: () => call<ShortcutState>("shortcuts_state"),
  /** Make it on the desktop, over one that's there. */
  create: (kind: ShortcutKind) => call<ShortcutState>("shortcuts_create", { kind }),
  remove: (kind: ShortcutKind) => call<ShortcutState>("shortcuts_remove", { kind }),
  createGame: (game: string) => call<ShortcutState>("shortcuts_create_game", { game }),
  removeGame: (game: string) => call<ShortcutState>("shortcuts_remove_game", { game }),
  /** The quickstart shortcut now starts `game`, so its icon becomes that game's. */
  follow: (game: string) => call<void>("shortcuts_follow", { game }),
};
