// The steps of the community guide for Genshin Impact's "Illegal tool detected" kick (lib/kickFix.ts), each with the
// place to do it in or the setting itself, and a check once gachamod can see it done. The player does the DLL steps by
// hand: gachamod opens the download page and the folder, and never downloads, copies or changes a DLL. Shown in the
// warning before a start (home/KickWarning.tsx) and on Settings › Launch options. Owner: SETTINGS/AI area.
import type { ReactNode } from "react";
import { Button, Select, Toggle } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { errorText, shell, type DllConfig } from "../../lib/api";
import { useGames } from "../../lib/store";
import { GIMI_DOWNLOAD, useKick } from "../../lib/kickFix";
import { openXxmi } from "../settings/parts";
import { lockNote } from "./XxmiDll";
import "./tools.css";

const MODES = [{ value: "HOOK", label: "Hook" }, { value: "DIRECT", label: "Direct" }, { value: "SKIP", label: "Skip" }];

function Step({ n, done, children }: { n: number; done: boolean; children: ReactNode }) {
  return (
    <li className={done ? "kick-step done" : "kick-step"}>
      <span className="kick-step-n" title={done ? "gachamod sees this step done" : undefined}>{done ? <Icon name="check" /> : n}</span>
      <div className="kick-step-b">{children}</div>
    </li>
  );
}

/** `dll`, `locked`: the launch form for Genshin Impact. `onChange` saves like the form does where it's shown. */
export function KickSteps({ dll, locked, onChange }: { dll: DllConfig; locked: Record<string, string>; onChange: (d: Partial<DllConfig>) => void }) {
  const kick = useKick();
  const gimi = useGames().find((g) => g.id === "gi")?.importerDir ?? null;
  const open = (job: Promise<unknown>) => void job.catch((e) => toast(errorText(e), true));
  // GIMI's d3d11.dll isn't XXMI's own: the first three steps are done
  const dllIn = !!kick?.fixed;
  const mode = dll.injectMode || "HOOK";
  const modes = MODES.some((m) => m.value === mode) ? MODES : [{ value: mode, label: mode }, ...MODES];
  const libs = dll.libraries.split(/\r?\n/).some((s) => s.trim());
  const all = dllIn && dll.unsafeMode && mode === "DIRECT" && !dll.injectLibraries;
  return (
    <div className="kick-steps">
      <ol>
        <Step n={1} done={dllIn}>
          <p>Download 3dmigoto-GIMI-for-playing-mods.zip from GIMI's GitHub page.</p>
          <Button size="sm" variant="ghost" icon="external" title={`Open ${GIMI_DOWNLOAD} in your browser`} onClick={() => open(shell.openUrl(GIMI_DOWNLOAD))}>Open the download page</Button>
        </Step>
        <Step n={2} done={dllIn}><p>Open the zip and take out d3d11.dll.</p></Step>
        <Step n={3} done={dllIn}>
          <p>Paste it into XXMI's GIMI folder, replacing the d3d11.dll there. Don't replace the folder's d3dx.ini.</p>
          {gimi && <Button size="sm" variant="ghost" icon="folder" title={gimi} onClick={() => open(shell.openPath(gimi))}>Open the GIMI folder</Button>}
        </Step>
        <Step n={4} done={dll.unsafeMode}>
          <p>Turn on Unsafe Mode in XXMI Launcher's settings, then close XXMI Launcher so gachamod sees it. XXMI signs this
            setting, so gachamod can't turn it on.</p>
          {!dll.unsafeMode && <Button size="sm" variant="ghost" title="Open XXMI Launcher to turn on Unsafe Mode there" onClick={openXxmi}>Open XXMI Launcher</Button>}
        </Step>
        <Step n={5} done={mode === "DIRECT"}>
          <p>Set Injection mode to Direct.</p>
          <Select label="Injection mode" value={mode} options={modes} disabled={!!locked["dll.injectMode"]} onChange={(v) => onChange({ injectMode: v })}
            hint={lockNote(locked["dll.injectMode"])} />
        </Step>
        <Step n={6} done={!dll.injectLibraries}>
          <p>Turn off Inject libraries.</p>
          <Toggle checked={dll.injectLibraries} disabled={!!locked["dll.injectLibraries"] || (!dll.injectLibraries && !libs)}
            onChange={(v) => onChange({ injectLibraries: v })} label="Inject libraries" hint={lockNote(locked["dll.injectLibraries"])} />
        </Step>
      </ol>
      {all && <p className="hint">Every step looks done.</p>}
    </div>
  );
}
