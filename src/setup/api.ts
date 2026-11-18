// The setup window's calls to src-setup (src-setup/src/main.rs). In a browser (npm run dev, then /setup.html) they
// are faked so every screen can be seen: ?mode=install|maintain|uninstall|repair|apply, ?theme=zzz, ?scheme=light,
// ?installed=0.1.0 (a version, or "none"), ?latest=0.1.2 (the newest on GitHub), ?offline=1, ?running=1, ?fail=1,
// ?open=0 (an update installing as gachamod quits), ?quiet=1 and ?background=1 (an update from the background).
import type { Look } from "./look";
import { t } from "../lib/i18n";

export type Mode = "install" | "maintain" | "uninstall" | "repair" | "apply";
export interface SetupInfo {
  mode: Mode;
  /** The version this setup installs. */
  version: string;
  /** It carries an installer (the download), rather than being the copy next to gachamod. */
  payload: boolean;
  installed: { dir: string; version: string | null; ok: boolean } | null;
  running: boolean;
  defaultDir: string;
  dataDirs: string[];
  admin: boolean;
  desktop: boolean;
  /** The quickstart shortcut: starts the game gachamod last had open, with mods. */
  quickstart: boolean;
  look: Look;
  homepage: string;
  /** An update gachamod downloaded and handed over (`--apply`): its version, whether to open gachamod after, keep the
   * window hidden unless it fails (`--quiet`) and start gachamod after with only its tray icon (`--open-background`,
   * which src-setup does itself). */
  apply: { version: string | null; open: boolean; quiet: boolean; background: boolean } | null;
}
export interface Step { step: string; text: string; value: number | null; hold: string | null }
export interface InstallOpts { dir: string | null; desktop: boolean; quickstart: boolean; admin: boolean }

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri()) return demo(cmd, args) as Promise<T>;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const api = {
  info: () => call<SetupInfo>("info"),
  dataSize: () => call<number>("data_size"),
  install: (opts: InstallOpts) => call<string>("install", { opts }),
  repair: () => call<string>("repair"),
  /** Download the newest gachamod from GitHub and install it over the copy there. */
  update: () => call<string>("update"),
  /** Install the update gachamod handed over. */
  apply: () => call<string>("apply"),
  /** The newest version on GitHub. */
  latest: () => call<string>("latest"),
  uninstall: (deleteData: boolean) => call<void>("uninstall", { deleteData }),
  stop: () => call<void>("stop"),
  openApp: (dir?: string) => call<void>("open_app", { dir: dir ?? null }),
  openPage: (url: string) => (inTauri() ? call<void>("open_page", { url }) : Promise.resolve(void window.open(url, "_blank"))),
  plainInstaller: () => call<void>("plain_installer"),
  async onStep(f: (s: Step) => void): Promise<() => void> {
    if (!inTauri()) { demoListeners.add(f); return () => demoListeners.delete(f); }
    const { listen } = await import("@tauri-apps/api/event");
    return listen<Step>("setup-step", (e) => f(e.payload));
  },
  async pickFolder(current: string): Promise<string | null> {
    if (!inTauri()) return window.prompt("Install folder", current);
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ directory: true, defaultPath: current, title: t("Install gachamod in") });
    return typeof r === "string" ? r : null;
  },
  async win(action: "show" | "minimize" | "close") {
    if (!inTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    if (action === "show") { await w.show(); await w.setFocus(); } else if (action === "minimize") await w.minimize(); else await w.close();
  },
};

// ── the browser demo ──

const demoListeners = new Set<(s: Step) => void>();
const q = () => new URLSearchParams(location.search);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const emit = (step: string, text: string, value: number | null = null, hold: string | null = null) => demoListeners.forEach((f) => f({ step, text, value, hold }));

async function steps(list: Array<[string, string, number]>) {
  for (const [step, text, ms] of list) {
    if (ms > 600) for (let i = 0; i <= 10; i++) { emit(step, `${text} (${Math.round(31 * i / 10)} of 31 MB)`, i / 10, "Windows security may be checking the new files."); await sleep(ms / 10); }
    else { emit(step, text); await sleep(ms); }
  }
  if (q().get("fail")) throw "The installer stopped partway. A newer gachamod may be installed, or a file in its folder is in use.";
  emit("done", "Done", 1);
}

async function demo(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const p = q();
  const mode = (p.get("mode") as Mode) ?? "install";
  const inst = p.get("installed") ?? (mode === "install" ? "none" : "0.1.1");
  switch (cmd) {
    case "info": return {
      mode, version: "0.1.1", payload: mode === "install" || mode === "repair",
      installed: inst === "none" ? null : { dir: "C:\\Users\\you\\AppData\\Local\\gachamod", version: inst, ok: true },
      running: p.get("running") === "1" || mode === "apply", defaultDir: "C:\\Users\\you\\AppData\\Local\\gachamod",
      dataDirs: ["C:\\Users\\you\\AppData\\Roaming\\app.gachamod.desktop", "C:\\Users\\you\\AppData\\Local\\app.gachamod.desktop"],
      admin: true, desktop: true, quickstart: inst === "none", homepage: "https://github.com/imanimal/gachamod",
      apply: mode === "apply" ? { version: p.get("latest") ?? "0.1.2", open: p.get("open") !== "0" && p.get("background") !== "1", quiet: p.get("quiet") === "1", background: p.get("background") === "1" } : null,
      look: { theme: p.get("theme") ?? "default", scheme: p.get("scheme") === "light" ? "light" : p.get("scheme") === "dark" ? "dark" : null, source: p.get("theme") ? "link" : "default",
        game: p.get("theme") === "zzz" ? { id: "zzz", name: "Zenless Zone Zero", short: "ZZZ", importer: "ZZMI", accent: "#ff7a1c" } : null },
    } satisfies SetupInfo;
    case "data_size": await sleep(700); return 2_576_980_378;
    case "install": await steps([["unpack", "Unpacking the installer", 400], ["copy", "Copying gachamod", 1600]]); return "C:\\Users\\you\\AppData\\Local\\gachamod";
    case "latest": await sleep(900); if (p.get("offline")) throw "Couldn't reach GitHub. Check your internet connection."; return p.get("latest") ?? "0.1.2";
    case "update": await steps([["download", `Downloading gachamod ${p.get("latest") ?? "0.1.2"}`, 1800], ["verify", "Checking the download", 500], ["copy", "Updating gachamod", 1200]]); return "C:\\Users\\you\\AppData\\Local\\gachamod";
    case "apply": await steps([["verify", "Checking the download", 500], ["close", "Waiting for gachamod to close", 700], ["copy", "Updating gachamod", 1600]]); return "C:\\Users\\you\\AppData\\Local\\gachamod";
    case "repair": await steps([["download", "Downloading gachamod 0.1.1", 1800], ["verify", "Checking the download", 500], ["copy", "Putting back gachamod", 1200]]); return "";
    case "uninstall": await steps([["remove", "Removing gachamod", 900], ...(args?.deleteData ? [["data", "Moving gachamod's data to the Recycle Bin", 900] as [string, string, number]] : [])]); return;
    default: return;
  }
}
