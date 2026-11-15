// Usage counts and error capture for the window. Owner: SYSTEM area.
//
// Counts which screens get opened, which backend commands run (the buttons that do something), which settings get
// changed (the key, and the value only when it's on or off), clicks on anything marked data-t="name", and whether the
// mouse, keyboard or a controller is used. Everything goes to the backend in batches; telemetry.rs keeps only known
// names and short plain values, drops it all when usage counts are off, and sends it. No mod names, paths or text
// the player typed. Errors in the window's code are logged and kept as crash reports; failed calls and console
// errors go to gachamod.log. docs/telemetry.md lists every event.
import { report, type UsageEvent } from "./api/report";
import { inTauri, watchCalls } from "./tauri";
import { currentGame, currentRoute, onRoute } from "./store";

const queue: UsageEvent[] = [];
const used = new Map<string, number>();
const logLines: Array<{ level: "info" | "warn" | "error"; text: string }> = [];
const inputs = new Set<string>();
const errors = new Set<string>();
/** Commands that are part of this, or read so often that counting them says nothing. */
const UNCOUNTED = new Set(["telemetry_events", "log_write", "report_ui_error", "settings_get", "report_state", "admin_state", "game_check_saved", "game_check_menu"]);

const plain = (s: string) => s.replace(/[^A-Za-z0-9 _.-]/g, "").slice(0, 60);

/** Count a usage event. */
export function note(name: UsageEvent["name"], props: UsageEvent["props"] = {}) {
  if (!inTauri()) return;
  queue.push({ name, props: { ...props, game: currentGame()?.id ?? "none" } });
  if (queue.length > 500) queue.splice(0, queue.length - 500);
}

/** A backend command ran (lib/tauri.ts `call`). */
function noteCall(cmd: string, args: Record<string, unknown>) {
  if (UNCOUNTED.has(cmd)) return;
  used.set(cmd, (used.get(cmd) ?? 0) + 1);
  if (cmd === "settings_set" && typeof args.key === "string") {
    const v = String(args.value ?? "");
    note("setting", { key: plain(args.key), ...(["0", "1", "true", "false"].includes(v) ? { value: v } : {}) });
  }
}

/** A backend command failed: one line in the log. */
function noteFailure(cmd: string, e: unknown) {
  if (UNCOUNTED.has(cmd)) return;
  log("warn", `${cmd} failed: ${e instanceof Error ? e.message : String(e)}`);
}

export function log(level: "info" | "warn" | "error", text: string) {
  if (!inTauri()) return;
  logLines.push({ level, text: text.slice(0, 2000) });
  if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
}

function flush() {
  if (!inTauri()) return;
  const events: UsageEvent[] = queue.splice(0);
  for (const [command, count] of used) events.push({ name: "used", props: { command, count } });
  used.clear();
  if (events.length) report.events(events).catch(() => {});
  const lines = logLines.splice(0);
  if (lines.length) report.log(lines).catch(() => {});
}

/** An error in the window's code: logged and kept as a crash report (each message once per run, five at most). */
export function reportError(e: unknown, where = "") {
  const err = e instanceof Error ? e : new Error(String(e));
  const message = `${where ? `${where}: ` : ""}${err.message || String(e)}`;
  if (errors.has(message) || errors.size >= 5 || !inTauri()) return;
  errors.add(message);
  report.uiError(message, err.stack ?? "").catch(() => {});
}

function screen() {
  const r = currentRoute();
  const props: UsageEvent["props"] = { view: r.view };
  if (r.tab && !r.tab.startsWith("ext:")) props.tab = plain(r.tab);
  if (r.section) props.section = plain(r.section);
  note("screen", props);
}

function input(kind: "mouse" | "keyboard" | "controller") {
  if (inputs.has(kind)) return;
  inputs.add(kind);
  note("input", { kind });
}

/** Start counting (once, before the window renders). `where` names the window ("main" or "overlay"). */
export function installTelemetry(where: "main" | "overlay") {
  if (!inTauri()) return;
  watchCalls({ ran: noteCall, failed: noteFailure });
  if (where === "main") { screen(); onRoute(screen); } else note("screen", { view: "overlay" });
  document.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.("[data-t]");
    const name = el?.getAttribute("data-t");
    if (name) note("click", { target: plain(name) });
  }, true);
  window.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" || e.pointerType === "touch") input("mouse"); }, true);
  window.addEventListener("keydown", (e) => { if (["Tab", "ArrowDown", "ArrowUp", "Enter"].includes(e.key)) input("keyboard"); }, true);
  window.addEventListener("gamepadconnected", () => input("controller"));
  window.addEventListener("error", (e) => reportError(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "unhandled"));
  for (const level of ["warn", "error"] as const) {
    const before = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      before(...args);
      log(level, args.map((a) => a instanceof Error ? `${a.message}\n${a.stack ?? ""}` : typeof a === "string" ? a : safeJson(a)).join(" "));
    };
  }
  window.setInterval(flush, 60_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v)?.slice(0, 500) ?? String(v); } catch { return String(v); }
}
