// The download queue as React state: the current snapshot, kept up to date from queue events. Owner: ONLINE area.
import { useEffect, useState } from "react";
import { queue, type QueueSnapshot } from "../../lib/api";
import { held } from "../../lib/tauri";

const EMPTY: QueueSnapshot = { items: [], summary: { running: 0, waiting: 0, needsChoice: 0, done: 0, failed: 0 } };
let last: QueueSnapshot = EMPTY;

export function useQueue(): QueueSnapshot {
  const [snap, setSnap] = useState<QueueSnapshot>(last);
  useEffect(() => {
    let live = true;
    const take = (s: QueueSnapshot) => { last = s; if (live) setSnap(s); };
    queue.get().then(take).catch(() => {});
    const off = held(queue.onChange(take));
    return () => { live = false; off(); };
  }, []);
  return snap;
}
