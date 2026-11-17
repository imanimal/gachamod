// The key list: each mod's toggle keys, shown while playing for mods that don't show their own (gacha-core
// keylist.rs, docs/ingame.md "The key list"). Owner: INGAME area.
import { call } from "../tauri";
import type { KeyLine } from "./modtools";
import type { GameId } from "./types";

/** One key section of a mod. `keys` are readable ("F6", "Ctrl+H", "Pad LB+Pad A"), keys turned off left out.
 *  `options`: how many values a cycle steps through (2 for an on/off switch). `onScreen`: it only works while the
 *  character is on screen. `ini`, `section` and `lines` (the key lines that are on) say where the keys are, for
 *  `modKeys.rebind`. */
export interface KeyRow {
  keys: string[]; what: string; kind: "cycle" | "toggle" | "hold" | "activate"; options: number; onScreen: boolean;
  ini: string; section: string; lines: KeyLine[];
}

/** A mod with keys. `showing`: on, or the live skin its character shows now. `ownHelp`: the mod shows its own key
 *  help in game (a help picture or panel it draws), and `helpKey` is the key that shows it, when one was found.
 *  `choice`: the player's own pick for this mod (null: automatic, which lists every mod unless the setting `own` is
 *  off, which leaves out the ones with their own help). `listed`: it shows in the key lists, after all that. */
export interface ModKeyList {
  modId: string; name: string; character: string | null; preview: string | null;
  live: boolean; showing: boolean; ownHelp: boolean; helpKey: string | null;
  choice: boolean | null; listed: boolean; rows: KeyRow[];
}

/** `on`: the key list exists (on by default). `style`: "window" shows it as the Keys tab of gachamod's menu over the
 *  game (in exclusive fullscreen the game draws it instead), "game" always has the game draw it, in the top right
 *  corner, and it stays there while playing until the key is pressed again. `key` is written like a hotkey ("F8").
 *  `own`: also list mods that show their own key help (on by default). */
export interface KeyListSettings { on: boolean; style: "window" | "game"; key: string; own: boolean }

/** `available`: the game has the in-game menu (characters that switch in game), which the key list rides on. */
export interface KeyList { settings: KeyListSettings; available: boolean; mods: ModKeyList[] }

export const keyList = {
  /** Every mod of the game that has keys, showing ones first, with the settings. */
  get: (game: GameId) => call<KeyList>("keylist_get", { game }),
  /** Change the settings. The game reloads once to pick up a drawn key list. */
  set: (game: GameId, settings: KeyListSettings) => call<KeyListSettings>("keylist_set", { game, settings }),
  /** Show (true) or leave out (false) one mod, or go back to automatic (null). */
  choose: (game: GameId, modId: string, listed: boolean | null) => call<ModKeyList>("keylist_choose", { game, modId, listed }),
};
