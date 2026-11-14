// Demo handlers for the ONLINE area's commands (lib/api/online.ts). Owner: ONLINE area.
// Downloads are faked with timers: progress over a few seconds, a short install, then a mod in demoDb.mods. About one
// install in four asks to pick among three variants, so the picker can be tried in a browser.
import { demoEmit, registerDemo } from "../tauri";
import { EVENTS, type ModEntry } from "../api/types";
import type { Candidate, InstallOutcome, QueueItem, QueueRequest, QueueSnapshot } from "../api/online";
import { demoDb, demoId, demoNow } from "./db";
import { demoRestoreRemoved } from "./library";

let items: QueueItem[] = [];
let nextId = 1;
const timers = new Map<number, number>();
const chosen = new Map<number, string[]>();

const finished = (i: QueueItem) => i.state === "done" || i.state === "failed" || i.state === "cancelled";

function snapshot(): QueueSnapshot {
  const s = { running: 0, waiting: 0, needsChoice: 0, done: 0, failed: 0 };
  for (const i of items) {
    if (i.state === "downloading" || i.state === "installing") s.running++;
    else if (i.state === "waiting") s.waiting++;
    else if (i.state === "needsChoice") s.needsChoice++;
    else if (i.state === "done") s.done++;
    else if (i.state === "failed") s.failed++;
  }
  return { items: items.map((i) => ({ ...i })), summary: s };
}

function emit() { demoEmit(EVENTS.queue, snapshot()); }

function set(id: number, patch: Partial<QueueItem> & { state: QueueItem["state"] } & Record<string, unknown>) {
  items = items.map((i) => (i.id === id ? ({ ...stripState(i), ...patch, finishedAt: ["done", "failed", "cancelled"].includes(patch.state) ? demoNow() : null } as QueueItem) : i));
}
function stripState(i: QueueItem) {
  const { id, req, addedAt, finishedAt, archive, staging, choose } = i;
  return { id, req, addedAt, finishedAt, archive, staging, choose };
}

function stop(id: number) {
  const t = timers.get(id);
  if (t !== undefined) { clearInterval(t); timers.delete(id); }
}

function pump() {
  const downloading = items.filter((i) => i.state === "downloading").length;
  let slots = 3 - downloading;
  const installing = items.some((i) => i.state === "installing");
  let startedInstall = installing;
  for (const i of items) {
    if (i.state !== "waiting") continue;
    if (i.archive || i.req.localPath || chosen.has(i.id)) {
      if (!startedInstall) { startedInstall = true; install(i.id); }
    } else if (slots > 0) { slots--; download(i.id); }
  }
}

function download(id: number) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const total = item.req.size > 0 ? item.req.size : 24 * 1024 * 1024;
  let received = 0;
  set(id, { state: "downloading", received, total });
  emit();
  const step = total / (12 + Math.floor(Math.random() * 10));
  timers.set(id, window.setInterval(() => {
    received = Math.min(total, received + step * (0.6 + Math.random() * 0.8));
    if (received >= total) {
      stop(id);
      set(id, { state: "waiting", archive: `%APPDATA%\\gachamod\\downloads\\${item.req.game}\\${item.req.fileId}-${item.req.fileName}` });
      emit();
      pump();
      return;
    }
    set(id, { state: "downloading", received: Math.round(received), total });
    emit();
  }, 250));
}

function variants(item: QueueItem): Candidate[] {
  const base = item.req.meta.name ?? "Mod";
  return ["Default", "No jacket", "Alt colour"].map((v, n) => ({
    key: `${base}/${v}`, label: v, iniCount: 1 + n, size: (18 + n * 7) * 1024 * 1024,
    preview: n === 0 ? item.req.meta.previewUrl ?? null : null,
  }));
}

function install(id: number) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  set(id, { state: "installing" });
  emit();
  timers.set(id, window.setTimeout(() => {
    timers.delete(id);
    const cur = items.find((i) => i.id === id);
    if (!cur || cur.state !== "installing") return;
    const keys = chosen.get(id);
    if (!keys && Math.random() < 0.25) {
      const candidates = variants(cur);
      set(id, { state: "needsChoice", candidates, staging: "%APPDATA%\\gachamod\\staging\\demo" });
      emit();
      demoEmit(EVENTS.variantsNeeded, { id, game: cur.req.game, name: cur.req.meta.name ?? cur.req.fileName, candidates });
      pump();
      return;
    }
    chosen.delete(id);
    const added = place(cur, keys ?? []);
    set(id, { state: "done", modIds: added.map((m) => m.id), archive: null, staging: null });
    emit();
    demoEmit(EVENTS.libraryChanged, { game: cur.req.game });
    const m = added[0];
    const verb = cur.req.meta.replaces ? "Updated" : "Installed";
    const what = added.length > 1 ? `${added.length} variants of ${cur.req.meta.name}` : m?.name ?? "the mod";
    demoEmit(EVENTS.toast, { text: m?.character ? `${verb} ${what} for ${m.character}` : `${verb} ${what}`, bad: false });
    pump();
  }, 900));
}

function place(item: QueueItem, keys: string[]): ModEntry[] {
  const game = item.req.game;
  const list = demoDb.mods.get(game) ?? [];
  const meta = item.req.meta;
  const name = meta.name || item.req.fileName.replace(/\.(zip|7z|rar)$/i, "") || "New mod";
  const character = meta.character ?? null;
  const group = character ?? meta.category ?? "Other";
  const labels = keys.length ? keys.map((k) => k.split("/").pop() ?? k) : [null];
  const modsDir = demoDb.games.find((g) => g.id === game)?.modsDir ?? "C:\\Users\\Player\\Mods";
  const old = meta.replaces ? list.find((m) => m.id === meta.replaces) : undefined;
  const out: ModEntry[] = labels.map((label, n) => {
    const display = label ? `${name} - ${label}` : name;
    const on = n === 0;
    const folder = `${on ? "" : "DISABLED "}${display}`;
    const base: ModEntry = {
      id: demoId(), game, name: display, folder, relPath: `${group}/${folder}`,
      path: `${modsDir}\\${group}\\${folder}`, enabled: on, character, group,
      source: meta.source ?? null, version: meta.version ?? null, installedAt: demoNow(), sizeBytes: (12 + Math.floor(Math.random() * 60)) * 1024 * 1024,
      fileCount: 8 + Math.floor(Math.random() * 30), iniCount: 1, preview: meta.previewUrl ?? null, tags: [], notes: null, favorite: false,
      nsfw: !!meta.nsfw, hasKeys: Math.random() < 0.5, conflicts: 0, updateAvailable: false,
    };
    return n === 0 && old ? { ...base, id: old.id, name: old.name, folder: old.folder, relPath: old.relPath, path: old.path, enabled: old.enabled, tags: old.tags, notes: old.notes, favorite: old.favorite } : n === 0 ? demoRestoreRemoved(game, base) : base;
  });
  const rest = old ? list.filter((m) => m.id !== old.id) : list;
  demoDb.mods.set(game, [...out, ...rest]);
  return out;
}

export function registerOnlineDemo() {
  registerDemo({
    queue_get: () => snapshot(),
    queue_add: ({ req }) => {
      const r = req as QueueRequest;
      const dup = items.find((i) => i.req.game === r.game && i.req.fileId === r.fileId && r.fileId > 0 && !finished(i));
      if (!dup) items.push({ id: nextId++, req: r, addedAt: demoNow(), finishedAt: null, state: "waiting" });
      pump();
      emit();
      return snapshot();
    },
    queue_cancel: ({ id }) => {
      const i = items.find((x) => x.id === Number(id));
      if (!i) throw { kind: "invalid", message: "That download isn't in the list anymore" };
      if (i.state === "installing") throw { kind: "invalid", message: "It's being installed right now and will be done in a moment" };
      if (!finished(i)) { stop(i.id); chosen.delete(i.id); set(i.id, { state: "cancelled", staging: null }); }
      pump();
      emit();
      return snapshot();
    },
    queue_retry: ({ id }) => {
      const i = items.find((x) => x.id === Number(id));
      if (i && (i.state === "failed" || i.state === "cancelled")) set(i.id, { state: "waiting" });
      pump();
      emit();
      return snapshot();
    },
    queue_remove: ({ id }) => {
      const i = items.find((x) => x.id === Number(id));
      if (i?.state === "installing") throw { kind: "invalid", message: "It's being installed right now. Remove it once it's done" };
      if (i) { stop(i.id); chosen.delete(i.id); items = items.filter((x) => x.id !== i.id); }
      pump();
      emit();
      return snapshot();
    },
    queue_clear_finished: () => {
      items = items.filter((i) => !finished(i));
      emit();
      return snapshot();
    },
    queue_choose: ({ id, keys }) => {
      const i = items.find((x) => x.id === Number(id));
      const k = (keys as string[]) ?? [];
      if (!i || i.state !== "needsChoice") throw { kind: "invalid", message: "That download isn't waiting for a choice anymore" };
      if (!k.length) set(i.id, { state: "cancelled", staging: null });
      else { chosen.set(i.id, k); set(i.id, { state: "waiting" }); }
      pump();
      emit();
      return snapshot();
    },
    install_local: ({ game, paths }): InstallOutcome => {
      const list = (paths as string[]) ?? [];
      for (const p of list) {
        const fileName = p.split(/[\\/]/).pop() ?? p;
        items.push({
          id: nextId++, addedAt: demoNow(), finishedAt: null, state: "waiting",
          req: { game: String(game), gbModId: 0, fileId: 0, url: "", fileName, size: 0, localPath: p, meta: { name: fileName.replace(/\.(zip|7z|rar)$/i, "") } },
        });
      }
      pump();
      emit();
      return { installed: [], needsChoice: null, notes: [list.length === 1 ? "Installing 1 mod" : `Installing ${list.length} mods`] };
    },
  });
}
