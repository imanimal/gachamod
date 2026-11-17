// What the download queue is doing with one GameBanana mod, for its Browse card: the shared queue store (useQueue.ts),
// and the event that opens the variant picker (OnlineOverlays hears it). Owner: BROWSE area.
import { useSyncExternalStore } from "react";
import type { GameId, QueueItem } from "../../lib/api";
import { getQueue, subscribeQueue } from "./useQueue";

export const PICK_EVENT = "gm-pick-variants";

/** Open the variant picker for a queue item that waits for a choice (Downloads' Pick button, a card's Pick badge). */
export function openVariantPicker(id: number) { window.dispatchEvent(new CustomEvent(PICK_EVENT, { detail: id })); }

const RANK: Partial<Record<QueueItem["state"], number>> = { needsChoice: 4, installing: 3, downloading: 2, waiting: 1 };

/** The queue item for this mod that is still going (a pick first, then installing, downloading, waiting), if any. */
export function activeFor(list: QueueItem[], game: GameId, modId: number): QueueItem | undefined {
  let best: QueueItem | undefined;
  for (const i of list) {
    if (i.req.game !== game || i.req.gbModId !== modId) continue;
    const r = RANK[i.state];
    if (r && (!best || r > (RANK[best.state] ?? 0))) best = i;
  }
  return best;
}

export function useQueueItem(game: GameId, modId: number): QueueItem | undefined {
  // a progress event replaces only the item that moved, so only that mod's card redraws
  return useSyncExternalStore(subscribeQueue, () => activeFor(getQueue().items, game, modId));
}
