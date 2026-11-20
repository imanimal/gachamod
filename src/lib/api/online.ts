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

export interface InstallOutcome { installed: ModEntry[]; needsChoice: Candidate[] | null; notes: string[]; /** separate mods from one file, each installed on its own */ bundle?: boolean;
  /** the game's ShaderFixes folder, when the file had shader fixes that went there */ shaderFixes?: string | null }

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
  /** The install didn't know where the files go and put them in Mods as they came: why. */
  unsure?: string | null;
  /** Unpacked files kept while a choice is pending. */
  staging?: string | null;
  /** Candidate keys picked for a NeedsChoice item. */
  choose?: string[];
  /** What an install is doing right now. */
  progress?: InstallProgress | null;
} & ItemState;

/** An install's current step ("Unpacking Lucia-Velvet v1.0.zip"), how far along it is (`done` of `total`, 0 total
 *  when unknown), and for a bundle, the mods found in it with how many are in place so far. */
export interface InstallProgress { step: string; done: number; total: number; mods: string[]; placed: number }
/** How far one running item is, between snapshots (runner.rs, events::QUEUE_PROGRESS): bytes for a download, the
 *  step for an install. */
export interface QueueProgress { id: number; received?: number; total?: number | null; progress?: InstallProgress }
export interface QueueSummary { running: number; waiting: number; needsChoice: number; done: number; failed: number }
export interface QueueSnapshot { items: QueueItem[]; summary: QueueSummary }

export const queue = {
  get: () => call<QueueSnapshot>("queue_get"),
  add: (req: QueueRequest) => call<QueueSnapshot>("queue_add", { req }),
  cancel: (id: number) => call<QueueSnapshot>("queue_cancel", { id }),
  retry: (id: number) => call<QueueSnapshot>("queue_retry", { id }),
  remove: (id: number) => call<QueueSnapshot>("queue_remove", { id }),
  choose: (id: number, keys: string[]) => call<QueueSnapshot>("queue_choose", { id, keys }),
  onChange: (cb: (s: QueueSnapshot) => void) => listen<QueueSnapshot>(EVENTS.queue, cb),
  /** The running items that moved since the last snapshot or progress event. */
  onProgress: (cb: (p: QueueProgress[]) => void) => listen<QueueProgress[]>(EVENTS.queueProgress, cb),
  onVariantsNeeded: (cb: (p: { id: number; game: GameId; name: string; candidates: Candidate[] }) => void) =>
    listen<{ id: number; game: GameId; name: string; candidates: Candidate[] }>(EVENTS.variantsNeeded, cb),
};

export const installs = {
  /** Each path becomes a queue item without a download step; results arrive through queue events. */
  local: (game: GameId, paths: string[], choose: string[] = []) => call<InstallOutcome>("install_local", { game, paths, choose }),
};
