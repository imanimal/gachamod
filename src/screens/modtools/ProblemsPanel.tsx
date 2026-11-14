// The Problems panel on the Tools screen: broken parts of mods and warnings, each with its fix when gachamod has one,
// and a way to ignore the rest. Owner: MODTOOLS area.
import { useEffect, useRef, useState } from "react";
import { go, useGame } from "../../lib/store";
import type { GameId, ModProblems, Problem } from "../../lib/api";
import { Badge, Button, Panel, Skeleton, plural } from "../../ui/kit";
import { FixButton } from "./FixButton";
import { severityHint, severityLabel, severityTone } from "./ModInsides";
import {
  autoFixes, downloadAgain, findOnline, fixAll, ignore, ignoreAll, ignoredProblems, loadLint,
  needsDownload, shownProblems, unignore, useIgnored, useLint,
} from "./problems";
import "./modtools.css";

const rank = (s: string) => (s === "bad" ? 0 : s === "warn" ? 1 : 2);

export function ProblemsPanel() {
  const game = useGame()?.id ?? null;
  const list = useLint(game);
  const ign = useIgnored();
  const [busy, setBusy] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (game) void loadLint(game, true); }, [game]);

  if (!game) return null;
  const run = async (key: string, job: () => Promise<unknown>) => {
    setBusy(key);
    try { await job(); } finally { if (live.current) setBusy(null); }
  };
  const check = () => {
    setChecking(true);
    void loadLint(game, true).finally(() => { if (live.current) setChecking(false); });
  };

  const rows = (list ?? []).map((m) => ({ m, shown: shownProblems(ign, game, m), hidden: ignoredProblems(ign, game, m) }));
  const listed = rows.filter((r) => r.shown.length)
    .sort((a, b) => rank(a.shown[0]!.severity) - rank(b.shown[0]!.severity) || Number(b.m.enabled) - Number(a.m.enabled));
  const ignored = rows.filter((r) => r.hidden.length);
  const total = listed.reduce((s, r) => s + r.shown.length, 0);
  const auto = list ? autoFixes(list, ign, game).length : 0;

  return (
    <Panel id="problems" title="Problems" icon="warn" className="tp tp-problems" count={list ? total : undefined}
      actions={<>
        {auto > 1 && (
          <Button size="sm" icon="wand" busy={busy === "all"} disabled={!!busy} title={`Make all ${auto} fixes that need no choice, as one step you can undo`}
            onClick={() => void run("all", () => fixAll(game, list!, ign))}>Fix all</Button>
        )}
        {total > 0 && (
          <Button size="sm" variant="ghost" icon="hide" disabled={!!busy} title="Hide everything listed here. It stops counting on Tools and moves to Ignored"
            onClick={() => ignoreAll(game, list!)}>Ignore all</Button>
        )}
        <Button size="sm" variant="ghost" icon="refresh" busy={checking} onClick={check} disabled={!list} title="Look for problems in every mod again">Check again</Button>
      </>}>
      <p className="hint tp-intro">What stops a mod from showing right in game, for mods on and off. Only broken parts of mods that are on add to the count on Tools.</p>
      {!list ? (
        <div className="tp-loading" aria-busy="true"><Skeleton h="2.6rem" /><Skeleton h="2.6rem" /></div>
      ) : listed.length === 0 ? (
        <p className="tp-none muted">{ignored.length ? "Nothing else to fix. The problems you ignored are below." : "No problems found."}</p>
      ) : (
        <ul className="tp-list tp-problem-list">
          {listed.map(({ m, shown }) => (
            <ModRow key={m.modId} game={game} m={m} shown={shown} busy={busy} run={run} />
          ))}
        </ul>
      )}
      {ignored.length > 0 && (
        <details className="tp-ignored">
          <summary className="hint">Ignored ({ignored.reduce((s, r) => s + r.hidden.length, 0)})</summary>
          <ul className="tp-list">
            {ignored.map(({ m, hidden }) => (
              <li key={m.modId} className="tp-ignored-mod row">
                <button type="button" className="tp-link grow" title="Open in Mods" onClick={() => go({ view: "library", modId: m.modId })}>{m.name}</button>
                <span className="hint">{plural(hidden.length, "problem")}</span>
                <Button size="sm" variant="ghost" icon="eye" title="List these problems again" onClick={() => unignore(game, m)}>Show again</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

function ModRow({ game, m, shown, busy, run }: {
  game: GameId; m: ModProblems; shown: Problem[]; busy: string | null; run: (key: string, job: () => Promise<unknown>) => Promise<void>;
}) {
  const download = needsDownload(shown);
  return (
    <li className="tp-problem">
      <div className="tp-problem-h row">
        <button type="button" className="tp-link grow" title="Open in Mods" onClick={() => go({ view: "library", modId: m.modId })}>{m.name}</button>
        {!m.enabled && <Badge tone="muted" title="This mod is off, so its problems don't count on Tools">Off</Badge>}
        {download && (m.source
          ? <Button size="sm" icon="install" busy={busy === `dl${m.modId}`} disabled={!!busy}
              title="Download this mod from GameBanana again, which can bring back a missing file. Its settings stay"
              onClick={() => void run(`dl${m.modId}`, () => downloadAgain(game, m))}>Download again</Button>
          : <Button size="sm" variant="ghost" icon="search" title="This mod isn't linked to GameBanana. Search for it there by name"
              onClick={() => findOnline(m)}>Find on GameBanana</Button>)}
        <Button size="sm" variant="ghost" icon="hide" disabled={!!busy} title="Stop listing these problems. They stop counting on Tools and move to Ignored"
          onClick={() => ignore(game, m, shown)}>Ignore</Button>
      </div>
      <ul className="tp-problem-items">
        {shown.map((p, i) => (
          <li key={`${p.kind}-${p.ini}-${i}`} className="tp-problem-item row">
            <Badge tone={severityTone(p.severity)} title={severityHint(p.severity)}>{severityLabel(p.severity)}</Badge>
            <span className="grow tp-problem-t">{p.detail}</span>
            {p.fix && <FixButton game={game} m={m} fix={p.fix} busyKey={`fx${m.modId}${i}`} busy={busy} run={run} />}
          </li>
        ))}
      </ul>
    </li>
  );
}
