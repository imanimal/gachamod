// XXMI's own settings for loading DLLs into the game (launch.rs DllConfig), shared by Settings › Launch options and the warning
// before Genshin Impact starts (home/KickWarning.tsx). XXMI signs Unsafe Mode and the library list, so gachamod can turn
// Unsafe Mode off but not on, and never edits the list. Owner: SETTINGS/AI area.
import type { ReactNode } from "react";
import { Select, Toggle } from "../../ui/kit";
import type { DllConfig } from "../../lib/api";
import { openXxmi } from "../settings/parts";
import { english, t, tb, tx } from "../../lib/i18n";
import "./tools.css";

/** A lock message from the backend (or a note of ours), with a button to open XXMI Launcher when the setting lives there. */
export function lockNote(msg: string | undefined): ReactNode | undefined {
  if (!msg) return undefined;
  const shown = tb(msg);
  if (!/in XXMI Launcher|Only XXMI Launcher/.test(english(msg))) return shown;
  return <span className="tools-lock">{tx("{note}. {button}", {
    note: shown,
    button: <button type="button" className="tools-xxmi" onClick={openXxmi} title={t("Open XXMI Launcher to change it there")}>{t("Open XXMI Launcher")}</button>,
  })}</span>;
}

const INJECT_MODES = [{ value: "HOOK", label: t("Hook") }, { value: "DIRECT", label: t("Direct") }, { value: "SKIP", label: t("Skip") }];

/** `locked`: LaunchConfig.locked. */
export function XxmiDll({ dll, locked, onChange, onUnsafeOff }: {
  dll: DllConfig; locked: Record<string, string>; onChange: (d: Partial<DllConfig>) => void; onUnsafeOff: () => void;
}) {
  const lock = (k: string) => lockNote(locked[k]);
  const list = dll.libraries.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const mode = dll.injectMode || "HOOK";
  const modes = INJECT_MODES.some((m) => m.value === mode) ? INJECT_MODES : [{ value: mode, label: mode }, ...INJECT_MODES];
  const noMods = mode === "SKIP" && !(dll.injectLibraries && list.length > 0);
  const libsOff = !dll.injectLibraries && !list.length;
  const modeTip = t("How XXMI puts its d3d11.dll into the game. Direct is more reliable. Hook is less reliable but may be less visible to anti-cheats. Skip leaves it out, for a d3d11.dll under Inject libraries");
  const libsTip = list.length ? t("Also loads {files}. XXMI Launcher signs this list, so change it in XXMI Launcher", { files: list.join(", ") })
    : t("Also loads the DLLs on a list, like ReShade. The list is empty: add DLLs to it in XXMI Launcher");
  const unsafeTip = t("XXMI loads 3DMigoto DLLs it didn't ship with, like an older GIMI d3d11.dll. Use only ones from a source you trust. Once it's off, only XXMI Launcher can turn it on again");

  const modeHint = lock("dll.injectMode") ?? (noMods ? t("Skip with no libraries injected starts the game without mods") : modeTip);

  return (
    <div className="tools-extras">
      <h3 className="sub-h">{t("How XXMI loads mods")}</h3>
      <Select label={t("Injection mode")} value={mode} options={modes} disabled={!!locked["dll.injectMode"]} onChange={(v) => onChange({ injectMode: v })} hint={modeHint} />
      <Toggle checked={dll.injectLibraries} disabled={!!locked["dll.injectLibraries"] || libsOff}
        onChange={(v) => onChange({ injectLibraries: v })} label={t("Inject libraries")} hint={lock("dll.injectLibraries") ?? lockNote(libsTip)} />
      <Toggle checked={dll.unsafeMode} disabled={!dll.unsafeMode}
        onChange={(v) => { if (!v) onUnsafeOff(); }} label={t("Unsafe mode")} hint={lock("dll.unsafeMode") ?? unsafeTip} />
    </div>
  );
}
