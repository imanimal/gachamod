// Demo handlers for moving from other managers (lib/api/migrate.ts). Owner: MODTOOLS area.
import { registerDemo } from "../tauri";
import { demoId, demoWait } from "./db";
import { demoLog, onDemoReset, scenario } from "./scenario";
import type { MigrateOptions, MigrateResult, MigrateUndo, OtherManager } from "../api/migrate";

const done = new Set<string>();
onDemoReset(() => done.clear());

const found = (game: string, picked: string | null): OtherManager[] => {
  const all: OtherManager[] = [];
  if (scenario().others && game === "zzz") {
    all.push({ id: "xxmm", name: "XX Mod Manager", place: "%APPDATA%\\xx-mod-manager\\config.json", library: "D:\\ZZZ Mod Source", inside: 6, outside: 14, outsideBytes: 2_340_000_000, presets: 3, running: false, notes: [] });
    all.push({ id: "wzmm", name: "WZMM", place: "%APPDATA%\\wzmm", library: "C:\\XXMI\\ZZMI\\dismods", inside: 0, outside: 4, outsideBytes: 410_000_000, presets: 1, running: false, notes: [] });
  }
  if (scenario().others && game === "gi") {
    all.push({ id: "jasm", name: "JASM", place: "%LOCALAPPDATA%\\JASM\\ApplicationData_Genshin", library: null, inside: 31, outside: 0, outsideBytes: 0, presets: 4, running: false, notes: [] });
    all.push({ id: "gimm", name: "GIMM", place: "%APPDATA%\\gimm\\config.json", library: "D:\\Mod_Collection", inside: 5, outside: 22, outsideBytes: 3_900_000_000, presets: 0, running: scenario().running, notes: [] });
  }
  if (picked) all.push({ id: "ssi", name: "SkinSelectImpact", place: picked, library: null, inside: 12, outside: 0, outsideBytes: 0, presets: 2, running: false, notes: [] });
  return all.filter((m) => !done.has(`${game}|${m.id}`));
};

export function registerMigrateDemo() {
  registerDemo({
    migrate_detect: async ({ game, picked }): Promise<OtherManager[]> => {
      await demoWait(300);
      return found(String(game), picked ? String(picked) : null);
    },
    migrate_import: async ({ game, manager, options }): Promise<MigrateResult> => {
      const m = found(String(game), null).find((x) => x.id === manager);
      if (!m) throw { kind: "invalid", message: "That manager has nothing for this game anymore. Look again" };
      if (m.running) throw { kind: "conflict", message: `Close ${m.name} first. It could change the mod folders while gachamod reads them` };
      const mode = (options as MigrateOptions).mode;
      await demoWait(mode === "move" ? 900 : 1800);
      done.add(`${String(game)}|${m.id}`);
      demoLog(`Migrate ${m.name} (${String(game)}, ${mode}): ${m.outside} placed from ${m.library ?? m.place}, ${m.presets} presets`);
      const added = Array.from({ length: m.outside }, demoId);
      const profiles = Array.from({ length: m.presets }, (_, i) => (i === 0 ? `Default (${m.name})` : `Preset ${i + 1}`));
      const count = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);
      const head = added.length
        ? `Brought in ${count(added.length, "mod")}${profiles.length ? ` and ${count(profiles.length, "profile")}` : ""} from ${m.name}`
        : `Made ${count(profiles.length, "profile")} from ${m.name}'s presets`;
      const notes = [head];
      if (mode === "copy" && m.inside && m.library) notes.push(`${m.inside} mods still load from ${m.name}'s folder, so it keeps working`);
      const undo: MigrateUndo = { game: String(game), manager: m.id, placed: added.map((id) => ({ id, at: "", from: "", moved: mode === "move", link: null })), profiles: profiles.map((_, i) => 900 + i), sidecars: [], turnedOff: [] };
      return { manager: m.name, added, profiles, notes, undo };
    },
    migrate_undo: async ({ undo }): Promise<string[]> => {
      await demoWait(600);
      const u = undo as MigrateUndo;
      done.delete(`${u.game}|${u.manager}`);
      demoLog(`Undid the move from ${u.manager} (${u.game}): ${u.placed.length} folders, ${u.profiles.length} profiles`);
      return [];
    },
  });
}
