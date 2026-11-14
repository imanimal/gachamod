// Switching skins in game without a reload (gacha-core live.rs, docs/ingame.md). Owner: INGAME area.
import { call } from "../tauri";
import type { ModBackup, ModSkip } from "./modtools";
import type { GameId } from "./types";

export interface LiveMod { modId: string; slot: number; name: string; enabled: boolean; preview: string | null }
/** One character's live mods. `active` is the slot showing; 0 is none of them (the game's own look). */
export interface LiveGroup { group: number; character: string; active: number; mods: LiveMod[] }
/** A character with two or more mods that aren't all live yet. */
export interface LiveReady { character: string; mods: LiveMod[] }
export interface LiveInfo { groups: LiveGroup[]; ready: LiveReady[]; running: boolean }
export interface LiveChange { changed: string[]; skipped: ModSkip[]; backups: ModBackup[]; turnedOn: string[]; turnedOff: string[] }
/** `reload`: the mod was off and was turned on, so it shows after a reload. `send`: the pick went to the running game. */
export interface Picked { reload: boolean; send: boolean }

export const live = {
  info: (game: GameId) => call<LiveInfo>("live_info", { game }),
  /** Make mods live: each joins its character's group. Takes a reload to start working (sent by itself). */
  add: (game: GameId, ids: string[]) => call<LiveChange>("live_add", { game, ids }),
  /** Stop switching them live. The one showing stays on, the others are turned off. */
  remove: (game: GameId, ids: string[]) => call<LiveChange>("live_remove", { game, ids }),
  /** Show slot `slot` of a group (0: none). Sent to the game when it runs, saved for its next start either way. */
  pick: (game: GameId, group: number, slot: number) => call<Picked>("live_pick", { game, group, slot }),
};
