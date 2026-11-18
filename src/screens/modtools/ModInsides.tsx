// The "Keys and options" part of a mod's drawer: options with pickers, problems, conflicts, readmes. The keys themselves are
// edited by ui/KeyEditor.tsx above it. Owner: MODTOOLS area. LIBRARY's mod drawer renders it.
import { useCallback, useEffect, useRef, useState } from "react";
import { emitApp, go, useGame } from "../../lib/store";
import { backups, errorKind, errorText, modtools, type MergedInfo, type ModEntry, type ModInspect, type Problem, type VarInfo } from "../../lib/api";
import { record } from "../../lib/history";
import { Badge, Button, IconButton, Panel, Segmented, Select, Skeleton, Toggle, Waiting, formatBytes, type Tone } from "../../ui/kit";
import { t, tb, tn } from "../../lib/i18n";
import { toast } from "../../ui/toast";
import { saved } from "../../ui/motion";
import { dropShared, ignoreConflict, turnOff } from "./toolsBadge";
import { FixButton } from "./FixButton";
import { onKeysChanged } from "../../ui/KeyEditor";
import "./modtools.css";

const varKey = (v: { ini: string; var: string }) => `${v.ini}|${v.var}`;

export const severityTone = (s: string): Tone => (s === "bad" ? "bad" : s === "warn" ? "warn" : "info");
export const severityLabel = (s: string) => (s === "bad" ? t("Broken") : s === "warn" ? t("Warning") : t("Note"));
export const severityHint = (s: string) => (s === "bad"
  ? t("Part of the mod won't show, or shows wrong, in game")
  : s === "warn" ? t("The mod works, but this part may not, or only in some cases") : t("Doesn't change how the mod looks in game"));

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
      .catch((e) => { if (live) { setData(null); setFailed(errorKind(e) === "todo" ? t("Toggles and options show here once the library is ready.") : errorText(e)); } });
    return () => { live = false; };
  }, [mod.game, mod.id, mod.enabled, reload]);
  // a fix or its Undo changed this mod's files
  useEffect(() => onKeysChanged((g, id) => { if (g === mod.game && id === mod.id) setReload((n) => n + 1); }), [mod.game, mod.id]);

  const shown = data && data.modId === mod.id ? data : null;
  if (failed) return <p className="mi mi-failed muted">{failed}</p>;
  if (!shown) {
    return (
      <Waiting className="mi mi-loading" what={t("Reading the mod's files")}>
        <Skeleton h="1.2rem" w="40%" /><Skeleton h="2.4rem" /><Skeleton h="2.4rem" />
      </Waiting>
    );
  }

  const options = shown.vars.filter((v) => v.persist);
  return (
    <div className="mi">
      {shown.keys.length === 0 && options.length === 0 && (
        <p className="mi-none muted">{t("This mod has no toggles or options.")}</p>
      )}
      {options.length > 0 && (
        <Options mod={mod} vars={options} running={running} stillCurrent={() => current.current === mod.id}
          onSaved={(v, value) => setData((d) => d && d.modId === mod.id ? { ...d, vars: d.vars.map((x) => varKey(x) === varKey(v) ? { ...x, current: value } : x) } : d)} />
      )}
      {shown.merged && <Merged mod={mod} info={shown.merged} running={running} />}
      {shown.problems.length > 0 && <Problems mod={mod} problems={shown.problems} onFixed={() => setReload((n) => n + 1)} />}
      {shown.conflicts.length > 0 && (
        <Conflicts mod={mod} data={shown} onDone={() => { emitApp({ type: "library-refresh", game: mod.game }); setReload((n) => n + 1); }} />
      )}
      {shown.readmes.length > 0 && (
        <Panel title={t("Readme")} icon="file" className="mi-panel mi-readmes">
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
    <Panel title={t("Options")} icon="sliders" className="mi-panel mi-opts-panel">
      {running && <p className="mi-running hint">{t("Close the game to change options. The game saves its values when it closes.")}</p>}
      {!mod.enabled && <p className="mi-off hint">{t("This mod is off. Options you pick now apply when you turn it on.")}</p>}
      <fieldset className="mi-opts" disabled={running}>
        {vars.map((v) => {
          const k = varKey(v);
          const value = pending[k] ?? v.current ?? v.default ?? v.values[0] ?? "0";
          const ref = (el: HTMLElement | null) => { if (el) rows.current.set(k, el); else rows.current.delete(k); };
          const title = v.default !== null ? t("${var} in {ini}, default {value}", { var: v.var, ini: v.ini, value: v.default }) : t("${var} in {ini}", { var: v.var, ini: v.ini });
          if (v.kind === "switch") {
            return (
              <div key={k} ref={ref} className="mi-opt mi-opt-switch" title={title}>
                <Toggle checked={value === "1"} disabled={running} onChange={(on) => change(v, on ? "1" : "0")} label={v.label} />
              </div>
            );
          }
          const values = v.values.includes(value) ? v.values : [...v.values, value];
          // a merged mod's swap values are its variants: show their names
          const opts = values.map((x) => ({ value: x, label: v.names?.[x] ?? x }));
          return (
            <div key={k} ref={ref} className="mi-opt mi-opt-list" title={title}>
              <span className="mi-opt-l">{v.label}</span>
              {values.length <= 5 && !v.names
                ? <Segmented size="sm" label={v.label} value={value} options={opts} onChange={(x) => change(v, x)} />
                : <Select title={v.label} value={value} options={opts} onChange={(x) => change(v, x)} />}
            </div>
          );
        })}
      </fieldset>
    </Panel>
  );
}

// ── merged mods ──

/** A mod made of several by the merge script: what's inside, and splitting it back into separate mods. */
function Merged({ mod, info, running }: { mod: ModEntry; info: MergedInfo; running: boolean }) {
  const [busy, setBusy] = useState(false);
  const n = info.variants.length;
  const split = async () => {
    setBusy(true);
    try {
      const r = await modtools.splitMerged(mod.game, mod.id);
      emitApp({ type: "library-refresh", game: mod.game });
      let backup = r.backup;
      const flip = async () => { backup = await backups.restore(backup.id); emitApp({ type: "library-refresh", game: mod.game }); };
      record({
        label: tn(r.mods.length, "Split {name} into {n} mod", "Split {name} into {n} mods", { name: mod.name }),
        brief: tn(r.mods.length, "Split the mod into {n} mod", "Split the mod into {n} mods"),
        undo: flip, redo: flip,
      });
    } catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };
  const why = running ? t("Close the game first. Mods can't move while it has them open") : info.blocked ? tb(info.blocked) : null;
  return (
    <Panel title={t("Merged mod")} icon="layers" className="mi-panel mi-merged">
      <p className="hint">{tn(n, "Made from {n} mod with the merge script. A key switches between them:", "Made from {n} mods with the merge script. A key switches between them:")} {info.variants.map((v) => v.name).join(", ")}</p>
      <div className="row">
        <Button icon="layers" busy={busy} disabled={!!why} onClick={() => void split()}
          title={why ?? t("Each one becomes a separate mod with a card. The one showing now stays on. Undo puts the merged mod back")}>
          {tn(n, "Split into {n} mod", "Split into {n} mods")}
        </Button>
        {!why && info.copyFiles > 0 && (
          <span className="hint">{tn(info.copyFiles, "Copies {n} shared file ({size})", "Copies {n} shared files ({size})", { size: formatBytes(info.copyBytes) })}</span>
        )}
        {why && <span className="hint">{why}</span>}
      </div>
    </Panel>
  );
}

// ── problems and conflicts ──

function Problems({ mod, problems, onFixed }: { mod: ModEntry; problems: Problem[]; onFixed: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const run = async (key: string, job: () => Promise<unknown>) => {
    setBusy(key);
    try { await job(); } finally { if (live.current) setBusy(null); }
  };
  const m = { modId: mod.id, name: mod.name, enabled: mod.enabled, source: mod.source, problems };
  return (
    <Panel title={t("Problems")} icon="warn" className="mi-panel mi-problems" count={problems.length}>
      <ul className="mi-prob-list">
        {problems.map((p, i) => (
          <li key={`${p.kind}-${i}`} className={`mi-prob mi-prob-${p.severity}`}>
            <Badge tone={severityTone(p.severity)} title={severityHint(p.severity)}>{severityLabel(p.severity)}</Badge>
            <span className="mi-prob-t">{tb(p.detail)}</span>
            {p.fix && <FixButton game={mod.game} m={m} fix={p.fix} busyKey={`f${i}`} busy={busy} run={run} onDone={onFixed} />}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** "14 shared parts", which opens to the list of them by the names the mod gives them. A few names usually say it
 *  all: "ZhuYuan.Body.IB" on an Anby mod means both mods also change Zhu Yuan. */
export function SharedParts({ n, parts }: { n: number; parts?: string[] }) {
  if (!parts?.length) return <span className="mi-conf-n hint">{tn(n, "{n} shared part", "{n} shared parts")}</span>;
  return (
    <details className="mi-parts">
      <summary className="hint" title={t("Show which parts these mods change")}>{tn(n, "{n} shared part", "{n} shared parts")}</summary>
      <ul className="mi-parts-l mono">
        {parts.map((p) => <li key={p}>{p}</li>)}
        {n > parts.length && <li className="muted">{t("and {n} more", { n: n - parts.length })}</li>}
      </ul>
    </details>
  );
}

function Conflicts({ mod, data, onDone }: { mod: ModEntry; data: ModInspect; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const act = (tag: string, job: () => Promise<unknown>) => {
    setBusy(tag);
    job()
      .then(() => { if (live.current) onDone(); })
      .catch((e) => toast(errorText(e), true))
      .finally(() => { if (live.current) setBusy(null); });
  };
  const off = (ids: string[], names: string[], tag: string) => act(tag, () => turnOff(mod.game, ids, names));
  return (
    <Panel title={t("Conflicts")} icon="layers" className="mi-panel mi-conflicts" count={data.conflicts.length}
      actions={<Button size="sm" busy={busy === "all"} disabled={!!busy || !mod.enabled} icon="check"
        title={t("Turn off the other mods that change the same parts")}
        onClick={() => off(data.conflicts.map((c) => c.modId), data.conflicts.map((c) => c.name), "all")}>{t("Keep this one")}</Button>}>
      <p className="hint mi-conf-hint">{t("These mods are on and change the same parts of the model, so only one of them shows.")}</p>
      <ul className="mi-conf-list">
        {data.conflicts.map((c) => (
          <li key={c.modId} className="mi-conf">
            <div className="mi-conf-row">
              <button type="button" className="tp-link mi-conf-name" title={t("Open in Mods")} onClick={() => go({ view: "library", modId: c.modId })}>{c.name}</button>
              {(c.hashes?.length ?? 0) > 0 && (
                <Button size="sm" variant="ghost" busy={busy === `d:${c.modId}`} disabled={!!busy}
                  title={tn(c.shared, "Take the {n} shared part out of {mod}, so {other} shows it and {mod} keeps the rest. Undo puts it back",
                    "Take the {n} shared parts out of {mod}, so {other} shows them and {mod} keeps the rest. Undo puts them back", { mod: mod.name, other: c.name })}
                  onClick={() => act(`d:${c.modId}`, () => dropShared(mod.game, mod.id, c.hashes!))}>{t("Remove from this mod")}</Button>
              )}
              <IconButton icon="hide" size="sm" label={t("Ignore the conflict with {name}. Tools, Conflicts lists ignored ones", { name: c.name })} disabled={!!busy}
                onClick={() => act(`i:${c.modId}`, () => ignoreConflict(mod.game, [mod.id, c.modId], [mod.name, c.name]))} />
              <IconButton icon="power" size="sm" label={t("Turn off {name}", { name: c.name })} disabled={!!busy} onClick={() => off([c.modId], [c.name], c.modId)} />
            </div>
            <SharedParts n={c.shared} parts={c.parts} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
