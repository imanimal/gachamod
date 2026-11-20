// The setup window: install, update, repair and uninstall, one card on the theme's stage. The common case is one
// click (Install, or Uninstall); everything else sits under Options. src-setup runs NSIS behind it and reports each
// step ("setup-step" events, src-setup/src/jobs.rs). gachamod's own updates open it too (mode "apply"), straight
// into the steps, so an update looks the same as installing. An update gachamod installs from the background is quiet:
// the window stays hidden unless it fails, and src-setup starts gachamod again in the background and closes setup.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameState } from "../lib/api";
import { seconds, useElapsed } from "../lib/activity";
import { THEMES, type Scheme } from "../lib/theme-info";
import { Glyphs, Backdrop } from "../ui/Deco";
import { Icon, type IconName } from "../ui/Icon";
import { Button, Card, Checkbox, formatBytes, Segmented, Select, Spinner, Toggle } from "../ui/kit";
import { Steps, type StepItem } from "../ui/Steps";
import { api, type SetupInfo, type Step } from "./api";
import { applyLook, schemeOf } from "./look";
import { t, tb } from "../lib/i18n";
import { gameName, gameShort } from "../lib/games";

/** apply: an update gachamod downloaded and handed over. */
type Job = "install" | "update" | "apply" | "repair" | "uninstall";
type View =
  | { k: "start" }
  | { k: "uninstall" }
  | { k: "work"; job: Job }
  | { k: "done"; job: Job; dir?: string; dataGone?: boolean; version?: string }
  | { k: "error"; job: Job; message: string };

const JOB_TITLE: Record<Job, string> = { install: t("Installing gachamod"), update: t("Updating gachamod"), apply: t("Updating gachamod"), repair: t("Repairing gachamod"), uninstall: t("Uninstalling gachamod") };
const JOB_FAILED: Record<Job, string> = { install: t("Couldn't install gachamod"), update: t("Couldn't update gachamod"), apply: t("Couldn't update gachamod"), repair: t("Couldn't repair gachamod"), uninstall: t("Couldn't uninstall gachamod") };
const STEP_LABEL: Record<string, string> = {
  unpack: t("Unpack the installer"), download: t("Download gachamod"), verify: t("Check the download"), close: t("Close gachamod"),
  copy: t("Copy gachamod"), remove: t("Remove gachamod"), data: t("Move the data to the Recycle Bin"),
};

/** -1, 0 or 1 for "1.2.3" style versions. */
function cmp(a: string, b: string): number {
  const p = (v: string) => v.replace(/^v/, "").split("-")[0]!.split(".").map((n) => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return Math.sign(d); }
  // same numbers: a release beats its betas (0.1.1 over 0.1.1-beta.3), then beta.3 beats beta.2
  const pre = (v: string) => v.replace(/^v/, "").split("-").slice(1).join("-");
  const pa = pre(a), pb = pre(b);
  if (pa === pb) return 0;
  if (!pa || !pb) return pa ? -1 : 1;
  return Math.sign(pa.localeCompare(pb, undefined, { numeric: true }));
}

/** The newest version on GitHub, looked up when setup opens over an installed copy. */
type Latest = { k: "off" } | { k: "checking" } | { k: "ok"; version: string } | { k: "failed"; message: string };

/** This setup carries an installer newer than the installed copy (or there's no copy). */
const carriesNewer = (info: SetupInfo) => info.payload && (!info.installed?.version || cmp(info.version, info.installed.version) > 0);
/** An update downloads from GitHub unless the installer inside this setup is the newer one. */
const fromGitHub = (job: Job, info: SetupInfo) => job === "update" && !carriesNewer(info);
/** gachamod opens once the job is done: after an install or update with "Open gachamod" on, and after an update
 * gachamod handed over unless it was closing anyway or goes back to the background (src-setup starts it there). */
const opensAfter = (job: Job, info: SetupInfo, openAfter: boolean) =>
  job === "apply" ? !!info.apply?.open && !info.apply.background : (job === "install" || job === "update") && openAfter;
/** The newest version on GitHub when it's newer than the installed copy. */
const newerOnline = (latest: Latest, info: SetupInfo) =>
  latest.k === "ok" && info.installed?.version && cmp(latest.version, info.installed.version) > 0 ? latest.version : null;


export function Setup() {
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [view, setView] = useState<View>({ k: "start" });
  const [step, setStep] = useState<Step | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [since, setSince] = useState(Date.now);
  // options
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(true);
  const [quickstart, setQuickstart] = useState(true);
  const [admin, setAdmin] = useState(true);
  const [openAfter, setOpenAfter] = useState(true);
  const [deleteData, setDeleteData] = useState(false);
  const [dataSize, setDataSize] = useState<number | null>(null);
  const [pick, setPick] = useState<{ theme?: string; scheme?: Scheme }>({});
  const [latest, setLatest] = useState<Latest>({ k: "off" });
  const skipped = useRef(false);

  useEffect(() => {
    api.info().then((i) => {
      setInfo(i); setDesktop(i.desktop); setQuickstart(i.quickstart); setAdmin(i.admin);
      applyLook(i.look);
      if (i.mode === "uninstall") setView({ k: "uninstall" });
      if (i.mode === "apply") setView({ k: "work", job: "apply" });
      // a quiet update (gachamod installing it from the background) shows the window only if it fails
      if (!i.apply?.quiet) requestAnimationFrame(() => void api.win("show"));
    }).catch((e) => { setFailed(String(e)); void api.win("show"); });
  }, []);

  // over an installed copy, look on GitHub for a newer version than this setup has, so a copy of gachamod that
  // won't open can still be updated from here
  const checkLatest = useCallback(() => {
    skipped.current = false;
    setLatest({ k: "checking" });
    api.latest().then((version) => { if (!skipped.current) setLatest({ k: "ok", version }); }).catch((e) => { if (!skipped.current) setLatest({ k: "failed", message: String(e) }); });
  }, []);
  /** Stop waiting on GitHub: the answer, when it comes, is dropped. */
  const skipLatest = useCallback(() => { skipped.current = true; setLatest({ k: "off" }); }, []);
  useEffect(() => {
    if (info?.installed && (info.mode === "install" || info.mode === "maintain") && !carriesNewer(info)) checkLatest();
  }, [info, checkLatest]);
  useEffect(() => { if (info) applyLook(info.look, pick); }, [info, pick]);

  // the current step, and the ones before it as done
  useEffect(() => {
    let off: (() => void) | undefined;
    void api.onStep((s) => {
      setStep((prev) => {
        if (prev && prev.step !== s.step) { setDone((d) => (d.includes(prev.step) ? d : [...d, prev.step])); setSince(Date.now()); }
        return s;
      });
    }).then((f) => { off = f; });
    return () => off?.();
  }, []);

  const run = useCallback(async (job: Job) => {
    if (!info) return;
    setView({ k: "work", job }); setStep(null); setDone([]); setSince(Date.now()); setOpen(false);
    try {
      let out: string | undefined;
      const online = fromGitHub(job, info);
      if (job === "apply") out = await api.apply();
      else if (online) out = await api.update();
      else if (job === "install" || job === "update") out = await api.install({ dir, desktop, quickstart, admin });
      else if (job === "repair") out = await api.repair();
      else await api.uninstall(deleteData);
      const version = job === "apply" ? info.apply?.version ?? undefined : job === "update" ? (online ? newerOnline(latest, info) ?? undefined : info.version) : undefined;
      setView({ k: "done", job, dir: out || info.installed?.dir, dataGone: job === "uninstall" && deleteData, version });
      if (opensAfter(job, info, openAfter)) {
        // a quiet update has src-setup open it (main.rs apply)
        if (!(job === "apply" && info.apply?.quiet)) await api.openApp(out).catch(() => undefined);
        setTimeout(() => void api.win("close"), 1400);
      } else if (job === "apply") {
        // gachamod was closed, so this window goes too once it has said so
        setTimeout(() => void api.win("close"), 2500);
      }
    } catch (e) {
      setView({ k: "error", job, message: String(e) });
    }
  }, [info, dir, desktop, quickstart, admin, deleteData, openAfter, latest]);

  // a repair started from Windows (--repair) and an update from gachamod (--apply) begin at once
  const started = useRef(false);
  useEffect(() => {
    if ((info?.mode === "repair" || info?.mode === "apply") && !started.current) { started.current = true; void run(info.mode); }
  }, [info, run]);
  // shown once the error is on the page, so a quiet update never fails unseen
  useEffect(() => { if (view.k === "error" && info?.apply?.quiet) void api.win("show"); }, [view.k, info]);
  useEffect(() => { if (view.k === "uninstall" && dataSize === null) void api.dataSize().then(setDataSize).catch(() => setDataSize(0)); }, [view.k, dataSize]);

  const busy = view.k === "work";
  const close = useCallback(() => { if (!busy) void api.win("close"); }, [busy]);
  const back = useCallback(() => {
    if (busy) return;
    if (open) setOpen(false);
    else if (view.k === "uninstall" && info?.mode !== "uninstall") setView({ k: "start" });
    else close();
  }, [busy, open, view.k, info, close]);
  useKeys(back);

  const game = info?.look.game;
  const deco = useMemo(() => (game ? { name: game.name, importer: game.importer, short: game.short } : null) as GameState | null, [game]);
  const title = info?.mode === "uninstall" ? t("Uninstall gachamod") : info?.mode === "repair" ? t("Repair gachamod") : info?.mode === "apply" ? t("Update gachamod") : t("gachamod setup");

  return (
    <div className="app setup-app">
      <Backdrop game={deco} />
      <header className="titlebar" data-tauri-drag-region>
        <div className="tb-side tb-l" data-tauri-drag-region>
          <span className="brand" data-tauri-drag-region><span className="brand-mark" aria-hidden="true" /></span>
          <span className="setup-tt" data-tauri-drag-region>{title}</span>
          <span className="sp" data-tauri-drag-region><Glyphs run /></span>
        </div>
        <span data-tauri-drag-region />
        <div className="tb-side tb-r" data-tauri-drag-region>
          <span className="winkeys">
            <button type="button" className="wk" aria-label={t("Minimise")} onClick={() => void api.win("minimize")}><Icon name="minus" /></button>
            <button type="button" className="wk wk-x" aria-label={busy ? t("Setup can't close while it works") : t("Close (Esc)")} disabled={busy} onClick={close}><Icon name="x" /></button>
          </span>
        </div>
      </header>
      <main className="view setup-view">
        {failed ? (
          <Panel><Hero title={t("Setup couldn't start")} sub={tb(failed)} icon="warn" /></Panel>
        ) : !info ? (
          <Panel><p className="setup-wait"><Spinner /> {t("Looking for gachamod on this PC")}</p></Panel>
        ) : view.k === "work" ? (
          <Working job={view.job} step={step} done={done} since={since} info={info} />
        ) : view.k === "done" ? (
          <Done view={view} opening={opensAfter(view.job, info, openAfter)} background={!!info.apply?.background} close={close} />
        ) : view.k === "error" ? (
          <Failed view={view} info={info} retry={() => void run(view.job)} close={close} />
        ) : view.k === "uninstall" ? (
          <Uninstall info={info} deleteData={deleteData} setDeleteData={setDeleteData} dataSize={dataSize}
            go={() => void run("uninstall")} repair={() => void run("repair")} cancel={info.mode === "uninstall" ? close : () => setView({ k: "start" })} />
        ) : info.mode === "install" ? (
          <Install info={info} latest={latest} checkLatest={checkLatest} skipLatest={skipLatest} open={open} setOpen={setOpen} go={(job) => void run(job)} uninstall={() => setView({ k: "uninstall" })}
            dir={dir} setDir={setDir} desktop={desktop} setDesktop={setDesktop} quickstart={quickstart} setQuickstart={setQuickstart} admin={admin} setAdmin={setAdmin}
            openAfter={openAfter} setOpenAfter={setOpenAfter} pick={pick} setPick={setPick} />
        ) : (
          <Maintain info={info} latest={latest} checkLatest={checkLatest} skipLatest={skipLatest} update={() => void run("update")} repair={() => void run("repair")} uninstall={() => setView({ k: "uninstall" })} />
        )}
      </main>
    </div>
  );
}

// ── pieces ──

function Panel({ children }: { children: ReactNode }) {
  return <section className="panel setup-card"><div className="panel-b">{children}</div></section>;
}

function Hero({ title, sub, icon }: { title: string; sub?: ReactNode; icon?: IconName }) {
  return (
    <div className="setup-hero">
      {icon ? <span className={`setup-ico t-${icon === "warn" ? "bad" : "ok"}`}><Icon name={icon} /></span> : <span className="brand-mark setup-logo" aria-hidden="true" />}
      <div className="setup-hero-t">
        <h1 className="setup-h">{title}</h1>
        {sub && <p className="setup-sub">{sub}</p>}
      </div>
    </div>
  );
}

const QUICKSTART_TIP = t("A second desktop icon that starts the game you played last, with mods. Settings, General can make it again.");
const ADMIN_TIP = t("Lets it switch skins in games that run as administrator, like Zenless Zone Zero, without you pressing F10. Windows asks for permission each time it starts.");

function Install(p: {
  info: SetupInfo; latest: Latest; checkLatest: () => void; skipLatest: () => void; open: boolean; setOpen: (v: boolean) => void; go: (job: Job) => void; uninstall: () => void;
  dir: string | null; setDir: (v: string | null) => void; desktop: boolean; setDesktop: (v: boolean) => void;
  quickstart: boolean; setQuickstart: (v: boolean) => void;
  admin: boolean; setAdmin: (v: boolean) => void; openAfter: boolean; setOpenAfter: (v: boolean) => void;
  pick: { theme?: string; scheme?: Scheme }; setPick: (v: { theme?: string; scheme?: Scheme }) => void;
}) {
  const { info } = p;
  const inst = info.installed;
  const c = inst?.version ? cmp(info.version, inst.version) : 1;
  const game = info.look.game;
  // already there, same version or newer: update it from GitHub when there's a newer one, open it, or repair or
  // uninstall it
  if (inst && inst.ok && c <= 0) {
    const newer = newerOnline(p.latest, info);
    return (
      <Panel>
        <Hero title="gachamod" sub={c === 0 ? t("Version {version} is installed.", { version: inst.version ?? "" }) : t("A newer version, {version}, is installed. This setup has {setup}.", { version: inst.version ?? "", setup: info.version })} />
        <p className="setup-p" title={inst.dir}>{t("It's in {folder}.", { folder: inst.dir })}</p>
        <div className="setup-actions">
          {newer && <UpdateButton version={newer} go={() => p.go("update")} />}
          <Button variant={newer ? undefined : "primary"} size={newer ? undefined : "lg"} icon="play" autoFocus={!newer}
            onClick={() => void api.openApp(inst.dir).then(() => api.win("close"))}>{t("Open gachamod")}</Button>
          <Button icon="refresh" onClick={() => p.go("repair")} title={t("Put gachamod's files, shortcuts and Windows settings back. Your mods and settings stay")}>{t("Repair")}</Button>
          <Button variant="ghost" icon="trash" onClick={p.uninstall}>{t("Uninstall")}</Button>
        </div>
        <LatestNote latest={p.latest} retry={p.checkLatest} skip={p.skipLatest} />
      </Panel>
    );
  }
  const update = !!inst;
  // installed but its exe is gone, and this setup is no newer: put it back
  const fix = !!inst && !inst.ok && c <= 0;
  const job: Job = fix ? "repair" : update ? "update" : "install";
  const sub = !inst ? t("Version {version}", { version: info.version })
    : fix ? t("gachamod.exe is missing from the folder. This puts it back.")
    : inst.version ? t("Version {version} is installed. This updates it to {setup}.", { version: inst.version, setup: info.version })
    : t("This installs version {version} over the copy you have.", { version: info.version });
  const where = p.dir ?? inst?.dir ?? info.defaultDir;
  // a fresh install from a game's own setup starts in one-game mode (src-setup look.rs named_game)
  const named = !inst && !!game && info.look.source !== "app" && info.look.source !== "default";
  const themes = THEMES.filter((th) => !th.hidden || th.id === info.look.theme);
  const themeNow = p.pick.theme ?? (themes.some((th) => th.id === info.look.theme) ? info.look.theme : "default");
  const schemeNow = p.pick.scheme ?? schemeOf(info.look, themeNow);
  return (
    <Panel>
      <Hero title="gachamod" sub={sub} />
      {!p.open ? (
        <p className="setup-p">{!game
          ? t("Browse GameBanana, install with one click and switch skins per character in Genshin Impact, Star Rail, Zenless Zone Zero, Wuthering Waves and other 3DMigoto games.")
          : named ? t("Browse GameBanana, install with one click and switch {game} skins per character. It handles your other games too, and starts with only {short} in the sidebar.", { game: gameName(game), short: gameShort(game) })
          : t("Browse GameBanana, install with one click and switch {game} skins per character.", { game: gameName(game) })}</p>
      ) : null}
      {/* a fresh install asks on the card itself; Options has the same choices with more words */}
      {!p.open && !update && (
        <div className="setup-picks" role="group" aria-label={t("Shortcuts and administrator")}>
          <Checkbox checked={p.desktop} onChange={p.setDesktop} label={t("Desktop shortcut")} />
          <Checkbox checked={p.quickstart} onChange={p.setQuickstart} label={t("Quickstart shortcut")} title={QUICKSTART_TIP} />
          <Checkbox checked={p.admin} onChange={p.setAdmin} label={t("Start gachamod as administrator")} title={ADMIN_TIP} />
        </div>
      )}
      {p.open && (
        <div className="setup-opts">
          {!update && (
            <div className="setup-row">
              <span className="setup-path" title={where}>{where}</span>
              <Button size="sm" icon="folder" onClick={() => void api.pickFolder(where).then((d) => { if (d) p.setDir(d); })}>{t("Change")}</Button>
            </div>
          )}
          <Toggle checked={p.desktop} onChange={p.setDesktop} label={t("Desktop shortcut")} />
          <Toggle checked={p.quickstart} onChange={p.setQuickstart} label={t("Quickstart shortcut")} hint={QUICKSTART_TIP} />
          <Toggle checked={p.admin} onChange={p.setAdmin} label={t("Start gachamod as administrator")} hint={ADMIN_TIP} />
          <Toggle checked={p.openAfter} onChange={p.setOpenAfter} label={update ? t("Open gachamod when it's updated") : t("Open gachamod when it's installed")} />
          <div className="setup-row setup-look" title={t("Only changes how setup looks")}>
            <Select label={t("Theme")} value={themeNow} options={themes.map((th) => ({ value: th.id, label: th.name }))} onChange={(v) => p.setPick({ ...p.pick, theme: v })} />
            <Segmented label={t("Dark or light")} value={schemeNow} onChange={(v) => p.setPick({ ...p.pick, scheme: v })}
              options={[{ value: "dark", label: "", icon: "moon", title: t("Dark") }, { value: "light", label: "", icon: "sun", title: t("Light") }]} />
          </div>
        </div>
      )}
      <div className="setup-actions">
        <Button variant="primary" size="lg" icon={fix ? "refresh" : update ? "update" : "install"} autoFocus onClick={() => p.go(job)}>
          {fix ? t("Repair") : update ? t("Update to {version}", { version: info.version }) : t("Install")}
        </Button>
        <Button variant="ghost" icon="sliders" onClick={() => p.setOpen(!p.open)} aria-expanded={p.open}
          title={p.open ? t("Back (Esc)") : t("Folder, shortcuts, administrator and theme")}>{p.open ? t("Hide options") : t("Options")}</Button>
      </div>
      {(!p.open || info.running) && (
        <p className="setup-note" title={where}>
          {!p.open && (update ? t("Your mods, profiles and settings stay.") : t("Installs for your Windows account in {folder}. No administrator rights needed.", { folder: where }))}
          {info.running && <>{!p.open && " "}{t("gachamod is open, so it closes first.")}</>}
        </p>
      )}
    </Panel>
  );
}

function Maintain({ info, latest, checkLatest, skipLatest, update, repair, uninstall }:
  { info: SetupInfo; latest: Latest; checkLatest: () => void; skipLatest: () => void; update: () => void; repair: () => void; uninstall: () => void }) {
  const inst = info.installed;
  if (!inst) {
    return (
      <Panel>
        <Hero title={t("gachamod isn't installed")} sub={t("There's nothing here to repair or uninstall.")} />
        <div className="setup-actions">
          <Button variant="primary" icon="external" autoFocus onClick={() => void api.openPage(`${info.homepage}/releases/latest`)}>{t("Get gachamod")}</Button>
        </div>
      </Panel>
    );
  }
  const newer = newerOnline(latest, info);
  const sub = !inst.version ? undefined
    : newer ? t("Version {version} is installed. {newer} is out.", { version: inst.version, newer })
    : latest.k === "ok" ? t("Version {version}, the newest.", { version: inst.version })
    : t("Version {version}", { version: inst.version });
  return (
    <Panel>
      <Hero title="gachamod" sub={sub} />
      <p className="setup-p" title={inst.dir}>
        {inst.ok ? t("It's in {folder}.", { folder: inst.dir }) : t("gachamod.exe is missing from {folder}. Repair puts it back.", { folder: inst.dir })}
      </p>
      <div className="setup-choices">
        <Card onClick={repair} className="setup-choice" title={t("Downloads gachamod again when this PC doesn't have a copy of the installer")}>
          <span className="setup-choice-h"><Icon name="refresh" /> {t("Repair")}</span>
          <span className="setup-choice-p">{t("Puts gachamod's files, shortcuts and Windows settings back. Your mods and settings stay.")}</span>
        </Card>
        <Card onClick={uninstall} className="setup-choice">
          <span className="setup-choice-h"><Icon name="trash" /> {t("Uninstall")}</span>
          <span className="setup-choice-p">{t("Removes gachamod from this PC. Your mods stay in their game folders.")}</span>
        </Card>
      </div>
      <div className="setup-actions">
        {newer && <UpdateButton version={newer} go={update} />}
        <Button icon="play" disabled={!inst.ok} onClick={() => void api.openApp(inst.dir).then(() => api.win("close"))}>{t("Open gachamod")}</Button>
      </div>
      <LatestNote latest={latest} retry={checkLatest} skip={skipLatest} />
    </Panel>
  );
}

function UpdateButton({ version, go }: { version: string; go: () => void }) {
  return (
    <Button variant="primary" size="lg" icon="update" autoFocus onClick={go}
      title={t("Download the newest gachamod from GitHub and install it over this copy. Your mods and settings stay")}>{t("Update to {version}", { version })}</Button>
  );
}

/** What the look on GitHub is doing, while it isn't done or when it failed. */
function LatestNote({ latest, retry, skip }: { latest: Latest; retry: () => void; skip: () => void }) {
  if (latest.k === "checking") {
    return (
      <p className="setup-note"><Spinner /> {t("Looking on GitHub for a newer version")}{" "}
        <Button size="sm" variant="ghost" onClick={skip} title={t("Stop looking for a newer version")}>{t("Skip")}</Button>
      </p>
    );
  }
  if (latest.k === "failed") {
    return (
      <p className="setup-note" title={latest.message}>
        {t("Couldn't look on GitHub for a newer version.")} <Button size="sm" variant="ghost" icon="refresh" onClick={retry}>{t("Try again")}</Button>
      </p>
    );
  }
  return null;
}

function Uninstall({ info, deleteData, setDeleteData, dataSize, go, repair, cancel }: {
  info: SetupInfo; deleteData: boolean; setDeleteData: (v: boolean) => void; dataSize: number | null; go: () => void; repair: () => void; cancel: () => void;
}) {
  const inst = info.installed;
  const [problem, setProblem] = useState("");
  if (!inst) {
    return (
      <Panel>
        <Hero title={t("gachamod isn't installed")} sub={t("There's nothing to uninstall.")} />
        <div className="setup-actions"><Button variant="primary" autoFocus onClick={cancel}>{t("Close")}</Button></div>
      </Panel>
    );
  }
  const size = dataSize === null ? t("counting") : formatBytes(dataSize);
  return (
    <Panel>
      <Hero title={t("Uninstall gachamod?")} sub={inst.version ? t("Version {version}, in {folder}", { version: inst.version, folder: inst.dir }) : inst.dir} />
      <p className="setup-p">{t("Your mods stay in their game folders and keep working with XXMI.")}</p>
      <div className="setup-check" title={info.dataDirs.join("\n")}>
        <Checkbox checked={deleteData} onChange={setDeleteData} label={t("Also delete gachamod's data ({size})", { size })} />
        <span className="hint">{t("Settings, profiles, downloads, backups and gachamod's trash. They go to the Recycle Bin. The size is both folders in full: Settings, Storage in gachamod lists the pieces.")}</span>
        <span className="hint">
          {info.dataDirs.map((d) => (
            <Button key={d} size="sm" variant="ghost" icon="folder" title={t("Open {path}", { path: d })}
              onClick={() => { api.openFolder(d).then(() => setProblem(""), (e) => setProblem(String(e))); }}>
              {/roaming/i.test(d) ? t("Show Roaming folder") : t("Show Local folder")}
            </Button>
          ))}
        </span>
        {problem && <span className="hint" role="alert">{problem}</span>}
      </div>
      <div className="setup-actions">
        <Button variant="danger" size="lg" icon="trash" onClick={go}>{t("Uninstall")}</Button>
        <Button icon="refresh" onClick={repair} title={t("Put gachamod's files back instead, if it isn't working")}>{t("Repair instead")}</Button>
        <Button variant="ghost" autoFocus onClick={cancel} title="Esc">{t("Cancel")}</Button>
      </div>
      {info.running && <p className="setup-note">{t("gachamod is open, so it closes first.")}</p>}
    </Panel>
  );
}

function plan(job: Job, info: SetupInfo): string[] {
  const close = info.running ? ["close"] : [];
  if (job === "uninstall") return [...close, "remove"];
  // gachamod is always closing when it hands over an update
  if (job === "apply") return ["verify", "close", "copy"];
  if (job === "repair") {
    const own = info.payload && (!info.installed?.version || cmp(info.version, info.installed.version) >= 0);
    return [...(own ? ["unpack"] : ["download", "verify"]), ...close, "copy"];
  }
  if (fromGitHub(job, info)) return ["download", "verify", ...close, "copy"];
  return ["unpack", ...close, "copy"];
}

function Working({ job, step, done, since, info }: { job: Job; step: Step | null; done: string[]; since: number; info: SetupInfo }) {
  const s = useElapsed(since);
  const [steps] = useState(() => plan(job, info));
  // a step that wasn't planned (gachamod opened meanwhile) goes in before the ones still to come
  const list = useMemo(() => {
    const out = [...steps];
    for (const id of [...done, step?.step]) {
      if (!id || id === "done" || out.includes(id)) continue;
      const next = out.findIndex((x) => !done.includes(x));
      out.splice(next === -1 ? out.length : next, 0, id);
    }
    return out;
  }, [steps, done, step]);
  const label = (id: string) => (id === "copy" ? (job === "repair" ? t("Put back gachamod's files") : job === "update" || job === "apply" ? t("Update gachamod") : t("Copy gachamod")) : STEP_LABEL[id] ?? id);
  return (
    <Panel>
      <Hero title={JOB_TITLE[job]} sub={job === "uninstall" ? t("Your mods stay where they are.") : t("Your mods and settings stay where they are.")} />
      <Steps items={list.map((id): StepItem => {
        const now = step?.step === id;
        return {
          id,
          state: done.includes(id) || step?.step === "done" ? "ok" : now ? "now" : "todo",
          label: <>{now && step ? tb(step.text) : label(id)}{now && s >= 3 ? ` (${seconds(s)})` : ""}</>,
          value: now && step && step.value !== null ? step.value : undefined,
          valueLabel: step ? tb(step.text) : undefined,
          extra: now && <>
            {step?.hold && s >= 10 && <span className="hint">{tb(step.hold)}</span>}
            {id === "copy" && s >= 60 && <Button size="sm" variant="ghost" icon="x" onClick={() => void api.stop()} title={t("End the installer. Run setup again or pick Repair to finish")}>{t("Stop")}</Button>}
          </>,
        };
      })} />
    </Panel>
  );
}

/** `background`: gachamod went back to the background with the new version, so there's nothing to open. */
function Done({ view, opening, background, close }: { view: Extract<View, { k: "done" }>; opening: boolean; background: boolean; close: () => void }) {
  const { job } = view;
  if (job === "uninstall") {
    return (
      <Panel>
        <Hero title={t("gachamod is uninstalled")} icon="check" sub={t("Your mods are still in their game folders.")} />
        {view.dataGone && <p className="setup-p">{t("gachamod's data is in the Recycle Bin if you want it back.")}</p>}
        <div className="setup-actions">
          <Button variant="primary" autoFocus onClick={close}>{t("Close")}</Button>
          {view.dataGone && <Button icon="trash" onClick={() => { api.openRecycleBin().catch(() => {}); }} title={t("Opens the Recycle Bin, where the data folders are")}>{t("Show Recycle Bin")}</Button>}
        </div>
      </Panel>
    );
  }
  const title = job === "install" ? t("gachamod is installed") : job === "update" || job === "apply" ? (view.version ? t("gachamod is updated to {version}", { version: view.version }) : t("gachamod is updated")) : t("gachamod is repaired");
  return (
    <Panel>
      <Hero title={title} icon="check" sub={opening ? t("Opening it now.") : job === "apply" && !background ? t("It opens with the new version next time.") : undefined} />
      {!opening && job !== "apply" && (
        <div className="setup-actions">
          <Button variant="primary" size="lg" icon="play" autoFocus onClick={() => void api.openApp(view.dir).then(close)}>{t("Open gachamod")}</Button>
          <Button onClick={close}>{t("Close")}</Button>
        </div>
      )}
    </Panel>
  );
}

function Failed({ view, info, retry, close }: { view: Extract<View, { k: "error" }>; info: SetupInfo; retry: () => void; close: () => void }) {
  return (
    <Panel>
      <Hero title={JOB_FAILED[view.job]} icon="warn" sub={tb(view.message)} />
      <div className="setup-actions">
        <Button variant="primary" icon="refresh" autoFocus onClick={retry}>{t("Try again")}</Button>
        {(view.job === "apply" || (info.payload && view.job !== "uninstall" && !fromGitHub(view.job, info))) && (
          <Button icon="package" onClick={() => void api.plainInstaller()} title={t("Windows' plain installer window, which asks each question itself")}>{t("Use the plain installer")}</Button>
        )}
        {view.job === "apply" && info.installed?.ok && (
          <Button icon="play" onClick={() => void api.openApp(info.installed?.dir).then(close)} title={t("Open the version you have, without the update")}>{t("Open gachamod")}</Button>
        )}
        {view.job !== "apply" && (view.job === "repair" ? !info.payload : fromGitHub(view.job, info)) && (
          <Button icon="external" onClick={() => void api.openPage(`${info.homepage}/releases/latest`)} title={t("The latest release on GitHub")}>{t("Download the installer")}</Button>
        )}
        <Button variant="ghost" onClick={close}>{t("Close")}</Button>
      </div>
    </Panel>
  );
}

// ── keyboard and controller ──

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Move focus to the nearest control in a direction (the app's controller rule, lib/gamepad.ts). */
function moveFocus(dx: number, dy: number) {
  // a check box's or switch's input is a hidden 1px box, so where it sits is its label's place
  const rect = (el: HTMLElement) => (el.closest(".check, .toggle") ?? el).getBoundingClientRect();
  const list = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => { const r = rect(el); return r.width > 2 && r.height > 2; });
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !list.includes(cur)) { (list.find((e) => e.closest(".setup-view")) ?? list[0])?.focus(); return; }
  const a = rect(cur), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null, score = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = rect(el), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const along = dx ? (bx - ax) * dx : (by - ay) * dy;
    if (along <= 4) continue;
    const s = along + (dx ? Math.abs(by - ay) : Math.abs(bx - ax)) * 2.2;
    if (s < score) { score = s; best = el; }
  }
  best?.focus();
}

/** Esc and the controller's B go back (or close); the D-pad or left stick moves between controls and A presses. */
function useKeys(back: () => void) {
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      document.documentElement.classList.add("kbd");
      if (e.key === "Escape") { e.preventDefault(); backRef.current(); }
    };
    const mouse = () => document.documentElement.classList.remove("kbd", "pad");
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", mouse);
    let raf = 0;
    const held = new Map<string, number>();
    // an input counts once it has been seen let go: a button already down when the window opens (or one a device
    // reports as always down) mustn't press Install
    const ready = new Set<string>();
    const press = (name: string, on: boolean, now: number, fn: () => void, repeat = false) => {
      if (!on) { held.delete(name); ready.add(name); return; }
      if (!ready.has(name)) return;
      const next = held.get(name);
      if (next === undefined) { held.set(name, now + (repeat ? 380 : Infinity)); fn(); }
      else if (repeat && now >= next) { held.set(name, now + 110); fn(); }
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!document.hasFocus()) return;
      const pad = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected);
      if (!pad) return;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = (i: number) => pad.axes[i] ?? 0;
      if (pad.buttons.some((x) => x.pressed) || pad.axes.some((v) => Math.abs(v) > 0.5)) document.documentElement.classList.add("kbd", "pad");
      press("up", b(12) || ax(1) < -0.6, now, () => moveFocus(0, -1), true);
      press("down", b(13) || ax(1) > 0.6, now, () => moveFocus(0, 1), true);
      press("left", b(14) || ax(0) < -0.6, now, () => moveFocus(-1, 0), true);
      press("right", b(15) || ax(0) > 0.6, now, () => moveFocus(1, 0), true);
      press("a", b(0), now, () => { const el = document.activeElement as HTMLElement | null; if (el && el !== document.body) el.click(); else moveFocus(0, 1); });
      press("b", b(1), now, () => backRef.current());
    };
    const start = () => { if (!raf) raf = requestAnimationFrame(tick); };
    window.addEventListener("gamepadconnected", start);
    if ([...(navigator.getGamepads?.() ?? [])].some((g) => g && g.connected)) start();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", key); window.removeEventListener("mousedown", mouse); window.removeEventListener("gamepadconnected", start); };
  }, []);
}
