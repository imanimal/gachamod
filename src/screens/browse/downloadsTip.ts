// What the Downloads badge counts, kept apart so the sidebar tip can say "2 downloading, 1 to pick" instead of
// calling a pick a download. OnlineOverlays sets it with the badge. Owner: ONLINE area.
import { useSyncExternalStore } from "react";
import { t } from "../../lib/i18n";

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
  if (c.failed > 0) return t("{n} failed", { n: c.failed });
  if (!c.downloading) return c.picks ? t("{n} waiting for you to pick", { n: c.picks }) : "";
  return c.picks ? t("{n} downloading, {picks} to pick", { n: c.downloading, picks: c.picks }) : t("{n} downloading", { n: c.downloading });
}
