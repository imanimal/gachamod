// Skeleton commands every area uses. Owner: skeleton.
import { call, listen } from "../tauri";
import { EVENTS, type GameId } from "./types";
import type { AiTask } from "../ai";
import type { Route } from "../store";

/** A message for a toast from the backend. `open`: the mod it is about (an install), which the toast offers to open. */
export interface ToastEvent {
  text: string; bad?: boolean; open?: { game: GameId; modId: string } | null;
  /** A new install (not an update): these mods are turned on next, by the "Turn on new mods" setting. */
  installed?: string[];
  /** A download that failed: its game and queue item, so the toast can offer a fix. */
  failed?: { game: GameId; item: number };
}

export const app = {
  info: () => call<{ name: string; version: string }>("app_info"),
  /** What the app was started with (a link or a .gachamod file), once. */
  startupOpened: () => call<Array<{ kind: "link"; url: string } | { kind: "file"; path: string }>>("startup_opened"),
  onDeepLink: (cb: (p: { url: string }) => void) => listen<{ url: string }>(EVENTS.deepLink, cb),
  onOpenFile: (cb: (p: { path: string }) => void) => listen<{ path: string }>(EVENTS.openFile, cb),
  /** `open`: the mod the toast is about (an install), so it can offer to open it. */
  onToast: (cb: (p: ToastEvent) => void) => listen<ToastEvent>(EVENTS.toast, cb),
  /** The menu over a game handed something to the app's own window (skinMenu.openInApp), which is in front now. */
  onGo: (cb: (p: GoEvent) => void) => listen<GoEvent>(EVENTS.go, cb),
};

/** What the menu over a game hands to the app's own window: a page to show, or a job for the AI helper. */
export interface GoEvent { game: GameId; route?: Route | null; ai?: AiTask | null }

/** Small string settings kept in the app's database. Keys are dotted: "ui.nsfw", "zzz.oneSkin". */
export const settings = {
  get: (key: string) => call<string | null>("settings_get", { key }),
  set: (key: string, value: string) => call<void>("settings_set", { key, value }),
  async getJson<T>(key: string, fallback: T): Promise<T> {
    try { const v = await settings.get(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
  },
  setJson: (key: string, value: unknown) => settings.set(key, JSON.stringify(value)),
};

export const shell = {
  openPath: (path: string) => call<void>("open_path", { path }),
  revealPath: (path: string) => call<void>("reveal_path", { path }),
  openUrl: (url: string) => call<void>("open_url", { url }),
};

/** Native file dialogs (Tauri's dialog plugin). Outside Tauri they resolve to null. */
export const dialogs = {
  async pickFiles(opts: { title?: string; extensions?: string[]; multiple?: boolean; directory?: boolean } = {}): Promise<string[] | null> {
    if (!("__TAURI_INTERNALS__" in window)) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ title: opts.title, multiple: opts.multiple ?? false, directory: opts.directory ?? false,
      filters: opts.extensions ? [{ name: opts.extensions.join(", "), extensions: opts.extensions }] : undefined });
    if (r === null) return null;
    return Array.isArray(r) ? r : [r];
  },
  async pickFolder(title?: string): Promise<string | null> {
    const r = await dialogs.pickFiles({ title, directory: true });
    return r?.[0] ?? null;
  },
  async saveFile(opts: { title?: string; defaultPath?: string; extensions?: string[] } = {}): Promise<string | null> {
    if (!("__TAURI_INTERNALS__" in window)) return null;
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({ title: opts.title, defaultPath: opts.defaultPath, filters: opts.extensions ? [{ name: opts.extensions.join(", "), extensions: opts.extensions }] : undefined });
  },
};

/** A local file as an image URL the webview can show (Tauri's asset protocol). Remote URLs pass through. */
export function fileUrl(pathOrUrl: string | null | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^(https?:|data:|blob:|asset:)/.test(pathOrUrl)) return pathOrUrl;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc?: (p: string, proto?: string) => string } }).__TAURI_INTERNALS__;
  return internals?.convertFileSrc ? internals.convertFileSrc(pathOrUrl, "asset") : undefined;
}

/** A copy of a mod's files taken right before the app changed them (crates/gacha-core/src/backups.rs). */
export interface Backup { id: string; game: string; modId: string; modDir: string; files: string[]; created: string[]; label: string; at: number }

/** Undo for file changes: every command that edits a mod's files returns the Backup it took; restoring it puts the
 *  files back and returns a backup of the changed state, which restores the change again (redo). */
export const backups = {
  restore: (id: string) => call<Backup>("backup_restore", { id }),
  list: (game?: string | null, modId?: string | null) => call<Backup[]>("backup_list", { game: game ?? null, modId: modId ?? null }),
};
