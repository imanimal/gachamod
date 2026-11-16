// Demo handlers for the key list (lib/api/keylist.ts): keys made up for the demo library's mods that have toggles,
// settings and picks kept in memory. Owner: INGAME area.
import type { KeyListSettings, KeyRow, ModEntry, ModKeyList } from "../api";
import { registerDemo } from "../tauri";
import { demoDb, demoWait } from "./db";
import { liveHooks } from "./library";

const fail = (message: string) => { throw { kind: "invalid", message }; };
const settingsOf = new Map<string, KeyListSettings>();
const settings = (game: string): KeyListSettings => settingsOf.get(game) ?? { on: true, style: "window", key: "F8", own: false };
/** The player's picks, by `${game}|${modId}`. */
const choices = new Map<string, boolean>();

const row = (keys: string[], what: string, kind: KeyRow["kind"] = "toggle", options = 2, onScreen = true): KeyRow => ({ keys, what, kind, options, onScreen });
/** Made-up keys, handed out in turn to the mods with toggles. */
const ROWS: KeyRow[][] = [
  [row(["F6"], "Jacket"), row(["Ctrl+H"], "Hair colour", "cycle", 4)],
  [row(["Numpad 1"], "Outfit", "cycle", 3), row(["Alt+G", "Pad LB+Pad A"], "Glasses")],
  [row(["V"], "Wink", "hold"), row(["B"], "Bag")],
  [row(["Up"], "Next outfit", "cycle", 5, false), row(["Down"], "Previous outfit", "cycle", 5, false), row(["Shift+T"], "Tail")],
  [row(["Ctrl+1"], "Weapon glow"), row(["Ctrl+2"], "Earrings")],
];
/** Mods without toggles in the library that get keys anyway, so "Other mods" has something. */
const EXTRA: Record<string, KeyRow[]> = { "Cleaner HUD": [row(["Ctrl+U"], "Hide the HUD", "toggle", 2, false)] };
/** Mods that show their own key help, by their place among the mods with keys, with the key that shows it. */
const OWN_HELP: Record<number, string | null> = { 1: "F1", 4: "Ctrl+F1" };

function listOf(game: string): ModKeyList[] {
  const s = settings(game);
  const live = liveHooks.live?.(game) ?? new Set<string>();
  const withKeys = (demoDb.mods.get(game) ?? []).filter((m: ModEntry) => m.hasKeys || EXTRA[m.name]);
  return withKeys
    .map((m, i): ModKeyList => {
      const ownHelp = i in OWN_HELP;
      const choice = choices.get(`${game}|${m.id}`) ?? null;
      return {
        modId: m.id, name: m.name, character: m.character, preview: m.preview, live: live.has(m.id), showing: m.enabled,
        ownHelp, helpKey: ownHelp ? OWN_HELP[i] ?? null : null, choice, listed: choice ?? (!ownHelp || s.own),
        rows: EXTRA[m.name] ?? ROWS[i % ROWS.length]!,
      };
    })
    .sort((a, b) => Number(b.showing) - Number(a.showing) || a.name.localeCompare(b.name));
}

const available = (game: string) => game === "zzz" || demoDb.settings.get("ui.tester") === "1";

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
