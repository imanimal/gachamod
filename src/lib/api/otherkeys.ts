// Keys of other apps (recorders, overlays) that are also gachamod's: Medal takes a screenshot on F7, the key that
// opens the skin menu. gachamod reads the other apps' settings and moves its own key, or for Medal changes the
// other app's key when the player asks (gacha-core otherkeys.rs, docs/other-app-keys.md). Owner: INGAME area.
import { call } from "../tauri";
import type { GameId } from "./types";

/** Another app's key that is also one of gachamod's. `id` is `${appId}|${key}`. `does` follows the app's name
 *  ("takes a screenshot"). `byDefault`: the app's settings couldn't be read, so `key` is the one it ships with.
 *  `menuGames`: games whose skin menu opens with the key; `keyListGames`: games whose key list shows with it;
 *  `profile`: it switches a profile. `suggestion`: a free key for gachamod, null when only a profile hotkey is hit.
 *  `otherKey`: the free key the other app would get, null when gachamod can't change that app's key (only Medal's
 *  can be). `otherNeeds`: what that change needs ("Medal has to be closed first. Quit it from its tray icon").
 *  `text`: "Medal takes a screenshot on F7." `ask`: the same with what the key does in gachamod, for a toast. */
export interface AppKeyClash {
  id: string; app: string; appId: string; does: string; key: string; byDefault: boolean;
  menuGames: GameId[]; keyListGames: GameId[]; profile: boolean; suggestion: string | null;
  otherKey: string | null; otherNeeds: string | null; text: string; ask: string;
}

/** What moving a key changed. `text`: "The skin menu opens with F9 now". */
export interface AppKeyMove { from: string; to: string; menuGames: GameId[]; keyListGames: GameId[]; text: string }

/** What changing the other app's key did. `text`: "Medal takes a screenshot on F9 now". */
export interface AppKeyChange { app: string; appId: string; from: string; to: string; text: string }

export const otherKeys = {
  /** Every key of a known app on this PC that is also one of gachamod's, the ones the player keeps left out. */
  clashes: () => call<AppKeyClash[]>("otherkeys_clashes"),
  /** The clashes to ask about in a toast now (at start and when a game starts): each three times in all, none when
   *  the setting "otherKeys.ask" is "0". */
  ask: () => call<AppKeyClash[]>("otherkeys_ask"),
  /** Move gachamod's key: every game whose skin menu or key list uses `from` uses `to`. Undo is the same call the
   *  other way round. */
  move: (from: string, to: string) => call<AppKeyMove>("otherkeys_move", { from, to }),
  /** Give the other app's key `from` the key `to`, so gachamod keeps its own. Medal only: it fails with what to do
   *  while Medal runs, and a copy of Medal's settings is kept next to them first. `undo` puts the old key back. */
  change: (appId: string, from: string, to: string, undo = false) => call<AppKeyChange>("otherkeys_change", { appId, from, to, undo }),
  /** Keep gachamod's key although the app uses it too, so it isn't asked about again (`on` false takes that back). */
  keep: (appId: string, key: string, on = true) => call<void>("otherkeys_keep", { appId, key, on }),
};
