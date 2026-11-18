// Settings export and import (a JSON file to move gachamod to another PC), and gachamod's own updates for the
// About and updates page. Owner: SETTINGS/AI area. Rust: commands/app.rs, gacha-core settings_file.rs and app_update.rs.
import { useEffect, useState } from "react";
import { oxford } from "../../lib/notes";
import { Button, Checkbox, Confirm, Panel, Progress, Segmented, formatBytes } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { appUpdate, dialogs, errorText, settingsFile, shell, type ImportSummary, type UpdateCheck } from "../../lib/api";
import { record, undo } from "../../lib/history";
import { currentGame, refreshGames } from "../../lib/store";
import { applyGameTheme } from "../../lib/theme";
import { getTextSize, getZoom, setTextSize, setZoom } from "../../lib/zoom";
import { appUpdateModePref, type AppUpdateMode } from "./automatic";
import { lang, sentences, t, tn } from "../../lib/i18n";
import { gameName } from "../../lib/games";

// ── the window's own choices (kept in localStorage, not the database) ──

const isUiKey = (k: string) => k.startsWith("gm.theme.") || k.startsWith("gm.accent.") || k === "gm.scheme" || k.startsWith("gm.scheme.")
  || k === "gm.motion" || k.startsWith("gm.motion.") || k === "gm.layout" || k === "pm.textSize" || k === "gm.zoom" || k === "gm.onlyGame" || k === "gm.schemeMode" || k === "gm.intro";

function readUi(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = k ? localStorage.getItem(k) : null;
      if (k && v !== null && isUiKey(k)) out[k] = v;
    }
  } catch { /* storage unavailable */ }
  return out;
}

/** Write the choices; `replace` also clears ours that the map doesn't have (an undo). */
function writeUi(ui: Record<string, string>, replace: boolean) {
  try {
    if (replace) for (const k of Object.keys(readUi())) if (!(k in ui)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(ui)) if (isUiKey(k)) localStorage.setItem(k, v);
  } catch { /* storage unavailable */ }
  applyGameTheme(currentGame());
  const px = Number(ui["pm.textSize"] ?? (replace ? 14 : getTextSize()));
  if (px && px !== getTextSize()) setTextSize(px);
  const zoom = Number(ui["gm.zoom"] ?? (replace ? 1 : getZoom()));
  if (zoom && zoom !== getZoom()) setZoom(zoom);
}

// ── export and import ──

const refreshGamesSafe = () => refreshGames().then(() => undefined, () => undefined);

export function TransferSection() {
  const [profiles, setProfiles] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ path: string; plan: ImportSummary } | null>(null);

  const exportNow = async () => {
    try {
      const day = new Date().toISOString().slice(0, 10);
      const path = await dialogs.saveFile({ title: t("Export settings"), defaultPath: `gachamod settings ${day}.json`, extensions: ["json"] });
      if (!path) { if (!("__TAURI_INTERNALS__" in window)) toast(t("Saving files works in the app")); return; }
      setBusy(true);
      const r = await settingsFile.export(path, profiles, readUi());
      const games = tn(r.games, "{n} game", "{n} games");
      toast(profiles ? t("Exported settings for {games} and {profiles}", { games, profiles: tn(r.profiles, "{n} profile", "{n} profiles") }) : t("Exported settings for {games}", { games }), false,
        { label: t("Show"), run: () => { shell.revealPath(path).catch((e) => toast(errorText(e), true)); } });
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };

  const pick = async () => {
    try {
      const path = (await dialogs.pickFiles({ title: t("Import settings"), extensions: ["json"] }))?.[0];
      if (!path) { if (!("__TAURI_INTERNALS__" in window)) toast(t("Opening files works in the app")); return; }
      setBusy(true);
      setPending({ path, plan: await settingsFile.preview(path) });
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };

  const apply = async (path: string) => {
    const r = await settingsFile.import(path, readUi());
    writeUi(r.ui, false);
    await refreshGamesSafe();
    let backup = r.backup;
    const entry = record({
      label: t("Imported settings"),
      undo: async () => { writeUi(await settingsFile.undo(backup), true); await refreshGamesSafe(); },
      redo: async () => { const again = await settingsFile.import(path, readUi()); backup = again.backup; writeUi(again.ui, false); await refreshGamesSafe(); },
    }, true);
    const said = [t("Imported settings.")];
    if (r.skippedPaths.length) said.push(t("Skipped what isn't on this PC: {paths}.", { paths: r.skippedPaths.join("; ") }));
    if (r.missingMods) {
      const mods = r.missingNames?.length ? oxford(r.missingNames) : tn(r.missingMods, "{n} mod", "{n} mods");
      said.push(tn(r.missingMods, "Profiles name {mods}, which isn't on this PC.", "Profiles name {mods}, which aren't on this PC.", { mods }));
    }
    const id: number = toast(sentences(said), false, { label: t("Undo import"), run: () => void undo(entry, id) });
  };

  return (
    <Panel title={t("Back up or move your settings")} icon="export" id="transfer">
      <p className="hint set-note">{t("One file with your settings and each game's folders, theme and launch options, to set up gachamod on another PC or keep a copy. Folders that don't exist on the other PC are skipped.")}</p>
      <div className="row">
        <Button icon="export" busy={busy} onClick={() => void exportNow()} title={t("Save a .json file with your settings")}>{t("Export settings")}</Button>
        <Button icon="import" disabled={busy} onClick={() => void pick()} title={t("Read a settings file. You see what changes before anything does")}>{t("Import settings")}</Button>
        <Checkbox checked={profiles} onChange={setProfiles} label={t("Include profiles")} />
      </div>
      {pending && (
        <Confirm title={t("Import settings")} yes={t("Import")} onClose={() => setPending(null)} onYes={() => apply(pending.path).catch((e) => { toast(errorText(e), true); })}>
          <ImportPlan plan={pending.plan} />
        </Confirm>
      )}
    </Panel>
  );
}

function ImportPlan({ plan }: { plan: ImportSummary }) {
  const when = plan.exportedAt ? new Date(plan.exportedAt * 1000).toLocaleDateString(lang) : null;
  const lines: string[] = [];
  if (plan.settings) lines.push(tn(plan.settings, "{n} setting changes", "{n} settings change"));
  if (plan.games.length) lines.push(t("Folders or options change for {games}", { games: oxford(plan.games.map((name) => gameName({ name })), 20) }));
  if (plan.newProfiles.length) lines.push(t("New profiles: {profiles}", { profiles: plan.newProfiles.join(", ") }));
  if (plan.replacedProfiles.length) lines.push(t("Profiles that get the file's mods and values: {profiles}. Switch to one to apply it", { profiles: plan.replacedProfiles.join(", ") }));
  if (Object.keys(plan.ui).length) lines.push(t("Themes, colours and text size follow the file"));
  return (
    <div className="set-import">
      <p className="hint">{when
        ? t("From gachamod {version}, exported {date}. A backup of your current settings is kept, and the toast after offers Undo.", { version: plan.appVersion || "?", date: when })
        : t("From gachamod {version}. A backup of your current settings is kept, and the toast after offers Undo.", { version: plan.appVersion || "?" })}</p>
      {lines.length ? <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p>{t("Nothing changes: your settings already match the file.")}</p>}
      {plan.missingMods > 0 && <p className="hint">{tn(plan.missingMods, "The file's profiles name {mods}, which isn't on this PC. Profiles get the rest.", "The file's profiles name {mods}, which aren't on this PC. Profiles get the rest.",
        { mods: plan.missingNames?.length ? oxford(plan.missingNames, 20) : tn(plan.missingMods, "{n} mod", "{n} mods") })}</p>}
      {plan.skippedPaths.length > 0 && (
        <>
          <p className="hint">{t("Not on this PC, so skipped:")}</p>
          <ul className="mono">{plan.skippedPaths.map((p) => <li key={p}>{p}</li>)}</ul>
        </>
      )}
    </div>
  );
}

// ── updates (the "gachamod updates" panel on About and updates) ──

const UPDATE_MODES: Array<{ value: AppUpdateMode; label: string; title: string }> = [
  { value: "1", label: t("Install"), title: t("Download new versions in the background and install them when you close gachamod") },
  { value: "tell", label: t("Only tell me"), title: t("Say when a new version is out and download nothing until you pick Update now") },
  { value: "0", label: t("Off"), title: t("Never look by itself. Use Check now") },
];
const MODE_SAID: Record<AppUpdateMode, string> = {
  "1": t("Updating gachamod automatically"),
  tell: t("gachamod tells you about new versions without installing them"),
  "0": t("Stopped looking for gachamod updates"),
};

export function UpdateRow() {
  const mode = appUpdateModePref.use();
  const auto = mode === "1";
  const [state, setState] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number | null } | null>(null);

  // what a background check found, and its download while it runs
  useEffect(() => {
    appUpdate.status().then(setState).catch(() => {});
    const offs = [
      appUpdate.onProgress(setProgress),
      appUpdate.onReady(() => { setProgress(null); appUpdate.status().then(setState).catch(() => {}); }),
    ];
    return () => offs.forEach((o) => void o.then((f) => f()));
  }, []);

  const checkNow = async () => {
    setChecking(true);
    try {
      const c = await appUpdate.check();
      setState(c);
      if (!c.reachable) toast(t("Couldn't get update info right now. Try again later"));
      else if (!c.available) toast(t("gachamod {version} is the newest version", { version: c.current }));
    } catch (e) { toast(errorText(e), true); }
    finally { setChecking(false); }
  };

  const install = async () => {
    setInstalling(true);
    // gachamod closes once the installer starts
    try { await appUpdate.install(); }
    catch (e) { toast(errorText(e), true); setProgress(null); setInstalling(false); }
  };

  const r = state?.available ? state.release : null;
  const ready = !!state?.ready;
  const downloading = !!progress && !ready;
  const hint = downloading ? (progress.total ? t("Downloading {done} of {total}", { done: formatBytes(progress.done), total: formatBytes(progress.total) }) : t("Downloading {done}", { done: formatBytes(progress.done) }))
    : ready ? (auto ? t("It installs when you close gachamod, or restart now to get it") : t("Restart gachamod to install it"))
    : t("gachamod closes, updates and opens again");
  return (
    <div className="set-rows set-update">
      <div className="set-row" id="set-app-updates">
        <span><b className="set-tip" title={t("gachamod looks for a new version at start and every 6 hours. Off, it never looks by itself: use Check now")}>{t("Update gachamod automatically")}</b>
          <span className="hint">{mode === "1" ? t("New versions download in the background and install when you close gachamod")
            : mode === "tell" ? t("A message says when a new version is out. Nothing downloads until you pick Update now")
            : t("gachamod doesn't look for new versions by itself")}</span></span>
        <Segmented size="sm" label={t("Update gachamod automatically")} value={mode} options={UPDATE_MODES}
          onChange={(v) => { if (v !== mode) void appUpdateModePref.set(v, MODE_SAID[v]); }} />
      </div>
      <div className="set-row" id="set-app-check">
        <span><b>{t("Check for updates")}</b><span className="hint">{mode !== "0" ? t("Look now instead of waiting for the next check") : t("gachamod doesn't look for new versions by itself")}</span></span>
        <Button size="sm" busy={checking} onClick={() => void checkNow()} title={t("Look for a newer gachamod now")}>{t("Check now")}</Button>
      </div>
      {r && (
        <div className="set-row">
          <span><b>{ready ? t("gachamod {version} is ready", { version: r.version }) : t("gachamod {version} is out", { version: r.version })}</b>
            <span className="hint">{hint}</span>
            {downloading && <Progress value={progress.total ? progress.done / progress.total : null} label={t("Downloading the update")} />}
          </span>
          <Button size="sm" variant="ghost" icon="external" onClick={() => shell.openUrl(r.url).catch((e) => toast(errorText(e), true))} title={t("Open the release notes on GitHub")}>{t("See what's new")}</Button>
          <Button size="sm" variant="primary" icon="install" busy={installing || downloading} onClick={() => void install()}
            title={ready ? t("Close gachamod, install the update and open it again") : t("Download the update, then close gachamod, install it and open it again")}>
            {ready ? t("Restart to update") : t("Update now")}
          </Button>
        </div>
      )}
    </div>
  );
}
