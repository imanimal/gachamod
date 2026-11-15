// Demo handlers for the menu over the game (lib/api/ingame.ts): its settings kept in memory, picks made in the demo
// library. Owner: INGAME area.
import type { MenuInfo, MenuSettings } from "../api";
import { registerDemo } from "../tauri";
import { demoDb, demoWait } from "./db";
import { setEnabled } from "./library";

const menus = new Map<string, MenuSettings>();
const menuOf = (game: string): MenuSettings => menus.get(game) ?? { style: "window", key: "F7", pad: true };
const fail = (message: string) => { throw { kind: "invalid", message }; };

/** When a skin was last picked in the demo's menu (the check's last step looks for it). */
export let demoPickedAt = 0;

export function registerIngameDemo() {
  registerDemo({
    menu_info: async ({ game }): Promise<MenuInfo> => {
      await demoWait(120);
      const g = String(game);
      return { menu: menuOf(g), running: !!demoDb.games.find((x) => x.id === g)?.running, blocked: false, reloads: true };
    },
    menu_set: async ({ game, menu }) => {
      await demoWait(120);
      const m = menu as MenuSettings;
      if (m.style !== "window" && m.style !== "off") fail("The menu is either on or off");
      if (!/^((Ctrl|Alt|Shift|Win)\+)*(F\d+|[A-Z0-9]|Num\d|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Space)$/.test(m.key)) fail(`${m.key} can't open the menu. Try F7`);
      menus.set(String(game), { ...m });
      return menuOf(String(game));
    },
    // one demo mod uses F7 for its own toggle
    menu_key_users: async ({ game }) => {
      await demoWait(200);
      const m = menuOf(String(game));
      return m.style === "window" && m.key === "F7" ? ((demoDb.mods.get(String(game)) ?? []).filter((x) => x.enabled && x.hasKeys).slice(0, 1).map((x) => x.name)) : [];
    },
    // the menu window: the demo shows it for the first game
    overlay_game: async () => demoDb.games[0]?.id ?? null,
    overlay_hide: async () => {},
    app_restart_admin: async () => { fail("The demo can't restart as administrator"); },
    overlay_pick: async ({ game, character, id }) => {
      await demoWait(150);
      const g = String(game);
      const who = String(character).toLowerCase();
      if (id) setEnabled(g, [String(id)], true, true);
      else {
        const on = (demoDb.mods.get(g) ?? []).filter((m) => m.enabled && m.character?.toLowerCase() === who).map((m) => m.id);
        if (on.length) setEnabled(g, on, false, false);
      }
      demoPickedAt = Date.now();
      return [];
    },
  });
}
