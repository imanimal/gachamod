// Demo handlers for live switching (lib/api/ingame.ts): groups kept in memory, picks just remembered.
// Owner: INGAME area.
import type { LiveChange, LiveGroup, LiveInfo, LiveMod, ModEntry } from "../api";
import { registerDemo } from "../tauri";
import { demoDb, demoWait } from "./db";
import { setEnabled } from "./library";

interface Group { n: number; character: string; active: number; next: number; slots: Array<{ slot: number; modId: string }> }
const store = new Map<string, Group[]>();
const groupsOf = (game: string) => { let g = store.get(game); if (!g) { g = []; store.set(game, g); } return g; };
const modsOf = (game: string): ModEntry[] => demoDb.mods.get(game) ?? [];
const liveMod = (m: ModEntry | undefined, id: string, slot: number): LiveMod =>
  ({ modId: id, slot, name: m?.name ?? "A mod that's gone", enabled: !!m?.enabled, preview: m?.preview ?? null });
const fail = (message: string) => { throw { kind: "invalid", message }; };

function info(game: string): LiveInfo {
  const mods = modsOf(game);
  const byId = new Map(mods.map((m) => [m.id, m]));
  const groups = groupsOf(game);
  const live = new Set(groups.flatMap((g) => g.slots.map((s) => s.modId)));
  const out: LiveGroup[] = groups.map((g) => ({ group: g.n, character: g.character, active: g.active, mods: g.slots.map((s) => liveMod(byId.get(s.modId), s.modId, s.slot)) }));
  const byChar = new Map<string, ModEntry[]>();
  for (const m of mods) {
    if (!m.character || m.iniCount === 0) continue;
    const k = m.character.toLowerCase();
    byChar.set(k, [...(byChar.get(k) ?? []), m]);
  }
  const ready = [...byChar.values()]
    .filter((l) => l.length >= 2 && l.some((m) => !live.has(m.id)))
    .map((l) => ({ character: l[0]!.character!, mods: l.filter((m) => !live.has(m.id)).map((m) => liveMod(m, m.id, 0)) }))
    .sort((a, b) => a.character.localeCompare(b.character));
  const running = !!demoDb.games.find((g) => g.id === game)?.running;
  return { groups: out, ready, running };
}

export function registerIngameDemo() {
  registerDemo({
    live_info: async ({ game }) => { await demoWait(120); return info(String(game)); },
    live_add: async ({ game, ids }) => {
      await demoWait(300);
      const g = String(game);
      const byId = new Map(modsOf(g).map((m) => [m.id, m]));
      const groups = groupsOf(g);
      const out: LiveChange = { changed: [], skipped: [], backups: [], turnedOn: [], turnedOff: [] };
      for (const id of ids as string[]) {
        const m = byId.get(id);
        if (!m || groups.some((x) => x.slots.some((s) => s.modId === id))) continue;
        if (!m.character) { out.skipped.push({ modId: id, name: m.name, reason: "it has no character, so there's no group to put it in" }); continue; }
        let grp = groups.find((x) => x.character.toLowerCase() === m.character!.toLowerCase());
        if (!grp) {
          let n = 1;
          while (groups.some((x) => x.n === n)) n++;
          grp = { n, character: m.character, active: 0, next: 1, slots: [] };
          groups.push(grp);
        }
        const slot = grp.next++;
        grp.slots.push({ slot, modId: id });
        if (m.enabled && grp.active === 0) grp.active = slot;
        if (!m.enabled) out.turnedOn.push(id);
        out.changed.push(id);
      }
      if (out.turnedOn.length) setEnabled(g, out.turnedOn, true, false);
      if (!out.changed.length && out.skipped[0]) fail(`${out.skipped[0].name} can't be switched in game: ${out.skipped[0].reason}`);
      return out;
    },
    live_remove: async ({ game, ids }) => {
      await demoWait(250);
      const g = String(game);
      const byId = new Map(modsOf(g).map((m) => [m.id, m]));
      const wanted = new Set(ids as string[]);
      const out: LiveChange = { changed: [], skipped: [], backups: [], turnedOn: [], turnedOff: [] };
      for (const grp of groupsOf(g)) {
        for (const s of grp.slots.filter((x) => wanted.has(x.modId))) {
          if (byId.get(s.modId)?.enabled && grp.active !== s.slot) out.turnedOff.push(s.modId);
          if (grp.active === s.slot) grp.active = 0;
          out.changed.push(s.modId);
        }
        grp.slots = grp.slots.filter((x) => !wanted.has(x.modId));
      }
      store.set(g, groupsOf(g).filter((x) => x.slots.length > 0));
      if (out.turnedOff.length) setEnabled(g, out.turnedOff, false, false);
      return out;
    },
    live_pick: async ({ game, group, slot }) => {
      await demoWait(150);
      const g = String(game);
      const grp = groupsOf(g).find((x) => x.n === Number(group));
      if (!grp) fail("That character isn't switched live any more");
      const s = grp!.slots.find((x) => x.slot === Number(slot));
      if (Number(slot) !== 0 && !s) fail("That mod isn't switched live any more");
      let reload = false;
      const m = s ? modsOf(g).find((x) => x.id === s.modId) : undefined;
      if (m && !m.enabled) { setEnabled(g, [m.id], true, false); reload = true; }
      grp!.active = Number(slot);
      return { reload, send: !!demoDb.games.find((x) => x.id === g)?.running };
    },
  });
}
