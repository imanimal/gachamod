// Tools: launch options, 3DMigoto switches for mod makers, dev helpers, then MODTOOLS' panels. Owner: SYSTEM area.
// Fields save on change (400 ms after the last one) with a small "Saved". Sections have ids for go({ section }).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Confirm, PageHeader, Panel, Segmented, Select, TextField, Toggle, formatBytes, plural } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { saved } from "../../ui/motion";
import { dev, errorKind, errorText, launchConfig, shell, type DevStatus, type GameState, type Hook, type LaunchConfig, type MigotoConfig } from "../../lib/api";
import { consumeRoute, useGame, useRoute } from "../../lib/store";
import { ConflictsPanel, HashLookupPanel, ImmPanel, PacksPanel, ProblemsPanel } from "../modtools/ToolsPanels";
import "./tools.css";

/** Plain labels for XXMI's game switches. Anything else shows under "Other" with its raw key. */
const EXTRA_LABELS: Record<string, { label: string; hint?: string }> = {
  unlock_fps: { label: "Unlock FPS", hint: "Lifts the game's frame rate cap" },
  unlock_fps_value: { label: "FPS limit", hint: "The cap to use when FPS is unlocked" },
  disable_dcr: { label: "Turn off dynamic character resolution", hint: "Keeps characters sharp at a distance" },
  enable_hdr: { label: "HDR", hint: "Needs an HDR display with HDR on in Windows" },
  disable_wounded_fx: { label: "Turn off wounded effects", hint: "No red screen edges at low health" },
  force_max_lod_bias: { label: "Sharpest textures", hint: "Always loads the most detailed textures" },
  resource_tier: { label: "Resource quality", hint: "The texture pack the game loads" },
};
const RESOURCE_TIERS = ["UHD", "HD", "SD"];
const PRIORITIES = ["LOW", "BELOW_NORMAL", "NORMAL", "ABOVE_NORMAL", "HIGH", "REALTIME"];
const PRIORITY_LABEL: Record<string, string> = { LOW: "Low", BELOW_NORMAL: "Below normal", NORMAL: "Normal", ABOVE_NORMAL: "Above normal", HIGH: "High", REALTIME: "Realtime" };
const WINDOW_MODES = [{ value: "WINDOWED", label: "Window" }, { value: "BORDERLESS", label: "Borderless" }, { value: "FULLSCREEN", label: "Full screen" }];
const LOG_LEVELS = ["DISABLED", "ERROR", "WARNING", "INFO", "DEBUG"];
const LOG_LABEL: Record<string, string> = { DISABLED: "Off", ERROR: "Errors", WARNING: "Warnings", INFO: "Info", DEBUG: "Everything" };

export function Tools() {
  const game = useGame();
  const route = useRoute();

  // scroll to a deep-linked section once the page has laid out
  useEffect(() => {
    const id = route.section;
    if (!id) return;
    const t = window.setTimeout(() => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); consumeRoute(["section"]); }, 120);
    return () => window.clearTimeout(t);
  }, [route.section]);

  if (!game) return null;
  return (
    <div className="page tools">
      <PageHeader title="Tools" icon="tools" sub={`Launch options and mod maker tools for ${game.name}`} />
      <LaunchSections game={game} />
      <DevSection game={game} />
      <div className="tools-ext"><ConflictsPanel /></div>
      <div className="tools-ext"><ProblemsPanel /></div>
      <div className="tools-ext"><HashLookupPanel /></div>
      <div className="tools-ext"><PacksPanel /></div>
      <div className="tools-ext"><ImmPanel /></div>
    </div>
  );
}

// ── launch and migoto: one config, saved together ──

function LaunchSections({ game }: { game: GameState }) {
  const [cfg, setCfg] = useState<LaunchConfig | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timer = useRef(0);
  const edits = useRef(0);
  const latest = useRef<LaunchConfig | null>(null);
  const ack = useRef<HTMLSpanElement>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; window.clearTimeout(timer.current); }; }, []);

  useEffect(() => {
    let on = true;
    launchConfig.get(game.id).then((c) => { if (on) { setCfg(c); latest.current = c; } }).catch((e) => { if (on) setLoadError(errorText(e)); });
    return () => { on = false; };
  }, [game.id]);

  const save = useCallback(async () => {
    const c = latest.current;
    if (!c) return;
    const at = edits.current;
    try {
      const back = await launchConfig.set(game.id, c);
      if (!live.current) return;
      setBlocked(null);
      // a newer edit is on its way; don't overwrite it with this answer
      if (at === edits.current) { setCfg(back); latest.current = back; }
      saved(ack.current);
      ack.current?.classList.add("show");
      window.setTimeout(() => ack.current?.classList.remove("show"), 1600);
    } catch (e) {
      if (!live.current) return;
      if (errorKind(e) === "conflict") setBlocked(errorText(e)); else toast(errorText(e), true);
    }
  }, [game.id]);

  const update = (patch: Partial<LaunchConfig>) => {
    setCfg((c) => {
      if (!c) return c;
      const n = { ...c, ...patch };
      latest.current = n;
      return n;
    });
    edits.current++;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 400);
  };

  if (loadError) return <Panel title="Launch" icon="play" id="launch"><p className="hint">{loadError}</p></Panel>;
  if (!cfg) return <Panel title="Launch" icon="play" id="launch"><p className="hint">Loading…</p></Panel>;

  const lock = (k: string) => cfg.locked[k];
  const setMig = (patch: Partial<MigotoConfig>) => update({ migoto: { ...cfg.migoto, ...patch } });
  const extras = Object.entries(cfg.extras);
  const known = extras.filter(([k]) => EXTRA_LABELS[k]);
  const other = extras.filter(([k]) => !EXTRA_LABELS[k]);
  const migLock = (k: string) => lock("migoto") ?? lock(`migoto.${k}`);
  const viaXxmi = cfg.via === "xxmi";

  const notice = blocked && (
    <div className="tools-blocked" role="alert">
      <span>{blocked}</span>
      <Button size="sm" onClick={() => void save()}>Try again</Button>
    </div>
  );
  const savedTag = <span ref={ack} className="tools-saved" aria-live="polite">Saved</span>;

  return (
    <>
      <Panel title="Launch" icon="play" id="launch" actions={savedTag}>
        {notice}
        <div className="tools-grid">
          <Field label="Start with" hint={lock("via") ?? (viaXxmi ? "XXMI Launcher loads the mods and applies these settings" : "gachamod starts the game's exe. Mods need another loader")}>
            <Segmented value={cfg.via} onChange={(v) => update({ via: v })} label="Start with"
              options={[{ value: "xxmi", label: "XXMI Launcher" }, { value: "direct", label: "The game's exe" }]} />
          </Field>
          <TextField label="Arguments" mono value={cfg.args} placeholder="-popupwindow -screen-width 1920" onChange={(v) => update({ args: v })}
            hint="Added to the game's command line" />
          {cfg.via === "direct" && (
            <TextField label="Different exe" mono value={cfg.customExe ?? ""} placeholder="Leave empty for the game's own exe"
              onChange={(v) => update({ customExe: v || null })} disabled={!!lock("customExe")} hint={lock("customExe")} />
          )}
          <Select label="Priority" value={cfg.processPriority || "NORMAL"} onChange={(v) => update({ processPriority: v })}
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] ?? p }))} hint={lock("processPriority") ?? "How much of the CPU Windows gives the game"} />
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
            {known.map(([k, v]) => <Extra key={k} k={k} v={v} onChange={(nv) => update({ extras: { ...cfg.extras, [k]: nv } })} />)}
          </div>
        )}
        {other.length > 0 && (
          <details className="tools-other">
            <summary>Other</summary>
            {other.map(([k, v]) => <Extra key={k} k={k} v={v} onChange={(nv) => update({ extras: { ...cfg.extras, [k]: nv } })} />)}
          </details>
        )}
        <Toggle checked={cfg.closeOnLaunch} onChange={(v) => update({ closeOnLaunch: v })} label="Close gachamod when the game starts"
          hint="Automatic reloads stop while gachamod is closed" />
      </Panel>

      <Panel title="Mod maker switches" icon="code" id="migoto">
        {lock("migoto") && <p className="hint">{lock("migoto")}</p>}
        <div className="tools-switches">
          <Toggle checked={cfg.migoto.hunting} disabled={!!migLock("hunting")} onChange={(v) => setMig({ hunting: v })} label="Hunting mode"
            hint={migLock("hunting") ?? "Numpad keys step through shaders and buffers to find hashes"} />
          <Toggle checked={cfg.migoto.dumpShaders} disabled={!!migLock("dumpShaders")} onChange={(v) => setMig({ dumpShaders: v })} label="Dump shaders"
            hint={migLock("dumpShaders") ?? "Marking a shader in hunting mode also saves its code to ShaderFixes"} />
          <Toggle checked={cfg.migoto.muteWarnings} disabled={!!migLock("muteWarnings")} onChange={(v) => setMig({ muteWarnings: v })} label="Hide warnings"
            hint={migLock("muteWarnings") ?? "No red ini warnings over the game"} />
          <Toggle checked={cfg.migoto.enforceRendering} disabled={!!migLock("enforceRendering")} onChange={(v) => setMig({ enforceRendering: v })} label="Enforce rendering"
            hint={migLock("enforceRendering") ?? "Tracks texture hashes so texture mods apply. Turn off only to test"} />
          <Toggle checked={cfg.migoto.callsLogging} disabled={!!migLock("callsLogging")} onChange={(v) => setMig({ callsLogging: v })} label="Log calls"
            hint={migLock("callsLogging") ?? "Writes every draw call to d3d11_log.txt. Slow, for debugging"} />
          <Toggle checked={cfg.migoto.debugLogging} disabled={!!migLock("debugLogging")} onChange={(v) => setMig({ debugLogging: v })} label="Debug logging"
            hint={migLock("debugLogging") ?? "More detail in d3d11_log.txt"} />
        </div>
        {!migLock("logLevel") && (
          <div className="tools-loglevel">
            <Select label="Log" value={cfg.migoto.logLevel || "DISABLED"} onChange={(v) => setMig({ logLevel: v })}
              options={LOG_LEVELS.map((l) => ({ value: l, label: LOG_LABEL[l] ?? l }))} hint="What 3DMigoto writes to d3d11_log.txt" />
          </div>
        )}
      </Panel>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="field"><span className="field-l">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</div>;
}

function HookField({ title, hook, locked, onChange }: { title: string; hook: Hook; locked?: string; onChange: (h: Hook) => void }) {
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

function Extra({ k, v, onChange }: { k: string; v: unknown; onChange: (v: unknown) => void }) {
  const info = EXTRA_LABELS[k] ?? { label: k };
  if (typeof v === "boolean") return <Toggle checked={v} onChange={onChange} label={info.label} hint={info.hint} />;
  if (k === "resource_tier" && typeof v === "string") {
    const opts = RESOURCE_TIERS.includes(v) ? RESOURCE_TIERS : [v, ...RESOURCE_TIERS];
    return <Select label={info.label} value={v} onChange={onChange} options={opts.map((o) => ({ value: o, label: o }))} hint={info.hint} />;
  }
  if (typeof v === "number") {
    return <TextField label={info.label} type="number" value={String(v)} hint={info.hint}
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
    <Panel title="For mod makers" icon="bug" id="dev">
      {noImporter
        ? <p className="hint">Set {game.name}'s mod loader folder in Settings first.</p>
        : <>
          <div className="toolbar tools-open">
            <Button icon="folder" onClick={() => open(game.importerDir)} disabled={!game.importerDir}>Loader folder</Button>
            <Button icon="file" onClick={() => open(st?.d3dxIni)} disabled={!st?.d3dxIni} title="3DMigoto's main settings">d3dx.ini</Button>
            <Button icon="file" onClick={() => open(st?.d3dxUserIni)} disabled={!st?.d3dxUserIni} title="Saved mod options">d3dx_user.ini</Button>
            <Button icon="folder" onClick={() => open(st?.shaderFixes.path)} disabled={!st?.shaderFixes.files}>ShaderFixes</Button>
          </div>
          <div className="tools-dev">
            <div className="tools-dev-row">
              <span><b>Reload mods in game</b><span className="hint">Brings {game.short} to the front and presses F10</span></span>
              <Button icon="refresh" busy={busy === "reload"} disabled={!game.running} title={game.running ? "Press F10 in the game" : `${game.name} isn't running`}
                onClick={() => void run("reload", async () => { await dev.reload(game.id); toast("Reloaded mods in game"); })}>Reload</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>Shader cache</b><span className="hint">{st ? `${formatBytes(st.shaderCache.bytes)}, ${plural(st.shaderCache.files, "file")}. It rebuilds on the next start` : "…"}</span></span>
              <Button icon="trash" busy={busy === "cache"} disabled={!st?.shaderCache.bytes}
                onClick={() => void run("cache", async () => { const b = await dev.clearShaderCache(game.id); toast(`Freed ${formatBytes(b)}`); })}>Clear</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>Frame dumps</b><span className="hint">{st ? `${formatBytes(st.frameDumps.bytes)} in FrameAnalysis folders` : "…"}</span></span>
              <Button icon="trash" busy={busy === "dumps"} disabled={!st?.frameDumps.bytes}
                onClick={() => void run("dumps", async () => { const b = await dev.clearFrameDumps(game.id); toast(`Freed ${formatBytes(b)}`); })}>Delete</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>Saved mod options</b><span className="hint">Every mod goes back to its first look. A copy of d3dx_user.ini is kept</span></span>
              <Button variant="danger" icon="trash" disabled={!st?.d3dxUserIni || game.running} title={game.running ? "Close the game first" : undefined}
                onClick={() => setWipe(true)}>Wipe</Button>
            </div>
          </div>
          <div className="tools-log">
            <div className="row"><b className="grow">3DMigoto log</b>{st?.log.bytes ? <Badge>{formatBytes(st.log.bytes)}</Badge> : null}
              <Button size="sm" variant="ghost" icon="refresh" onClick={loadLog}>Refresh</Button>
              <Button size="sm" variant="ghost" icon="external" disabled={!st?.log.bytes} onClick={() => open(st?.log.path)}>Open</Button>
            </div>
            <pre className="tools-log-text selectable">{log === null ? "…" : log || "No log yet. Turn on a log level above, then start the game."}</pre>
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
