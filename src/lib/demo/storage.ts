// Demo handlers for Settings › Storage (lib/api/storage.ts): sizes from the demo library plus believable numbers for the
// folders around it. Owner: SYSTEM area.
import type { BackupEntry, ModChange, ModEntry, StorageCategory, StorageDuplicate, StorageGame, StorageItem, StorageMod, StorageReport, StorageStep } from "../api";
import { call, demoEmit, registerDemo } from "../tauri";
import { demoDb, demoNow, demoWait } from "./db";

const MB = 1024 * 1024;
const GB = 1024 * MB;

const CATEGORY: Record<string, StorageCategory> = {
  "mods-on": "on", "mods-off": "off", trash: "trash", archives: "downloads", parts: "downloads", backups: "backups",
  "shader-cache": "loader", "frame-dumps": "loader", log: "loader", loader: "loader", xxmi: "loader", others: "others",
};
const item = (key: string, bytes: number, count: number, path: string | null, name: string | null = null): StorageItem =>
  ({ key, category: CATEGORY[key] ?? "app", bytes: Math.round(bytes), count, path, name });

const DATA = "C:\\Users\\Player\\AppData\\Roaming\\app.gachamod.desktop";

/** Extra folders per game: [archives, shader cache, log, backups, frame dumps, loader files]. */
const EXTRA: Record<string, [number, number, number, number, number, number]> = {
  zzz: [1.3 * GB, 640 * MB, 2 * MB, 85 * MB, 0, 96 * MB],
  gi: [220 * MB, 410 * MB, 148 * MB, 30 * MB, 1.6 * GB, 104 * MB],
  ww: [0, 190 * MB, 1 * MB, 4 * MB, 0, 88 * MB],
  ef: [0, 60 * MB, 0, 0, 0, 72 * MB],
};

let cancelled = false;

/** What's in the demo's backups folder: mod files from before a change, the database's daily copies and settings. */
const day = 86_400;
let demoBackups: BackupEntry[] | null = null;
function backupList(): BackupEntry[] {
  if (demoBackups) return demoBackups;
  const now = demoNow();
  const mod = (id: string, game: string, label: string, ago: number, bytes: number, files: number): BackupEntry =>
    ({ id, kind: "mod", game, modId: id, label, at: now - ago, bytes: Math.round(bytes), files, path: `${DATA}\\backups\\${id}` });
  const file = (id: string, kind: BackupEntry["kind"], ago: number, bytes: number): BackupEntry =>
    ({ id, kind, game: null, modId: null, label: null, at: now - ago, bytes: Math.round(bytes), files: 1, path: `${DATA}\\backups\\${id}` });
  demoBackups = [
    mod("1795050090115-59", "zzz", "Before switching Casual Velina in game", 3600, 85 * 1024, 2),
    mod("1794902119116-9", "zzz", "Rebound F6 to F7 in Ellen Joe Maid", 2 * day, 12 * 1024, 1),
    file("gachamod-2026-11-19.sqlite", "database", day, 5.6 * MB),
    mod("1794739512091-0", "zzz", "Ran ZZZ Mod Fixer on Belle Schoolgirl", 5 * day, 264 * MB, 146),
    file("settings-2026-11-12-101010.000.json", "settings", 8 * day, 140 * 1024),
    mod("1794600000000-3", "gi", "Fixed hashes in Raiden Shogun Kimono for the new game version", 40 * day, 22 * MB, 4),
  ];
  return demoBackups;
}

async function report(full: boolean): Promise<StorageReport> {
  const games: StorageGame[] = [];
  const mods: ModEntry[] = [];
  for (const g of demoDb.games.filter((x) => x.modsDir)) {
    const list = await call<ModEntry[]>("library_list", { game: g.id });
    mods.push(...list);
    const on = list.filter((m) => m.enabled), off = list.filter((m) => !m.enabled);
    const items: StorageItem[] = [
      item("mods-on", on.reduce((s, m) => s + m.sizeBytes, 0), on.length, g.modsDir),
      item("mods-off", off.reduce((s, m) => s + m.sizeBytes, 0), off.length, g.modsDir),
    ];
    const x = EXTRA[g.id];
    if (full && x) {
      const [archives, cache, log, backups, dumps, loader] = x;
      items.push(item("archives", archives, Math.round(archives / (90 * MB)), `${DATA}\\downloads\\${g.id}`), item("shader-cache", cache, Math.round(cache / (40 * 1024)), `${g.importerDir}\\ShaderCache`),
        item("log", log, 1, `${g.importerDir}\\d3d11_log.txt`), item("backups", backups, Math.round(backups / (3 * MB)), `${DATA}\\backups`),
        item("frame-dumps", dumps, Math.round(dumps / (2 * MB)), g.importerDir), item("loader", loader, 140, g.importerDir));
      if (g.id === "gi") items.push(item("others", 2.1 * GB, 31, "C:\\Users\\Player\\Documents\\XXMM\\GIMI", "XX Mod Manager"));
      if (g.id === "zzz") items.push(item("trash", 340 * MB, 3, `${DATA}\\trash\\zzz`), item("parts", 46 * MB, 1, `${DATA}\\downloads\\zzz`));
    }
    const kept = items.filter((i) => i.bytes > 0).sort((a, b) => b.bytes - a.bytes);
    games.push({ game: g.id, bytes: kept.reduce((s, i) => s + i.bytes, 0), items: kept });
  }
  games.sort((a, b) => b.bytes - a.bytes);
  const app = full ? [
    item("xxmi", 312 * MB, 1840, "C:\\Users\\Player\\AppData\\Roaming\\XXMI Launcher"), item("thumbs", 48 * MB, 212, `${DATA}\\cache\\thumbs`),
    item("cache", 22 * MB, 40, `${DATA}\\cache`), item("database", 6.4 * MB, 2, `${DATA}\\gachamod.sqlite`), item("backups", 31 * MB, 6, `${DATA}\\backups`),
    item("logs", 3.1 * MB, 9, `${DATA}\\logs`), item("archive", 9 * MB, 18, `${DATA}\\archive`), item("staging", 0, 0, `${DATA}\\staging`),
  ].filter((i) => i.bytes > 0).sort((a, b) => b.bytes - a.bytes) : [];

  const out: StorageMod[] = mods.map((m) => ({ id: m.id, game: m.game, name: m.name, character: m.character, enabled: m.enabled, bytes: m.sizeBytes, files: m.fileCount,
    path: m.path, installedAt: m.installedAt, preview: m.preview, thumb: m.thumb ?? null, nsfw: m.nsfw })).sort((a, b) => b.bytes - a.bytes);
  const chars = new Map<string, { game: string; name: string | null; bytes: number; mods: number; enabled: number }>();
  for (const m of mods) {
    const k = `${m.game}\u0000${m.character ?? ""}`;
    const c = chars.get(k) ?? { game: m.game, name: m.character, bytes: 0, mods: 0, enabled: 0 };
    c.bytes += m.sizeBytes; c.mods++; if (m.enabled) c.enabled++;
    chars.set(k, c);
  }
  // two copies of one Ellen mod with the same files, and one GameBanana download installed twice
  const duplicates: StorageDuplicate[] = [];
  if (full) {
    const zzz = out.filter((m) => m.game === "zzz");
    const [a, b, c, d] = [zzz[2], zzz[5], zzz[8], zzz[11]];
    if (a && b) duplicates.push({ game: "zzz", kind: "same", keep: a.id, remove: [b.id], bytes: b.bytes });
    if (c && d) duplicates.push({ game: "zzz", kind: "download", keep: c.id, remove: [d.id], bytes: d.bytes });
  }
  return {
    total: games.reduce((s, g) => s + g.bytes, 0) + app.reduce((s, i) => s + i.bytes, 0),
    games, app, mods: out, characters: [...chars.values()].sort((a, b) => b.bytes - a.bytes), duplicates,
    trashDays: Number(demoDb.settings.get("trash.days") ?? 0), trashOverdue: full ? 120 * MB : 0, keepArchives: demoDb.settings.get("downloads.keep") === "1",
    complete: full && !cancelled, measuredAt: demoNow(),
  };
}

export function registerStorageDemo() {
  registerDemo({
    storage_measure: async ({ full }) => {
      cancelled = false;
      const say = (step: StorageStep["step"], game: string | null = null) => demoEmit("storage-progress", { step, game } satisfies StorageStep);
      if (full) {
        const steps: Array<[StorageStep["step"], string | null]> = [["data", null], ["loader", "zzz"], ["loader", "gi"], ["copies", "zzz"], ["copies", "gi"], ["others", "gi"], ["xxmi", null]];
        for (const [s, g] of steps) {
          if (cancelled) break;
          say(s, g);
          await demoWait(700);
        }
      }
      return report(!!full);
    },
    storage_cancel: () => { cancelled = true; },
    backup_entries: async () => { await demoWait(300); return backupList(); },
    backup_recycle: async ({ ids }) => {
      await demoWait(300);
      const gone = new Set(ids as string[]);
      const moved = backupList().filter((e) => gone.has(e.id)).reduce((s, e) => s + e.bytes, 0);
      demoBackups = backupList().filter((e) => !gone.has(e.id));
      return moved;
    },
    storage_remove_copies: ({ game, ids }) => call<ModChange>("mods_remove", { game, ids }),
    storage_recycle_archives: async ({ game }) => {
      await demoWait(400);
      const ids = game ? [String(game)] : Object.keys(EXTRA);
      let n = 0;
      for (const id of ids) { const x = EXTRA[id]; if (x) { n += x[0]; x[0] = 0; } }
      return Math.round(n);
    },
  });
}
