// The one place the UI touches Tauri. Outside Tauri (plain `npm run dev` in a browser) calls go to the
// in-memory demo backend instead, so the UI can be worked on and tested without the Rust side.
import type { InvokeArgs } from "@tauri-apps/api/core";
import { describeCall, track } from "./activity";

export const inTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** This window is the menu shown over a running game (src-tauri overlay.rs), or its demo at #overlay in a browser. */
export const isMenuWindow = (): boolean => typeof window !== "undefined" && (window.location.hash === "#overlay"
  || (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label === "overlay");

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;
const demo: Record<string, Handler> = {};

/** Register demo handlers used when running outside Tauri. */
export function registerDemo(handlers: Record<string, Handler>) { Object.assign(demo, handlers); }

/** What hears about every call (usage counts and the log, lib/telemetry.ts). */
let watcher: { ran: (cmd: string, args: Record<string, unknown>) => void; failed: (cmd: string, e: unknown) => void } | null = null;
export function watchCalls(w: NonNullable<typeof watcher>) { watcher = w; }

/** A finished call, for the console (src/dev/console): how long it took and what came back or went wrong. */
export interface CallDone { cmd: string; args: Record<string, unknown>; ms: number; ok: boolean; result?: unknown; error?: unknown }
const callDone = new Set<(c: CallDone) => void>();
export function onCallDone(f: (c: CallDone) => void): () => void { callDone.add(f); return () => { callDone.delete(f); }; }

/** Run a backend command. Each one is noted in lib/activity.ts while it runs, so a slow one shows what it is. */
export function call<T>(cmd: string, args: InvokeArgs = {}): Promise<T> {
  const d = describeCall(cmd);
  watcher?.ran(cmd, args as Record<string, unknown>);
  const p = d ? track(run<T>(cmd, args), d[0], d[1]) : run<T>(cmd, args);
  if (watcher) p.catch((e) => watcher?.failed(cmd, e));
  if (callDone.size) {
    const t0 = performance.now();
    const tell = (c: Omit<CallDone, "cmd" | "args" | "ms">) => callDone.forEach((f) => f({ cmd, args: args as Record<string, unknown>, ms: performance.now() - t0, ...c }));
    p.then((result) => tell({ ok: true, result }), (error) => tell({ ok: false, error }));
  }
  return p;
}

async function run<T>(cmd: string, args: InvokeArgs): Promise<T> {
  if (inTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  const h = demo[cmd];
  if (!h) throw new Error(`No demo handler for ${cmd}`);
  return (await h(args as Record<string, unknown>)) as T;
}

type Unlisten = () => void;
const demoListeners = new Map<string, Set<(p: unknown) => void>>();

export async function listen<T>(event: string, cb: (payload: T) => void): Promise<Unlisten> {
  if (inTauri()) {
    const { listen: l } = await import("@tauri-apps/api/event");
    return l<T>(event, (e) => cb(e.payload));
  }
  // each listen gets its own entry, like Tauri's, so unlistening one never removes another with the same callback
  const set = demoListeners.get(event) ?? new Set();
  const h = (p: unknown) => cb(p as T);
  set.add(h);
  demoListeners.set(event, set);
  return () => set.delete(h);
}

/** A listener's unlisten, usable before the listener is in place: called early, it removes the listener as soon as
 *  it arrives (an effect cleaned up before `listen` resolved would otherwise leave it running). */
export function held(p: Promise<Unlisten>): Unlisten {
  let gone = false, off: Unlisten | undefined;
  p.then((u) => { if (gone) u(); else off = u; }).catch(() => {});
  return () => { gone = true; off?.(); off = undefined; };
}

/** Demo backend: emit an event to listeners. */
export function demoEmit(event: string, payload: unknown) {
  demoListeners.get(event)?.forEach((cb) => cb(payload));
}

export async function windowAction(action: "minimize" | "toggleMaximize" | "close" | "startDragging") {
  if (!inTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  await w[action]();
}
