// Settings export and import (a JSON file to move gachamod to another PC), and gachamod's own update check for the
// About section. Owner: SYSTEM area. Rust: commands/app.rs, gacha-core settings_file.rs and app_update.rs.
import { useEffect, useState } from "react";
import { Button, Checkbox, Confirm, Panel, Progress, Toggle, formatBytes, plural } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { appUpdate, dialogs, errorText, settings, settingsFile, shell, type ImportSummary, type UpdateCheck } from "../../lib/api";
import { record, undo } from "../../lib/history";
import { currentGame, refreshGames } from "../../lib/store";
import { applyGameTheme } from "../../lib/theme";
import { getTextSize, setTextSize } from "../../lib/zoom";

// ── the window's own choices (kept in localStorage, not the database) ──

const isUiKey = (k: string) => k.startsWith("gm.theme.") || k.startsWith("gm.accent.") || k === "gm.scheme" || k === "gm.motion" || k === "pm.textSize";

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
      const path = await dialogs.saveFile({ title: "Export settings", defaultPath: `gachamod settings ${day}.json`, extensions: ["json"] });
      if (!path) { if (!("__TAURI_INTERNALS__" in window)) toast("Saving files works in the app"); return; }
      setBusy(true);
      const r = await settingsFile.export(path, profiles, readUi());
      toast(`Exported settings for ${plural(r.games, "game")}${profiles ? ` and ${plural(r.profiles, "profile")}` : ""}`, false,
        { label: "Show", run: () => { shell.revealPath(path).catch((e) => toast(errorText(e), true)); } });
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };

  const pick = async () => {
    try {
      const path = (await dialogs.pickFiles({ title: "Import settings", extensions: ["json"] }))?.[0];
      if (!path) { if (!("__TAURI_INTERNALS__" in window)) toast("Opening files works in the app"); return; }
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
      label: "Imported settings",
      undo: async () => { writeUi(await settingsFile.undo(backup), true); await refreshGamesSafe(); },
      redo: async () => { const again = await settingsFile.import(path, readUi()); backup = again.backup; writeUi(again.ui, false); await refreshGamesSafe(); },
    }, true);
    const skipped = r.skippedPaths.length ? ` Skipped what isn't on this PC: ${r.skippedPaths.join("; ")}.` : "";
    const missing = r.missingMods ? ` ${plural(r.missingMods, "mod")} in profiles aren't here.` : "";
    const id: number = toast(`Imported settings.${skipped}${missing}`, false, { label: "Undo import", run: () => void undo(entry, id) });
  };

  return (
    <Panel title="Back up and move" icon="export" id="transfer">
      <p className="hint set-note">One file with your settings and each game's folders, theme and launch options, to set up gachamod on another PC or keep a copy.
        Folders that don't exist on the other PC are skipped.</p>
      <div className="row">
        <Button icon="export" busy={busy} onClick={() => void exportNow()} title="Save a .json file with your settings">Export settings</Button>
        <Button icon="import" disabled={busy} onClick={() => void pick()} title="Read a settings file. You see what changes before anything does">Import settings</Button>
        <Checkbox checked={profiles} onChange={setProfiles} label="Include profiles" />
      </div>
      {pending && (
        <Confirm title="Import settings" yes="Import" onClose={() => setPending(null)} onYes={() => apply(pending.path).catch((e) => { toast(errorText(e), true); })}>
          <ImportPlan plan={pending.plan} />
        </Confirm>
      )}
    </Panel>
  );
}

function ImportPlan({ plan }: { plan: ImportSummary }) {
  const when = plan.exportedAt ? new Date(plan.exportedAt * 1000).toLocaleDateString() : null;
  const lines: string[] = [];
  if (plan.settings) lines.push(`${plural(plan.settings, "setting")} change`);
  if (plan.games.length) lines.push(`Folders or options change for ${plan.games.join(", ")}`);
  if (plan.newProfiles.length) lines.push(`New profiles: ${plan.newProfiles.join(", ")}`);
  if (plan.replacedProfiles.length) lines.push(`Profiles that get the file's mods and values: ${plan.replacedProfiles.join(", ")}. Switch to one to apply it`);
  if (Object.keys(plan.ui).length) lines.push("Themes, colours and text size follow the file");
  return (
    <div className="set-import">
      <p className="hint">From gachamod {plan.appVersion || "?"}{when ? `, exported ${when}` : ""}. A backup of your current settings is kept, and the toast after offers Undo.</p>
      {lines.length ? <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p>Nothing changes: your settings already match the file.</p>}
      {plan.missingMods > 0 && <p className="hint">{plural(plan.missingMods, "mod")} in the file's profiles aren't on this PC and are left out.</p>}
      {plan.skippedPaths.length > 0 && (
        <>
          <p className="hint">Not on this PC, so skipped:</p>
          <ul className="mono">{plan.skippedPaths.map((p) => <li key={p}>{p}</li>)}</ul>
        </>
      )}
    </div>
  );
}

// ── updates (About section) ──

const UPDATE_KEY = "app.updateCheck";

export function UpdateRow() {
  const [auto, setAuto] = useState(true);
  const [state, setState] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number | null } | null>(null);

  useEffect(() => { settings.get(UPDATE_KEY).then((v) => setAuto(v !== "0")).catch(() => {}); }, []);
  const setAutoSaved = (v: boolean) => { setAuto(v); settings.set(UPDATE_KEY, v ? "1" : "0").catch((e) => toast(errorText(e), true)); };

  const checkNow = async () => {
    setChecking(true);
    try {
      const c = await appUpdate.check();
      setState(c);
      if (!c.reachable) toast("Couldn't get update info right now. Try again later");
      else if (!c.available) toast(`gachamod ${c.current} is the newest version`);
    } catch (e) { toast(errorText(e), true); }
    finally { setChecking(false); }
  };

  const install = async () => {
    const asset = state?.release?.asset;
    if (!asset) return;
    setProgress({ done: 0, total: asset.size || null });
    const off = appUpdate.onProgress(setProgress);
    try { await appUpdate.install(asset); }
    catch (e) { toast(errorText(e), true); setProgress(null); }
    finally { void off.then((f) => f()); }
  };

  const r = state?.available ? state.release : null;
  return (
    <div className="set-rows set-update">
      <div className="set-row">
        <span><b>Check for updates</b><span className="hint">Looks for a new gachamod once a day when it starts. Nothing installs unless you press Install</span></span>
        <Button size="sm" busy={checking} onClick={() => void checkNow()} title="Look for a newer gachamod now">Check now</Button>
        <Toggle checked={auto} onChange={setAutoSaved} />
      </div>
      {r && (
        <div className="set-row">
          <span><b>gachamod {r.version} is out</b>
            <span className="hint">{progress ? `Downloading ${formatBytes(progress.done)}${progress.total ? ` of ${formatBytes(progress.total)}` : ""}. gachamod closes when the installer starts` : r.asset ? `Installer ${formatBytes(r.asset.size)}` : "This release has no installer. Get it from the release page"}</span>
            {progress && <Progress value={progress.total ? progress.done / progress.total : null} label="Downloading the update" />}
          </span>
          <Button size="sm" variant="ghost" icon="external" onClick={() => shell.openUrl(r.url).catch((e) => toast(errorText(e), true))}>See what's new</Button>
          {r.asset && <Button size="sm" variant="primary" icon="install" busy={!!progress} onClick={() => void install()}>Install</Button>}
        </div>
      )}
    </div>
  );
}
