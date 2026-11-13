// The "Keys and options" part of a mod's drawer: key bindings, variables with pickers, problems, conflicts, readmes.
// Owner: MODTOOLS area. LIBRARY's mod drawer renders it.
import { useCallback, useEffect, useRef, useState } from "react";
import { emitApp, useGame } from "../../lib/store";
import { errorKind, errorText, modtools, type KeyBinding, type ModEntry, type ModInspect, type Problem, type VarInfo } from "../../lib/api";
import { Badge, Button, IconButton, Kbd, Panel, Segmented, Select, Skeleton, Toggle, plural, type Tone } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { saved } from "../../ui/motion";
import { turnOff } from "./toolsBadge";
import "./modtools.css";

const varKey = (v: { ini: string; var: string }) => `${v.ini}|${v.var}`;

export const severityTone = (s: string): Tone => (s === "bad" ? "bad" : s === "warn" ? "warn" : "info");
export const severityLabel = (s: string) => (s === "bad" ? "Broken" : s === "warn" ? "Check" : "Note");

export function ModInsides({ mod }: { mod: ModEntry }) {
  const game = useGame();
  const running = !!game?.running;
  const [data, setData] = useState<ModInspect | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // the mod this component shows now, so answers for an earlier mod are dropped
  const current = useRef(mod.id);
  current.current = mod.id;

  useEffect(() => {
    let live = true;
    setFailed(null);
    modtools.inspect(mod.game, mod.id)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) { setData(null); setFailed(errorKind(e) === "todo" ? "Keys and options show here once the library is ready." : errorText(e)); } });
    return () => { live = false; };
  }, [mod.game, mod.id, mod.enabled, reload]);

  const shown = data && data.modId === mod.id ? data : null;
  if (failed) return <p className="mi mi-failed muted">{failed}</p>;
  if (!shown) {
    return (
      <div className="mi mi-loading" aria-busy="true">
        <Skeleton h="1.2rem" w="40%" /><Skeleton h="2.4rem" /><Skeleton h="2.4rem" />
      </div>
    );
  }

  const options = shown.vars.filter((v) => v.persist);
  return (
    <div className="mi">
      {shown.keys.length === 0 && options.length === 0 && (
        <p className="mi-none muted">This mod has no keys or options.</p>
      )}
      {options.length > 0 && (
        <Options mod={mod} vars={options} running={running} stillCurrent={() => current.current === mod.id}
          onSaved={(v, value) => setData((d) => d && d.modId === mod.id ? { ...d, vars: d.vars.map((x) => varKey(x) === varKey(v) ? { ...x, current: value } : x) } : d)} />
      )}
      {shown.keys.length > 0 && <Keys keys={shown.keys} vars={shown.vars} />}
      {shown.problems.length > 0 && <Problems problems={shown.problems} />}
      {shown.conflicts.length > 0 && (
        <Conflicts mod={mod} data={shown} onDone={() => { emitApp({ type: "library-refresh", game: mod.game }); setReload((n) => n + 1); }} />
      )}
      {shown.readmes.length > 0 && (
        <Panel title="Readme" icon="file" className="mi-panel mi-readmes">
          {shown.readmes.map(([name, text]) => (
            <details key={name} className="mi-readme">
              <summary className="mi-readme-h">{name}</summary>
              <pre className="mi-readme-t mono">{text}</pre>
            </details>
          ))}
        </Panel>
      )}
    </div>
  );
}

// ── options ──

function Options({ mod, vars, running, stillCurrent, onSaved }:
  { mod: ModEntry; vars: VarInfo[]; running: boolean; stillCurrent: () => boolean; onSaved: (v: VarInfo, value: string) => void }) {
  const rows = useRef(new Map<string, HTMLElement>());
  const [pending, setPending] = useState<Record<string, string>>({});

  const change = useCallback((v: VarInfo, value: string) => {
    const k = varKey(v);
    setPending((p) => ({ ...p, [k]: value }));
    modtools.setVar(mod.game, mod.id, { ini: v.ini, var: v.var, value })
      .then(() => {
        if (!stillCurrent()) return;
        onSaved(v, value);
        saved(rows.current.get(k));
      })
      .catch((e) => { if (stillCurrent()) toast(errorText(e), true); })
      .finally(() => { if (stillCurrent()) setPending((p) => { const n = { ...p }; delete n[k]; return n; }); });
  }, [mod.game, mod.id, stillCurrent, onSaved]);

  return (
    <Panel title="Options" icon="sliders" className="mi-panel mi-opts-panel">
      {running && <p className="mi-running hint">Close the game to change options. It saves its own values when it closes.</p>}
      {!mod.enabled && <p className="mi-off hint">This mod is off. Options you pick now apply when you turn it on.</p>}
      <fieldset className="mi-opts" disabled={running}>
        {vars.map((v) => {
          const k = varKey(v);
          const value = pending[k] ?? v.current ?? v.default ?? v.values[0] ?? "0";
          const ref = (el: HTMLElement | null) => { if (el) rows.current.set(k, el); else rows.current.delete(k); };
          const title = `$${v.var} in ${v.ini}${v.default !== null ? `, default ${v.default}` : ""}`;
          if (v.kind === "switch") {
            return (
              <div key={k} ref={ref} className="mi-opt mi-opt-switch" title={title}>
                <Toggle checked={value === "1"} disabled={running} onChange={(on) => change(v, on ? "1" : "0")} label={v.label} />
              </div>
            );
          }
          const values = v.values.includes(value) ? v.values : [...v.values, value];
          return (
            <div key={k} ref={ref} className="mi-opt mi-opt-list" title={title}>
              <span className="mi-opt-l">{v.label}</span>
              {values.length <= 5
                ? <Segmented size="sm" label={v.label} value={value} options={values.map((x) => ({ value: x, label: x }))} onChange={(x) => change(v, x)} />
                : <Select value={value} options={values.map((x) => ({ value: x, label: x }))} onChange={(x) => change(v, x)} />}
            </div>
          );
        })}
      </fieldset>
    </Panel>
  );
}

// ── keys ──

function does(k: KeyBinding, labels: Map<string, string>): string {
  const name = (v: string) => labels.get(v) ?? v;
  const vars = k.vars.map((v) => name(v.var));
  if (vars.length === 0) return k.kind === "hold" ? "Does something while held" : "Does something in game";
  const list = vars.length === 1 ? vars[0]! : `${vars.slice(0, -1).join(", ")} and ${vars[vars.length - 1]}`;
  switch (k.kind) {
    case "cycle": return `Changes ${list}`;
    case "toggle": return `Turns ${list} on or off`;
    case "hold": return `Changes ${list} while held`;
    default: return `Sets ${list}`;
  }
}

function Keys({ keys, vars }: { keys: KeyBinding[]; vars: VarInfo[] }) {
  const labels = new Map(vars.map((v) => [v.var, v.label]));
  return (
    <Panel title="Keys" icon="keyboard" className="mi-panel mi-keys" count={keys.length}>
      <ul className="mi-key-list">
        {keys.map((k) => {
          const cycle = k.vars.find((v) => v.values.length > 1);
          return (
            <li key={`${k.ini}|${k.section}`} className="mi-key-row" title={`[${k.section}] in ${k.ini}${k.condition ? `, only when ${k.condition}` : ""}`}>
              <span className="mi-key-chips">
                {(k.labels.length ? k.labels : [k.label]).map((l, i) => <Kbd key={`${l}-${i}`}>{l}</Kbd>)}
                {k.back && <span className="mi-key-back hint">Back <Kbd>{k.back}</Kbd></span>}
              </span>
              <span className="mi-key-what">{does(k, labels)}</span>
              {cycle && (
                <span className="mi-key-vals" aria-label="Values">
                  {cycle.values.map((v, i) => <span key={`${v}-${i}`} className="mi-val badge t-muted">{v}</span>)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ── problems and conflicts ──

function Problems({ problems }: { problems: Problem[] }) {
  return (
    <Panel title="Problems" icon="warn" className="mi-panel mi-problems" count={problems.length}>
      <ul className="mi-prob-list">
        {problems.map((p, i) => (
          <li key={`${p.kind}-${i}`} className={`mi-prob mi-prob-${p.severity}`}>
            <Badge tone={severityTone(p.severity)}>{severityLabel(p.severity)}</Badge>
            <span className="mi-prob-t">{p.detail}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Conflicts({ mod, data, onDone }: { mod: ModEntry; data: ModInspect; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const off = (ids: string[], names: string[], tag: string) => {
    setBusy(tag);
    turnOff(mod.game, ids, names)
      .then(() => { if (live.current) onDone(); })
      .catch((e) => toast(errorText(e), true))
      .finally(() => { if (live.current) setBusy(null); });
  };
  return (
    <Panel title="Conflicts" icon="layers" className="mi-panel mi-conflicts" count={data.conflicts.length}
      actions={<Button size="sm" busy={busy === "all"} disabled={!!busy || !mod.enabled} icon="check"
        title="Turn off the other mods that change the same parts"
        onClick={() => off(data.conflicts.map((c) => c.modId), data.conflicts.map((c) => c.name), "all")}>Keep this one</Button>}>
      <p className="hint mi-conf-hint">These mods are on and change the same parts of the model, so only one of them shows.</p>
      <ul className="mi-conf-list">
        {data.conflicts.map((c) => (
          <li key={c.modId} className="mi-conf">
            <span className="mi-conf-name">{c.name}</span>
            <span className="mi-conf-n hint">{plural(c.shared, "shared part")}</span>
            <IconButton icon="power" size="sm" label={`Turn off ${c.name}`} disabled={!!busy} onClick={() => off([c.modId], [c.name], c.modId)} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
