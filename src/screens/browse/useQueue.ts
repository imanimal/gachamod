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
    // an event that arrives before the first answer is newer than it
    let heard = false;
    queue.get().then((s) => { if (!heard) take(s); }).catch(() => {});
    const off = held(queue.onChange((s) => { heard = true; take(s); }));
    return () => { live = false; off(); };
  }, []);
  return snap;
}
