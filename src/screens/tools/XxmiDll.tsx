// XXMI's own settings for loading DLLs into the game (launch.rs DllConfig), shared by Settings › Launch options and the warning
// before Genshin Impact starts (home/KickWarning.tsx). XXMI signs Unsafe Mode and the library list, so gachamod can turn
// Unsafe Mode off but not on, and never edits the list. Owner: SETTINGS/AI area.
import type { ReactNode } from "react";
import { Select, Toggle } from "../../ui/kit";
import type { DllConfig } from "../../lib/api";
import { openXxmi } from "../settings/parts";
import "./tools.css";

/** A lock message from the backend, with a button to open XXMI Launcher when the setting lives there. */
export function lockNote(msg: string | undefined): ReactNode | undefined {
  if (!msg) return undefined;
  if (!/in XXMI Launcher|Only XXMI Launcher/.test(msg)) return msg;
  return <span className="tools-lock">{msg}. <button type="button" className="tools-xxmi" onClick={openXxmi} title="Open XXMI Launcher to change it there">Open XXMI Launcher</button></span>;
}

const INJECT_MODES = [{ value: "HOOK", label: "Hook" }, { value: "DIRECT", label: "Direct" }, { value: "SKIP", label: "Skip" }];

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
  const modeTip = "How XXMI puts its d3d11.dll into the game. Direct is more reliable. Hook is less reliable but may be less visible to anti-cheats. Skip leaves it out, for a d3d11.dll under Inject libraries";
  const libsTip = list.length ? `Also loads ${list.join(", ")}. XXMI Launcher signs this list, so change it in XXMI Launcher`
    : "Also loads the DLLs on a list, like ReShade. The list is empty: add DLLs to it in XXMI Launcher";
  const unsafeTip = "XXMI loads 3DMigoto DLLs that aren't its own, like an older GIMI d3d11.dll. Use only ones from a source you trust. Once it's off, only XXMI Launcher can turn it on again";

  const modeHint = lock("dll.injectMode") ?? (noMods ? "Skip with no libraries injected starts the game without mods" : modeTip);

  return (
    <div className="tools-extras">
      <h3 className="sub-h">How XXMI loads mods</h3>
      <Select label="Injection mode" value={mode} options={modes} disabled={!!locked["dll.injectMode"]} onChange={(v) => onChange({ injectMode: v })} hint={modeHint} />
      <Toggle checked={dll.injectLibraries} disabled={!!locked["dll.injectLibraries"] || libsOff}
        onChange={(v) => onChange({ injectLibraries: v })} label="Inject libraries" hint={lock("dll.injectLibraries") ?? lockNote(libsTip)} />
      <Toggle checked={dll.unsafeMode} disabled={!dll.unsafeMode}
        onChange={(v) => { if (!v) onUnsafeOff(); }} label="Unsafe mode" hint={lock("dll.unsafeMode") ?? unsafeTip} />
    </div>
  );
}
