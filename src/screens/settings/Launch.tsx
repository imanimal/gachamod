// Settings › Launch options: how each game starts (XXMI or its exe, arguments, window, priority, commands before and
// after, XXMI's own switches for the game) and 3DMigoto's switches for mod makers. Both panels show one config per game
// (launch.rs), read when the page opens and again when the window gets focus, saved 400 ms after the last change with a
// small "Saved". They show the game picked in the sidebar until another is picked here. Tools › Mod makers shows a copy
// of the switches (MigotoSection); every copy hears the others' saves, so they agree. Routes: go({ view: "settings",
// section: "launch" }) or section: "migoto", and go({ view: "tools", section: "migoto" }). Owner: SETTINGS/AI area.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Panel, Segmented, Select, TextField, Toggle, Waiting } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { placeFor } from "../../lib/places";
import { saved } from "../../ui/motion";
import { errorKind, errorText, launchConfig, type GameId, type GameState, type Hook, type LaunchConfig, type MigotoConfig } from "../../lib/api";
import { currentGame, go, useGame, useGames } from "../../lib/store";
import { registerCommands, type Command } from "../../lib/search";
import { GI_KICK_GUIDE, openKickGuide, setKickFixDone, useKick } from "../../lib/kickFix";
import { XxmiDll, lockNote } from "../tools/XxmiDll";
import { KickSteps } from "../tools/KickSteps";
import { t } from "../../lib/i18n";
import { gameName, gameShort } from "../../lib/games";
import "../tools/tools.css";

/** `max`: the highest number the field takes (launch.rs caps the same value when it saves and before a start). */
type ExtraInfo = { label: string; hint?: string; max?: number };
/** Plain labels for XXMI's game switches, in the order they show. Anything else shows under "Other" with its raw key. */
const EXTRA_LABELS: Record<string, ExtraInfo> = {
  configure_game: { label: t("Set in-game graphics for mods"), hint: t("XXMI sets the graphics options mods need before each start") },
  disable_wounded_fx: { label: t("Turn off wounded effect"), hint: t("Most mods' textures break after a few hits while it's on") },
  force_max_lod_bias: { label: t("LOD bias on Ultra High"), hint: t("Mod textures are made for this setting") },
  mesh_lod_distance_lod_base_fov: { label: t("Mesh LOD base FOV"), hint: t("Higher keeps the full character model, the one mods replace, at farther camera distances. 165 by default") },
  resource_tier: { label: t("Client resource quality"), hint: t("Pick a tier you have installed. A missing one crashes the game while loading") },
  unlock_fps: { label: t("Raise FPS limit"), hint: t("Sets the game's frame rate limit to the value below before each start") },
  unlock_fps_value: { label: t("FPS limit"), hint: t("120, 180 or 240 cause the fewest glitches") },
  enable_hdr: { label: t("HDR"), hint: t("Needs an HDR display with HDR on in Windows") },
};
/** Where XXMI does something different for one game. */
const GAME_LABELS: Record<string, Record<string, ExtraInfo>> = {
  gi: {
    configure_game: { label: t("Turn off dynamic character resolution"), hint: t("XXMI turns it off before each start. Mods break with it on") },
    unlock_fps: { label: t("Raise FPS limit"), hint: t("Starts the game through an FPS unlocker that stays open in the background") },
    unlock_fps_value: { label: t("FPS limit"), max: 120,
      hint: t("120 at most. Above 120 Genshin Impact stops the game with \"Illegal tool detected\" (10612-4001), so gachamod sets a higher limit back to 120 before each start") },
  },
  ww: {
    configure_game: { label: t("Set in-game graphics for mods"), hint: t("Before each start, sets graphics quality to Quality and turns off ray tracing. The options below need this on") },
    unlock_fps: { label: t("Force 120 FPS"), hint: t("Allows 120 FPS on PCs the game doesn't offer it on. Turning this off doesn't change it back") },
  },
  zzz: {
    configure_game: { label: t("Set in-game graphics for mods"), hint: t("Before each start, sets character quality to High and turns off high-precision character animation. Mods break with other settings") },
  },
  hsr: {
    unlock_fps: { label: t("Force 120 FPS"), hint: t("Sets the game's FPS option to 120 before each start. Turning this off doesn't change it back") },
  },
};
/** Switches XXMI only applies while configure_game is on. */
const NEEDS_CONFIGURE = new Set(["disable_wounded_fx", "force_max_lod_bias", "mesh_lod_distance_lod_base_fov"]);
const extraInfo = (game: string, k: string): ExtraInfo => GAME_LABELS[game]?.[k] ?? EXTRA_LABELS[k] ?? { label: k };
const RESOURCE_TIERS = ["UHD", "HD", "SD"];
const PRIORITIES = ["LOW", "BELOW_NORMAL", "NORMAL", "ABOVE_NORMAL", "HIGH", "REALTIME"];
const PRIORITY_LABEL: Record<string, string> = { LOW: t("Low"), BELOW_NORMAL: t("Below normal"), NORMAL: t("Normal"), ABOVE_NORMAL: t("Above normal"), HIGH: t("High"), REALTIME: t("Realtime") };
const WINDOW_MODES = [{ value: "WINDOWED", label: t("Window") }, { value: "BORDERLESS", label: t("Borderless") }, { value: "FULLSCREEN", label: t("Full screen") }];
// XXMI's own levels (it has no ERROR)
const LOG_LEVELS = ["DISABLED", "WARNING", "INFO", "DEBUG"];
const LOG_LABEL: Record<string, string> = { DISABLED: t("Off"), WARNING: t("Warnings"), INFO: t("Info"), DEBUG: t("Debug") };

const WHERE = t("Settings › Launch options");

// what only some games have, in the global search (the panels themselves are in settingsSearch.ts)
registerCommands("settings.launch", () => {
  const g = currentGame();
  if (!g) return [];
  const list: Command[] = [];
  if (g.id === "gi") list.push({ id: "launch:gi-kick", title: t("Illegal tool detected"), section: "Pages", icon: "warn", where: WHERE,
    keywords: "genshin kicked anti cheat 10612 4001 10310 disconnect banned d3d11 gimi", run: () => go({ view: "settings", section: "launch" }) });
  if (g.viaXxmi) list.push({ id: "launch:xxmi-dll", title: t("How XXMI loads mods"), section: "Pages", icon: "play", where: WHERE,
    keywords: "unsafe mode injection inject mode hook direct skip inject libraries extra dll reshade d3d11", run: () => go({ view: "settings", section: "launch" }) });
  return list;
});

/** Both panels for one game, with a game picker when more than one shows in the sidebar. */
export function LaunchSections() {
  const current = useGame();
  const list = useGames().filter((g) => g.shown || g.id === current?.id);
  const [pick, setPick] = useState<GameId | null>(null);
  // picking another game in the sidebar brings these back to it
  useEffect(() => { setPick(null); }, [current?.id]);
  const game = list.find((g) => g.id === pick) ?? current ?? list[0];
  if (!game) {
    return (
      <Panel title={t("Launch options")} icon="play" id="launch">
        <p className="hint row"><span>{t("Set up a game first.")}</span>
          <Button size="sm" icon="folder" onClick={() => go({ view: "settings", section: "games" })}>{t("Game folders")}</Button></p>
      </Panel>
    );
  }
  const picker = list.length > 1 && (
    <span>
      <Select title={t("Game whose options these are. It follows the game picked in the sidebar")} value={game.id} onChange={(v) => setPick(v)} options={list.map((g) => ({ value: g.id, label: gameName(g) }))} />
    </span>
  );
  // a fresh form per game, so one game's edit can't land on another
  return <GameLaunch key={game.id} game={game} picker={picker || null} />;
}

function GameLaunch({ game, picker }: { game: GameState; picker: ReactNode }) {
  const l = useLaunch(game.id);
  return <><LaunchPanel game={game} l={l} picker={picker} /><MigotoPanel l={l} picker={picker} /></>;
}

/** The mod maker switches by themselves, for Tools › Mod makers: the same panel and config, for one game. */
export function MigotoSection({ game }: { game: GameState }) {
  return <MigotoFor key={game.id} game={game.id} />;
}
function MigotoFor({ game }: { game: GameId }) {
  const l = useLaunch(game);
  return <MigotoPanel l={l} picker={null} inTools />;
}

/** A save, told to the other copies of the same game's config (Settings' Launch page and Tools' switches). */
const SAVED_EVENT = "gm-launch-saved";
type SavedDetail = { game: GameId; cfg: LaunchConfig; from: object };

// ── one config, saved together, shown in two panels ──

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
  const saveNow = useRef<() => Promise<void>>(async () => undefined);
  const self = useRef({});
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      // an edit still waiting out its 400 ms goes now instead of being lost with the page
      if (timer.current) { window.clearTimeout(timer.current); timer.current = 0; void saveNow.current(); }
    };
  }, []);

  // edits.current when the last save finished: anything newer hasn't reached the backend yet
  const settled = useRef(0);
  useEffect(() => {
    let on = true;
    const read = () => launchConfig.get(game).then((c) => {
      if (on && edits.current === settled.current) { setCfg(c); latest.current = c; }
    });
    read().catch((e) => { if (on) setLoadError(errorText(e)); });
    // read again on coming back to the window: XXMI Launcher may have changed its settings meanwhile, and a stale
    // form would write the old values back on the next edit
    const back = () => { void read().catch(() => undefined); };
    window.addEventListener("focus", back);
    // another copy saved: take its answer, unless an edit here is still on its way
    const heard = (e: Event) => {
      const d = (e as CustomEvent<SavedDetail>).detail;
      if (!on || d.game !== game || d.from === self.current || edits.current !== settled.current) return;
      setCfg(d.cfg); latest.current = d.cfg;
    };
    window.addEventListener(SAVED_EVENT, heard);
    return () => { on = false; window.removeEventListener("focus", back); window.removeEventListener(SAVED_EVENT, heard); };
  }, [game]);
  const tell = useCallback((cfg: LaunchConfig) => {
    window.dispatchEvent(new CustomEvent<SavedDetail>(SAVED_EVENT, { detail: { game, cfg, from: self.current } }));
  }, [game]);

  const save = useCallback(async () => {
    const c = latest.current;
    if (!c) return;
    const at = edits.current;
    try {
      const back = await launchConfig.set(game, c);
      // a failed save keeps this behind, so reading again on focus can't drop the edit "Try again" will send
      settled.current = Math.max(settled.current, at);
      tell(back);
      if (!live.current) return;
      setBlocked(null);
      // a newer edit is on its way; don't overwrite it with this answer
      if (at === edits.current) { setCfg(back); latest.current = back; }
      setSavedAt(Date.now());
    } catch (e) {
      // once the page is gone there's no form to show it in, so it's a toast
      if (live.current && errorKind(e) === "conflict") setBlocked(errorText(e)); else toast(errorText(e), true);
    }
  }, [game, tell]);
  saveNow.current = save;

  /** Unsafe Mode has its own command (launch.rs unsafe_off); only its part of the form changes. */
  const unsafeOff = useCallback(async () => {
    try {
      const back = await launchConfig.unsafeOff(game);
      if (!live.current) return;
      tell({ ...(latest.current ?? back), dll: back.dll, locked: back.locked });
      const n = (c: LaunchConfig | null) => (c ? { ...c, dll: back.dll, locked: back.locked } : back);
      latest.current = n(latest.current);
      setCfg(n);
      setSavedAt(Date.now());
    } catch (e) {
      toast(errorText(e), true);
    }
  }, [game, tell]);

  const update = useCallback((patch: Partial<LaunchConfig>) => {
    setCfg((c) => {
      if (!c) return c;
      const n = { ...c, ...patch };
      latest.current = n;
      return n;
    });
    edits.current++;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = 0; void save(); }, 400);
  }, [save]);

  return { cfg, blocked, loadError, savedAt, save, update, unsafeOff };
}

/** A small "Saved" that shows for a moment after each save. */
function SavedTag({ at }: { at: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!at || !el) return;
    saved(el);
    el.classList.add("show");
    const timer = window.setTimeout(() => el.classList.remove("show"), 1600);
    return () => window.clearTimeout(timer);
  }, [at]);
  return <span ref={ref} className="tools-saved" aria-live="polite">{t("Saved")}</span>;
}

/** The backend refused a save because something else holds the file: say so, with a way to try again. */
function Blocked({ l }: { l: Launch }) {
  if (!l.blocked) return null;
  const place = placeFor(l.blocked);
  return (
    <div className="tools-blocked" role="alert">
      <span>{l.blocked}</span>
      {place && <Button size="sm" variant="ghost" onClick={() => void place.run()}>{place.label}</Button>}
      <Button size="sm" onClick={() => void l.save()}>{t("Try again")}</Button>
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

function LaunchPanel({ game, l, picker }: { game: GameState; l: Launch; picker: ReactNode }) {
  const { cfg, update } = l;
  if (l.loadError) return <Panel title={t("Launch options")} icon="play" id="launch" actions={picker}><LoadError text={l.loadError} /></Panel>;
  if (!cfg) return <Panel title={t("Launch options")} icon="play" id="launch" actions={picker}><Waiting what={t("Reading launch options")} /></Panel>;

  const lock = (k: string) => lockNote(cfg.locked[k]);
  const known = Object.keys(EXTRA_LABELS).filter((k) => k in cfg.extras).map((k) => [k, cfg.extras[k]] as const);
  const other = Object.entries(cfg.extras).filter(([k]) => !EXTRA_LABELS[k]);
  const configureOff = cfg.extras.configure_game === false;
  const extraLock = (k: string) => configureOff && NEEDS_CONFIGURE.has(k) ? t("Turn on \"{option}\" first", { option: extraInfo(game.id, "configure_game").label }) : undefined;
  const viaXxmi = cfg.via === "xxmi";

  return (
    <Panel title={t("Launch options")} icon="play" id="launch" actions={<>{picker}<SavedTag at={l.savedAt} /></>}>
      <Blocked l={l} />
      <div className="tools-grid">
        {game.xxmi && <Field label={t("Start with")} hint={lock("via") ?? (viaXxmi ? t("XXMI Launcher loads the mods and applies these settings") : t("gachamod starts the game's exe. Mods need another loader"))}>
          <Segmented value={cfg.via} onChange={(v) => update({ via: v })} label={t("Start with")} disabled={!!cfg.locked.via}
            options={[{ value: "xxmi", label: "XXMI" }, { value: "direct", label: t("Game exe") }]} />
        </Field>}
        <TextField label={t("Arguments")} mono value={cfg.args} placeholder="-popupwindow -screen-width 1920" onChange={(v) => update({ args: v })}
          hint={t("Added to the game's command line")} />
        {cfg.via === "direct" && (
          <TextField label={t("Different exe")} mono value={cfg.customExe ?? ""} placeholder={t("Leave empty to use the game's exe")}
            onChange={(v) => update({ customExe: v || null })} disabled={!!lock("customExe")} hint={lock("customExe")} />
        )}
        <Select label={t("Priority")} value={cfg.processPriority || "NORMAL"} onChange={(v) => update({ processPriority: v })} disabled={!!cfg.locked.processPriority}
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] ?? p }))} hint={lock("processPriority") ?? t("Which programs Windows runs first when the CPU is busy. It doesn't raise FPS. Normal is best: High and Realtime can make sound, input and other apps stutter")} />
        <Select label={t("Window")} value={cfg.windowMode || "BORDERLESS"} onChange={(v) => update({ windowMode: v })}
          options={WINDOW_MODES} hint={lock("windowMode")} disabled={!!cfg.locked.windowMode} />
      </div>
      <div className="tools-hooks">
        <HookField label={t("Run a command before the game starts")} hook={cfg.preLaunch} locked={lock("preLaunch")} onChange={(h) => update({ preLaunch: h })} />
        <HookField label={t("Run a command after mods load")} hook={cfg.postLoad} locked={lock("postLoad")} onChange={(h) => update({ postLoad: h })} />
      </div>
      {known.length > 0 && (
        <div className="tools-extras">
          <h3 className="sub-h">{t("{game} options", { game: gameShort(game) })}</h3>
          {known.map(([k, v]) => <Extra key={k} k={k} v={v} info={extraInfo(game.id, k)} locked={extraLock(k)} onChange={(nv) => update({ extras: { ...cfg.extras, [k]: nv } })} />)}
        </div>
      )}
      {game.id === "gi" && (
        <KickFix name={gameName(game)}>
          {viaXxmi && cfg.dll && (
            <details className="tools-other">
              <summary>{t("Steps from the guide")}</summary>
              <KickSteps dll={cfg.dll} locked={cfg.locked} onChange={(d) => update({ dll: { ...cfg.dll!, ...d } })} />
            </details>
          )}
        </KickFix>
      )}
      {viaXxmi && cfg.dll && <XxmiDll dll={cfg.dll} locked={cfg.locked} onChange={(d) => update({ dll: { ...cfg.dll!, ...d } })} onUnsafeOff={() => void l.unsafeOff()} />}
      {other.length > 0 && (
        <details className="tools-other">
          <summary>{t("Other")}</summary>
          {other.map(([k, v]) => <Extra key={k} k={k} v={v} info={{ label: k }} onChange={(nv) => update({ extras: { ...cfg.extras, [k]: nv } })} />)}
        </details>
      )}
      <Toggle checked={cfg.closeOnLaunch} onChange={(v) => update({ closeOnLaunch: v })} label={t("Close gachamod when the game starts")}
        hint={t("Automatic reloads stop while gachamod is closed")} />
    </Panel>
  );
}

/** Genshin Impact's "Illegal tool detected" kick: the community guide, and the switch that stops the warning before
 *  each start (lib/kickFix.ts). gachamod only links the guide and reads the DLLs; it never changes them. */
function KickFix({ name, children }: { name: string; children?: ReactNode }) {
  const k = useKick();
  const on = !!k?.said && !k.undone;
  const hint = k?.undone ? t("XXMI has put its stock d3d11.dll back since, most likely in an update. Do the fix again, then turn this on")
    : k?.fixed && !on ? t("GIMI's d3d11.dll isn't XXMI's stock one, so the fix looks done and gachamod doesn't warn")
    : t("Until this is on, gachamod warns before each start with mods. It warns again if XXMI puts its stock d3d11.dll back");
  return (
    <div className="tools-kick">
      <p className="hint row">
        <span>{t("If {game} stops with \"Illegal tool detected\" even with the FPS limit at 120, the usual cause is its anti-cheat flagging XXMI's d3d11.dll. A GameBanana guide shows a way around it by hand. It goes against the game's terms and can get your account banned.", { game: name })}</span>
        <Button size="sm" variant="ghost" icon="external" title={t("Open {url} in your browser", { url: GI_KICK_GUIDE })} onClick={openKickGuide}>{t("Open the guide")}</Button>
      </p>
      {children}
      <Toggle checked={on} onChange={(v) => void setKickFixDone(v)} label={t("I did this fix")} hint={hint} />
    </div>
  );
}

/** 3DMigoto's switches for making mods: hunting mode, dumping shaders, warnings and logging. The shader cache, the log
 *  itself and looking up a hash are in Tools › Mod makers, next to its copy of this panel (`inTools`). */
function MigotoPanel({ l, picker, inTools }: { l: Launch; picker: ReactNode; inTools?: boolean }) {
  const { cfg, update } = l;
  if (l.loadError) return <Panel title={t("Mod maker switches")} icon="code" id="migoto" actions={picker}><LoadError text={l.loadError} /></Panel>;
  if (!cfg) return <Panel title={t("Mod maker switches")} icon="code" id="migoto" actions={picker}><Waiting what={t("Reading 3DMigoto's settings")} /></Panel>;

  const lock = (k: string) => lockNote(cfg.locked[k]);
  const setMig = (patch: Partial<MigotoConfig>) => update({ migoto: { ...cfg.migoto, ...patch } });
  const migLock = (k: string) => lock("migoto") ?? lock(`migoto.${k}`);

  return (
    <Panel title={t("Mod maker switches")} icon="code" id="migoto" actions={<>{picker}<SavedTag at={l.savedAt} /></>}>
      <Blocked l={l} />
      {lock("migoto") && <p className="hint">{lock("migoto")}</p>}
      <div className="tools-switches">
        <Toggle checked={cfg.migoto.hunting} disabled={!!migLock("hunting")} onChange={(v) => setMig({ hunting: v })} label={t("Hunting mode")}
          hint={migLock("hunting") ?? t("Numpad 0 turns it on in game, then numpad keys step through shaders and buffers to find hashes")} />
        <Toggle checked={cfg.migoto.dumpShaders} disabled={!!migLock("dumpShaders")} onChange={(v) => setMig({ dumpShaders: v })} label={t("Dump shaders")}
          hint={migLock("dumpShaders") ?? t("Marking a shader in hunting mode also saves its code to ShaderFixes")} />
        <Toggle checked={cfg.migoto.muteWarnings} disabled={!!migLock("muteWarnings")} onChange={(v) => setMig({ muteWarnings: v })} label={t("Hide warnings")}
          hint={migLock("muteWarnings") ?? t("No mod error text or beeps in game")} />
        {cfg.xxmiAvailable && <Toggle checked={cfg.migoto.enforceRendering} disabled={!!migLock("enforceRendering")} onChange={(v) => setMig({ enforceRendering: v })} label={t("Enforce rendering")}
          hint={migLock("enforceRendering") ?? t("Writes the [Rendering] values mods need into d3dx.ini before each start. Turn off to edit them by hand")} />}
        <Toggle checked={cfg.migoto.callsLogging} disabled={!!migLock("callsLogging")} onChange={(v) => setMig({ callsLogging: v })} label={t("Log calls")}
          hint={migLock("callsLogging") ?? t("Writes every DirectX call to d3d11_log.txt. Slow, for debugging")} />
        <Toggle checked={cfg.migoto.debugLogging} disabled={!!migLock("debugLogging")} onChange={(v) => setMig({ debugLogging: v })} label={t("Debug logging")}
          hint={migLock("debugLogging") ?? t("More detail in d3d11_log.txt")} />
      </div>
      {!migLock("logLevel") && (
        <div className="tools-loglevel">
          <Select label={t("Log")} value={cfg.migoto.logLevel || "DISABLED"} onChange={(v) => setMig({ logLevel: v })}
            options={LOG_LEVELS.map((lv) => ({ value: lv, label: LOG_LABEL[lv] ?? lv }))} hint={t("What goes in d3d11_log.txt. Warnings logs mod errors, Info adds DirectX calls, Debug adds much more")} />
        </div>
      )}
      {!inTools && (
        <p className="hint row">
          <span>{t("The log, the shader cache and 3DMigoto's files are in Tools.")}</span>
          <Button size="sm" variant="ghost" icon="tools" onClick={() => go({ view: "tools", section: "dev" })}
            title={t("Opens Tools, Mod makers, with the log, the shader cache and d3dx.ini of the game picked in the sidebar")}>{t("View log")}</Button>
        </p>
      )}
    </Panel>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="field"><span className="field-l">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</div>;
}

function HookField({ label, hook, locked, onChange }: { label: string; hook: Hook; locked?: ReactNode; onChange: (h: Hook) => void }) {
  return (
    <div className="tools-hook">
      <Toggle checked={hook.enabled} disabled={!!locked} onChange={(v) => onChange({ ...hook, enabled: v })} label={label} hint={locked} />
      {hook.enabled && (
        <>
          <TextField mono value={hook.command} disabled={!!locked} placeholder='"C:\Tools\ReShade launcher.exe"' onChange={(v) => onChange({ ...hook, command: v })} />
          <Toggle size="sm" checked={hook.wait} disabled={!!locked} onChange={(v) => onChange({ ...hook, wait: v })} label={t("Wait for it to finish")} />
        </>
      )}
    </div>
  );
}

/** A number setting. What's typed stays as typed (it can be emptied, and new digits don't merge with the saved value);
 *  each valid number saves, and leaving the field shows the saved value, capped at `max`. */
function NumberExtra({ v, info, locked, onChange }: { v: number; info: ExtraInfo; locked?: string; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(String(v));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(String(v)); }, [v]);
  const cap = (n: number) => (info.max !== undefined ? Math.min(n, info.max) : n);
  return (
    <div style={{ display: "contents" }} onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; setText(String(v)); }}>
      <TextField label={info.label} type="number" value={text} disabled={!!locked} hint={locked ?? info.hint}
        onChange={(s) => {
          setText(s);
          const n = Number(s);
          if (s.trim() !== "" && Number.isFinite(n)) onChange(cap(Number.isInteger(v) ? Math.round(n) : n));
        }} />
    </div>
  );
}

function Extra({ k, v, info, locked, onChange }: { k: string; v: unknown; info: ExtraInfo; locked?: string; onChange: (v: unknown) => void }) {
  if (typeof v === "boolean") return <Toggle checked={v} disabled={!!locked} onChange={onChange} label={info.label} hint={locked ?? info.hint} />;
  if (k === "resource_tier" && typeof v === "string") {
    const opts = RESOURCE_TIERS.includes(v) ? RESOURCE_TIERS : [v, ...RESOURCE_TIERS];
    return <Select label={info.label} value={v} onChange={onChange} options={opts.map((o) => ({ value: o, label: o }))} hint={info.hint} />;
  }
  if (typeof v === "number") return <NumberExtra v={v} info={info} locked={locked} onChange={onChange} />;
  return <TextField label={info.label} mono value={typeof v === "string" ? v : JSON.stringify(v)} hint={info.hint}
    onChange={(s) => onChange(typeof v === "string" ? s : (() => { try { return JSON.parse(s); } catch { return v; } })())} />;
}
