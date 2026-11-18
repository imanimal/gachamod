// Tools > Fixes: which installed mods a game update broke, one click to fix them, the fixers gachamod takes its data
// from, and new fixers posted on GameBanana. Owner: FIXES area.
import { useEffect, useRef, useState } from "react";
import { fixes, type FixInfo, type GameId, type ModHealthRow } from "../../lib/api";
import { autoMutePref, downloadNewestFixer, fixLabel, fixMods, fixWarningsPref, fixerName, checkHealth, isDeadEnd, stopWaiting, triedNote, useFixerBusy, useFixerFiles, useHealthRows } from "../../lib/fixes";
import { useHolds } from "../../lib/holds";
import { gameTools, gbToolId, type GbTool } from "../../lib/gamebanana";
import { openGbTool } from "../browse/state";
import { jsonPref } from "../../lib/prefs";
import { go, useGames } from "../../lib/store";
import { Badge, Button, Checkbox, Panel, Skeleton, timeAgo } from "../../ui/kit";
import { fixesAutoUpdatePref } from "../settings/automatic";
import { muteDeadEnds, unmute } from "./deadEnds";
import "../modtools/modtools.css";
import { ModLink } from "../modtools/ModLink";
import { sentences, stops, t, tb, tn } from "../../lib/i18n";

/** Words that make a GameBanana tool a fixer (docs/fixers.md). */
const FIXER = /fix|hash|remap|repair|update|convert/i;
/** Per game, the newest tool date (unix seconds) the user has seen. */
const seenPref = jsonPref<Record<string, number>>("fixes.seenTools", {});

export function FixesPanel({ game }: { game: GameId }) {
  const rows = useHealthRows(game);
  const [info, setInfo] = useState<FixInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const waiting = useFixerBusy().has("waiting");
  const warn = fixWarningsPref.use();
  const holds = useHolds(game);
  const autoMute = autoMutePref.use();
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { let on = true; fixes.info(game).then((i) => { if (on) setInfo(i); }).catch(() => {}); return () => { on = false; }; }, [game]);

  const run = async (key: string, job: () => Promise<unknown>) => {
    setBusy(key);
    try { await job(); } finally { if (live.current) setBusy(null); }
  };
  const broken = (rows ?? []).filter((r) => r.status === "broken");
  const stuck = (rows ?? []).filter((r) => r.status === "unfixable");
  const fixed = (rows ?? []).filter((r) => r.status === "fixed");
  // everything worth a first try: hash swaps here, and mods whose fixer it can get and run. A mod a fixer already
  // failed on, or one whose model changed, is tried from its own row
  const fixable = [...broken, ...stuck.filter((r) => r.tool && !r.tried && !r.needsAuthor)];
  const all = [...broken, ...stuck].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  const quiet = all.filter((r) => holds[r.modId]);
  // dead ends (the model changed, no fixer, or the fixer already failed) get one line and one button, not a row each
  const dead = all.filter((r) => isDeadEnd(r) && !quiet.includes(r));
  const listed = all.filter((r) => !quiet.includes(r) && !dead.includes(r));
  // no hash changes or fixers known for this game: nothing can be found broken, so there is nothing to list or check
  const noData = !!info && !info.pairs && !info.sources.length;

  return (
    <Panel id="fixes" title={t("Fixes")} icon="wand" className="tp tp-fixes" count={rows && warn ? listed.length : undefined}
      actions={<>
        {!noData && <Button size="sm" variant="ghost" icon={warn ? "bell" : "bell-off"}
          title={warn ? t("Stop warning about mods a game update broke, here, on mod cards and in a mod's details. Nothing changes in the mods")
            : t("Warn again about mods a game update broke")}
          onClick={() => void fixWarningsPref.set(!warn, warn ? t("Muted the broken mod warnings") : t("Showing the broken mod warnings again"))}>{warn ? t("Mute warnings") : t("Unmute warnings")}</Button>}
        {waiting && (
          <Button size="sm" variant="ghost" onClick={stopWaiting}
            title={t("The fixer is open in a separate window. gachamod carries on by itself a few seconds after the fixer stops changing files. This carries on now, with what it changed so far")}>{t("Stop waiting")}</Button>
        )}
        {warn && !noData && fixable.length > 0 && (
          <Button size="sm" variant="primary" icon="wand" busy={busy === "all"} disabled={!!busy}
            title={t("Outdated hashes are swapped, and a mod that needs more gets its fixer run on it. A fix isn't certain: a mod the fixer can't repair says so afterwards. Each gets a backup, and Undo puts it back")}
            onClick={() => void run("all", () => fixMods(game, fixable.map((r) => r.modId)))}>{tn(fixable.length, "Attempt fix on {n} mod", "Attempt fix on {n} mods")}</Button>
        )}
        {warn && !noData && <Button size="sm" variant="ghost" icon="refresh" busy={busy === "check"} disabled={!!busy} title={t("Check every mod again")}
          onClick={() => void run("check", () => checkHealth(game))}>{t("Check again")}</Button>}
      </>}>
      {noData ? (
        <p className="hint tp-intro">{t("gachamod has no hash fixes for this game, so it can't tell which mods a game update broke.")}</p>
      ) : !warn ? (
        <p className="tp-none muted">{t("Warnings about mods a game update broke are muted. Unmute to see them and fix them.")}</p>
      ) : (<>
      <p className="hint tp-intro">
        {info?.currentVersion.split(" ")[0]
          ? t("Mods that still use hashes from before {version} stop showing. gachamod swaps them, or runs the mod's fixer. A backup is kept, and Undo puts the files back.", { version: info.currentVersion.split(" ")[0]! })
          : t("Mods that still use hashes from before the latest version stop showing. gachamod swaps them, or runs the mod's fixer. A backup is kept, and Undo puts the files back.")}
      </p>
      {!rows ? (
        <div className="tp-loading" aria-busy="true"><Skeleton h="2.6rem" /><Skeleton h="2.6rem" /></div>
      ) : listed.length === 0 ? (
        dead.length ? null : <p className="tp-none muted">{fixed.length ? tn(fixed.length, "No broken mods left. gachamod fixed {n} mod.", "No broken mods left. gachamod fixed {n} mods.") : t("No mods with outdated hashes found.")}</p>
      ) : (
        <ul className="tp-list tp-problem-list">
          {listed.map((r) => <HealthRow key={r.modId} game={game} r={r} busy={busy} run={run} />)}
        </ul>
      )}
      {rows && dead.length > 0 && (
        <div className="fx-dead">
          <div className="row">
            <span className="grow">{dead.length === 1 ? t("{mod} needs an update from its author", { mod: dead[0]!.name }) : tn(dead.length, "{n} mod needs an update from their author", "{n} mods need an update from their author")}</span>
            <Button size="sm" icon="bell-off" busy={busy === "mute"} disabled={!!busy}
              title={t("Turns them off and stops warning about them. Undo turns them back on. A newer version from the author shows up again if it's still broken")}
              onClick={() => void run("mute", () => muteDeadEnds(game, dead))}>{dead.some((r) => r.enabled) ? t("Turn off and mute") : t("Mute")}</Button>
          </div>
          <Checkbox checked={autoMute} label={t("Always turn off and mute mods that need their author")}
            title={t("When a check finds another mod that no fix here can repair, gachamod turns it off and stops warning about it, without asking. Undo turns it back on")}
            onChange={(v) => void autoMutePref.set(v, v ? t("Turning off mods that need their author") : t("Listing mods that need their author again"))} />
          <details className="tp-ignored">
            <summary className="hint">{t("Show them")}</summary>
            <ul className="tp-list">
              {dead.map((r) => <DeadRow key={r.modId} game={game} r={r} busy={busy} run={run} />)}
            </ul>
          </details>
        </div>
      )}
      {quiet.length > 0 && (
        <details className="tp-ignored">
          <summary className="hint">{t("Muted ({n})", { n: quiet.length })}</summary>
          <ul className="tp-list">
            {quiet.map((r) => (
              <li key={r.modId} className="tp-ignored-mod row">
                <ModLink game={game} modId={r.modId} name={r.name} className="grow" />
                {!r.enabled && <Badge tone="muted" title={t("This mod is off")}>{t("Off")}</Badge>}
                <span className="hint">{holds[r.modId]?.kind === "update" ? t("Until it's updated") : t("Ignored")}</span>
                <Button size="sm" variant="ghost" icon="bell" title={t("Warn about this mod again. It stays on or off as it is")} onClick={() => void unmute(game, r)}>{t("Unmute")}</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {fixed.length > 0 && (
        <details className="tp-ignored">
          <summary className="hint">{t("Fixed ({n})", { n: fixed.length })}</summary>
          <ul className="tp-list">
            {fixed.map((r) => (
              <li key={r.modId} className="tp-ignored-mod row">
                <ModLink game={game} modId={r.modId} name={r.name} className="grow" />
              </li>
            ))}
          </ul>
        </details>
      )}
      </>)}
      <NewFixers game={game} />
      {info && info.sources.length > 0 && (
        <details className="tp-ignored fx-sources">
          <summary className="hint">{t("Where the fixes come from ({n})", { n: info.sources.length })}</summary>
          <ul className="tp-list">
            {info.sources.map((s) => (
              <li key={s.id} className="fx-source">
                <div className="row">
                  <span className="grow">{s.name}</span>
                  {s.checked && <span className="hint">{t("Checked {date}", { date: s.checked })}</span>}
                </div>
                <span className="hint">{stops([s.author, s.license && t("Licence: {licence}", { licence: s.license }), s.used && t("gachamod uses: {what}", { what: s.used })].filter((x): x is string => !!x))}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

function HealthRow({ game, r, busy, run }: { game: GameId; r: ModHealthRow; busy: string | null; run: (key: string, job: () => Promise<unknown>) => Promise<void> }) {
  const fixerBusy = useFixerBusy();
  const can = r.status === "broken" || !!r.tool;
  const fix = () => void run(r.modId, () => fixMods(game, [r.modId]));
  const from = r.tool && (gbToolId(r.tool.url) !== null ? "GameBanana" : "GitHub");
  const note = triedNote(r);
  const [all, setAll] = useState(false);
  const toolTip = r.tool ? sentences([
    t("Gets {tool} from {source} and runs it on this mod.", { tool: r.tool.name, source: from || "" }),
    r.tried && t("It gets the fixer's newest version first."),
    r.needsAuthor && t("It may not help: the game changed the model, which a fixer can't redo."),
    t("A backup is kept and Undo puts it back"),
  ].filter((x): x is string => !!x)) : "";
  return (
    <li className="tp-problem">
      <div className="tp-problem-h row">
        <ModLink game={game} modId={r.modId} name={r.name} className="grow" />
        {!r.enabled && <Badge tone="muted" title={t("This mod is off")}>{t("Off")}</Badge>}
        {can && (
          <Button size="sm" icon="wand" busy={busy === r.modId || fixerBusy.has(`mod:${r.modId}`)} disabled={!!busy}
            title={r.status === "broken"
              ? tn(r.swaps, "Swaps {n} outdated hash. A backup is kept and Undo puts it back", "Swaps {n} outdated hashes. A backup is kept and Undo puts it back")
              : toolTip}
            onClick={fix}>{fixLabel(r)}</Button>
        )}
      </div>
      <ul className="tp-problem-items">
        {(all ? r.reasons : r.reasons.slice(0, 4)).map((reason, i) => {
          // a model change is the first reason of a mod that has one
          const author = !r.tool || (r.needsAuthor && i === 0);
          return (
            <li key={reason} className="tp-problem-item row">
              <Badge tone={r.status === "broken" ? "warn" : "bad"}
                title={r.status === "broken" ? t("gachamod knows the new hashes. Click to swap them")
                  : author ? (can ? t("A fixer can't redo a changed model, so the mod needs an update from its author. Click to try the fixer anyway") : t("A fixer can't redo a changed model, so the mod needs an update from its author"))
                  : t("{tool} handles this kind of change. Click to get it and run it on this mod", { tool: r.tool!.name })}
                onClick={busy || !can ? undefined : fix}>
                {r.status === "broken" ? t("Outdated hashes") : author ? t("Needs its author") : t("Needs {tool}", { tool: fixerName(r.tool!.name) })}
              </Badge>
              <span className="grow tp-problem-t">{tb(reason)}</span>
            </li>
          );
        })}
        {r.reasons.length > 4 && (
          <li><Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? t("Show fewer") : tn(r.reasons.length - 4, "Show {n} more", "Show {n} more")}</Button></li>
        )}
        {note && <li className="hint tp-problem-tried">{stops([note], true)}</li>}
      </ul>
    </li>
  );
}

/** One line for a dead end: its name, why, and a retry (a newer fixer may help). */
function DeadRow({ game, r, busy, run }: { game: GameId; r: ModHealthRow; busy: string | null; run: (key: string, job: () => Promise<unknown>) => Promise<void> }) {
  const fixerBusy = useFixerBusy();
  const why = r.needsAuthor ? r.reasons[0] : triedNote(r) ?? r.reasons[0];
  return (
    <li className="tp-ignored-mod row">
      <ModLink game={game} modId={r.modId} name={r.name} />
      <span className="hint grow" title={stops(r.reasons.map((x) => tb(x)))}>{why && tb(why)}</span>
      {!r.enabled && <Badge tone="muted" title={t("This mod is off")}>{t("Off")}</Badge>}
      {r.tool && (
        <Button size="sm" variant="ghost" icon="wand" busy={busy === r.modId || fixerBusy.has(`mod:${r.modId}`)} disabled={!!busy}
          title={t("Gets the newest {tool} and runs it on this mod. It may not help. A backup is kept and Undo puts it back", { tool: r.tool.name })}
          onClick={() => void run(r.modId, () => fixMods(game, [r.modId]))}>{fixLabel(r)}</Button>
      )}
    </li>
  );
}

/** New fixer tools for the game on GameBanana, until dismissed. Off with Settings > Mods a game update broke > Look for new mod fixers. */
function NewFixers({ game }: { game: GameId }) {
  const on = fixesAutoUpdatePref.use();
  const seen = seenPref.use();
  const gbId = useGames().find((g) => g.id === game)?.gamebananaId ?? null;
  const [tools, setTools] = useState<GbTool[] | null>(null);
  useEffect(() => {
    if (!on || !gbId) { setTools(null); return; }
    let live = true;
    gameTools(gbId).then((list) => { if (live) setTools(list.filter((x) => FIXER.test(x.name))); }).catch(() => { if (live) setTools(null); });
    return () => { live = false; };
  }, [on, gbId]);
  if (!on || !tools) return null;
  // the first time, only the last 30 days count as new
  const since = seen[game] ?? Math.floor(Date.now() / 1000) - 30 * 86_400;
  const fresh = tools.filter((x) => x.added > since);
  if (!fresh.length) return null;
  const dismiss = () => void seenPref.set({ ...seen, [game]: Math.max(...tools.map((x) => x.added)) }, t("Dismissed the new fixers"));
  return (
    <div className="fx-new" role="status">
      <div className="row">
        <strong className="grow">{fresh.length === 1 ? t("A new fixer on GameBanana") : tn(fresh.length, "{n} new fixer on GameBanana", "{n} new fixers on GameBanana")}</strong>
        <Button size="sm" variant="ghost" icon="sliders" onClick={() => go({ view: "settings", section: "set-fix-updates" })}
          title={t("Opens Settings, Look for new mod fixers, where this check can be turned off")}>{t("Settings")}</Button>
        <Button size="sm" variant="ghost" icon="check" onClick={dismiss} title={t("Stop listing these. Newer ones still show up")}>{t("Dismiss")}</Button>
      </div>
      <ul className="tp-list">
        {fresh.slice(0, 6).map((tool) => (
          <li key={tool.id} className="row fx-new-item">
            <button type="button" className="tp-link grow" title={t("Open its page")} onClick={() => openGbTool(tool.id)}>{tool.name}</button>
            <span className="hint">{[tool.submitter, timeAgo(tool.added)].filter(Boolean).join(", ")}</span>
            <GetFixer game={game} toolId={tool.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Download a fixer's newest file in one click. */
function GetFixer({ game, toolId }: { game: GameId; toolId: number }) {
  const have = useFixerFiles(game).filter((f) => f.toolId === toolId);
  const busy = useFixerBusy();
  if (have.length) return <span className="hint">{t("Downloaded")}</span>;
  return (
    <Button size="sm" icon="downloads" busy={busy.has(`tool:${toolId}`)} title={t("Download its newest file into gachamod's fixers folder")}
      onClick={() => void downloadNewestFixer(game, toolId)}>{t("Download")}</Button>
  );
}
