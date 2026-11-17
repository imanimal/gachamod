// The download queue as React state: one shared copy, kept up to date from queue events. A full snapshot comes on
// every state change; between them a small "queue-progress" event patches just the rows that moved, so a running
// download doesn't redraw the whole list eight times a second. Owner: ONLINE area.
import { useSyncExternalStore } from "react";
import { errorText, queue, type InstallProgress, type QueueProgress, type QueueSnapshot } from "../../lib/api";
import { held } from "../../lib/tauri";

const EMPTY: QueueSnapshot = { items: [], summary: { running: 0, waiting: 0, needsChoice: 0, done: 0, failed: 0 } };

export interface QueueState {
  snap: QueueSnapshot;
  /** Why the queue couldn't be read, until it can. */
  error: string | null;
  /** A read is running (the first one, or a retry after an error). */
  loading: boolean;
  /** Read the queue again (after an error). */
  reload: () => void;
}

let state: QueueState = { snap: EMPTY, error: null, loading: false, reload: () => load() };
const subs = new Set<() => void>();
let stop: (() => void) | null = null;
// an event that arrives before the answer to a read is newer than it
let heard = false;

function set(next: Partial<QueueState>) {
  state = { ...state, ...next };
  subs.forEach((f) => f());
}

function take(s: QueueSnapshot) { heard = true; set({ snap: s, error: null, loading: false }); }

function load() {
  heard = false;
  set({ loading: true });
  queue.get().then((s) => { if (!heard) set({ snap: s, error: null, loading: false }); })
    .catch((e) => { if (!heard) set({ error: errorText(e), loading: false }); });
}

const sameStep = (a: InstallProgress | null | undefined, b: InstallProgress) =>
  !!a && a.step === b.step && a.done === b.done && a.total === b.total && a.placed === b.placed && a.mods.length === b.mods.length;

/** Patch the rows a progress event names. Other rows keep their objects, so memo rows and cards skip a redraw. */
function patch(list: QueueProgress[]) {
  const by = new Map(list.map((p) => [p.id, p]));
  let changed = false;
  const items = state.snap.items.map((i) => {
    const p = by.get(i.id);
    if (!p) return i;
    if (i.state === "downloading" && p.received !== undefined && (p.received !== i.received || (p.total ?? null) !== i.total)) {
      changed = true;
      return { ...i, received: p.received, total: p.total ?? null };
    }
    if (i.state === "installing" && p.progress && !sameStep(i.progress, p.progress)) {
      changed = true;
      return { ...i, progress: p.progress };
    }
    return i;
  });
  if (changed) set({ snap: { ...state.snap, items } });
}

/** Listen to the queue while anything uses it. */
export function subscribeQueue(f: () => void): () => void {
  subs.add(f);
  if (!stop) {
    const offChange = held(queue.onChange(take));
    const offProgress = held(queue.onProgress(patch));
    stop = () => { offChange(); offProgress(); };
    load();
  }
  return () => {
    subs.delete(f);
    if (!subs.size && stop) { stop(); stop = null; }
  };
}

/** The latest queue snapshot (kept after the last listener goes, so a page opened again starts from it). */
export const getQueue = (): QueueSnapshot => state.snap;

export function useQueue(): QueueSnapshot {
  return useSyncExternalStore(subscribeQueue, getQueue);
}

/** The queue with its read error, for a page that says when it couldn't be read. */
export function useQueueState(): QueueState {
  return useSyncExternalStore(subscribeQueue, () => state);
}
