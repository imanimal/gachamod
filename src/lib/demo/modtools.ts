// Demo handlers for the MODTOOLS area's commands (lib/api/modtools.ts). Owner: MODTOOLS area.
// Keys and options are made up from each mod's name, so every mod in the demo library has something to show.
import { demoEmit, registerDemo } from "../tauri";
import { demoDb, demoId, demoNow, demoWait } from "./db";
import type {
  Backup, ClashKey, ConflictGroup, DrawRef, ExportPlan, FixAll, FixInfo, ModHealthRow, ExportRequest, HashHit, ImmInfo, ImportOptions, ImportResult, IniOutline, KeyBinding,
  KeyClash, KeyEdit, KeyEntry, KeyLine, KeyTarget, ModEntry, ModInspect, ModKeys, ModProblems, OnScreenAll, OnScreenMod, PackFiles, PackPreview, PackPreviewMod, PreviewGame, PreviewProfile, ProblemFix,
  ModMesh, VarInfo, VarValue,
} from "../api";
import { queue } from "../api/online";
import { bindingLabel } from "../../screens/modtools/keyNames";

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
    problems: n % 4 === 0 ? [{ kind: "missing_file", detail: `${ini} needs Textures/Face.dds, which isn't in the mod folder`, ini, severity: "bad", fix: null }] : [],
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

// Fixes made in the demo: "<game>|<modId>". Undo (backup_restore) takes one back out.
const lintFixed = new Set<string>();
const lintBackups = new Map<string, string>();

function demoLint(game: string): ModProblems[] {
  const list = modsOf(game);
  const out: ModProblems[] = [];
  const add = (m: ModEntry | undefined, problems: ModProblems["problems"]) => {
    if (m && !lintFixed.has(`${game}|${m.id}`)) out.push({ modId: m.id, name: m.name, enabled: m.enabled, source: m.source, problems });
  };
  add(list[1], [{
    kind: "missing_file", severity: "warn", ini: "merged.ini",
    detail: "merged.ini needs ./Regular/BodyRemapBlend.buf, which isn't in the mod folder. Only the remap for another model of the character (a skin, or the Raiden boss) uses it",
    fix: { kind: "point", ini: "merged.ini", from: ".\\Regular\\BodyRemapBlend.buf", to: ".\\RegularOutfit\\BodyRemapBlend.buf", inis: [] },
  }]);
  const v = ["1/Variant.ini", "2/Variant.ini", "3/Variant.ini"];
  add(list[2], [{
    kind: "overlap", severity: "bad", ini: v[0]!,
    detail: `${v[0]}, ${v[1]} and ${v[2]} change the same parts of the model, so they draw over each other in game. Keep one of them on`,
    fix: { kind: "keep", ini: v[0]!, from: null, to: null, inis: v },
  }]);
  if (list[3]) add(list[3], [{ kind: "missing_file", detail: `${iniOf(list[3])} needs Textures/Face.dds, which isn't in the mod folder`, ini: iniOf(list[3]), severity: "bad", fix: null }]);
  if (list[4]) add(list[4], [{ kind: "no_key", detail: `[KeySwap] in ${iniOf(list[4])} has no key line, so it does nothing`, ini: iniOf(list[4]), severity: "info", fix: null }]);
  return out;
}

// Mod fixes: the 6th mod of each game uses outdated hashes gachamod swaps, the 7th needs a fixer it can't run.
const fixDone = new Set<string>();
const fixBackups = new Map<string, string>();
const FIXERS: Record<string, { version: string; tool: { name: string; url: string } }> = {
  zzz: { version: "2.5", tool: { name: "ZZZ Mod Fixer", url: "https://github.com/Vonksdesu/ZZZ-Mod-Fixer" } },
  ww: { version: "3.5", tool: { name: "Wuwa Mod Fixer", url: "https://github.com/Moonholder/Wuwa_Mod_Fixer" } },
  hsr: { version: "2.3", tool: { name: "HSR Fix", url: "https://github.com/petrascyll/hsr-scripts" } },
  gi: { version: "4.3", tool: { name: "the fixer on GameBanana", url: "https://gamebanana.com/tools/16433" } },
};

function demoHealth(game: string): ModHealthRow[] {
  const f = FIXERS[game];
  if (!f) return [];
  const list = modsOf(game);
  const out: ModHealthRow[] = [];
  const broken = list[5], stuck = list[6];
  const who = (m: ModEntry) => m.character ?? "the character";
  if (broken) {
    out.push(fixDone.has(`${game}|${broken.id}`)
      ? { modId: broken.id, name: broken.name, enabled: broken.enabled, status: "fixed", reasons: ["gachamod swapped its outdated hashes"], since: null, tool: null, swaps: 0 }
      : { modId: broken.id, name: broken.name, enabled: broken.enabled, status: "broken", reasons: [`Uses ${who(broken)}'s Body hash from before ${f.version}`, `Uses ${who(broken)}'s Hair hash from before ${f.version}`], since: f.version, tool: null, swaps: 3 });
  }
  if (stuck) out.push({ modId: stuck.id, name: stuck.name, enabled: stuck.enabled, status: "unfixable", reasons: [`Needs ${f.tool.name} for ${who(stuck)}'s ${f.version} change`], since: f.version, tool: f.tool, swaps: 0 });
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

/** Packs saved in this demo session, by path, so opening one shows what went in. */
interface DemoPack { title: string; kind: string; files: PackFiles; parts: Array<{ game: string; mods: ModEntry[]; profiles: string[] }> }
const packs = new Map<string, DemoPack>();

const sizeOf = (m: ModEntry) => m.sizeBytes || 40_000_000;
const linkOf = (m: ModEntry) => (m.source?.site === "gamebanana" && m.source.modId > 0 ? m.source : null);

/** The mods and profile names a share request covers, per game. */
function demoPick(r: Pick<ExportRequest, "game" | "modIds" | "profileId" | "scope">): DemoPack["parts"] {
  const profilesOf = (g: string) => (demoDb.profiles.get(g) ?? []).map((p) => p.name);
  switch (r.scope) {
    case "mods": return [{ game: r.game, mods: r.modIds.map((id) => findMod(r.game, id)), profiles: [] }];
    case "profile": {
      const p = demoDb.profiles.get(r.game)?.find((x) => x.id === r.profileId);
      return [{ game: r.game, mods: modsOf(r.game).filter((m) => m.enabled), profiles: [p?.name ?? "Profile"] }];
    }
    case "game": return [{ game: r.game, mods: modsOf(r.game), profiles: profilesOf(r.game) }];
    default: return demoDb.games.filter((g) => g.shown && modsOf(g.id).length).map((g) => ({ game: g.id, mods: modsOf(g.id), profiles: profilesOf(g.id) }));
  }
}

function demoPlan(r: Pick<ExportRequest, "game" | "modIds" | "profileId" | "scope">): ExportPlan {
  const parts = demoPick(r);
  const mods = parts.flatMap((p) => p.mods);
  if (!mods.length) fail("invalid", "There are no mods to export. Pick at least one");
  const unlinked = mods.filter((m) => !linkOf(m));
  const unlinkedSize = unlinked.reduce((s, m) => s + sizeOf(m), 0);
  const short = demoDb.games.find((g) => g.id === r.game)?.short ?? "Game";
  const title = r.scope === "all" ? "My mods" : r.scope === "game" ? `${short} mods`
    : r.scope === "profile" ? parts[0]!.profiles[0]! : mods.length === 1 ? mods[0]!.name : `${short} mods`;
  return {
    title, games: parts.map((p) => p.game), mods: mods.length, linked: mods.length - unlinked.length, unlinked: unlinked.length,
    unlinkedSize, totalSize: mods.reduce((s, m) => s + sizeOf(m), 0), profiles: parts.reduce((s, p) => s + p.profiles.length, 0),
    suggested: unlinked.length === mods.length || unlinkedSize <= 20 * 1024 * 1024 ? "unlinked" : "links",
    unlinkedNames: unlinked.slice(0, 30).map((m) => m.name),
    links: mods.filter(linkOf).map((m) => `${m.name}: ${linkOf(m)!.url}`).join("\n"),
  };
}

/** The sample file the demo opens when nothing was saved at that path: a link list a friend sent. */
function samplePack(): DemoPack {
  const lib = modsOf("zzz");
  const base = lib.find(linkOf) ?? lib[0];
  // copies stand for mods the friend has and you don't: their own made-up GameBanana ids
  const copy = (m: ModEntry | undefined, patch: Partial<ModEntry>, gb: number) => (m ? [{
    ...m, id: demoId(),
    source: m.source ? { ...m.source, modId: gb, url: `https://gamebanana.com/mods/${gb}` } : null, ...patch,
  } as ModEntry] : []);
  return {
    title: "Ellen skins", kind: "profile", files: "links",
    parts: [{
      game: "zzz", profiles: ["Night out"],
      mods: [
        ...lib.filter(linkOf).slice(0, 1),
        ...copy(lib[2] ?? base, { name: "Maid outfit", character: "Ellen Joe", relPath: "Ellen Joe/Maid outfit" }, 9_900_001),
        ...copy(lib[3] ?? base, { name: "Winter coat", character: "Miyabi", relPath: "Miyabi/Winter coat", enabled: false }, 9_900_002),
        ...copy(base, { name: "Recoloured hair", character: "Ellen Joe", relPath: "Ellen Joe/Recoloured hair", source: null }, 0),
      ],
    }],
  };
}

function demoPackInspect(path: string): PackPreview {
  const pack = packs.get(path) ?? samplePack();
  let index = 0;
  const mods: PackPreviewMod[] = [];
  const profiles: PreviewProfile[] = [];
  const games: PreviewGame[] = [];
  for (const part of pack.parts) {
    const g = demoDb.games.find((x) => x.id === part.game);
    const lib = modsOf(part.game);
    for (const m of part.mods) {
      const link = linkOf(m);
      const inside = pack.files === "files" || (pack.files === "unlinked" && !link);
      mods.push({
        index: index++, game: part.game, name: m.name, character: m.character, relPath: m.relPath.replace(/(^|\/)DISABLED[ _-]*/gi, "$1"),
        size: sizeOf(m), enabled: m.enabled,
        existing: lib.find((l) => l.id === m.id || (link && l.source?.modId === link.modId))?.id ?? null,
        preview: m.preview ?? null,
        how: inside ? "inside" : link ? "download" : "missing", gbModId: link?.modId ?? null, url: link?.url ?? null,
      });
    }
    part.profiles.forEach((name, i) => profiles.push({
      game: part.game, name, icon: i === 0 ? "🌙" : null, color: i === 0 ? "#7a5cff" : null, description: null, active: i === 0, mods: part.mods.length,
    }));
    games.push({ game: part.game, name: g?.name ?? part.game, ready: !!g?.modsDir, note: g?.modsDir ? null : `${g?.name ?? part.game} isn't set up here.`, mods: part.mods.length, profiles: part.profiles.length });
  }
  const inside = mods.filter((m) => m.how === "inside");
  return {
    path, manifestOk: true, format: 2, game: pack.parts[0]?.game ?? "zzz", kind: pack.kind, title: pack.title, createdAt: demoNow() - 3600 * 5,
    mods, profile: profiles.length === 1 ? profiles[0]! : null, profiles, games,
    totalSize: inside.reduce((s, m) => s + m.size, 0),
    downloadSize: mods.filter((m) => m.how === "download").reduce((s, m) => s + m.size, 0),
  };
}

async function demoPackImport(path: string, opts: ImportOptions): Promise<ImportResult> {
  const p = demoPackInspect(path);
  const ready = new Set(p.games.filter((g) => g.ready).map((g) => g.game));
  const chosen = p.mods.filter((m) => ready.has(m.game) && (opts.only.length === 0 || opts.only.includes(m.index)));
  await fakeProgress(chosen.filter((m) => m.how === "inside").reduce((s, m) => s + m.size, 0) || 1, 900);
  const res: ImportResult = { added: [], replaced: [], skipped: 0, profileId: null, profiles: [], queued: 0, missing: [], notes: [] };
  for (const m of chosen) {
    if (m.how === "missing") { res.missing.push(m.name); continue; }
    if (m.existing && opts.onExisting === "skip") { res.skipped++; continue; }
    const replaces = m.existing && opts.onExisting === "replace" ? m.existing : null;
    if (m.how === "download") {
      await queue.add({
        game: m.game, gbModId: m.gbModId!, fileId: 0, url: m.url ?? "", fileName: `${m.name}.zip`, size: m.size,
        meta: { name: m.name, character: m.character, replaces, source: { site: "gamebanana", modId: m.gbModId!, fileId: null, url: m.url ?? "", submitter: null, fileName: null, remoteUpdated: null } },
      });
      res.queued++;
      continue;
    }
    if (replaces) { res.replaced.push(replaces); continue; }
    const list = modsOf(m.game).slice();
    const base = list.find((x) => x.id === m.existing) ?? list[0];
    if (!base) continue;
    const id = demoId();
    list.push({ ...base, id, name: m.name, character: m.character, relPath: m.relPath, folder: m.relPath.split("/").pop() ?? m.name, enabled: m.enabled, installedAt: demoNow(), conflicts: 0, updateAvailable: false });
    demoDb.mods.set(m.game, list);
    res.added.push(id);
  }
  if (opts.applyProfile && p.profiles.length) {
    res.profiles = p.profiles.map((_, i) => (Date.now() % 100000) + i);
    res.profileId = res.profiles[0]!;
  }
  return res;
}

// ── keys ──
// Each mod gets two or three key sections like real character mods (a toggle with a pad binding, a cycle with a
// back key, sometimes a numpad key). Some mods already gate their keys themselves, UI mods have no character, and
// a few have nothing that draws, so every state of "only while on screen" shows up somewhere.

interface DemoKeys { keys: KeyEntry[]; onScreen: string }
const keyState = new Map<string, DemoKeys>();
const snapshots = new Map<string, { at: string; state: string }>();
const keyAt = (game: string, id: string) => `${game}|${id}`;

function demoLine(field: string, index: number, value: string): KeyLine {
  return { field, index, value, label: bindingLabel(value), original: null, originalLabel: null, off: false, pad: /^XB/i.test(value.trim()) };
}

function demoKeysOf(game: string, id: string): DemoKeys {
  const at = keyAt(game, id);
  const have = keyState.get(at);
  if (have) return have;
  const m = findMod(game, id);
  const ini = iniOf(m);
  const n = seed(m.name);
  const letter = ["J", "K", "H", "U", "J"][n % 5]!;
  const ui = /\b(ui|hud|menu|reshade|shader)\b/i.test(m.name);
  const entry = (section: string, name: string, kind: string, vars: KeyEntry["vars"], lines: KeyLine[]): KeyEntry =>
    ({ ini, section, kind, name, vars, condition: null, lines, off: false, onScreen: false });
  const keys: KeyEntry[] = ui ? [
    entry("KeyHideHud", "Hide hud", "toggle", [{ var: "hide_hud", values: ["0", "1"] }], [demoLine("key", 0, "no_modifiers VK_F6")]),
  ] : [
    entry("KeyJacket", "Jacket", "toggle", [{ var: "jacket", values: ["0", "1"] }], [demoLine("key", 0, `ctrl alt VK_${letter}`), demoLine("key", 1, "XB_LEFT_SHOULDER XB_Y")]),
    entry("KeyColor", "Color", "cycle", [{ var: "color", values: ["0", "1", "2", "3"] }], [demoLine("key", 0, "ctrl alt VK_C"), demoLine("back", 0, "ctrl alt VK_X")]),
  ];
  if (!ui && n % 3 === 0) keys.push(entry("KeyHair", "Hair", "cycle", [{ var: "hairvar", values: ["0", "1", "2", "3", "4", "5", "6"] }], [demoLine("key", 0, "VK_NUMPAD1")]));
  let onScreen = ui ? "global" : n % 4 === 1 ? "own" : n % 7 === 2 ? "cant" : "off";
  if (onScreen === "own") keys.forEach((k) => { k.condition = "$active == 1"; k.onScreen = true; });
  const s = { keys, onScreen };
  keyState.set(at, s);
  return s;
}

const NOTES: Record<string, string> = {
  own: "This mod already turns its toggles off while its character isn't on screen",
  cant: "gachamod couldn't tell which part of the mod draws the character",
  global: "This mod doesn't draw a character, so its toggles work everywhere",
};

function demoModKeys(game: string, id: string): ModKeys {
  const s = demoKeysOf(game, id);
  const m = findMod(game, id);
  return {
    modId: id, inis: [iniOf(m)], keys: s.keys, onScreen: s.onScreen, onScreenNote: NOTES[s.onScreen] ?? null,
    changed: s.keys.some((k) => k.lines.some((l) => l.off || l.original !== null)),
  };
}

/** Change a mod's demo keys with a "backup" that puts the state from before back. */
function demoEdit(game: string, id: string, label: string, change: (s: DemoKeys) => void): KeyEdit {
  const s = demoKeysOf(game, id);
  const before = JSON.stringify(s);
  change(s);
  const changed = JSON.stringify(s) !== before;
  const note = demoDb.games.find((g) => g.id === game)?.running ? "Press F10 in game to load the change" : null;
  if (!changed) return { keys: demoModKeys(game, id), backup: null, note };
  const bid = `keys-${demoId()}`;
  snapshots.set(bid, { at: keyAt(game, id), state: before });
  const m = findMod(game, id);
  const backup: Backup = { id: bid, game, modId: id, modDir: m.path, files: [iniOf(m)], created: [], label, at: demoNow() };
  return { keys: demoModKeys(game, id), backup, note };
}

const DEMO_COMBO = (v: string) => v.toLowerCase().split(/\s+/).filter((t) => t && !t.startsWith("no_")).sort().join(" ");

function demoClashes(game: string): KeyClash[] {
  const lines: Array<{ combo: string; key: ClashKey }> = [];
  for (const m of modsOf(game).filter((x) => x.enabled)) {
    const k = demoModKeys(game, m.id);
    for (const e of k.keys.filter((x) => !x.off)) {
      for (const l of e.lines.filter((x) => !x.off)) {
        lines.push({ combo: DEMO_COMBO(l.value), key: {
          modId: m.id, name: m.name, character: m.character, ini: e.ini, section: e.section, field: l.field, index: l.index,
          value: l.value, label: l.label, what: e.name, onScreen: e.onScreen, fixable: k.onScreen === "off",
        } });
      }
    }
  }
  const groups = new Map<string, ClashKey[]>();
  for (const l of lines) {
    const others = lines.filter((o) => o.combo === l.combo && o.key.modId !== l.key.modId);
    const real = others.some((o) => !(o.key.onScreen && l.key.onScreen) || (o.key.character !== null && o.key.character === l.key.character));
    if (real) groups.set(l.combo, [...(groups.get(l.combo) ?? []), l.key]);
  }
  return [...groups.values()].map((keys) => ({ label: keys[0]!.label, keys })).sort((a, b) => b.keys.length - a.keys.length || a.label.localeCompare(b.label));
}

function gate(s: DemoKeys, on: boolean) {
  s.onScreen = on ? "on" : "off";
  for (const k of s.keys) k.onScreen = on;
}

export function registerModtoolsDemo() {
  registerDemo({
    keys_list: async ({ game, id }) => { await demoWait(120); return demoModKeys(String(game), String(id)); },
    keys_rebind: async ({ game, id, target, binding }) => {
      await demoWait(140);
      const t = target as KeyTarget;
      const b = String(binding).trim();
      const keysOnly = b.split(/\s+/).filter((x) => !["ctrl", "alt", "shift", "windows"].includes(x.toLowerCase()));
      if (!keysOnly.length) fail("invalid", "Pick a key. Ctrl, Alt or Shift alone can't be a key");
      if (keysOnly.length === 1 && keysOnly[0]!.toUpperCase() === "VK_F10") fail("invalid", "F10 reloads mods in game, so a mod can't use it. Pick another key");
      const m = findMod(String(game), String(id));
      const e = demoKeysOf(String(game), String(id)).keys.find((k) => k.section === t.section);
      const l = e?.lines.find((x) => x.field === t.field && x.index === t.index) ?? fail("invalid", `[${t.section}] isn't in the mod any more. Open it again`);
      if (l.off) fail("invalid", "Turn the key on before changing it");
      const old = l.label;
      return demoEdit(String(game), String(id), `Changed ${old} to ${bindingLabel(b)} in ${m.name}`, () => {
        const back = l.original !== null && DEMO_COMBO(l.original) === DEMO_COMBO(b);
        if (!back && l.original === null && DEMO_COMBO(l.value) !== DEMO_COMBO(b)) { l.original = l.value; l.originalLabel = l.label; }
        l.value = back ? l.original! : b;
        l.label = bindingLabel(l.value);
        if (back) { l.original = null; l.originalLabel = null; }
      });
    },
    keys_set_off: async ({ game, id, section, off }) => {
      await demoWait(120);
      const m = findMod(String(game), String(id));
      return demoEdit(String(game), String(id), `${off ? "Turned off" : "Turned on"} a toggle of ${m.name}`, (s) => {
        const e = s.keys.find((k) => k.section === section);
        if (!e) return;
        e.off = !!off;
        e.lines.forEach((l) => { l.off = !!off; });
      });
    },
    keys_put_back: async ({ game, id }) => {
      await demoWait(140);
      const m = findMod(String(game), String(id));
      const at = keyAt(String(game), String(id));
      return demoEdit(String(game), String(id), `Put back the original files of ${m.name}`, (s) => {
        // the keys the mod came with, made fresh
        keyState.delete(at);
        const fresh = demoKeysOf(String(game), String(id));
        keyState.set(at, s);
        s.keys = fresh.keys;
        s.onScreen = fresh.onScreen;
      });
    },
    keys_on_screen: async ({ game, id, on, draw }) => {
      await demoWait(180);
      const m = findMod(String(game), String(id));
      const s = demoKeysOf(String(game), String(id));
      if (on && s.onScreen === "own") return { keys: demoModKeys(String(game), String(id)), backup: null, note: "This mod already does this itself" };
      if (on && s.onScreen === "global") return { keys: demoModKeys(String(game), String(id)), backup: null, note: NOTES.global };
      if (on && s.onScreen === "cant" && !(draw as DrawRef[] | null)?.length) fail("invalid", `gachamod couldn't tell which part of ${m.name} draws the character`);
      return demoEdit(String(game), String(id), on ? `Toggles of ${m.name} work only while on screen` : `Toggles of ${m.name} work any time again`, (x) => gate(x, !!on));
    },
    keys_on_screen_all: async ({ game, on }): Promise<OnScreenAll> => {
      await demoWait(500);
      const out: OnScreenAll = { changed: [], skipped: [], already: 0 };
      for (const m of modsOf(String(game))) {
        const s = demoKeysOf(String(game), m.id);
        if (on && s.onScreen === "cant") { out.skipped.push({ modId: m.id, name: m.name, reason: "gachamod couldn't tell which part draws the character" }); continue; }
        if (on ? s.onScreen !== "off" : s.onScreen !== "on") { out.already++; continue; }
        const r = demoEdit(String(game), m.id, on ? `Toggles of ${m.name} work only while on screen` : `Toggles of ${m.name} work any time again`, (x) => gate(x, !!on));
        if (r.backup) out.changed.push({ modId: m.id, name: m.name, backup: r.backup });
      }
      return out;
    },
    keys_on_screen_mods: async ({ game }): Promise<OnScreenMod[]> => {
      await demoWait(200);
      return modsOf(String(game))
        .filter((m) => { const s = keyState.get(keyAt(String(game), m.id)); return s?.onScreen === "on" || s?.onScreen === "partial"; })
        .map((m) => ({ modId: m.id, name: m.name, character: m.character, enabled: m.enabled, partial: keyState.get(keyAt(String(game), m.id))!.onScreen === "partial" }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    keys_clashes: async ({ game }) => { await demoWait(260); return demoClashes(String(game)); },
    keys_outline: async ({ game, id }): Promise<IniOutline[]> => {
      await demoWait(120);
      const m = findMod(String(game), String(id));
      const ini = iniOf(m);
      const base = ini.replace(/\.ini$/, "");
      return [{
        ini, namespace: null, keys: demoKeysOf(String(game), String(id)).keys.map((k) => k.section),
        sections: [
          { section: `TextureOverride${base}Body`, lines: ["hash = 1a2b3c4d", "match_first_index = 0", "ib = Resource" + base + "BodyIB"] },
          { section: `TextureOverride${base}Face`, lines: ["hash = 5e6f7a8b", "ps-t0 = Resource" + base + "FaceDiffuse"] },
          { section: `TextureOverride${base}Weapon`, lines: ["hash = 9c0d1e2f", "handling = skip", "drawindexed = auto"] },
        ],
      }];
    },
    // the keys edits above undo through their own snapshots; any other backup id answers like the shared handler
    backup_restore: ({ id }) => {
      const swapped = fixBackups.get(String(id));
      if (swapped) {
        if (fixDone.has(swapped)) fixDone.delete(swapped); else fixDone.add(swapped);
        const bid = `fix-${demoId()}`;
        fixBackups.set(bid, swapped);
        const [game, modId] = swapped.split("|") as [string, string];
        return { id: bid, game, modId, modDir: "", files: [], created: [], label: "", at: demoNow() };
      }
      const fixed = lintBackups.get(String(id));
      if (fixed) {
        if (lintFixed.has(fixed)) lintFixed.delete(fixed); else lintFixed.add(fixed);
        const bid = `lint-${demoId()}`;
        lintBackups.set(bid, fixed);
        const [game, modId] = fixed.split("|") as [string, string];
        return { id: bid, game, modId, modDir: "", files: [], created: [], label: "", at: demoNow() };
      }
      const snap = snapshots.get(String(id));
      if (!snap) return { id: `${String(id)}-before`, game: "", modId: "", modDir: "", files: [], created: [], label: "", at: demoNow() };
      const [game, modId] = snap.at.split("|") as [string, string];
      const now = keyState.get(snap.at);
      const bid = `keys-${demoId()}`;
      if (now) snapshots.set(bid, { at: snap.at, state: JSON.stringify(now) });
      keyState.set(snap.at, JSON.parse(snap.state) as DemoKeys);
      return { id: bid, game, modId, modDir: "", files: [], created: [], label: "", at: demoNow() };
    },
  });
  registerDemo({
    mod_inspect: async ({ game, id }) => { await demoWait(160); return demoInspect(String(game), String(id)); },
    mod_mesh: async ({ game, id }) => {
      await demoWait(400);
      const m = modsOf(String(game)).find((x) => x.id === id);
      if (m && m.iniCount === 0) fail("invalid", "This mod doesn't draw a model gachamod can read (it may only change textures or effects)");
      return demoMesh();
    },
    mod_set_var: async ({ game, id, value }) => {
      await demoWait(120);
      if (demoDb.games.find((g) => g.id === game)?.running) fail("conflict", "Close the game first. It overwrites saved options when it closes");
      const m = findMod(String(game), String(id));
      const v = value as VarValue;
      saved.set(savedKey(String(game), m.id, v.ini, v.var), v.value);
    },
    conflicts_scan: async ({ game }) => { await demoWait(260); return demoConflicts(String(game)); },
    lint_scan: async ({ game }) => { await demoWait(300); return demoLint(String(game)); },
    lint_fix: async ({ game, id, fix }) => {
      await demoWait(220);
      const m = findMod(String(game), String(id));
      const f = fix as ProblemFix;
      const key = `${String(game)}|${m.id}`;
      if (lintFixed.has(key)) fail("invalid", `${m.name} changed since the last check. Check again`);
      lintFixed.add(key);
      const bid = `lint-${demoId()}`;
      lintBackups.set(bid, key);
      const label = f.kind === "keep" ? `Kept ${f.ini} on and turned off ${f.inis.length - 1} others` : `${f.ini} now uses ${(f.to ?? "").replace(/\\/g, "/")}`;
      return { id: bid, game: String(game), modId: m.id, modDir: m.path, files: [f.ini ?? ""], created: [], label, at: demoNow() };
    },
    hash_lookup: async ({ game, hash }) => { await demoWait(200); return demoHash(String(game), String(hash)); },
    fixes_info: async ({ game }): Promise<FixInfo> => {
      await demoWait(80);
      const f = FIXERS[String(game)];
      return {
        game: String(game), currentVersion: f ? "3.3" : "", pairs: f ? 778 : 0,
        sources: f ? [{ id: "demo", name: f.tool.name, author: "The community", url: f.tool.url, license: "MIT", checked: "2026-11-13", used: "data and rules" }] : [],
      };
    },
    fixes_health: async ({ game }) => { await demoWait(240); return demoHealth(String(game)); },
    fixes_apply: async ({ game, ids }): Promise<FixAll> => {
      await demoWait(400);
      const g = String(game);
      const out: FixAll = { changed: [], skipped: [] };
      for (const row of demoHealth(g).filter((r) => (ids as string[]).includes(r.modId))) {
        const m = findMod(g, row.modId);
        if (row.status === "unfixable") { out.skipped.push({ modId: m.id, name: m.name, reason: row.reasons[0] ?? "" }); continue; }
        if (row.status !== "broken") continue;
        const key = `${g}|${m.id}`;
        fixDone.add(key);
        const bid = `fix-${demoId()}`;
        fixBackups.set(bid, key);
        out.changed.push({ modId: m.id, name: m.name, backup: { id: bid, game: g, modId: m.id, modDir: m.path, files: [iniOf(m)], created: [], label: `Fixed ${m.name} for the game update (3 hashes)`, at: demoNow() } });
      }
      return out;
    },
    pack_plan: async ({ req }) => { await demoWait(200); return demoPlan(req as ExportRequest); },
    pack_export: async ({ req }) => {
      const r = req as ExportRequest;
      const files: PackFiles = (r.files || "files") as PackFiles;
      const plan = demoPlan(r);
      const inside = files === "files" ? plan.totalSize : files === "unlinked" ? plan.unlinkedSize : 0;
      await fakeProgress(inside || 1, inside ? 1600 : 500);
      packs.set(r.dest, { title: r.title || plan.title, kind: r.scope, files, parts: demoPick(r) });
      const linkBytes = Math.max(2048, plan.mods * 700 + plan.profiles * 400);
      const links = files === "files" ? 0 : plan.linked;
      return { path: r.dest, size: linkBytes + Math.round(inside * 0.8), mods: plan.mods, links, inside: plan.mods - links - (files === "links" ? plan.unlinked : 0), profiles: plan.profiles };
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
      return { added: Array.from({ length: n }, demoId), replaced: [], skipped: 0, profileId: null, profiles: [], queued: 0, missing: [], notes: [`Moved ${n} mods from Integrated Mod Manager`] };
    },
  });
}

// ── a model for the 3D view: a turned figure with a striped texture, so the viewer has something to show ──

const b64 = (a: Float32Array | Uint32Array) => {
  const u8 = new Uint8Array(a.buffer);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

function demoMesh(): ModMesh {
  // radius and height down the figure's outline, from the feet up
  const outline: Array<[number, number]> = [[0, 0], [0.2, 0.02], [0.24, 0.32], [0.13, 0.72], [0.15, 0.95], [0.1, 1.1], [0.04, 1.2], [0.1, 1.26], [0.12, 1.36], [0.1, 1.46], [0, 1.52]];
  const seg = 48;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  outline.forEach(([r, y], i) => {
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      uv.push(j / seg, i / (outline.length - 1));
    }
  });
  for (let i = 0; i < outline.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const bands = ["#2b2f3a", "#e8e2d6", "#c4473a", "#e8e2d6", "#3d6fb6", "#f0c9a8", "#2b2f3a"];
  if (g) bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (i * 256) / bands.length, 256, 256 / bands.length + 1); });
  const n = pos.length / 3;
  return {
    buffers: [{ name: "resourcedemoposition", count: n, positions: b64(new Float32Array(pos)), normals: null, uvs: b64(new Float32Array(uv)) }],
    parts: [{ name: "TextureOverrideDemoBody", buffer: 0, indices: b64(new Uint32Array(idx)), texture: 0 }],
    textures: [c.toDataURL("image/png")],
    up: "y",
    triangles: idx.length / 3,
    notes: [],
  };
}
