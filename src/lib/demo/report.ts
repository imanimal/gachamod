// Demo handlers for logs, crash reports, usage counts, feedback and administrator (lib/api/report.ts). Nothing leaves
// the browser. Owner: SYSTEM area.
import type { MenuInfo } from "../api";
import { call, registerDemo } from "../tauri";
import { demoDb, demoWait } from "./db";
import { demoPickedAt } from "./ingame";

export function registerReportDemo() {
  const on = (k: string) => demoDb.settings.get(k) !== "0";
  const state = () => ({ usage: on("telemetry.usage"), crashes: on("telemetry.crashes"), configured: true, logsDir: "%APPDATA%\\app.gachamod.desktop\\logs" });
  let always = false;
  registerDemo({
    report_state: state,
    report_set: ({ usage, crashes }) => {
      if (typeof usage === "boolean") demoDb.settings.set("telemetry.usage", usage ? "1" : "0");
      if (typeof crashes === "boolean") demoDb.settings.set("telemetry.crashes", crashes ? "1" : "0");
      return state();
    },
    telemetry_events: () => undefined,
    log_write: () => undefined,
    report_ui_error: () => undefined,
    feedback_send: async ({ feedback }) => {
      await demoWait(700);
      if (!String((feedback as { text?: string }).text ?? "").trim()) throw new Error("Write something first");
    },
    admin_state: () => ({ elevated: false, always }),
    admin_set_always: ({ on: v }) => { always = !!v; return { elevated: false, always }; },
    game_check_setup: async ({ game }) => {
      const g = demoDb.games.find((x) => x.id === game);
      if (!g) throw { kind: "invalid", message: `gachamod doesn't know the game ${String(game)}` };
      const info = await call<MenuInfo>("menu_info", { game });
      const running = await call<boolean>("game_running", { game });
      return {
        game: g.id, name: g.name, importer: g.importer, viaXxmi: g.viaXxmi, loaderVersion: g.importerVersion ?? null, xxmiVersion: g.viaXxmi ? "0.9.3" : null,
        windowMode: g.viaXxmi ? "borderless" : null, running, gameAdmin: running ? g.id === "zzz" : null, appAdmin: false,
        foregroundCheck: "1", reloadKey: "no_modifiers VK_F10",
        menuStyle: info.menu.style, menuKey: info.menu.key, menuPad: info.menu.pad,
      };
    },
    // the player "presses the menu key" three seconds into the step; a pick in the demo's menu counts too
    game_check_menu: ({ since }) => (demoPickedAt > Number(since) ? "picked" : Date.now() - Number(since) > 3000 ? "window" : null),
    game_check_send: async () => { await demoWait(700); },
  });
}
