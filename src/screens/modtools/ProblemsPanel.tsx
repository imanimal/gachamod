// The Problems panel on the Tools screen: broken parts of mods and warnings, each with its fix when gachamod has one,
// and a way to ignore the rest. Owner: MODTOOLS area.
import { useEffect, useRef, useState } from "react";
import { useGame } from "../../lib/store";
import type { GameId, ModProblems, Problem } from "../../lib/api";
import { t, tb, tn } from "../../lib/i18n";
import { Badge, Button, Panel, Skeleton, Waiting } from "../../ui/kit";
import { FixButton } from "./FixButton";
import { severityHint, severityLabel, severityTone } from "./ModInsides";
import {
  autoFixes, downloadAgain, findOnline, fixAll, ignore, ignoreAll, ignoredProblems, loadLint,
  needsDownload, shownProblems, unignore, useIgnored, useLint,
} from "./problems";
import "./modtools.css";
import { ModLink } from "./ModLink";

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
  // warnings alone (a texture the .ini names but the mod doesn't ship) rarely show in game: folded away, not counted
  const brokenRows = listed.filter((r) => r.shown.some((p) => p.severity === "bad"));
  const warnRows = listed.filter((r) => !brokenRows.includes(r));
  // mods that are off don't count, the same as on the Tools badge (problems.ts badgeKeys)
  const badCount = brokenRows.reduce((s, r) => s + (r.m.enabled ? r.shown.filter((p) => p.severity === "bad").length : 0), 0);
  const auto = list ? autoFixes(list, ign, game).length : 0;

  return (
    <Panel id="problems" title={t("Problems")} icon="warn" className="tp tp-problems" count={list ? badCount : undefined}
      actions={<>
        {auto > 1 && (
          <Button size="sm" icon="wand" busy={busy === "all"} disabled={!!busy} title={t("Make all {n} fixes that need no choice, as one step you can undo", { n: auto })}
            onClick={() => void run("all", () => fixAll(game, list!, ign))}>{t("Fix all")}</Button>
        )}
        {total > 0 && (
          <Button size="sm" variant="ghost" icon="hide" disabled={!!busy} title={t("Hide everything listed here. It stops counting on Tools and moves to Ignored")}
            onClick={() => ignoreAll(game, list!)}>{t("Ignore all")}</Button>
        )}
        <Button size="sm" variant="ghost" icon="refresh" busy={checking} onClick={check} disabled={!list} title={t("Look for problems in every mod again")}>{t("Check again")}</Button>
      </>}>
      <p className="hint tp-intro">{t("What could stop a mod from showing right in game. Warnings, like a file the .ini names that the mod doesn't ship, usually make no difference, so they're folded away.")}</p>
      {!list ? (
        <Waiting what={t("Checking mods for problems")} className="tp-loading"><Skeleton h="2.6rem" /><Skeleton h="2.6rem" /></Waiting>
      ) : brokenRows.length === 0 ? (
        <p className="tp-none muted">{warnRows.length ? t("Nothing broken. Only warnings, below.") : ignored.length ? t("Nothing else to fix. The problems you ignored are below.") : t("No problems found.")}</p>
      ) : (
        <ul className="tp-list tp-problem-list">
          {brokenRows.map(({ m, shown }) => (
            <ModRow key={m.modId} game={game} m={m} shown={shown} busy={busy} run={run} />
          ))}
        </ul>
      )}
      {list && warnRows.length > 0 && (
        <details className="tp-ignored">
          <summary className="hint">{t("Warnings ({n})", { n: warnRows.reduce((s, r) => s + r.shown.length, 0) })}</summary>
          <ul className="tp-list tp-problem-list">
            {warnRows.map(({ m, shown }) => (
              <ModRow key={m.modId} game={game} m={m} shown={shown} busy={busy} run={run} />
            ))}
          </ul>
        </details>
      )}
      {ignored.length > 0 && (
        <details className="tp-ignored">
          <summary className="hint">{t("Ignored ({n})", { n: ignored.reduce((s, r) => s + r.hidden.length, 0) })}</summary>
          <ul className="tp-list">
            {ignored.map(({ m, hidden }) => (
              <li key={m.modId} className="tp-ignored-mod row">
                <ModLink game={game} modId={m.modId} name={m.name} className="grow" />
                <span className="hint">{tn(hidden.length, "{n} problem", "{n} problems")}</span>
                <Button size="sm" variant="ghost" icon="eye" title={t("List these problems again")} onClick={() => unignore(game, m)}>{t("Show again")}</Button>
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
  const broken = shown.some((p) => p.severity === "bad");
  return (
    <li className="tp-problem">
      <div className="tp-problem-h row">
        <ModLink game={game} modId={m.modId} name={m.name} className="grow" />
        {!m.enabled && <Badge tone="muted" title={t("This mod is off, so its problems don't count on Tools")}>{t("Off")}</Badge>}
        {download && (m.source
          ? <Button size="sm" variant={broken ? undefined : "ghost"} icon="install" busy={busy === `dl${m.modId}`} disabled={!!busy}
              title={t("Download this mod from GameBanana again, which can bring back a missing file. The mod's settings stay")}
              onClick={() => void run(`dl${m.modId}`, () => downloadAgain(game, m))}>{t("Download again")}</Button>
          : <Button size="sm" variant="ghost" icon="search" title={t("This mod isn't linked to GameBanana. Search for it there by name")}
              onClick={() => findOnline(m)}>{t("Find on GameBanana")}</Button>)}
        <Button size="sm" variant="ghost" icon="hide" disabled={!!busy} title={t("Stop listing these problems. They stop counting on Tools and move to Ignored")}
          onClick={() => ignore(game, m, shown)}>{t("Ignore")}</Button>
      </div>
      <ul className="tp-problem-items">
        {shown.map((p, i) => (
          <li key={`${p.kind}-${p.ini}-${i}`} className="tp-problem-item row">
            <Badge tone={severityTone(p.severity)} title={severityHint(p.severity)}>{severityLabel(p.severity)}</Badge>
            <span className="grow tp-problem-t">{tb(p.detail)}</span>
            {p.fix && <FixButton game={game} m={m} fix={p.fix} busyKey={`fx${m.modId}${i}`} busy={busy} run={run} />}
          </li>
        ))}
      </ul>
    </li>
  );
}
