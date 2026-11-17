// Demo handlers for the key list (lib/api/keylist.ts): the demo keys of the library's mods that have toggles (the
// ones the key editor shows, so a rebind in either place shows in both), settings and picks kept in memory.
// Owner: INGAME area.
import type { KeyListSettings, KeyRow, ModEntry, ModKeyList } from "../api";
import { registerDemo } from "../tauri";
import { demoDb, demoWait } from "./db";
import { liveHooks } from "./library";
import { demoModKeys } from "./modtools";

const fail = (message: string) => { throw { kind: "invalid", message }; };
const settingsOf = new Map<string, KeyListSettings>();
const settings = (game: string): KeyListSettings => settingsOf.get(game) ?? { on: true, style: "window", key: "F8", own: true };
/** The player's picks, by `${game}|${modId}`. */
const choices = new Map<string, boolean>();

/** A demo mod's keys as the key list's rows: sections with every key off left out. */
function rowsOf(game: string, id: string): KeyRow[] {
  return demoModKeys(game, id).keys.filter((e) => !e.off).flatMap((e): KeyRow[] => {
    const lines = e.lines.filter((l) => !l.off && l.label);
    if (!lines.length) return [];
    const kind = (["cycle", "toggle", "hold", "activate"] as const).find((k) => k === e.kind) ?? "activate";
    const options = kind === "cycle" ? Math.max(0, ...e.vars.map((v) => v.values.length)) : kind === "toggle" ? 2 : 0;
    return [{ keys: [...new Set(lines.map((l) => l.label))], what: e.name, kind, options, onScreen: e.onScreen, ini: e.ini, section: e.section, lines }];
  });
}
/** Mods without toggles in the library that get keys anyway, so "Other mods" has something. */
const EXTRA = new Set(["Cleaner HUD"]);
/** Mods that show their own key help, by their place among the mods with keys, with the key that shows it. */
const OWN_HELP: Record<number, string | null> = { 1: "F1", 4: "Ctrl+F1" };

function listOf(game: string): ModKeyList[] {
  const s = settings(game);
  const live = liveHooks.live?.(game) ?? new Set<string>();
  const withKeys = (demoDb.mods.get(game) ?? []).filter((m: ModEntry) => m.hasKeys || EXTRA.has(m.name));
  return withKeys
    .map((m, i): ModKeyList => {
      const ownHelp = i in OWN_HELP;
      const choice = choices.get(`${game}|${m.id}`) ?? null;
      return {
        modId: m.id, name: m.name, character: m.character, preview: m.preview, live: live.has(m.id), showing: m.enabled,
        ownHelp, helpKey: ownHelp ? OWN_HELP[i] ?? null : null, choice, listed: choice ?? (!ownHelp || s.own),
        rows: rowsOf(game, m.id),
      };
    })
    .filter((m) => m.rows.length > 0)
    .sort((a, b) => Number(b.showing) - Number(a.showing) || a.name.localeCompare(b.name));
}

const available = (game: string) => game === "zzz" || game === "gi" || demoDb.settings.get("ui.testerOk") === "1";

export function registerKeylistDemo() {
  registerDemo({
    keylist_get: async ({ game }) => {
      await demoWait(140);
      const g = String(game);
      return { settings: settings(g), available: available(g), mods: listOf(g) };
    },
    keylist_set: async ({ game, settings: next }) => {
      await demoWait(120);
      const s = next as KeyListSettings;
      if (!/^((Ctrl|Alt|Shift|Win)\+)*(F\d+|[A-Z0-9]|Num\d|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Space)$/.test(s.key)) fail(`${s.key} can't open the key list. Try F8`);
      settingsOf.set(String(game), { ...s });
      return settings(String(game));
    },
    keylist_choose: async ({ game, modId, listed }) => {
      await demoWait(100);
      const g = String(game);
      const k = `${g}|${String(modId)}`;
      if (listed === null || listed === undefined) choices.delete(k); else choices.set(k, !!listed);
      const m = listOf(g).find((x) => x.modId === String(modId));
      if (!m) fail("That mod has no keys any more");
      return m;
    },
  });
}
