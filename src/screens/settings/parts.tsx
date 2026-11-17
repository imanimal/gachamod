// Small pieces every settings section uses. Owner: SETTINGS/AI area.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { RowLabel } from "../../ui/kit";
import { errorText, settings, xxmi } from "../../lib/api";
import { toast } from "../../ui/toast";

// ── a setting with a default, saved on change ──

export function useSetting(key: string, fallback: string): [string, (v: string) => void] {
  const [v, setV] = useState(fallback);
  useEffect(() => {
    let live = true;
    settings.get(key).then((x) => { if (live && x !== null) setV(x); }).catch(() => {});
    return () => { live = false; };
  }, [key]);
  const set = useCallback((nv: string) => {
    setV(nv);
    settings.set(key, nv).catch((e) => toast(errorText(e), true));
  }, [key]);
  return [v, set];
}

/** One row: a label, an optional short hint under it, the control on the right. `tip` is a hover tip on the label
 *  for terms a basic modder may not know. */
export function SetRow({ id, label, hint, tip, children }: { id?: string; label: string; hint?: string; tip?: string; children: ReactNode }) {
  const labelId = useId();
  const row = useRef<HTMLDivElement>(null);
  // A row whose only control is a switch flips it when its name is clicked, like a checkbox label
  const [sw, setSw] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    const all = row.current?.querySelectorAll<HTMLInputElement>('input[role="switch"]');
    setSw(all && all.length === 1 ? all[0] : null);
  });
  return (
    <div className="set-row" id={id} ref={row}>
      <span><b id={labelId} title={tip} className={tip ? "set-tip" : undefined} style={sw ? { cursor: "pointer" } : undefined}
        onClick={sw ? () => { if (!sw.disabled) sw.click(); } : undefined}>{label}</b>{hint && <span className="hint">{hint}</span>}</span>
      <RowLabel.Provider value={labelId}>{children}</RowLabel.Provider>
    </div>
  );
}


/** Open XXMI Launcher, with a toast when it can't. */
export function openXxmi() { xxmi.open().catch((e) => toast(errorText(e), true)); }
