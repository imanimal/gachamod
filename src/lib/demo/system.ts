// Demo handlers for the SYSTEM area's commands (lib/api/system.ts). Owner: SYSTEM area.
import { demoEmit, registerDemo } from "../tauri";
import type { DevStatus, GamePaths, ImportSummary, Integration, LaunchConfig, UpdateCheck, XxmiStatus } from "../api/system";
import type { GameState } from "../api/types";
import { demoDb, demoWait } from "./db";

const ROOT = "C:\\Users\\Player\\AppData\\Roaming\\XXMI Launcher";

/** Games with counts from the demo library, and the running flags the fake launches set. */
function gamesNow(): GameState[] {
  return demoDb.games.map((g) => {
    const mods = demoDb.mods.get(g.id) ?? [];
    return { ...g, modCount: mods.length, enabledCount: mods.filter((m) => m.enabled).length, running: running.has(g.id) };
  });
}

const running = new Set<string>();

/** `?fresh` in the address: a PC with games but no XXMI Launcher or mod loader yet, to try the first start and the
 *  one-click setup. The loaders' folders come back when "Install mod loaders" runs. */
const fresh = typeof location !== "undefined" && new URLSearchParams(location.search).has("fresh");
let xxmiFound = !fresh;
const loaders = new Map<string, Pick<GameState, "importerDir" | "modsDir" | "viaXxmi" | "importerVersion" | "importerLatest">>();
if (fresh) {
  for (const g of demoDb.games) {
    if (!g.modsDir) continue;
    loaders.set(g.id, { importerDir: g.importerDir, modsDir: g.modsDir, viaXxmi: g.viaXxmi, importerVersion: g.importerVersion, importerLatest: g.importerLatest });
    Object.assign(g, { importerDir: null, modsDir: null, viaXxmi: false, importerVersion: null, importerLatest: null, shown: false });
  }
}

/** The demo's one-click setup: a few steps with a download, then each game's loader folders. */
async function demoInstall(games: string[] | null): Promise<GameState[]> {
  const steps: Array<[string, number]> = [["Asking GitHub for XXMI Launcher", 0], ["Downloading XXMI Launcher", 61_000_000], ["Unpacking XXMI Launcher", 0], ["Downloading the 3DMigoto libraries", 3_500_000]];
  const want = demoDb.games.filter((g) => g.xxmi && (games?.length ? games.includes(g.id) : g.installed) && !g.modsDir);
  for (const g of want) steps.push([`Downloading ${g.importer} for ${g.name}`, 900_000]);
  steps.push(["Writing XXMI Launcher's settings", 0]);
  for (const [step, total] of steps) {
    if (!total) { demoEmit("xxmi-setup", { step, done: 0, total: null }); await demoWait(500); continue; }
    for (let i = 0; i <= 10; i++) { demoEmit("xxmi-setup", { step, done: Math.round((total * i) / 10), total }); await demoWait(120); }
  }
  xxmiFound = true;
  for (const g of want) {
    const code = g.importer;
    Object.assign(g, loaders.get(g.id) ?? { importerDir: `${ROOT}\\${code}`, modsDir: `${ROOT}\\${code}\\Mods`, viaXxmi: true, importerVersion: "1.0.0", importerLatest: "1.0.0" });
    loaders.delete(g.id);
  }
  return gamesNow();
}

function xxmiStatus(): XxmiStatus {
  if (!xxmiFound) return { found: false, root: null, exe: null, config: null, version: null, latest: null, running: false, importers: [] };
  return {
    found: true, root: ROOT, exe: `${ROOT}\\Resources\\Bin\\XXMI Launcher.exe`, config: `${ROOT}\\XXMI Launcher Config.json`,
    version: "2.4.1", latest: "2.5.0", running: false,
    importers: demoDb.games.filter((g) => g.xxmi).map((g) => ({
      code: g.importer, game: g.id, enabled: g.viaXxmi, deployedVersion: g.importerVersion, latestVersion: g.importerLatest,
      gameFolder: g.gameDir, importerDir: g.viaXxmi ? `${ROOT}\\${g.importer}` : null,
    })),
  };
}

const EXTRAS: Record<string, Record<string, unknown>> = {
  gi: { configure_game: true, unlock_fps: true, unlock_fps_value: 120, enable_hdr: false },
  hsr: { unlock_fps: false },
  zzz: { configure_game: true },
  ww: { configure_game: true, unlock_fps: false, disable_wounded_fx: true, force_max_lod_bias: false, resource_tier: "HD", mesh_lod_distance_lod_base_fov: 165 },
  hi3: { unlock_fps: false, unlock_fps_value: 120, enable_hdr: false },
};

const configs = new Map<string, LaunchConfig>();

function launchConfig(game: string): LaunchConfig {
  const saved = configs.get(game);
  if (saved) return saved;
  const g = demoDb.games.find((x) => x.id === game);
  const viaXxmi = !!g?.viaXxmi;
  const signed = "XXMI Launcher signs this command. Set it in XXMI Launcher";
  const c: LaunchConfig = {
    via: viaXxmi ? "xxmi" : "direct",
    args: game === "ww" ? "-SkipSplash" : "",
    processPriority: viaXxmi ? "NORMAL" : "",
    windowMode: viaXxmi ? "BORDERLESS" : "",
    preLaunch: { enabled: false, command: "", wait: true },
    postLoad: { enabled: false, command: "", wait: true },
    customExe: null,
    extras: viaXxmi ? { ...(EXTRAS[game] ?? {}) } : {},
    migoto: { hunting: false, dumpShaders: false, muteWarnings: true, logLevel: viaXxmi ? "DISABLED" : "", callsLogging: false, debugLogging: false, enforceRendering: true },
    dll: viaXxmi ? { injectMode: game === "ww" ? "DIRECT" : "HOOK", injectLibraries: false, libraries: "", unsafeMode: false } : null,
    closeOnLaunch: false,
    locked: viaXxmi
      ? { preLaunch: signed, postLoad: signed, customExe: "Set a custom launch in XXMI Launcher", "migoto.callsLogging": "Your XXMI Launcher version doesn't have this option", "migoto.debugLogging": "Your XXMI Launcher version doesn't have this option",
        "dll.unsafeMode": "XXMI Launcher signs this setting. Turn it on in XXMI Launcher" }
      : { via: "XXMI Launcher doesn't manage this game here", processPriority: "Only XXMI Launcher can set this", windowMode: "Only XXMI Launcher can set this", postLoad: "Only XXMI Launcher can run this", "migoto.logLevel": "Use calls and debug logging instead" },
    xxmiAvailable: viaXxmi,
  };
  configs.set(game, c);
  return c;
}

const LOG = [
  "3DMigoto loaded, version 1.3.16 (XXMI build)",
  "  Loading config: d3dx.ini",
  "  [Include] include = Core\\ZZMI\\main.ini",
  "  [Include] include_recursive = Mods",
  "  Processing ini: Mods\\Ellen Joe\\Coca Cola\\Ellen.ini",
  "  Processing ini: Mods\\Miyabi\\Winter Kimono\\Miyabi.ini",
  "  Processing ini: Mods\\Jane Doe\\Detective Coat\\JaneDoe.ini",
  "WARNING: [TextureOverrideEllenHairIB] hash = 7d2a19c3 is overridden twice (Mods\\Ellen Joe\\Maid\\Ellen.ini)",
  "  Resource Mods\\Zhu Yuan\\Police\\ZhuYuanBody.dds: file not found",
  "Hooked IDXGISwapChain::Present",
  "Reloading config (F10)",
  "  Processing ini: Mods\\Ellen Joe\\Coca Cola\\Ellen.ini",
  "  Loaded 38 mods, 2 warnings",
];

let shaderCache = 412_337_152;
let frameDumps = 1_843_200_000;
const integrationsState: Integration[] = [
  { id: "scheme:gachamod", label: "1-click installs from GameBanana", supported: true, ours: true, owner: null },
  { id: "file:.gachamod", label: "Open .gachamod files", supported: true, ours: true, owner: null },
];

export function registerSystemDemo() {
  registerDemo({
    games_list: () => gamesNow(),
    // the demo has no exe to read: the UI falls back to its own badge
    game_icon: () => null,
    games_detect: async () => { await demoWait(900); return gamesNow(); },
    game_set_paths: ({ game, paths }) => {
      const p = paths as GamePaths;
      demoDb.games = demoDb.games.map((g) => g.id !== game ? g : {
        ...g, gameDir: p.gameDir ?? null, importerDir: p.importerDir ?? null,
        modsDir: p.modsDir ?? (p.importerDir ? `${p.importerDir}\\Mods` : null), installed: !!p.gameDir,
      });
      return gamesNow();
    },
    game_set_shown: ({ game, shown }) => { demoDb.games = demoDb.games.map((g) => (g.id === game ? { ...g, shown: !!shown } : g)); return gamesNow(); },
    game_running: ({ game }) => running.has(String(game)),
    // the demo's GIMI has XXMI's own d3d11.dll
    game_kick_check: ({ game, vanilla }) => {
      const said = game === "gi" && !!demoDb.settings.get("gi.kickFixDll");
      return { warn: game === "gi" && !vanilla && !said, undone: false, fixed: false, said };
    },
    game_kick_fix_done: ({ done }) => { demoDb.settings.set("gi.kickFixDll", done ? "demo" : ""); },
    game_launch: async ({ game }) => {
      const id = String(game);
      const g = demoDb.games.find((x) => x.id === id);
      if (!g?.gameDir && !g?.viaXxmi) throw { kind: "not_set_up", message: `${g?.name ?? "This game"}'s game folder isn't set. Pick it in Settings` };
      if (running.has(id)) throw { kind: "conflict", message: `${g.name} is already running` };
      await demoWait(400);
      setTimeout(() => { running.add(id); demoEmit("game-state", { game: id, running: true }); }, 2000);
      setTimeout(() => { running.delete(id); demoEmit("game-state", { game: id, running: false }); }, 95_000);
    },
    xxmi_status: () => xxmiStatus(),
    xxmi_install: ({ games }) => demoInstall((games as string[] | null) ?? null),
    xxmi_uninstall: async ({ games }) => {
      await demoWait(700);
      const ids = (games as string[] | null) ?? [];
      const kept: string[] = [];
      for (const g of demoDb.games.filter((x) => x.xxmi && x.viaXxmi && (!ids.length || ids.includes(x.id)))) {
        loaders.set(g.id, { importerDir: g.importerDir, modsDir: g.modsDir, viaXxmi: g.viaXxmi, importerVersion: g.importerVersion, importerLatest: g.importerLatest });
        if (g.modsDir) kept.push(g.modsDir);
        Object.assign(g, { importerDir: null, modsDir: null, viaXxmi: false, importerVersion: null, importerLatest: null });
      }
      if (!ids.length) xxmiFound = false;
      return { games: gamesNow(), kept };
    },
    xxmi_open: () => undefined,
    launch_config_get: ({ game }) => launchConfig(String(game)),
    launch_config_set: async ({ game, config }) => {
      await demoWait(150);
      const prev = launchConfig(String(game));
      const sent = config as LaunchConfig;
      // like launch.rs: the form never changes the signed settings
      const dll = prev.dll && sent.dll ? { ...sent.dll, libraries: prev.dll.libraries, unsafeMode: prev.dll.unsafeMode } : prev.dll;
      const next = { ...sent, dll, locked: prev.locked, xxmiAvailable: prev.xxmiAvailable };
      configs.set(String(game), next);
      return next;
    },
    launch_unsafe_off: async ({ game }) => {
      await demoWait(150);
      const prev = launchConfig(String(game));
      const next: LaunchConfig = { ...prev, dll: prev.dll && { ...prev.dll, unsafeMode: false },
        locked: { ...prev.locked, "dll.unsafeMode": "XXMI Launcher signs this setting. Turn it on in XXMI Launcher" } };
      configs.set(String(game), next);
      return next;
    },
    dev_status: ({ game }): DevStatus => {
      const dir = demoDb.games.find((g) => g.id === game)?.importerDir ?? `${ROOT}\\ZZMI`;
      return {
        log: { path: `${dir}\\d3d11_log.txt`, files: 1, bytes: 48_213 },
        shaderCache: { path: `${dir}\\ShaderCache`, files: shaderCache ? 1840 : 0, bytes: shaderCache },
        shaderFixes: { path: `${dir}\\ShaderFixes`, files: 12, bytes: 96_400 },
        frameDumps: { path: dir, files: frameDumps ? 3200 : 0, bytes: frameDumps },
        d3dxIni: `${dir}\\d3dx.ini`, d3dxUserIni: `${dir}\\d3dx_user.ini`,
      };
    },
    dev_log_tail: ({ lines }) => LOG.slice(-Number(lines || 400)).join("\n"),
    dev_clear_shader_cache: () => { const b = shaderCache; shaderCache = 0; return b; },
    dev_clear_frame_dumps: () => { const b = frameDumps; frameDumps = 0; return b; },
    dev_reload: ({ game }) => {
      if (!running.has(String(game))) throw { kind: "invalid", message: `${demoDb.games.find((g) => g.id === game)?.name ?? "The game"} isn't running` };
    },
    dev_wipe_user_config: () => undefined,
    app_data_dir: () => ROOT.replace("XXMI Launcher", "gachamod"),
    save_look: () => undefined,
    setup_available: () => true,
    setup_open: () => undefined,
    app_reset: () => undefined,
    app_relaunch: () => { location.reload(); },
    setup_game: () => null,
    integrations_get: () => integrationsState.map((i) => ({ ...i })),
    integration_set: ({ id, on }) => {
      const i = integrationsState.find((x) => x.id === id);
      if (i) { i.ours = !!on; i.owner = null; }
      return integrationsState.map((x) => ({ ...x }));
    },
    // settings file: the browser has no file dialogs, so these only answer if called directly
    settings_export: () => ({ games: demoDb.games.length, profiles: 2, settings: demoDb.settings.size }),
    settings_import_preview: (): ImportSummary => demoImport(""),
    settings_import: async (): Promise<ImportSummary> => { await demoWait(300); return demoImport("demo-backup.json"); },
    settings_import_undo: () => ({}),
    // updates: a pretend newer release so the About section has something to show
    app_update_check: async (): Promise<UpdateCheck> => { await demoWait(500); return demoUpdate(); },
    app_update_status: (): UpdateCheck => demoUpdate(),
    app_update_install: async () => {
      const total = 9_400_000;
      for (let done = 0; done <= total; done += total / 10) { demoEmit("app-update-progress", { done, total }); await demoWait(150); }
      throw { kind: "invalid", message: "The demo can't install updates. The app would close, update and open again now" };
    },
  });
}

function demoUpdate(): UpdateCheck {
  return {
    current: "0.1.0-demo", reachable: true, available: true, ready: false,
    release: { version: "0.2.0", name: "gachamod 0.2.0", url: "https://github.com/imanimal/gachamod/releases/tag/v0.2.0", notes: "Settings export and import. Update check.", publishedAt: null },
  };
}

function demoImport(backup: string): ImportSummary {
  return {
    appVersion: "0.1.0", exportedAt: Math.floor(Date.now() / 1000) - 86_400, settings: 4, games: ["Zenless Zone Zero"],
    newProfiles: ["Summer (ZZZ)"], replacedProfiles: ["Default (ZZZ)"], skippedPaths: ["Genshin Impact game folder: D:\\Games\\Genshin Impact Game"],
    missingMods: 2, missingNames: ["Ellen Maid", "Neon Burnice"], ui: {}, backup,
  };
}
