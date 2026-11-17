// Demo handlers for logs, crash reports, usage counts, feedback and administrator (lib/api/report.ts). Nothing leaves
// the browser. Owner: SYSTEM area.
import type { LiveInfo } from "../api";
import { call, registerDemo } from "../tauri";
import { demoDb, demoWait } from "./db";

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
    log_tail: () => [
      "2026-11-17 18:02:11 info  gachamod 0.1.1-demo started",
      "2026-11-17 18:02:11 info  Found Genshin Impact, Zenless Zone Zero, Wuthering Waves, Arknights: Endfield",
      "2026-11-17 18:02:12 info  Watching 4 Mods folders for changes",
      "2026-11-17 18:02:14 warn  GameBanana took 6.2 s to answer; trying again",
      "2026-11-17 18:03:40 error Couldn't read ZZMI/Mods/Ellen Maid/mod.ini: The file is in use by another process",
    ].join("\r\n"),
    report_ui_error: () => undefined,
    render_events: () => undefined,
    render_state: () => ({ on: on("render.log"), dir: "%APPDATA%\app.gachamod.desktop\logs\rendering", incidents: 0 }),
    feedback_send: async ({ feedback }) => {
      await demoWait(700);
      if (!String((feedback as { text?: string }).text ?? "").trim()) throw new Error("Write something first");
    },
    admin_state: () => ({ elevated: false, always }),
    admin_set_always: ({ on: v }) => { always = !!v; return { elevated: false, always }; },
    game_check_setup: async ({ game }) => {
      const g = demoDb.games.find((x) => x.id === game);
      if (!g) throw { kind: "invalid", message: `gachamod doesn't know the game ${String(game)}` };
      const info = await call<LiveInfo>("live_info", { game });
      const running = await call<boolean>("game_running", { game });
      return {
        game: g.id, name: g.name, importer: g.importer, viaXxmi: g.viaXxmi, loaderVersion: g.importerVersion ?? null, xxmiVersion: g.viaXxmi ? "0.9.3" : null,
        windowMode: g.viaXxmi ? "borderless" : null, running, gameAdmin: running ? g.id === "zzz" : null, appAdmin: false,
        foregroundCheck: "1", reloadKey: "no_modifiers VK_F10", liveGroups: info.groups.length,
        menuStyle: info.menu.style, menuKey: info.menu.key, menuPad: info.menu.pad,
      };
    },
    // the game "saves" a pick about five seconds after the check first asks for it, as the loader does
    game_check_saved: async ({ game, group }) => {
      const key = `${String(game)}/${String(group)}`;
      const first = asked.get(key) ?? Date.now();
      asked.set(key, first);
      const info = await call<LiveInfo>("live_info", { game });
      const active = info.groups.find((x) => x.group === Number(group))?.active ?? null;
      const now = Date.now();
      if (now - first < 5000) return { value: active === null ? null : 0, savedAt: now - 60_000 };
      asked.delete(key);
      return { value: active, savedAt: now };
    },
    // the player "presses the menu key" three seconds into the step
    game_check_menu: ({ since }) => (Date.now() - Number(since) > 3000 ? "window" : null),
    game_check_send: async () => { await demoWait(700); },
  });
}

const asked = new Map<string, number>();
