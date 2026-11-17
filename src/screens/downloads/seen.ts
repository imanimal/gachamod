// Which failed downloads and pending choices the user has already looked at, so the Downloads badge counts only new
// ones. A row counts as seen once Downloads is open and the row is hovered, focused or clicked, or the page has been
// on screen a few seconds. The key holds the state and finish time, so a retry that fails again is new. Kept in
// localStorage so a reload doesn't bring the badge back. Owner: BROWSE area.
import { useSyncExternalStore } from "react";
import type { QueueItem } from "../../lib/api";

const KEY = "gm.downloads.seen";
const MAX = 300;

/** A row that drives the badge until it is seen. */
export const isNotice = (i: QueueItem) => i.state === "failed" || i.state === "needsChoice";
export const seenKey = (i: QueueItem) => `${i.id}:${i.state}:${i.finishedAt ?? ""}`;

function read(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch { return new Set(); }
}

let seen = read();
const subs = new Set<() => void>();
function save(next: Set<string>) {
  seen = next;
  try { localStorage.setItem(KEY, JSON.stringify([...next].slice(-MAX))); } catch { /* storage off */ }
  subs.forEach((f) => f());
}
// another window (the in-game menu) saw something
try {
  window.addEventListener("storage", (e) => { if (e.key === KEY) { seen = read(); subs.forEach((f) => f()); } });
} catch { /* no window */ }

const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** The seen keys; a new Set each time one is added, for React. */
export const useSeen = () => useSyncExternalStore(sub, () => seen);

export const isSeen = (i: QueueItem, set: Set<string> = seen) => set.has(seenKey(i));
export const unseen = (items: QueueItem[], set: Set<string> = seen) => items.filter((i) => isNotice(i) && !set.has(seenKey(i)));

export function markSeen(items: QueueItem[]) {
  const fresh = unseen(items);
  if (!fresh.length) return;
  const next = new Set(seen);
  fresh.forEach((i) => next.add(seenKey(i)));
  save(next);
}

/** Forget rows that left the queue or moved on (a retry). Skipped for an empty queue, which is also how it looks before it loads. */
export function pruneSeen(items: QueueItem[]) {
  if (!items.length) return;
  const keys = new Set(items.map(seenKey));
  const next = new Set([...seen].filter((k) => keys.has(k)));
  if (next.size !== seen.size) save(next);
}
