// What the Downloads badge counts, kept apart so the sidebar tip can say "2 downloading, 1 to pick" instead of
// calling a pick a download. OnlineOverlays sets it with the badge. Owner: ONLINE area.
import { useSyncExternalStore } from "react";

export interface DownloadsCounts { downloading: number; picks: number; failed: number }

let counts: DownloadsCounts = { downloading: 0, picks: 0, failed: 0 };
const subs = new Set<() => void>();

export function setDownloadsCounts(next: DownloadsCounts) {
  if (next.downloading === counts.downloading && next.picks === counts.picks && next.failed === counts.failed) return;
  counts = next;
  subs.forEach((f) => f());
}

export const useDownloadsCounts = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => counts);

/** The tip's count part: "3 failed", "1 waiting for you to pick", "2 downloading, 1 to pick". Empty with nothing. */
export function downloadsTipText(c: DownloadsCounts): string {
  if (c.failed > 0) return `${c.failed} failed`;
  if (!c.downloading) return c.picks ? `${c.picks} waiting for you to pick` : "";
  return c.picks ? `${c.downloading} downloading, ${c.picks} to pick` : `${c.downloading} downloading`;
}
