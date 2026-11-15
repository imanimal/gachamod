// Logs, crash reports, usage counts, feedback, and starting as administrator (src-tauri commands/report.rs).
// Owner: SYSTEM area.
import { call } from "../tauri";

export interface ReportState {
  usage: boolean;
  crashes: boolean;
  /** False in a build made without the PostHog key: the switches still work, nothing is sent. */
  configured: boolean;
  logsDir: string | null;
}

export type FeedbackKind = "problem" | "idea" | "other";
export interface Feedback { kind: FeedbackKind; text: string; contact?: string; logs: boolean; screen?: string; game?: string }

/** One usage event: a name the backend knows and a few short plain values (telemetry.rs drops anything else). */
export interface UsageEvent { name: "screen" | "click" | "setting" | "input" | "used"; props: Record<string, string | number | boolean> }

export interface AdminState { elevated: boolean; always: boolean }

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
  menuStyle: "window" | "off";
  menuKey: string;
  menuPad: boolean;
}
/** Each step's answer and what gachamod saw, as short plain values. */
export type CheckSteps = Record<string, string | number | boolean>;
export interface CheckReport { game: string; steps: CheckSteps; notes?: string; contact?: string; logs: boolean }

export const gameCheck = {
  setup: (game: string) => call<CheckSetup>("game_check_setup", { game }),
  /** What gachamod did with the menu since `since`: "window" (it opened over the game), "fullscreen" (the key was
   *  pressed but the game runs in exclusive fullscreen) or "picked" (a skin was picked in it). Null: nothing yet. */
  menu: (game: string, since: number) => call<string | null>("game_check_menu", { game, since }),
  send: (report: CheckReport) => call<void>("game_check_send", { report }),
};

export const report = {
  state: () => call<ReportState>("report_state"),
  set: (p: { usage?: boolean; crashes?: boolean }) => call<ReportState>("report_set", p),
  events: (events: UsageEvent[]) => call<void>("telemetry_events", { events }),
  feedback: (feedback: Feedback) => call<void>("feedback_send", { feedback }),
  log: (lines: Array<{ level: "info" | "warn" | "error"; text: string }>) => call<void>("log_write", { lines }),
  uiError: (message: string, stack: string) => call<void>("report_ui_error", { message, stack }),
};

export const admin = {
  state: () => call<AdminState>("admin_state"),
  /** Start as administrator every time, from the next start. */
  setAlways: (on: boolean) => call<AdminState>("admin_set_always", { on }),
  /** Close and open again as administrator. Windows asks first; false when the player said no there. */
  restart: () => call<boolean>("app_restart_admin"),
};
