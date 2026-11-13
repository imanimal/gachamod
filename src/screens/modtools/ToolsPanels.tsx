// MODTOOLS panels for the Tools screen: conflicts, problems, hash lookup, packs, moving from IMM.
// Owner: MODTOOLS area. SYSTEM's Tools screen renders them.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { inTauri } from "../../lib/tauri";
import { emitApp, go, useGame, useGames } from "../../lib/store";
import {
  dialogs, errorKind, errorText, imm, library, modtools, type ConflictGroup, type HashHit, type ImmInfo, type ModProblems,
} from "../../lib/api";
import { Badge, Button, Confirm, Panel, Skeleton, TextField, plural } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { problemCount, setToolsCount, turnOff } from "./toolsBadge";
import { severityLabel, severityTone } from "./ModInsides";
import "./modtools.css";

function useMounted() {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return live;
}

/** Load a list for the current game; Todo (a part not built yet) quietly gives an empty list. */
function useGameList<T>(load: (game: string) => Promise<T[]>): { game: string | null; list: T[] | null; reload: () => void } {
  const game = useGame()?.id ?? null;
  const [state, setState] = useState<{ game: string | null; list: T[] | null }>({ game: null, list: null });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!game) return;
    let live = true;
    loadRef.current(game)
      .then((list) => { if (live) setState({ game, list }); })
      .catch((e) => {
        if (!live) return;
        if (errorKind(e) !== "todo") toast(errorText(e), true);
        setState({ game, list: [] });
      });
    return () => { live = false; };
  }, [game, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { game, list: state.game === game ? state.list : null, reload };
}

const Loading = () => <div className="tp-loading" aria-busy="true"><Skeleton h="2.6rem" /><Skeleton h="2.6rem" /></div>;

// ── conflicts ──

export function ConflictsPanel() {
  const { game, list, reload } = useGameList<ConflictGroup>(modtools.conflicts);
  const [busy, setBusy] = useState<string | null>(null);
  const live = useMounted();
  useEffect(() => { if (game && list) setToolsCount(game, "conflicts", list.length); }, [game, list]);

  const keep = (g: ConflictGroup, keepId: string) => {
    if (!game) return;
    const others = g.mods.filter((m) => m.modId !== keepId);
    setBusy(keepId);
    turnOff(game, others.map((m) => m.modId), others.map((m) => m.name))
      .then(() => { emitApp({ type: "library-refresh", game }); if (live.current) reload(); })
      .catch((e) => toast(errorText(e), true))
      .finally(() => { if (live.current) setBusy(null); });
  };

  return (
    <Panel id="conflicts" title="Conflicts" icon="layers" className="tp tp-conflicts" count={list ? list.length : undefined}
      actions={<Button size="sm" variant="ghost" icon="refresh" onClick={reload} disabled={!list}>Check again</Button>}>
      <p className="hint tp-intro">Mods that are on and change the same parts of a model. Only one of them shows in game.</p>
      {!list ? <Loading /> : list.length === 0 ? (
        <p className="tp-none muted">No conflicts between the mods that are on.</p>
      ) : (
        <ul className="tp-list tp-conflict-list">
          {list.map((g) => (
            <li key={g.mods.map((m) => m.modId).join(",")} className="tp-conflict">
              <div className="tp-conflict-h">
                {g.character && <span className="tp-conflict-char">{g.character}</span>}
                <span className="hint" title={g.hashes.join(", ")}>{plural(g.hashes.length, "shared part")}</span>
              </div>
              <ul className="tp-conflict-mods">
                {g.mods.map((m) => (
                  <li key={m.modId} className="tp-conflict-mod row">
                    <button type="button" className="tp-link grow" title="Open in Mods" onClick={() => go({ view: "library", modId: m.modId })}>{m.name}</button>
                    <Button size="sm" busy={busy === m.modId} disabled={!!busy} title={`Keep ${m.name} on and turn the others in this group off`}
                      onClick={() => keep(g, m.modId)}>Keep this one</Button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── problems ──

export function ProblemsPanel() {
  const { game, list, reload } = useGameList<ModProblems>(modtools.lint);
  useEffect(() => { if (game && list) setToolsCount(game, "problems", problemCount(list)); }, [game, list]);
  return (
    <Panel id="problems" title="Problems" icon="warn" className="tp tp-problems" count={list ? problemCount(list) : undefined}
      actions={<Button size="sm" variant="ghost" icon="refresh" onClick={reload} disabled={!list}>Check again</Button>}>
      <p className="hint tp-intro">Files a mod needs that are missing, inis that can't be read, and keys that do nothing. On and off mods both count.</p>
      {!list ? <Loading /> : list.length === 0 ? (
        <p className="tp-none muted">No problems found.</p>
      ) : (
        <ul className="tp-list tp-problem-list">
          {list.map((m) => (
            <li key={m.modId} className="tp-problem">
              <button type="button" className="tp-link" title="Open in Mods" onClick={() => go({ view: "library", modId: m.modId })}>{m.name}</button>
              <ul className="tp-problem-items">
                {m.problems.map((p, i) => (
                  <li key={`${p.kind}-${i}`} className="tp-problem-item row">
                    <Badge tone={severityTone(p.severity)}>{severityLabel(p.severity)}</Badge>
                    <span className="grow">{p.detail}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── hash lookup ──

export function HashLookupPanel() {
  const game = useGame()?.id ?? null;
  const [hash, setHash] = useState("");
  const [hits, setHits] = useState<{ hash: string; list: HashHit[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useMounted();

  const find = (e: FormEvent) => {
    e.preventDefault();
    const h = hash.trim();
    if (!game || !h) return;
    setBusy(true);
    modtools.hashLookup(game, h)
      .then((list) => { if (live.current) setHits({ hash: h, list }); })
      .catch((err) => toast(errorText(err), true))
      .finally(() => { if (live.current) setBusy(false); });
  };

  return (
    <Panel id="hash" title="Find a hash" icon="search" className="tp tp-hash">
      <form className="tp-hash-form row" onSubmit={find}>
        <div className="grow">
          <TextField value={hash} onChange={setHash} mono placeholder="7a8b9c0d" label="Hash"
            hint="From a TextureOverride or ShaderOverride section. Shows which mods, on or off, change it." />
        </div>
        <Button type="submit" variant="primary" icon="search" busy={busy} disabled={!hash.trim()}>Find</Button>
      </form>
      {hits && (hits.list.length === 0 ? (
        <p className="tp-none muted">No mod uses {hits.hash}.</p>
      ) : (
        <ul className="tp-list tp-hash-list">
          {hits.list.map((h, i) => (
            <li key={`${h.modId}-${h.ini}-${h.section}-${i}`} className="tp-hash-hit row">
              <button type="button" className="tp-link" title="Open in Mods" onClick={() => go({ view: "library", modId: h.modId })}>{h.name}</button>
              <span className="hint mono grow">{h.ini} [{h.section}]</span>
              <Badge tone={h.enabled ? "ok" : "muted"}>{h.enabled ? "On" : "Off"}</Badge>
            </li>
          ))}
        </ul>
      ))}
    </Panel>
  );
}

// ── packs ──

export function PacksPanel() {
  const g = useGame();
  const [busy, setBusy] = useState(false);
  const live = useMounted();

  const exportAll = () => {
    if (!g) return;
    setBusy(true);
    library.list(g.id)
      .then((list) => {
        if (!list.length) { toast(`There are no ${g.short} mods to export yet`); return; }
        emitApp({ type: "export-mods", game: g.id, modIds: list.map((m) => m.id) });
      })
      .catch((e) => toast(errorText(e), true))
      .finally(() => { if (live.current) setBusy(false); });
  };

  const importOne = async () => {
    try {
      const files = await dialogs.pickFiles({ title: "Open a .gachamod file", extensions: ["gachamod"] });
      const path = files?.[0] ?? (inTauri() ? null : "C:\\Users\\Player\\Downloads\\Ellen skins.gachamod");
      if (path) emitApp({ type: "open-pack", path });
    } catch (e) { toast(errorText(e), true); }
  };

  return (
    <Panel id="packs" title=".gachamod files" icon="package" className="tp tp-packs">
      <p className="hint tp-intro">One file with mods, their picked options and a profile, to move to another PC or share. Opening one in Windows also works.</p>
      <div className="tp-packs-a row">
        <Button icon="export" busy={busy} disabled={!g} onClick={exportAll}>Export all {g?.short ?? ""} mods</Button>
        <Button icon="import" onClick={() => void importOne()}>Import a .gachamod</Button>
      </div>
    </Panel>
  );
}

// ── IMM ──

export function ImmPanel() {
  const games = useGames();
  const [info, setInfo] = useState<ImmInfo | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const live = useMounted();

  useEffect(() => {
    let on = true;
    imm.detect().then((i) => { if (on) setInfo(i); }).catch((e) => { if (on && errorKind(e) !== "todo") toast(errorText(e), true); });
    return () => { on = false; };
  }, [tick]);

  if (!info?.found || info.games.length === 0) return null;
  const nameOf = (id: string) => games.find((g) => g.id === id)?.name ?? id;
  const asked = info.games.find((g) => g.game === ask);

  const move = async (game: string) => {
    try {
      const r = await imm.takeover(game);
      toast(r.notes[0] ?? `Moved the mods from Integrated Mod Manager`);
      if (r.notes.length > 1) toast(r.notes.slice(1).join(" "), true);
      emitApp({ type: "library-refresh", game });
      if (live.current) setTick((n) => n + 1);
    } catch (e) { toast(errorText(e), true); }
  };

  return (
    <Panel id="imm" title="Mods from Integrated Mod Manager" icon="swap" className="tp tp-imm">
      <p className="hint tp-intro">IMM keeps mods in its own folders. Moving them puts each one in Mods/Character/Mod name, keeps their options and GameBanana links, and turns off the ones that were off.</p>
      <ul className="tp-list tp-imm-list">
        {info.games.map((g) => (
          <li key={g.game} className="tp-imm-game row">
            <span className="tp-imm-name grow">
              <strong>{nameOf(g.game)}</strong>
              <span className="hint"> {plural(g.mods, "mod")}, {g.enabled} on{g.withSource ? `, ${g.withSource} linked to GameBanana` : ""}</span>
            </span>
            <Button icon="swap" onClick={() => setAsk(g.game)}>Move mods from IMM</Button>
          </li>
        ))}
      </ul>
      {asked && (
        <Confirm title={`Move ${plural(asked.mods, "mod")} from IMM?`} yes="Move them" onClose={() => setAsk(null)} onYes={() => move(asked.game)}>
          <p>Close Integrated Mod Manager and {nameOf(asked.game)} first. The mods move out of IMM's folders, so IMM won't list them any more. Nothing is deleted.</p>
        </Confirm>
      )}
    </Panel>
  );
}
