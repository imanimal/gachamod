// Tools, one page at a time like Settings (settings/Paged.tsx): problems and fixes after a game update, conflicts and
// key clashes, launch options, switching skins in game, sharing or moving mods, and the mod maker tools (3DMigoto
// switches, files and logs, finding a hash). Owner: SETTINGS/AI area; MODTOOLS, FIXES and INGAME own their panels.
// Launch fields save on change (400 ms after the last one) with a small "Saved". Every page and panel is a route:
// go({ view: "tools", section: "launch" }) or section: "fixes".
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Confirm, PageHeader, Panel, Segmented, Select, TextField, Toggle, formatBytes, plural, Waiting } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { placeFor } from "../../lib/places";
import { saved } from "../../ui/motion";
import { dev, errorKind, errorText, launchConfig, shell, type DevStatus, type GameId, type GameState, type Hook, type LaunchConfig, type MigotoConfig } from "../../lib/api";
import { allGames, currentGame, emitApp, go, useGame } from "../../lib/store";
import { registerCommands } from "../../lib/search";
import { FixesPanel } from "./FixesPanel";
import { InGamePanel } from "../ingame/InGamePanel";
import { openXxmi } from "../settings/parts";
import { Paged, type PageInfo } from "../settings/Paged";
import { ConflictsPanel, HashLookupPanel, ImmPanel, KeyClashesPanel, PacksPanel, ProblemsPanel } from "../modtools/ToolsPanels";
import "./tools.css";

type ExtraInfo = { label: string; hint?: string };
/** Plain labels for XXMI's game switches, in the order they show. Anything else shows under "Other" with its raw key. */
const EXTRA_LABELS: Record<string, ExtraInfo> = {
  configure_game: { label: "Set in-game graphics for mods", hint: "XXMI sets the graphics options mods need before each start" },
  disable_wounded_fx: { label: "Turn off wounded effect", hint: "Most mods' textures break after a few hits while it's on" },
  force_max_lod_bias: { label: "LOD bias on Ultra High", hint: "Mod textures are made for this setting" },
  mesh_lod_distance_lod_base_fov: { label: "Mesh LOD base FOV", hint: "Higher keeps the full character model, the one mods replace, at farther camera distances. 165 by default" },
  resource_tier: { label: "Client resource quality", hint: "Pick a tier you have installed. A missing one crashes the game while loading" },
  unlock_fps: { label: "Raise FPS limit", hint: "Sets the game's frame rate limit to the value below before each start" },
  unlock_fps_value: { label: "FPS limit", hint: "120, 180 or 240 cause the fewest glitches" },
  enable_hdr: { label: "HDR", hint: "Needs an HDR display with HDR on in Windows" },
};
/** Where XXMI does something different for one game. */
const GAME_LABELS: Record<string, Record<string, ExtraInfo>> = {
  gi: {
    configure_game: { label: "Turn off dynamic character resolution", hint: "XXMI turns it off before each start. Mods break with it on" },
    unlock_fps: { label: "Raise FPS limit", hint: "Starts the game through an FPS unlocker that stays open in the background" },
  },
  ww: {
    configure_game: { label: "Set in-game graphics for mods", hint: "Before each start, sets graphics quality to Quality and turns off ray tracing. The options below need this on" },
    unlock_fps: { label: "Force 120 FPS", hint: "Allows 120 FPS on PCs the game doesn't offer it on. Turning this off doesn't change it back" },
  },
  zzz: {
    configure_game: { label: "Set in-game graphics for mods", hint: "Before each start, sets character quality to High and turns off high-precision character animation. Mods break with other settings" },
  },
  hsr: {
    unlock_fps: { label: "Force 120 FPS", hint: "Sets the game's FPS option to 120 before each start. Turning this off doesn't change it back" },
  },
};
/** Switches XXMI only applies while configure_game is on. */
const NEEDS_CONFIGURE = new Set(["disable_wounded_fx", "force_max_lod_bias", "mesh_lod_distance_lod_base_fov"]);
const extraInfo = (game: string, k: string): ExtraInfo => GAME_LABELS[game]?.[k] ?? EXTRA_LABELS[k] ?? { label: k };
const RESOURCE_TIERS = ["UHD", "HD", "SD"];
const PRIORITIES = ["LOW", "BELOW_NORMAL", "NORMAL", "ABOVE_NORMAL", "HIGH", "REALTIME"];
const PRIORITY_LABEL: Record<string, string> = { LOW: "Low", BELOW_NORMAL: "Below normal", NORMAL: "Normal", ABOVE_NORMAL: "Above normal", HIGH: "High", REALTIME: "Realtime" };
const WINDOW_MODES = [{ value: "WINDOWED", label: "Window" }, { value: "BORDERLESS", label: "Borderless" }, { value: "FULLSCREEN", label: "Full screen" }];
// XXMI's own levels (it has no ERROR)
const LOG_LEVELS = ["DISABLED", "WARNING", "INFO", "DEBUG"];
const LOG_LABEL: Record<string, string> = { DISABLED: "Off", WARNING: "Warnings", INFO: "Info", DEBUG: "Debug" };

// Tools sections in the global search
registerCommands("tools", () => {
  const g = currentGame();
  if (!g) return [];
  return [
    { id: "tools:fixes", title: "Fix mods after a game update", section: "Pages", icon: "wand", where: "Tools › Problems and fixes", keywords: "fixer fixes broken mods hash game update patch repair",
      run: () => go({ view: "tools", section: "fixes" }) },
    { id: "tools:ingame", title: "In-game menu", section: "Pages", icon: "gamepad", where: "Tools › Switch skins in game", keywords: "in game overlay switch mods without reload f10 toggle menu",
      run: () => go({ view: "tools", section: "ingame" }) },
    { id: "tools:migoto", title: "Mod maker switches", section: "Pages", icon: "code", where: "Tools › Mod makers", keywords: "hunting mode dump shaders log 3dmigoto debug warnings",
      run: () => go({ view: "tools", section: "migoto" }) },
    { id: "tools:dev", title: "Shader cache and logs", section: "Pages", icon: "bug", where: "Tools › Mod makers", keywords: "shader cache clear frame dumps log d3dx ini d3dx_user wipe reload",
      run: () => go({ view: "tools", section: "dev" }) },
    ...(g.modCount > 0 ? [{ id: "tools:share", title: `Share ${g.short} library`, section: "Actions", icon: "share" as const, hint: ".gachamod", where: "Tools › Share and move",
      keywords: "export share send friend backup gachamod pack links library mods profiles", run: () => emitApp({ type: "export-pack", game: g.id, scope: "game" }) }] : []),
    ...(allGames().filter((x) => x.modsDir && x.modCount > 0).length > 1 ? [{ id: "tools:share-all", title: "Share every game", section: "Actions", icon: "share" as const,
      hint: ".gachamod", where: "Tools › Share and move", keywords: "export share send friend backup gachamod pack links all games library", run: () => emitApp({ type: "export-pack", game: g.id, scope: "all" }) }] : []),
  ];
});

/** A lock message from the backend, with a button to open XXMI Launcher when the setting lives there. */
function lockNote(msg: string | undefined): ReactNode | undefined {
  if (!msg) return undefined;
  if (!/in XXMI Launcher|Only XXMI Launcher/.test(msg)) return msg;
  return <span className="tools-lock">{msg}. <button type="button" className="tools-xxmi" onClick={openXxmi} title="Open XXMI Launcher to change it there">Open XXMI Launcher</button></span>;
}

/** Tools' pages in order. A page holds the panels that belong together. */
const PAGES: PageInfo[] = [
  { id: "problems", label: "Problems and fixes", icon: "warn", tip: "What stops a mod from showing right in game, and the fixers for mods a game update broke" },
  { id: "conflicts", label: "Conflicts", icon: "layers", tip: "Mods that are on and change the same parts of a model, or use the same keys" },
  { id: "launch", label: "Launch", icon: "play", tip: "How the game starts: arguments, window, commands before and after" },
  { id: "ingame", label: "Switch skins in game", icon: "swap" },
  { id: "packs", label: "Share and move", icon: "package", tip: "Share mods and profiles as a .gachamod file, or move mods out of Integrated Mod Manager" },
  { id: "migoto", label: "Mod makers", icon: "code", tip: "3DMigoto's hunting mode and logging, the shader cache and logs, and looking up a hash" },
];
/** The page each of the other panels is on, for a route to one that isn't shown. */
const PANEL_PAGE: Record<string, string> = { fixes: "problems", "key-clashes": "conflicts", imm: "packs", dev: "migoto", hash: "migoto" };
const pageOf = (id: string): string | undefined => PANEL_PAGE[id];

export function Tools() {
  const game = useGame();
  if (!game) return null;
  return <ToolsPages game={game} />;
}

function ToolsPages({ game }: { game: GameState }) {
  const launch = useLaunch(game.id);
  return (
    <div className="page tools pg-screen">
      <PageHeader title="Tools" icon="tools" sub={`Mod fixes, launch options and mod maker tools for ${game.name}`} />
      <Paged name="tools" label="Tools pages" pages={PAGES} fallback={pageOf}>
        {{
          problems: <><ProblemsPanel /><FixesPanel game={game.id} /></>,
          conflicts: <><ConflictsPanel /><KeyClashesPanel /></>,
          launch: <LaunchPanel game={game} l={launch} />,
          ingame: <InGamePanel game={game.id} />,
          packs: <><PacksPanel /><ImmPanel /></>,
          migoto: <><MigotoPanel l={launch} /><DevSection game={game} /><HashLookupPanel /></>,
        }}
      </Paged>
    </div>
  );
}

// ── launch and migoto: one config, saved together, shown on two pages (Launch, Mod makers) ──

type Launch = ReturnType<typeof useLaunch>;

function useLaunch(game: GameId) {
  const [cfg, setCfg] = useState<LaunchConfig | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const timer = useRef(0);
  const edits = useRef(0);
  const latest = useRef<LaunchConfig | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; window.clearTimeout(timer.current); }; }, []);

  useEffect(() => {
    let on = true;
    launchConfig.get(game).then((c) => { if (on) { setCfg(c); latest.current = c; } }).catch((e) => { if (on) setLoadError(errorText(e)); });
    return () => { on = false; };
  }, [game]);

  const save = useCallback(async () => {
    const c = latest.current;
    if (!c) return;
    const at = edits.current;
    try {
      const back = await launchConfig.set(game, c);
      if (!live.current) return;
      setBlocked(null);
      // a newer edit is on its way; don't overwrite it with this answer
      if (at === edits.current) { setCfg(back); latest.current = back; }
      setSavedAt(Date.now());
    } catch (e) {
      if (!live.current) return;
      if (errorKind(e) === "conflict") setBlocked(errorText(e)); else toast(errorText(e), true);
    }
  }, [game]);

  const update = useCallback((patch: Partial<LaunchConfig>) => {
    setCfg((c) => {
      if (!c) return c;
      const n = { ...c, ...patch };
      latest.current = n;
      return n;
    });
    edits.current++;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 400);
  }, [save]);

  return { cfg, blocked, loadError, savedAt, save, update };
}

/** A small "Saved" that shows for a moment after each save. */
function SavedTag({ at }: { at: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!at || !el) return;
    saved(el);
    el.classList.add("show");
    const t = window.setTimeout(() => el.classList.remove("show"), 1600);
    return () => window.clearTimeout(t);
  }, [at]);
  return <span ref={ref} className="tools-saved" aria-live="polite">Saved</span>;
}

/** The backend refused a save because something else holds the file: say so, with a way to try again. */
function Blocked({ l }: { l: Launch }) {
  if (!l.blocked) return null;
  const place = placeFor(l.blocked);
  return (
    <div className="tools-blocked" role="alert">
      <span>{l.blocked}</span>
      {place && <Button size="sm" variant="ghost" onClick={() => void place.run()}>{place.label}</Button>}
      <Button size="sm" onClick={() => void l.save()}>Try again</Button>
    </div>
  );
}

/** Why a panel couldn't load, with a button to the setting it names. */
function LoadError({ text }: { text: string }) {
  const place = placeFor(text);
  return (
    <p className="hint row">
      <span>{text}</span>
      {place && <Button size="sm" onClick={() => void place.run()}>{place.label}</Button>}
    </p>
  );
}

function LaunchPanel({ game, l }: { game: GameState; l: Launch }) {
  const { cfg, update } = l;
  if (l.loadError) return <Panel title="Launch" icon="play" id="launch"><LoadError text={l.loadError} /></Panel>;
  if (!cfg) return <Panel title="Launch" icon="play" id="launch"><Waiting what="Reading launch options" /></Panel>;

  const lock = (k: string) => lockNote(cfg.locked[k]);
  const known = Object.keys(EXTRA_LABELS).filter((k) => k in cfg.extras).map((k) => [k, cfg.extras[k]] as const);
  const other = Object.entries(cfg.extras).filter(([k]) => !EXTRA_LABELS[k]);
  const configureOff = cfg.extras.configure_game === false;
  const extraLock = (k: string) => configureOff && NEEDS_CONFIGURE.has(k) ? `Turn on "${extraInfo(game.id, "configure_game").label}" first` : undefined;
  const viaXxmi = cfg.via === "xxmi";

  return (
    <Panel title="Launch" icon="play" id="launch" actions={<SavedTag at={l.savedAt} />}>
      <Blocked l={l} />
      <div className="tools-grid">
        {game.xxmi && <Field label="Start with" hint={lock("via") ?? (viaXxmi ? "XXMI Launcher loads the mods and applies these settings" : "gachamod starts the game's exe. Mods need another loader")}>
          <Segmented value={cfg.via} onChange={(v) => update({ via: v })} label="Start with"
            options={[{ value: "xxmi", label: "XXMI" }, { value: "direct", label: "Game exe" }]} />
        </Field>}
        <TextField label="Arguments" mono value={cfg.args} placeholder="-popupwindow -screen-width 1920" onChange={(v) => update({ args: v })}
          hint="Added to the game's command line" />
        {cfg.via === "direct" && (
          <TextField label="Different exe" mono value={cfg.customExe ?? ""} placeholder="Leave empty for the game's own exe"
            onChange={(v) => update({ customExe: v || null })} disabled={!!lock("customExe")} hint={lock("customExe")} />
        )}
        <Select label="Priority" value={cfg.processPriority || "NORMAL"} onChange={(v) => update({ processPriority: v })}
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] ?? p }))} hint={lock("processPriority") ?? "Which programs Windows runs first when the CPU is busy. It doesn't raise FPS. Normal is best: High and Realtime can make sound, input and other apps stutter"} />
        <Select label="Window" value={cfg.windowMode || "BORDERLESS"} onChange={(v) => update({ windowMode: v })}
          options={WINDOW_MODES} hint={lock("windowMode")} />
      </div>
      <div className="tools-hooks">
        <HookField title="Before the game starts" hook={cfg.preLaunch} locked={lock("preLaunch")} onChange={(h) => update({ preLaunch: h })} />
        <HookField title="After mods load" hook={cfg.postLoad} locked={lock("postLoad")} onChange={(h) => update({ postLoad: h })} />
      </div>
      {known.length > 0 && (
        <div className="tools-extras">
          <h3 className="sub-h">{game.short} options</h3>
          {known.map(([k, v]) => <Extra key={k} k={k} v={v} info={extraInfo(game.id, k)} locked={extraLock(k)} onChange={(nv) => update({ extras: { ...cfg.extras, [k]: nv } })} />)}
        </div>
      )}
      {other.length > 0 && (
        <details className="tools-other">
          <summary>Other</summary>
          {other.map(([k, v]) => <Extra key={k} k={k} v={v} info={{ label: k }} onChange={(nv) => update({ extras: { ...cfg.extras, [k]: nv } })} />)}
        </details>
      )}
      <Toggle checked={cfg.closeOnLaunch} onChange={(v) => update({ closeOnLaunch: v })} label="Close gachamod when the game starts"
        hint="Automatic reloads stop while gachamod is closed" />
    </Panel>
  );
}

function MigotoPanel({ l }: { l: Launch }) {
  const { cfg, update } = l;
  if (l.loadError) return <Panel title="Mod maker switches" icon="code" id="migoto"><LoadError text={l.loadError} /></Panel>;
  if (!cfg) return <Panel title="Mod maker switches" icon="code" id="migoto"><Waiting what="Reading 3DMigoto's settings" /></Panel>;

  const lock = (k: string) => lockNote(cfg.locked[k]);
  const setMig = (patch: Partial<MigotoConfig>) => update({ migoto: { ...cfg.migoto, ...patch } });
  const migLock = (k: string) => lock("migoto") ?? lock(`migoto.${k}`);

  return (
    <Panel title="Mod maker switches" icon="code" id="migoto" actions={<SavedTag at={l.savedAt} />}>
      <Blocked l={l} />
      {lock("migoto") && <p className="hint">{lock("migoto")}</p>}
      <div className="tools-switches">
        <Toggle checked={cfg.migoto.hunting} disabled={!!migLock("hunting")} onChange={(v) => setMig({ hunting: v })} label="Hunting mode"
          hint={migLock("hunting") ?? "Numpad 0 turns it on in game, then numpad keys step through shaders and buffers to find hashes"} />
        <Toggle checked={cfg.migoto.dumpShaders} disabled={!!migLock("dumpShaders")} onChange={(v) => setMig({ dumpShaders: v })} label="Dump shaders"
          hint={migLock("dumpShaders") ?? "Marking a shader in hunting mode also saves its code to ShaderFixes"} />
        <Toggle checked={cfg.migoto.muteWarnings} disabled={!!migLock("muteWarnings")} onChange={(v) => setMig({ muteWarnings: v })} label="Hide warnings"
          hint={migLock("muteWarnings") ?? "No mod error text or beeps in game"} />
        {cfg.xxmiAvailable && <Toggle checked={cfg.migoto.enforceRendering} disabled={!!migLock("enforceRendering")} onChange={(v) => setMig({ enforceRendering: v })} label="Enforce rendering"
          hint={migLock("enforceRendering") ?? "Writes the [Rendering] values mods need into d3dx.ini before each start. Turn off to edit them by hand"} />}
        <Toggle checked={cfg.migoto.callsLogging} disabled={!!migLock("callsLogging")} onChange={(v) => setMig({ callsLogging: v })} label="Log calls"
          hint={migLock("callsLogging") ?? "Writes every DirectX call to d3d11_log.txt. Slow, for debugging"} />
        <Toggle checked={cfg.migoto.debugLogging} disabled={!!migLock("debugLogging")} onChange={(v) => setMig({ debugLogging: v })} label="Debug logging"
          hint={migLock("debugLogging") ?? "More detail in d3d11_log.txt"} />
      </div>
      {!migLock("logLevel") && (
        <div className="tools-loglevel">
          <Select label="Log" value={cfg.migoto.logLevel || "DISABLED"} onChange={(v) => setMig({ logLevel: v })}
            options={LOG_LEVELS.map((lv) => ({ value: lv, label: LOG_LABEL[lv] ?? lv }))} hint="What goes in d3d11_log.txt. Warnings logs mod errors, Info adds DirectX calls, Debug adds much more" />
        </div>
      )}
    </Panel>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="field"><span className="field-l">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</div>;
}

function HookField({ title, hook, locked, onChange }: { title: string; hook: Hook; locked?: ReactNode; onChange: (h: Hook) => void }) {
  return (
    <div className="tools-hook">
      <Toggle checked={hook.enabled} disabled={!!locked} onChange={(v) => onChange({ ...hook, enabled: v })} label={`Run a command ${title.toLowerCase()}`} hint={locked} />
      {hook.enabled && (
        <>
          <TextField mono value={hook.command} disabled={!!locked} placeholder='"C:\Tools\ReShade launcher.exe"' onChange={(v) => onChange({ ...hook, command: v })} />
          <Toggle size="sm" checked={hook.wait} disabled={!!locked} onChange={(v) => onChange({ ...hook, wait: v })} label="Wait for it to finish" />
        </>
      )}
    </div>
  );
}

function Extra({ k, v, info, locked, onChange }: { k: string; v: unknown; info: ExtraInfo; locked?: string; onChange: (v: unknown) => void }) {
  if (typeof v === "boolean") return <Toggle checked={v} disabled={!!locked} onChange={onChange} label={info.label} hint={locked ?? info.hint} />;
  if (k === "resource_tier" && typeof v === "string") {
    const opts = RESOURCE_TIERS.includes(v) ? RESOURCE_TIERS : [v, ...RESOURCE_TIERS];
    return <Select label={info.label} value={v} onChange={onChange} options={opts.map((o) => ({ value: o, label: o }))} hint={info.hint} />;
  }
  if (typeof v === "number") {
    return <TextField label={info.label} type="number" value={String(v)} disabled={!!locked} hint={locked ?? info.hint}
      onChange={(s) => { const n = Number(s); if (s.trim() !== "" && Number.isFinite(n)) onChange(Number.isInteger(v) ? Math.round(n) : n); }} />;
  }
  return <TextField label={info.label} mono value={typeof v === "string" ? v : JSON.stringify(v)} hint={info.hint}
    onChange={(s) => onChange(typeof v === "string" ? s : (() => { try { return JSON.parse(s); } catch { return v; } })())} />;
}

// ── dev ──

function DevSection({ game }: { game: GameState }) {
  const [st, setSt] = useState<DevStatus | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [wipe, setWipe] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const load = useCallback(() => {
    dev.status(game.id).then((s) => { if (live.current) setSt(s); }).catch(() => { if (live.current) setSt(null); });
  }, [game.id]);
  const loadLog = useCallback(() => {
    dev.logTail(game.id, 400).then((t) => { if (live.current) setLog(t); }).catch((e) => toast(errorText(e), true));
  }, [game.id]);
  useEffect(() => { load(); loadLog(); }, [load, loadLog]);

  const run = async (key: string, job: () => Promise<unknown>) => {
    setBusy(key);
    try { await job(); } catch (e) { toast(errorText(e), true); } finally { if (live.current) setBusy(null); load(); }
  };
  const open = (p: string | null | undefined) => { if (p) shell.openPath(p).catch((e) => toast(errorText(e), true)); };
  const noImporter = !game.importerDir && !game.modsDir;

  return (
    <Panel title="Files and logs" icon="bug" id="dev">
      {noImporter
        ? <p className="hint">Set {game.name}'s mod loader folder first. <Button size="sm" variant="ghost" icon="folder" onClick={() => go({ view: "settings", section: "games" })}>Game folders</Button></p>
        : <>
          <div className="toolbar tools-open">
            <Button icon="folder" onClick={() => open(game.importerDir)} disabled={!game.importerDir} title="Open the folder with d3dx.ini and Mods">Loader folder</Button>
            <Button icon="file" onClick={() => open(st?.d3dxIni)} disabled={!st?.d3dxIni} title="3DMigoto's main settings">d3dx.ini</Button>
            <Button icon="file" onClick={() => open(st?.d3dxUserIni)} disabled={!st?.d3dxUserIni} title="Saved mod options">d3dx_user.ini</Button>
            <Button icon="folder" onClick={() => open(st?.shaderFixes.path)} disabled={!st?.shaderFixes.files} title={st?.shaderFixes.files ? "Open the ShaderFixes folder" : "No ShaderFixes folder yet"}>ShaderFixes</Button>
          </div>
          <div className="tools-dev">
            <div className="tools-dev-row">
              <span><b>Reload mods in game</b><span className="hint">Brings {game.short} to the front and presses F10</span></span>
              <Button icon="refresh" busy={busy === "reload"} disabled={!game.running} title={game.running ? "Press F10 in the game" : `${game.name} isn't running`}
                onClick={() => void run("reload", async () => { await dev.reload(game.id); toast("Reloaded mods in game"); })}>Reload</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>Shader cache</b><span className="hint">{st ? `${formatBytes(st.shaderCache.bytes)}, ${plural(st.shaderCache.files, "file")}. It rebuilds on the next start` : "…"}</span></span>
              <Button icon="trash" busy={busy === "cache"} disabled={!st?.shaderCache.bytes} title="Delete the shader cache. The game rebuilds it on the next start"
                onClick={() => void run("cache", async () => { const b = await dev.clearShaderCache(game.id); toast(`Freed ${formatBytes(b)}`); })}>Clear</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>Frame dumps</b><span className="hint">{st ? `${formatBytes(st.frameDumps.bytes)} in FrameAnalysis folders` : "…"}</span></span>
              <Button icon="trash" busy={busy === "dumps"} disabled={!st?.frameDumps.bytes} title="Delete the FrameAnalysis folders"
                onClick={() => void run("dumps", async () => { const b = await dev.clearFrameDumps(game.id); toast(`Freed ${formatBytes(b)}`); })}>Delete</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>Saved mod options</b><span className="hint">Every mod goes back to its first look. A copy of d3dx_user.ini is kept</span></span>
              <Button variant="danger" icon="trash" disabled={!st?.d3dxUserIni || game.running} title={game.running ? "Close the game first" : "Reset every mod's options. A copy of d3dx_user.ini is kept"}
                onClick={() => setWipe(true)}>Wipe</Button>
            </div>
          </div>
          <div className="tools-log">
            <div className="row"><b className="grow">3DMigoto log</b>{st?.log.bytes ? <Badge>{formatBytes(st.log.bytes)}</Badge> : null}
              <Button size="sm" variant="ghost" icon="refresh" onClick={loadLog} title="Read the log again">Refresh</Button>
              <Button size="sm" variant="ghost" icon="external" disabled={!st?.log.bytes} onClick={() => open(st?.log.path)} title="Open the log file">Open</Button>
            </div>
            <pre className="tools-log-text selectable">{log === null ? "…" : log || "No log yet. Turn on a log level in Mod maker switches, then start the game."}</pre>
          </div>
        </>}
      {wipe && (
        <Confirm title="Wipe saved mod options?" yes="Wipe" danger onClose={() => setWipe(false)}
          onYes={async () => { try { await dev.wipeUserConfig(game.id); toast("Mod options are back to their defaults"); load(); } catch (e) { toast(errorText(e), true); } }}>
          Every mod's chosen options (outfits, colours, toggles) go back to their first value. gachamod keeps a copy of the old file as d3dx_user.ini.wiped.bak.
        </Confirm>
      )}
    </Panel>
  );
}
