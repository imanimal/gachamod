// The menu over the game while playing (gacha-core live.rs menu settings, src-tauri overlay.rs, docs/ingame.md).
// Owner: INGAME area.
import { call } from "../tauri";
import type { GameId } from "./types";

/** How the menu opens while playing. `style` "window": gachamod's menu over the game. `key` is written like a hotkey
 *  ("F7", "Ctrl+Alt+M"). `pad`: pressing both sticks in opens it too. */
export interface MenuSettings { style: "window" | "off"; key: string; pad: boolean }
/** `blocked`: the game runs as administrator and gachamod doesn't, so the menu key never reaches gachamod and the
 *  game doesn't reload by itself. `reloads`: gachamod presses F10 when the game is back in front after a change. */
export interface MenuInfo { menu: MenuSettings; running: boolean; blocked: boolean; reloads: boolean }

export const ingame = {
  info: (game: GameId) => call<MenuInfo>("menu_info", { game }),
  /** Mods that are on and use the menu's key themselves, by name. */
  keyUsers: (game: GameId) => call<string[]>("menu_key_users", { game }),
  /** Turn the menu on or off, or change its key. */
  setMenu: (game: GameId, menu: MenuSettings) => call<MenuSettings>("menu_set", { game, menu }),
  /** Start gachamod again as administrator (Windows asks first), so its keys reach a game that runs as one. False
   *  when the player said no there. */
  restartAsAdmin: () => call<boolean>("app_restart_admin"),
};

/** The menu's own window over the game (src-tauri overlay.rs). */
export const skinMenu = {
  /** The game the menu was opened for. */
  game: () => call<GameId | null>("overlay_game"),
  /** Close the menu and bring the game back to the front, where it reloads its mods if they changed. */
  hide: (game: GameId) => call<void>("overlay_hide", { game }),
  /** Turn `id` on and the character's other mods off (null: all of them off). Returns what went wrong, if anything. */
  pick: (game: GameId, character: string, id: string | null) => call<string[]>("overlay_pick", { game, character, id }),
};
