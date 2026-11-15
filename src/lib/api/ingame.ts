// Switching skins in game without a reload (gacha-core live.rs, docs/ingame.md). Owner: INGAME area.
import { call } from "../tauri";
import type { ModBackup, ModSkip } from "./modtools";
import type { GameId } from "./types";

export interface LiveMod { modId: string; slot: number; name: string; enabled: boolean; preview: string | null }
/** One character's live mods. `active` is the slot showing; 0 is none of them (the game's own look). */
export interface LiveGroup { group: number; character: string; active: number; mods: LiveMod[] }
/** A character with two or more mods that aren't all live yet. */
export interface LiveReady { character: string; mods: LiveMod[] }
/** How the skin menu opens while playing. "window": gachamod's menu over the game (in exclusive fullscreen the game
 *  draws its own). "game": always the one the game draws. `key` is written like a hotkey ("F7", "Ctrl+Alt+M"). */
export interface MenuSettings { style: "window" | "game" | "off"; key: string; pad: boolean }
/** `blocked`: the game runs as administrator and gachamod doesn't, so gachamod's keys never reach it. `all`: every
 *  mod that has a character switches in game, and new ones join by themselves. */
export interface LiveInfo { groups: LiveGroup[]; ready: LiveReady[]; running: boolean; menu: MenuSettings; blocked: boolean; all: boolean }
export interface LiveChange { changed: string[]; skipped: ModSkip[]; backups: ModBackup[]; turnedOn: string[]; turnedOff: string[] }
/** `reload`: the mod was off and was turned on, so it shows after a reload. `send`: the pick went to the running game. */
export interface Picked { reload: boolean; send: boolean; note?: string | null }

export const live = {
  info: (game: GameId) => call<LiveInfo>("live_info", { game }),
  /** Make mods live: each joins its character's group. Takes a reload to start working (sent by itself). */
  add: (game: GameId, ids: string[]) => call<LiveChange>("live_add", { game, ids }),
  /** Stop switching them live. The one showing stays on, the others are turned off. */
  remove: (game: GameId, ids: string[]) => call<LiveChange>("live_remove", { game, ids }),
  /** Show slot `slot` of a group (0: none). Sent to the game when it runs, saved for its next start either way. */
  pick: (game: GameId, group: number, slot: number) => call<Picked>("live_pick", { game, group, slot }),
  /** Change how the skin menu opens. The game reloads once to pick it up. */
  setMenu: (game: GameId, menu: MenuSettings) => call<MenuSettings>("live_menu_set", { game, menu }),
  /** Make every mod that has a character switch in game, now and as new ones arrive. Off only stops new ones. */
  setAll: (game: GameId, on: boolean) => call<LiveChange>("live_set_all", { game, on }),
  /** Start gachamod again as administrator (Windows asks first), so its keys reach a game that runs as one. */
  restartAsAdmin: () => call<void>("app_restart_admin"),
};

/** The skin menu's own window over the game (src-tauri overlay.rs). */
export const skinMenu = {
  /** The game the menu was opened for. */
  game: () => call<GameId | null>("overlay_game"),
  /** Close the menu and bring the game back to the front. */
  hide: (game: GameId) => call<void>("overlay_hide", { game }),
  pick: (game: GameId, group: number, slot: number) => call<Picked>("overlay_pick", { game, group, slot }),
};
