// Demo handlers for live switching (lib/api/ingame.ts): groups kept in memory, picks just remembered.
// Owner: INGAME area.
import type { LiveChange, LiveGroup, LiveInfo, LiveMod, MenuSettings, ModChange, ModEntry } from "../api";
import { call, registerDemo } from "../tauri";
import { demoDb, demoWait } from "./db";
import { liveHooks, setEnabled, setFolders } from "./library";

interface Group { n: number; character: string; active: number; next: number; slots: Array<{ slot: number; modId: string }> }
const store = new Map<string, Group[]>();
const groupsOf = (game: string) => { let g = store.get(game); if (!g) { g = []; store.set(game, g); } return g; };
const modsOf = (game: string): ModEntry[] => demoDb.mods.get(game) ?? [];
const liveMod = (m: ModEntry | undefined, id: string, slot: number): LiveMod =>
  ({ modId: id, slot, name: m?.name ?? "A mod that's gone", enabled: !!(m?.enabled || m?.standby), preview: m?.preview ?? null });
const fail = (message: string) => { throw { kind: "invalid", message }; };
const alls = new Map<string, boolean>();
const menus = new Map<string, MenuSettings>();
const menuOf = (game: string): MenuSettings => menus.get(game) ?? { style: "window", key: "F7", pad: true };
const loaded = (m: ModEntry) => m.enabled || !!m.standby;

/** Library rows of these groups follow the picks: the one showing is on, the others wait on standby. */
function syncRows(game: string, groups: Group[]): ModEntry[] {
  const byId = new Map(modsOf(game).map((m) => [m.id, m]));
  const out: ModEntry[] = [];
  for (const g of groups) {
    for (const s of g.slots) {
      const m = byId.get(s.modId);
      if (!m) continue;
      const was = `${m.enabled}${!!m.standby}`;
      const l = loaded(m);
      m.enabled = l && s.slot === g.active;
      m.standby = l && s.slot !== g.active;
      if (`${m.enabled}${m.standby}` !== was) out.push({ ...m });
    }
  }
  return out;
}

/** Live skins switched from the library (backend live::switch). */
function liveSwitch(game: string, targets: Array<[string, boolean]>): ModChange {
  const change: ModChange = { changed: [], removed: [], notes: [] };
  const want = new Map<Group, number>();
  for (const [id, on] of targets) {
    const g = groupsOf(game).find((x) => x.slots.some((s) => s.modId === id));
    const slot = g?.slots.find((s) => s.modId === id)?.slot;
    if (!g || slot === undefined) continue;
    const now = want.get(g) ?? g.active;
    if (on) want.set(g, slot); else if (now === slot) want.set(g, 0);
  }
  const touched: Group[] = [];
  for (const [g, slot] of want) {
    if (slot === g.active) continue;
    const m = modsOf(game).find((x) => x.id === g.slots.find((s) => s.slot === slot)?.modId);
    if (m && !loaded(m)) setFolders(game, [m.id], true, false);
    g.active = slot;
    touched.push(g);
  }
  change.changed = syncRows(game, touched);
  return change;
}

liveHooks.live = (game) => new Set(groupsOf(game).flatMap((g) => g.slots.map((s) => s.modId)));
liveHooks.switch = liveSwitch;
liveHooks.hide = (game, character) => {
  const g = groupsOf(game).find((x) => x.character.toLowerCase() === character.toLowerCase() && x.active !== 0);
  if (!g) return null;
  g.active = 0;
  return { changed: syncRows(game, [g]), removed: [], notes: [] };
};

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
  return { groups: out, ready, running, menu: menuOf(game), blocked: false, all: alls.get(game) ?? false };
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
        if (loaded(m) && grp.active === 0) grp.active = slot;
        if (!loaded(m)) out.turnedOn.push(id);
        out.changed.push(id);
      }
      if (out.turnedOn.length) setFolders(g, out.turnedOn, true, false);
      syncRows(g, groups);
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
          const m = byId.get(s.modId);
          if (m && loaded(m) && grp.active !== s.slot) out.turnedOff.push(s.modId);
          if (grp.active === s.slot) grp.active = 0;
          out.changed.push(s.modId);
        }
        grp.slots = grp.slots.filter((x) => !wanted.has(x.modId));
      }
      store.set(g, groupsOf(g).filter((x) => x.slots.length > 0));
      if (out.turnedOff.length) setFolders(g, out.turnedOff, false, false);
      for (const m of modsOf(g)) if (out.changed.includes(m.id) && m.standby) { m.enabled = true; m.standby = false; }
      return out;
    },
    live_set_all: async ({ game, on }) => {
      const g = String(game);
      alls.set(g, !!on);
      const none: LiveChange = { changed: [], skipped: [], backups: [], turnedOn: [], turnedOff: [] };
      if (!on) return none;
      const live = new Set(groupsOf(g).flatMap((x) => x.slots.map((s) => s.modId)));
      const ids = modsOf(g).filter((m) => m.character && m.iniCount > 0 && !m.parent && !live.has(m.id)).map((m) => m.id);
      if (!ids.length) return none;
      try { return await call<LiveChange>("live_add", { game: g, ids }); } catch { return none; }
    },
    live_menu_set: async ({ game, menu }) => {
      await demoWait(120);
      const m = menu as MenuSettings;
      if (!/^((Ctrl|Alt|Shift|Win)\+)*(F\d+|[A-Z0-9]|Num\d|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Space)$/.test(m.key)) fail(`${m.key} can't open the menu. Try F7`);
      menus.set(String(game), { ...m });
      return menuOf(String(game));
    },
    // the menu window: the demo shows it for the first game, with a character made live so there is something to see
    overlay_game: async () => {
      const g = demoDb.games[0]?.id;
      if (!g) return null;
      const groups = groupsOf(g);
      const first = info(g).ready[0];
      if (!groups.length && first) {
        groups.push({ n: 1, character: first.character, active: 1, next: first.mods.length + 1, slots: first.mods.map((m, i) => ({ slot: i + 1, modId: m.modId })) });
        setFolders(g, first.mods.map((m) => m.modId), true, false);
        syncRows(g, groups);
      }
      return g;
    },
    overlay_hide: async () => {},
    app_restart_admin: async () => { fail("The demo can't restart as administrator"); },
    overlay_pick: async ({ game, group, slot }) => {
      await demoWait(150);
      const g = String(game);
      const grp = groupsOf(g).find((x) => x.n === Number(group));
      if (!grp) fail("That character isn't switched live any more");
      grp!.active = Number(slot);
      syncRows(g, [grp!]);
      return { reload: false, send: true };
    },
    live_pick: async ({ game, group, slot }) => {
      await demoWait(150);
      const g = String(game);
      const grp = groupsOf(g).find((x) => x.n === Number(group));
      if (!grp) fail("That character isn't switched live any more");
      const s = grp!.slots.find((x) => x.slot === Number(slot));
      if (Number(slot) !== 0 && !s) fail("That mod isn't switched live any more");
      const shown = grp!.slots.find((x) => x.slot === grp!.active);
      const m = s ? modsOf(g).find((x) => x.id === s.modId) : undefined;
      const reload = !!m && !loaded(m);
      // the same as turning that skin on (or the one showing off) in the library
      if (s) setEnabled(g, [s.modId], true, false);
      else if (shown) setEnabled(g, [shown.modId], false, false);
      return { reload, send: !!demoDb.games.find((x) => x.id === g)?.running };
    },
  });
}
