// The download queue and local installs. Owner: ONLINE area. Rust: commands/online.rs, runner.rs, install.rs.
// Browsing GameBanana itself is in lib/gamebanana.ts (the API allows CORS, so the UI calls it directly).
import { call, listen } from "../tauri";
import { EVENTS, type GameId, type ModEntry, type ModSource } from "./types";

export interface InstallMeta {
  name?: string | null;
  character?: string | null;
  category?: string | null;
  source?: ModSource | null;
  version?: string | null;
  nsfw?: boolean;
  previewUrl?: string | null;
  /** Update in place: the library id this replaces. */
  replaces?: string | null;
}

export interface Candidate { key: string; label: string; iniCount: number; size: number; preview: string | null }

export interface InstallOutcome { installed: ModEntry[]; needsChoice: Candidate[] | null; notes: string[] }

export interface QueueRequest {
  game: GameId; gbModId: number; fileId: number; url: string; fileName: string; size: number; md5?: string | null;
  meta: InstallMeta; thumb?: string | null;
  /** An archive or folder on this PC to install instead of downloading (folders are copied). */
  localPath?: string | null;
}

export type ItemState =
  | { state: "waiting" }
  | { state: "downloading"; received: number; total: number | null }
  | { state: "installing" }
  | { state: "needsChoice"; candidates: Candidate[] }
  | { state: "done"; modIds: string[] }
  | { state: "failed"; message: string }
  | { state: "cancelled" };

export type QueueItem = {
  id: number; req: QueueRequest; addedAt: number; finishedAt: number | null;
  /** The downloaded archive once complete (an item that has it is waiting to install). */
  archive?: string | null;
  /** Unpacked files kept while a choice is pending. */
  staging?: string | null;
  /** Candidate keys picked for a NeedsChoice item. */
  choose?: string[];
} & ItemState;
export interface QueueSummary { running: number; waiting: number; needsChoice: number; done: number; failed: number }
export interface QueueSnapshot { items: QueueItem[]; summary: QueueSummary }

export const queue = {
  get: () => call<QueueSnapshot>("queue_get"),
  add: (req: QueueRequest) => call<QueueSnapshot>("queue_add", { req }),
  cancel: (id: number) => call<QueueSnapshot>("queue_cancel", { id }),
  retry: (id: number) => call<QueueSnapshot>("queue_retry", { id }),
  remove: (id: number) => call<QueueSnapshot>("queue_remove", { id }),
  clearFinished: () => call<QueueSnapshot>("queue_clear_finished"),
  choose: (id: number, keys: string[]) => call<QueueSnapshot>("queue_choose", { id, keys }),
  onChange: (cb: (s: QueueSnapshot) => void) => listen<QueueSnapshot>(EVENTS.queue, cb),
  onVariantsNeeded: (cb: (p: { id: number; game: GameId; name: string; candidates: Candidate[] }) => void) =>
    listen<{ id: number; game: GameId; name: string; candidates: Candidate[] }>(EVENTS.variantsNeeded, cb),
};

export const installs = {
  /** Each path becomes a queue item without a download step; results arrive through queue events. */
  local: (game: GameId, paths: string[], choose: string[] = []) => call<InstallOutcome>("install_local", { game, paths, choose }),
};
