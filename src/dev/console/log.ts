// The console's output: everything the window logs, every backend call with its time and result, gachamod.log lines
// as the backend writes them, toasts and app events. A ring of the last few thousand lines. Dev and demo only.
import { useSyncExternalStore } from "react";
import { inTauri, onCallDone } from "../../lib/tauri";
import { onToastShown } from "../../ui/toast";

export type Level = "debug" | "info" | "warn" | "error";
/** Where a line came from: the window's code, a backend call, gachamod.log, a toast, an app event, or the console. */
export type Source = "ui" | "call" | "backend" | "toast" | "event" | "you";
export interface Line { id: number; at: number; level: Level; source: Source; text: string; detail?: string }

const MAX = 4000;
let lines: Line[] = [];
let next = 1;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export function push(level: Level, source: Source, text: string, detail?: string) {
  lines = [...(lines.length >= MAX ? lines.slice(lines.length - MAX + 1) : lines), { id: next++, at: Date.now(), level, source, text, detail }];
  notify();
}
export const print = (text: string, level: Level = "info") => push(level, "you", text);
export function clearLines() { lines = []; notify(); }
export const allLines = () => lines;
export const useLines = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lines);

/** Text for any value: strings as they are, errors with their stack, the rest as short JSON. */
export function show(v: unknown, max = 4000): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
  if (v && typeof v === "object" && "message" in v && typeof (v as { message: unknown }).message === "string") {
    const e = v as { kind?: string; message: string };
    return e.kind ? `[${e.kind}] ${e.message}` : e.message;
  }
  try {
    const s = JSON.stringify(v, (_k, x: unknown) => (typeof x === "string" && x.length > 300 ? `${x.slice(0, 300)}…` : x));
    return s === undefined ? String(v) : s.length > max ? `${s.slice(0, max)}…` : s;
  } catch { return String(v); }
}

let installed = false;
/** Start listening. Safe to call more than once. */
export function installCapture() {
  if (installed) return;
  installed = true;

  const methods: Array<[keyof Console, Level]> = [["log", "info"], ["info", "info"], ["debug", "debug"], ["warn", "warn"], ["error", "error"]];
  for (const [name, level] of methods) {
    const orig = (console[name] as (...a: unknown[]) => void).bind(console);
    (console as unknown as Record<string, (...a: unknown[]) => void>)[name] = (...args: unknown[]) => {
      orig(...args);
      const [first, ...rest] = args.map((a) => show(a));
      const head = (first ?? "").split("\n")[0]!;
      const more = [(first ?? "").split("\n").slice(1).join("\n"), ...rest].filter(Boolean).join("\n");
      push(level, "ui", head + (rest.length && !more.includes("\n") && more.length < 160 ? ` ${more}` : ""), more.length >= 160 || more.includes("\n") ? more : undefined);
    };
  }
  window.addEventListener("error", (e) => push("error", "ui", `Uncaught: ${e.message}`, e.error ? show(e.error) : `${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => push("error", "ui", `Unhandled rejection: ${show(e.reason).split("\n")[0]}`, show(e.reason)));

  onCallDone((c) => {
    const args = Object.keys(c.args).length ? ` ${show(c.args, 200)}` : "";
    const ms = `${c.ms < 10 ? c.ms.toFixed(1) : Math.round(c.ms)} ms`;
    if (c.ok) push("debug", "call", `${c.cmd}${args}  ${ms}`, c.result === undefined ? undefined : show(c.result, 20_000));
    else push("error", "call", `${c.cmd}${args} failed after ${ms}: ${show(c.error).split("\n")[0]}`, show(c.error));
  });

  onToastShown((text, en, bad, action) => {
    const extra = [en !== text ? `English: ${en}` : "", action ? `Button: ${action}` : ""].filter(Boolean).join("\n");
    push(bad ? "warn" : "info", "toast", text, extra || undefined);
  });

  window.addEventListener("gm-app", (e) => {
    const d = (e as CustomEvent<{ type: string }>).detail;
    const { type, ...rest } = d;
    push("debug", "event", `${type}${Object.keys(rest).length ? ` ${show(rest, 200)}` : ""}`);
  });

  // gachamod.log, line by line as the backend writes it (the demo sends a few lines of its own)
  void import("../../lib/api").then(({ report }) => report.onLog((l) => {
    const [head, ...more] = l.text.split("\n");
    push(l.level, "backend", head ?? "", more.length ? more.join("\n") : undefined);
  })).catch(() => {});

  push("info", "you", `Console ready (${inTauri() ? "app" : "browser demo"}). Type help, or press Shift+\` to close.`);
}
