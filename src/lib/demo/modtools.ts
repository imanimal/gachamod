// Demo handlers for the MODTOOLS area's commands (lib/api/modtools.ts). Owner: MODTOOLS area.
// Keys and options are made up from each mod's name, so every mod in the demo library has something to show.
import { demoEmit, registerDemo } from "../tauri";
import { demoDb, demoId, demoNow, demoWait } from "./db";
import type {
  ConflictGroup, ExportRequest, HashHit, ImmInfo, ImportOptions, ImportResult, KeyBinding, ModEntry, ModInspect, ModProblems,
  PackPreview, VarInfo, VarValue,
} from "../api";

const saved = new Map<string, string>();
const savedKey = (game: string, id: string, ini: string, v: string) => `${game}|${id}|${ini}|${v}`;
const fail = (kind: string, message: string) => { throw { kind, message }; };

const modsOf = (game: string): ModEntry[] => demoDb.mods.get(game) ?? [];
const findMod = (game: string, id: string) => modsOf(game).find((m) => m.id === id) ?? fail("invalid", "That's no longer there. It may have just been removed");
const iniOf = (m: ModEntry) => `${m.name.replace(/[^\w ]+/g, "").trim().replace(/\s+/g, "") || "Mod"}.ini`;

/** A small number from a string, so each mod gets the same made-up insides every time. */
function seed(s: string): number { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

function demoInspect(game: string, id: string): ModInspect {
  const m = findMod(game, id);
  const ini = iniOf(m);
  const n = seed(m.name);
  const cur = (v: string, d: string) => saved.get(savedKey(game, id, ini, v)) ?? d;
  const key = (section: string, keys: string[], labels: string[], kind: string, vars: KeyBinding["vars"], back: string | null = null): KeyBinding =>
    ({ ini, section, key: keys[0]!, label: labels[0]!, keys, labels, back, kind, vars, condition: "$active == 1" });
  const keys: KeyBinding[] = [
    key("KeyJacket", ["ctrl alt VK_J", "XB_Y"], ["Ctrl+Alt+J", "Pad Y"], "toggle", [{ var: "jacket", values: ["0"] }]),
    key("KeyColor", ["ctrl alt VK_C"], ["Ctrl+Alt+C"], "cycle", [{ var: "color", values: ["0", "1", "2", "3"] }], "Ctrl+Alt+X"),
  ];
  const vars: VarInfo[] = [
    { ini, var: "jacket", persist: true, default: "1", current: cur("jacket", "1"), values: ["0", "1"], label: "Jacket", kind: "switch" },
    { ini, var: "color", persist: true, default: "0", current: cur("color", "0"), values: ["0", "1", "2", "3"], label: "Color", kind: "list" },
  ];
  if (n % 3 === 0) {
    keys.push(key("KeyHair", ["VK_NUMPAD1"], ["Num 1"], "cycle", [{ var: "hairvar", values: ["0", "1", "2", "3", "4", "5", "6"] }]));
    vars.push({ ini, var: "hairvar", persist: true, default: "0", current: cur("hairvar", "0"), values: ["0", "1", "2", "3", "4", "5", "6"], label: "Hair", kind: "list" });
  }
  const others = modsOf(game).filter((o) => o.id !== m.id && o.enabled && o.character && o.character === m.character);
  return {
    modId: m.id, inis: [ini], keys, vars, hashCount: 14 + (n % 20),
    conflicts: m.enabled ? others.slice(0, 2).map((o) => ({ modId: o.id, name: o.name, shared: 6 + (seed(o.name) % 9) })) : [],
    problems: n % 4 === 0 ? [{ kind: "missing_file", detail: `${ini} needs Textures/Face.dds, which isn't in the mod folder`, ini, severity: "bad" }] : [],
    readmes: [["readme.txt", `${m.name}\n\nCtrl+Alt+J takes the jacket off and puts it back.\nCtrl+Alt+C changes the colour (4 colours).\n\nPress F10 in game after changing files.`]],
  };
}

function demoConflicts(game: string): ConflictGroup[] {
  const on = modsOf(game).filter((m) => m.enabled);
  const pool = on.length >= 4 ? on : modsOf(game);
  if (pool.length < 2) return [];
  const groups: ConflictGroup[] = [{
    mods: pool.slice(0, 2).map((m) => ({ modId: m.id, name: m.name, shared: 8 })),
    hashes: ["2b8f6ab0", "4e5c1d9a", "7a1b9c3e", "9f00a2d1", "c3d4e5f6", "d2e81f04", "e0b7c6a5", "f1a2b3c4"],
    character: pool[0]!.character && pool[0]!.character === pool[1]!.character ? pool[0]!.character : null,
  }];
  if (pool.length >= 4) {
    groups.push({ mods: pool.slice(2, 4).map((m) => ({ modId: m.id, name: m.name, shared: 3 })), hashes: ["0a1b2c3d", "5e6f7a8b", "93cd04ef"], character: null });
  }
  return groups;
}

function demoLint(game: string): ModProblems[] {
  const list = modsOf(game);
  const out: ModProblems[] = [];
  if (list[1]) out.push({ modId: list[1].id, name: list[1].name, problems: [{ kind: "missing_file", detail: `${iniOf(list[1])} needs Textures/Face.dds, which isn't in the mod folder`, ini: iniOf(list[1]), severity: "bad" }] });
  if (list[4]) out.push({ modId: list[4].id, name: list[4].name, problems: [{ kind: "no_key", detail: `[KeySwap] in ${iniOf(list[4])} has no key line, so it does nothing`, ini: iniOf(list[4]), severity: "info" }] });
  return out;
}

function demoHash(game: string, hash: string): HashHit[] {
  const h = hash.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{1,16}$/.test(h)) fail("invalid", "That isn't a hash. Hashes look like 7a8b9c0d (8 letters and digits, 0-9 and a-f)");
  return modsOf(game).filter((_, i) => (seed(h) + i) % 5 === 0).slice(0, 3)
    .map((m) => ({ modId: m.id, name: m.name, ini: iniOf(m), section: "TextureOverrideBodyIB", enabled: m.enabled }));
}

/** Fake progress: a few pack-progress events over `ms`. */
async function fakeProgress(total: number, ms = 1600) {
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await demoWait(ms / steps);
    demoEmit("pack-progress", { done: Math.round((total * i) / steps), total });
  }
}

const immMoved = new Set<string>();
const packs = new Map<string, { game: string; mods: ModEntry[]; profile: string | null }>();

function demoPackInspect(path: string): PackPreview {
  const known = packs.get(path);
  const game = known?.game ?? "zzz";
  const lib = modsOf(game);
  const mods = known?.mods ?? [
    ...lib.slice(0, 1),
    { ...(lib[2] ?? lib[0]), id: demoId(), name: "Maid outfit", character: "Ellen Joe", relPath: "Ellen Joe/Maid outfit" } as ModEntry,
    { ...(lib[3] ?? lib[0]), id: demoId(), name: "Winter coat", character: "Miyabi", relPath: "Miyabi/Winter coat", enabled: false } as ModEntry,
  ].filter((m) => m && m.name);
  return {
    path, manifestOk: true, game, kind: known?.profile ? "profile" : "mods", title: known?.profile ?? (mods.length === 1 ? mods[0]!.name : "Ellen skins"),
    createdAt: demoNow() - 3600 * 5,
    mods: mods.map((m, index) => ({
      index, name: m.name, character: m.character, relPath: m.relPath.replace(/(^|\/)DISABLED[ _-]*/gi, "$1"), size: m.sizeBytes || 48_000_000,
      enabled: m.enabled, existing: lib.some((l) => l.id === m.id) ? m.id : null, preview: m.preview ?? null,
    })),
    profile: known?.profile || !known ? { name: known?.profile ?? "Night out", icon: "🌙", color: "#7a5cff", banner: null, description: "Evening outfits" } : null,
    totalSize: mods.reduce((s, m) => s + (m.sizeBytes || 48_000_000), 0),
  };
}

async function demoPackImport(path: string, opts: ImportOptions): Promise<ImportResult> {
  const p = demoPackInspect(path);
  const chosen = p.mods.filter((m) => opts.only.length === 0 || opts.only.includes(m.index));
  await fakeProgress(chosen.reduce((s, m) => s + m.size, 0));
  const res: ImportResult = { added: [], replaced: [], skipped: 0, profileId: null, notes: [] };
  const list = modsOf(p.game).slice();
  for (const m of chosen) {
    if (m.existing && opts.onExisting === "skip") { res.skipped++; continue; }
    if (m.existing && opts.onExisting === "replace") { res.replaced.push(m.existing); continue; }
    const id = demoId();
    const base = list.find((x) => x.id === m.existing) ?? list[0];
    if (!base) continue;
    list.push({ ...base, id, name: m.name, character: m.character, relPath: m.relPath, folder: m.relPath.split("/").pop() ?? m.name, enabled: m.enabled, installedAt: demoNow(), conflicts: 0, updateAvailable: false });
    res.added.push(id);
  }
  demoDb.mods.set(p.game, list);
  if (opts.applyProfile && p.profile) res.profileId = Date.now() % 100000;
  return res;
}

export function registerModtoolsDemo() {
  registerDemo({
    mod_inspect: async ({ game, id }) => { await demoWait(160); return demoInspect(String(game), String(id)); },
    mod_set_var: async ({ game, id, value }) => {
      await demoWait(120);
      if (demoDb.games.find((g) => g.id === game)?.running) fail("conflict", "Close the game first. It overwrites saved options when it closes");
      const m = findMod(String(game), String(id));
      const v = value as VarValue;
      saved.set(savedKey(String(game), m.id, v.ini, v.var), v.value);
    },
    conflicts_scan: async ({ game }) => { await demoWait(260); return demoConflicts(String(game)); },
    lint_scan: async ({ game }) => { await demoWait(300); return demoLint(String(game)); },
    hash_lookup: async ({ game, hash }) => { await demoWait(200); return demoHash(String(game), String(hash)); },
    pack_export: async ({ req }) => {
      const r = req as ExportRequest;
      const mods = r.modIds.length ? r.modIds.map((id) => findMod(r.game, id)) : modsOf(r.game).filter((m) => m.enabled);
      const total = mods.reduce((s, m) => s + (m.sizeBytes || 40_000_000), 0);
      await fakeProgress(total);
      packs.set(r.dest, { game: r.game, mods, profile: r.profileId !== null ? (demoDb.profiles.get(r.game)?.find((p) => p.id === r.profileId)?.name ?? "Profile") : null });
      return { path: r.dest, size: Math.round(total * 0.8), mods: mods.length };
    },
    pack_inspect: async ({ path }) => { await demoWait(300); return demoPackInspect(String(path)); },
    pack_import: ({ path, opts }) => demoPackImport(String(path), opts as ImportOptions),
    imm_detect: async (): Promise<ImmInfo> => {
      await demoWait(150);
      return {
        found: true, dir: "%LOCALAPPDATA%\\Integrated Mod Manager (IMM)",
        games: [
          { game: "zzz", config: "configZZ.json", mods: 23, enabled: 9, withSource: 18 },
          { game: "gi", config: "configGI.json", mods: 7, enabled: 3, withSource: 7 },
        ].filter((g) => !immMoved.has(g.game)),
      };
    },
    imm_takeover: async ({ game }): Promise<ImportResult> => {
      await demoWait(1400);
      immMoved.add(String(game));
      const n = game === "gi" ? 7 : 23;
      return { added: Array.from({ length: n }, demoId), replaced: [], skipped: 0, profileId: null, notes: [`Moved ${n} mods from Integrated Mod Manager`] };
    },
  });
}
