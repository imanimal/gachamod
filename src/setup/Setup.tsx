// The setup window: install, update, repair and uninstall, one card on the theme's stage. The common case is one
// click (Install, or Uninstall); everything else sits under Options. src-setup runs NSIS behind it and reports each
// step ("setup-step" events, src-setup/src/jobs.rs).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameState } from "../lib/api";
import { seconds, useElapsed } from "../lib/activity";
import { THEMES, type Scheme } from "../lib/theme-info";
import { Glyphs, Backdrop } from "../ui/Deco";
import { Icon, type IconName } from "../ui/Icon";
import { Button, Card, Checkbox, formatBytes, Progress, Segmented, Select, Spinner, Toggle } from "../ui/kit";
import { api, type SetupInfo, type Step } from "./api";
import { applyLook, schemeOf } from "./look";

type Job = "install" | "update" | "repair" | "uninstall";
type View =
  | { k: "start" }
  | { k: "uninstall" }
  | { k: "work"; job: Job }
  | { k: "done"; job: Job; dir?: string; dataGone?: boolean }
  | { k: "error"; job: Job; message: string };

const JOB_TITLE: Record<Job, string> = { install: "Installing gachamod", update: "Updating gachamod", repair: "Repairing gachamod", uninstall: "Uninstalling gachamod" };
const STEP_LABEL: Record<string, string> = {
  unpack: "Unpack the installer", download: "Download gachamod", verify: "Check the download", close: "Close gachamod",
  copy: "Copy gachamod", remove: "Remove gachamod", data: "Move its data to the Recycle Bin",
};

/** -1, 0 or 1 for "1.2.3" style versions. */
function cmp(a: string, b: string): number {
  const p = (v: string) => v.replace(/^v/, "").split("-")[0]!.split(".").map((n) => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return Math.sign(d); }
  return 0;
}


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
  const [admin, setAdmin] = useState(false);
  const [openAfter, setOpenAfter] = useState(true);
  const [deleteData, setDeleteData] = useState(false);
  const [dataSize, setDataSize] = useState<number | null>(null);
  const [pick, setPick] = useState<{ theme?: string; scheme?: Scheme }>({});

  useEffect(() => {
    api.info().then((i) => {
      setInfo(i); setDesktop(i.desktop); setAdmin(i.admin);
      applyLook(i.look);
      if (i.mode === "uninstall") setView({ k: "uninstall" });
      requestAnimationFrame(() => void api.win("show"));
    }).catch((e) => { setFailed(String(e)); void api.win("show"); });
  }, []);
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
      if (job === "install" || job === "update") out = await api.install({ dir, desktop, admin });
      else if (job === "repair") out = await api.repair();
      else await api.uninstall(deleteData);
      setView({ k: "done", job, dir: out || info.installed?.dir, dataGone: job === "uninstall" && deleteData });
      if ((job === "install" || job === "update") && openAfter) {
        await api.openApp(out).catch(() => undefined);
        setTimeout(() => void api.win("close"), 1400);
      }
    } catch (e) {
      setView({ k: "error", job, message: String(e) });
    }
  }, [info, dir, desktop, admin, deleteData, openAfter]);

  // a repair started from Windows (--repair) begins at once
  const started = useRef(false);
  useEffect(() => { if (info?.mode === "repair" && !started.current) { started.current = true; void run("repair"); } }, [info, run]);
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
  const title = info?.mode === "uninstall" ? "Uninstall gachamod" : info?.mode === "repair" ? "Repair gachamod" : "gachamod setup";

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
            <button type="button" className="wk" aria-label="Minimise" onClick={() => void api.win("minimize")}><Icon name="minus" /></button>
            <button type="button" className="wk wk-x" aria-label={busy ? "Setup can't close while it works" : "Close (Esc)"} disabled={busy} onClick={close}><Icon name="x" /></button>
          </span>
        </div>
      </header>
      <main className="view setup-view">
        {failed ? (
          <Panel><Hero title="Setup couldn't start" sub={failed} icon="warn" /></Panel>
        ) : !info ? (
          <Panel><p className="setup-wait"><Spinner /> Looking for gachamod on this PC</p></Panel>
        ) : view.k === "work" ? (
          <Working job={view.job} step={step} done={done} since={since} info={info} />
        ) : view.k === "done" ? (
          <Done view={view} info={info} openAfter={openAfter} close={close} />
        ) : view.k === "error" ? (
          <Failed view={view} info={info} retry={() => void run(view.job)} close={close} />
        ) : view.k === "uninstall" ? (
          <Uninstall info={info} deleteData={deleteData} setDeleteData={setDeleteData} dataSize={dataSize}
            go={() => void run("uninstall")} repair={() => void run("repair")} cancel={info.mode === "uninstall" ? close : () => setView({ k: "start" })} />
        ) : info.mode === "install" ? (
          <Install info={info} open={open} setOpen={setOpen} go={(job) => void run(job)} uninstall={() => setView({ k: "uninstall" })}
            dir={dir} setDir={setDir} desktop={desktop} setDesktop={setDesktop} admin={admin} setAdmin={setAdmin}
            openAfter={openAfter} setOpenAfter={setOpenAfter} pick={pick} setPick={setPick} />
        ) : (
          <Maintain info={info} repair={() => void run("repair")} uninstall={() => setView({ k: "uninstall" })} />
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

function Install(p: {
  info: SetupInfo; open: boolean; setOpen: (v: boolean) => void; go: (job: Job) => void; uninstall: () => void;
  dir: string | null; setDir: (v: string | null) => void; desktop: boolean; setDesktop: (v: boolean) => void;
  admin: boolean; setAdmin: (v: boolean) => void; openAfter: boolean; setOpenAfter: (v: boolean) => void;
  pick: { theme?: string; scheme?: Scheme }; setPick: (v: { theme?: string; scheme?: Scheme }) => void;
}) {
  const { info } = p;
  const inst = info.installed;
  const c = inst?.version ? cmp(info.version, inst.version) : 1;
  const game = info.look.game;
  // already there, same version or newer: open it, or repair or uninstall it
  if (inst && inst.ok && c <= 0) {
    return (
      <Panel>
        <Hero title="gachamod" sub={c === 0 ? `Version ${inst.version} is installed.` : `A newer version, ${inst.version}, is installed. This setup has ${info.version}.`} />
        <p className="setup-p" title={inst.dir}>It's in {inst.dir}.</p>
        <div className="setup-actions">
          <Button variant="primary" size="lg" icon="play" autoFocus onClick={() => void api.openApp(inst.dir).then(() => api.win("close"))}>Open gachamod</Button>
          <Button icon="refresh" onClick={() => p.go("repair")} title="Put gachamod's files, shortcuts and Windows settings back. Your mods and settings stay">Repair</Button>
          <Button variant="ghost" icon="trash" onClick={p.uninstall}>Uninstall</Button>
        </div>
      </Panel>
    );
  }
  const update = !!inst;
  // installed but its exe is gone, and this setup is no newer: put it back
  const fix = !!inst && !inst.ok && c <= 0;
  const job: Job = fix ? "repair" : update ? "update" : "install";
  const sub = !inst ? `Version ${info.version}`
    : fix ? "gachamod.exe is missing from its folder. This puts it back."
    : inst.version ? `Version ${inst.version} is installed. This updates it to ${info.version}.`
    : `This installs version ${info.version} over the copy you have.`;
  const where = p.dir ?? inst?.dir ?? info.defaultDir;
  // a fresh install from a game's own setup starts in one-game mode (src-setup look.rs named_game)
  const named = !inst && !!game && info.look.source !== "app" && info.look.source !== "default";
  const themes = THEMES.filter((t) => !t.hidden || t.id === info.look.theme);
  const themeNow = p.pick.theme ?? (themes.some((t) => t.id === info.look.theme) ? info.look.theme : "default");
  const schemeNow = p.pick.scheme ?? schemeOf(info.look, themeNow);
  return (
    <Panel>
      <Hero title="gachamod" sub={sub} />
      {!p.open ? (
        <p className="setup-p">{game
          ? `Browse GameBanana, install with one click and switch ${game.name} skins per character, all from one window.${named ? ` It handles your other games too, and starts with only ${game.short} in the sidebar.` : ""}`
          : "Browse GameBanana, install with one click and switch skins per character in Genshin Impact, Star Rail, Zenless Zone Zero, Wuthering Waves and other 3DMigoto games."}</p>
      ) : (
        <div className="setup-opts">
          {!update && (
            <div className="setup-row">
              <span className="setup-path" title={where}>{where}</span>
              <Button size="sm" icon="folder" onClick={() => void api.pickFolder(where).then((d) => { if (d) p.setDir(d); })}>Change</Button>
            </div>
          )}
          <Toggle checked={p.desktop} onChange={p.setDesktop} label="Desktop shortcut" />
          <Toggle checked={p.admin} onChange={p.setAdmin} label="Start gachamod as administrator"
            hint="Lets its hotkeys and its menu work in games that run as administrator, like Zenless Zone Zero, and reload their mods without you pressing F10. Windows asks for permission each time it starts." />
          <Toggle checked={p.openAfter} onChange={p.setOpenAfter} label={`Open gachamod when it's ${update ? "updated" : "installed"}`} />
          <div className="setup-row setup-look" title="Only changes how setup looks">
            <Select label="Setup's look" value={themeNow} options={themes.map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => p.setPick({ ...p.pick, theme: v })} />
            <Segmented label="Dark or light" value={schemeNow} onChange={(v) => p.setPick({ ...p.pick, scheme: v })}
              options={[{ value: "dark", label: "", icon: "moon", title: "Dark" }, { value: "light", label: "", icon: "sun", title: "Light" }]} />
          </div>
        </div>
      )}
      <div className="setup-actions">
        <Button variant="primary" size="lg" icon={fix ? "refresh" : update ? "update" : "install"} autoFocus onClick={() => p.go(job)}>
          {fix ? "Repair" : update ? `Update to ${info.version}` : "Install"}
        </Button>
        <Button variant="ghost" icon="sliders" onClick={() => p.setOpen(!p.open)} aria-expanded={p.open}
          title={p.open ? "Back (Esc)" : "Folder, shortcuts, administrator and setup's look"}>{p.open ? "Hide options" : "Options"}</Button>
      </div>
      {(!p.open || info.running) && (
        <p className="setup-note" title={where}>
          {!p.open && (update ? "Your mods, profiles and settings stay." : `Installs for your Windows account in ${where}. No administrator rights needed.`)}
          {info.running && " gachamod is open, so it closes first."}
        </p>
      )}
    </Panel>
  );
}

function Maintain({ info, repair, uninstall }: { info: SetupInfo; repair: () => void; uninstall: () => void }) {
  const inst = info.installed;
  if (!inst) {
    return (
      <Panel>
        <Hero title="gachamod isn't installed" sub="There's nothing here to repair or uninstall." />
        <div className="setup-actions">
          <Button variant="primary" icon="external" autoFocus onClick={() => void api.openPage(`${info.homepage}/releases/latest`)}>Get gachamod</Button>
        </div>
      </Panel>
    );
  }
  return (
    <Panel>
      <Hero title="gachamod" sub={inst.version ? `Version ${inst.version}` : undefined} />
      <p className="setup-p" title={inst.dir}>
        {inst.ok ? `It's in ${inst.dir}.` : `gachamod.exe is missing from ${inst.dir}. Repair puts it back.`}
      </p>
      <div className="setup-choices">
        <Card onClick={repair} className="setup-choice" title="Downloads gachamod again when this PC doesn't have a copy of the installer">
          <span className="setup-choice-h"><Icon name="refresh" /> Repair</span>
          <span className="setup-choice-p">Puts gachamod's files, shortcuts and Windows settings back. Your mods and settings stay.</span>
        </Card>
        <Card onClick={uninstall} className="setup-choice">
          <span className="setup-choice-h"><Icon name="trash" /> Uninstall</span>
          <span className="setup-choice-p">Removes gachamod from this PC. Your mods stay in their game folders.</span>
        </Card>
      </div>
      <div className="setup-actions">
        <Button icon="play" disabled={!inst.ok} onClick={() => void api.openApp(inst.dir).then(() => api.win("close"))}>Open gachamod</Button>
      </div>
    </Panel>
  );
}

function Uninstall({ info, deleteData, setDeleteData, dataSize, go, repair, cancel }: {
  info: SetupInfo; deleteData: boolean; setDeleteData: (v: boolean) => void; dataSize: number | null; go: () => void; repair: () => void; cancel: () => void;
}) {
  const inst = info.installed;
  if (!inst) {
    return (
      <Panel>
        <Hero title="gachamod isn't installed" sub="There's nothing to uninstall." />
        <div className="setup-actions"><Button variant="primary" autoFocus onClick={cancel}>Close</Button></div>
      </Panel>
    );
  }
  const size = dataSize === null ? "counting" : formatBytes(dataSize);
  return (
    <Panel>
      <Hero title="Uninstall gachamod?" sub={inst.version ? `Version ${inst.version}, in ${inst.dir}` : inst.dir} />
      <p className="setup-p">Your mods stay in their game folders and keep working with XXMI.</p>
      <div className="setup-check" title={info.dataDirs.join("\n")}>
        <Checkbox checked={deleteData} onChange={setDeleteData} label={`Also delete gachamod's data (${size})`} />
        <span className="hint">Settings, profiles, downloads, backups and gachamod's trash. They go to the Recycle Bin.</span>
      </div>
      <div className="setup-actions">
        <Button variant="danger" size="lg" icon="trash" onClick={go}>Uninstall</Button>
        <Button icon="refresh" onClick={repair} title="Put gachamod's files back instead, if it isn't working">Repair instead</Button>
        <Button variant="ghost" autoFocus onClick={cancel} title="Esc">Cancel</Button>
      </div>
      {info.running && <p className="setup-note">gachamod is open, so it closes first.</p>}
    </Panel>
  );
}

function plan(job: Job, info: SetupInfo): string[] {
  const close = info.running ? ["close"] : [];
  if (job === "uninstall") return [...close, "remove"];
  if (job === "repair") {
    const own = info.payload && (!info.installed?.version || cmp(info.version, info.installed.version) >= 0);
    return [...(own ? ["unpack"] : ["download", "verify"]), ...close, "copy"];
  }
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
  const label = (id: string) => (id === "copy" ? (job === "repair" ? "Put back gachamod's files" : job === "update" ? "Update gachamod" : "Copy gachamod") : STEP_LABEL[id] ?? id);
  return (
    <Panel>
      <Hero title={JOB_TITLE[job]} sub={job === "uninstall" ? "Your mods stay where they are." : "Your mods and settings stay where they are."} />
      <ol className="setup-steps">
        {list.map((id) => {
          const now = step?.step === id;
          const ok = done.includes(id) || step?.step === "done";
          return (
            <li key={id} className={`setup-step${now ? " now" : ""}${ok ? " ok" : ""}`}>
              <span className="setup-step-i">{ok ? <Icon name="check" /> : now ? <Spinner /> : <span className="setup-dot" />}</span>
              <span className="setup-step-b">
                <span className="setup-step-t">{now && step ? step.text : label(id)}{now && s >= 3 ? ` (${seconds(s)})` : ""}</span>
                {now && step && step.value !== null && <Progress value={step.value} label={step.text} />}
                {now && step?.hold && s >= 10 && <span className="hint">{step.hold}</span>}
                {now && id === "copy" && s >= 60 && <Button size="sm" variant="ghost" icon="x" onClick={() => void api.stop()} title="End the installer. Run setup again or pick Repair to finish">Stop</Button>}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function Done({ view, info, openAfter, close }: { view: Extract<View, { k: "done" }>; info: SetupInfo; openAfter: boolean; close: () => void }) {
  const { job } = view;
  if (job === "uninstall") {
    return (
      <Panel>
        <Hero title="gachamod is uninstalled" icon="check" sub="Your mods are still in their game folders." />
        {view.dataGone && <p className="setup-p">Its data is in the Recycle Bin if you want it back.</p>}
        <div className="setup-actions"><Button variant="primary" autoFocus onClick={close}>Close</Button></div>
      </Panel>
    );
  }
  const opening = (job === "install" || job === "update") && openAfter;
  const title = job === "install" ? "gachamod is installed" : job === "update" ? `gachamod is updated to ${info.version}` : "gachamod is repaired";
  return (
    <Panel>
      <Hero title={title} icon="check" sub={opening ? "Opening it now." : undefined} />
      {!opening && (
        <div className="setup-actions">
          <Button variant="primary" size="lg" icon="play" autoFocus onClick={() => void api.openApp(view.dir).then(close)}>Open gachamod</Button>
          <Button onClick={close}>Close</Button>
        </div>
      )}
    </Panel>
  );
}

function Failed({ view, info, retry, close }: { view: Extract<View, { k: "error" }>; info: SetupInfo; retry: () => void; close: () => void }) {
  const what = view.job === "uninstall" ? "uninstall" : view.job === "repair" ? "repair" : view.job === "update" ? "update" : "install";
  return (
    <Panel>
      <Hero title={`Couldn't ${what} gachamod`} icon="warn" sub={view.message} />
      <div className="setup-actions">
        <Button variant="primary" icon="refresh" autoFocus onClick={retry}>Try again</Button>
        {info.payload && view.job !== "uninstall" && (
          <Button icon="package" onClick={() => void api.plainInstaller()} title="Windows' plain installer window, which asks each question itself">Use the plain installer</Button>
        )}
        {!info.payload && view.job === "repair" && (
          <Button icon="external" onClick={() => void api.openPage(`${info.homepage}/releases/latest`)} title="The latest release on GitHub">Download the installer</Button>
        )}
        <Button variant="ghost" onClick={close}>Close</Button>
      </div>
    </Panel>
  );
}

// ── keyboard and controller ──

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Move focus to the nearest control in a direction (the app's controller rule, lib/gamepad.ts). */
function moveFocus(dx: number, dy: number) {
  const list = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !list.includes(cur)) { (list.find((e) => e.closest(".setup-view")) ?? list[0])?.focus(); return; }
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null, score = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
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
