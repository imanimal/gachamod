// Switching skins in game without a reload (gacha-core live.rs, docs/ingame.md). Owner: INGAME area.
import { call } from "../tauri";
import type { ModBackup, ModSkip } from "./modtools";
import type { GameId } from "./types";

export interface LiveMod { modId: string; slot: number; name: string; enabled: boolean; preview: string | null }
/** One character's live mods. `active` is the slot showing; 0 is none of them (the game's own look). */
/** `waiting`: the app's pick couldn't be keyed into the running game, so it shows at the game's next reload. */
export interface LiveGroup { group: number; character: string; active: number; mods: LiveMod[]; waiting: boolean }
/** A character with two or more mods that aren't all live yet. */
export interface LiveReady { character: string; mods: LiveMod[] }
/** How the skin menu opens while playing. "window": gachamod's menu over the game (in exclusive fullscreen the game
 *  draws its own). "game": always the one the game draws. `key` is written like a hotkey ("F7", "Ctrl+Alt+M"). */
/** `fastSave`: the game saves its values every second (d3dx.ini `settings_auto_save_interval`), so a pick made in its
 *  own menu shows in gachamod at once. */
export interface MenuSettings { style: "window" | "game"; key: string; pad: boolean; fastSave: boolean }
/** `blocked`: the game runs as administrator and gachamod doesn't, so gachamod's keys never reach it. `all`: the
 *  panel's one switch: every mod that has a character switches in game, and new ones join by themselves (on by
 *  default in Zenless Zone Zero). `allowed`: new groups and the drawn
 *  menu can be set up (Zenless Zone Zero, or any game with tester options on, "ui.tester"). */
export interface LiveInfo { groups: LiveGroup[]; ready: LiveReady[]; running: boolean; menu: MenuSettings; blocked: boolean; all: boolean; allowed: boolean }
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
  /** Start gachamod again as administrator (Windows asks first), so its keys reach a game that runs as one. False
   *  when the player said no there. */
  restartAsAdmin: () => call<boolean>("app_restart_admin"),
};

/** The skin menu's own window over the game (src-tauri overlay.rs). */
export const skinMenu = {
  /** The game the menu was opened for. */
  game: () => call<GameId | null>("overlay_game"),
  /** Close the menu and bring the game back to the front. */
  hide: (game: GameId) => call<void>("overlay_hide", { game }),
  /** `close`: a skin that shows at once closes the menu and leaves the game in front. */
  pick: (game: GameId, group: number, slot: number, close = false) => call<Picked>("overlay_pick", { game, group, slot, close }),
};
