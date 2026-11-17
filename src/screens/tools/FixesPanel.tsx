// Tools > Fixes: which installed mods a game update broke, one click to fix them, the fixers gachamod takes its data
// from, and new fixers posted on GameBanana. Owner: FIXES area.
import { useEffect, useRef, useState } from "react";
import { fixes, type FixInfo, type GameId, type ModHealthRow } from "../../lib/api";
import { autoMutePref, downloadNewestFixer, fixLabel, fixMods, fixWarningsPref, fixerName, checkHealth, isDeadEnd, isMuted, mutedPref, stopWaiting, triedNote, useFixerBusy, useFixerFiles, useHealthRows } from "../../lib/fixes";
import { gameTools, gbToolId, type GbTool } from "../../lib/gamebanana";
import { openGbTool } from "../browse/state";
import { jsonPref } from "../../lib/prefs";
import { go, useGames } from "../../lib/store";
import { Badge, Button, Checkbox, Panel, Skeleton, plural, timeAgo } from "../../ui/kit";
import { fixesAutoUpdatePref } from "../settings/automatic";
import { muteDeadEnds, unmute } from "./deadEnds";
import "../modtools/modtools.css";

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
  const muted = mutedPref.use();
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
  const quiet = all.filter((r) => isMuted(muted, game, r.modId, r));
  // dead ends (the model changed, no fixer, or the fixer already failed) get one line and one button, not a row each
  const dead = all.filter((r) => isDeadEnd(r) && !quiet.includes(r));
  const listed = all.filter((r) => !quiet.includes(r) && !dead.includes(r));
  // no hash changes or fixers known for this game: nothing can be found broken, so there is nothing to list or check
  const noData = !!info && !info.pairs && !info.sources.length;

  return (
    <Panel id="fixes" title="Fixes" icon="wand" className="tp tp-fixes" count={rows && warn ? listed.length : undefined}
      actions={<>
        {!noData && <Button size="sm" variant="ghost" icon={warn ? "bell" : "bell-off"}
          title={warn ? "Stop warning about mods a game update broke, here, on mod cards and in a mod's details. Nothing changes in the mods"
            : "Warn again about mods a game update broke"}
          onClick={() => void fixWarningsPref.set(!warn, warn ? "Muted the broken mod warnings" : "Showing the broken mod warnings again")}>{warn ? "Mute" : "Unmute"}</Button>}
        {waiting && (
          <Button size="sm" variant="ghost" onClick={stopWaiting}
            title="The fixer is open in its own window. gachamod carries on by itself a few seconds after the fixer stops changing files. This carries on now, with what it changed so far">Stop waiting</Button>
        )}
        {warn && !noData && fixable.length > 0 && (
          <Button size="sm" variant="primary" icon="wand" busy={busy === "all"} disabled={!!busy}
            title={`Outdated hashes are swapped, and a mod that needs more gets its fixer run on it. A fix isn't certain: a mod the fixer can't repair says so afterwards. Each gets a backup, and Undo puts it back`}
            onClick={() => void run("all", () => fixMods(game, fixable.map((r) => r.modId)))}>Attempt fix on {plural(fixable.length, "mod")}</Button>
        )}
        {warn && !noData && <Button size="sm" variant="ghost" icon="refresh" busy={busy === "check"} disabled={!!busy} title="Check every mod again"
          onClick={() => void run("check", () => checkHealth(game))}>Check again</Button>}
      </>}>
      {noData ? (
        <p className="hint tp-intro">gachamod has no hash fixes for this game, so it can't tell which mods a game update broke.</p>
      ) : !warn ? (
        <p className="tp-none muted">Warnings about mods a game update broke are muted. Unmute to see them and fix them.</p>
      ) : (<>
      <p className="hint tp-intro">
        {`Mods that still use hashes from before ${info?.currentVersion.split(" ")[0] || "the latest version"} stop showing. gachamod swaps them, or runs the mod's fixer. A backup is kept, and Undo puts the files back.`}
      </p>
      {!rows ? (
        <div className="tp-loading" aria-busy="true"><Skeleton h="2.6rem" /><Skeleton h="2.6rem" /></div>
      ) : listed.length === 0 ? (
        dead.length ? null : <p className="tp-none muted">{fixed.length ? `No broken mods left. gachamod fixed ${plural(fixed.length, "mod")}.` : "No mods with outdated hashes found."}</p>
      ) : (
        <ul className="tp-list tp-problem-list">
          {listed.map((r) => <HealthRow key={r.modId} game={game} r={r} busy={busy} run={run} />)}
        </ul>
      )}
      {rows && dead.length > 0 && (
        <div className="fx-dead">
          <div className="row">
            <span className="grow">{dead.length === 1 ? `${dead[0]!.name} needs an update from its author` : `${dead.length} mods need an update from their author`}</span>
            <Button size="sm" icon="bell-off" busy={busy === "mute"} disabled={!!busy}
              title="Turns them off and stops warning about them. Undo turns them back on. A newer version from the author shows up again if it's still broken"
              onClick={() => void run("mute", () => muteDeadEnds(game, dead))}>{dead.some((r) => r.enabled) ? "Turn off and mute" : "Mute"}</Button>
          </div>
          <Checkbox checked={autoMute} label="Always turn off and mute mods that need their author"
            title="When a check finds another mod that no fix here can repair, gachamod turns it off and stops warning about it, without asking. Undo turns it back on"
            onChange={(v) => void autoMutePref.set(v, v ? "Turning off mods that need their author" : "Listing mods that need their author again")} />
          <details className="tp-ignored">
            <summary className="hint">Show them</summary>
            <ul className="tp-list">
              {dead.map((r) => <DeadRow key={r.modId} game={game} r={r} busy={busy} run={run} />)}
            </ul>
          </details>
        </div>
      )}
      {quiet.length > 0 && (
        <details className="tp-ignored">
          <summary className="hint">Muted ({quiet.length})</summary>
          <ul className="tp-list">
            {quiet.map((r) => (
              <li key={r.modId} className="tp-ignored-mod row">
                <button type="button" className="tp-link grow" title="Open in Mods" onClick={() => go({ view: "library", modId: r.modId })}>{r.name}</button>
                {!r.enabled && <Badge tone="muted" title="This mod is off">Off</Badge>}
                <Button size="sm" variant="ghost" icon="bell" title="Warn about this mod again. It stays off" onClick={() => unmute(game, r)}>Unmute</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {fixed.length > 0 && listed.length > 0 && (
        <details className="tp-ignored">
          <summary className="hint">Fixed ({fixed.length})</summary>
          <ul className="tp-list">
            {fixed.map((r) => (
              <li key={r.modId} className="tp-ignored-mod row">
                <button type="button" className="tp-link grow" title="Open in Mods" onClick={() => go({ view: "library", modId: r.modId })}>{r.name}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      </>)}
      <NewFixers game={game} />
      {info && info.sources.length > 0 && (
        <details className="tp-ignored fx-sources">
          <summary className="hint">Where the fixes come from ({info.sources.length})</summary>
          <ul className="tp-list">
            {info.sources.map((s) => (
              <li key={s.id} className="fx-source">
                <div className="row">
                  <span className="grow">{s.name}</span>
                  {s.checked && <span className="hint">Checked {s.checked}</span>}
                </div>
                <span className="hint">{[s.author, s.license && `Licence: ${s.license}`, s.used && `gachamod uses: ${s.used}`].filter(Boolean).join(". ")}</span>
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
  const again = r.tried ? "It gets the fixer's newest version first. " : "";
  return (
    <li className="tp-problem">
      <div className="tp-problem-h row">
        <button type="button" className="tp-link grow" title="Open in Mods" onClick={() => go({ view: "library", modId: r.modId })}>{r.name}</button>
        {!r.enabled && <Badge tone="muted" title="This mod is off">Off</Badge>}
        {can && (
          <Button size="sm" icon="wand" busy={busy === r.modId || fixerBusy.has(`mod:${r.modId}`)} disabled={!!busy}
            title={r.status === "broken"
              ? `Swaps ${plural(r.swaps, "outdated hash", "outdated hashes")}. A backup is kept and Undo puts it back`
              : `Gets ${r.tool!.name} from ${from} and runs it on this mod. ${again}${r.needsAuthor ? "It may not help: the game changed the model, which a fixer can't redo. " : ""}A backup is kept and Undo puts it back`}
            onClick={fix}>{fixLabel(r)}</Button>
        )}
      </div>
      <ul className="tp-problem-items">
        {(all ? r.reasons : r.reasons.slice(0, 4)).map((t, i) => {
          // a model change is the first reason of a mod that has one
          const author = !r.tool || (r.needsAuthor && i === 0);
          return (
            <li key={t} className="tp-problem-item row">
              <Badge tone={r.status === "broken" ? "warn" : "bad"}
                title={r.status === "broken" ? "gachamod knows the new hashes. Click to swap them"
                  : author ? `A fixer can't redo a changed model, so the mod needs an update from its author${can ? ". Click to try the fixer anyway" : ""}`
                  : `${r.tool!.name} handles this kind of change. Click to get it and run it on this mod`}
                onClick={busy || !can ? undefined : fix}>
                {r.status === "broken" ? "Outdated hashes" : author ? "Needs its author" : `Needs ${fixerName(r.tool!.name)}`}
              </Badge>
              <span className="grow tp-problem-t">{t}</span>
            </li>
          );
        })}
        {r.reasons.length > 4 && (
          <li><Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show ${r.reasons.length - 4} more`}</Button></li>
        )}
        {note && <li className="hint tp-problem-tried">{note}.</li>}
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
      <button type="button" className="tp-link" title="Open in Mods" onClick={() => go({ view: "library", modId: r.modId })}>{r.name}</button>
      <span className="hint grow" title={r.reasons.join(". ")}>{why}</span>
      {!r.enabled && <Badge tone="muted" title="This mod is off">Off</Badge>}
      {r.tool && (
        <Button size="sm" variant="ghost" icon="wand" busy={busy === r.modId || fixerBusy.has(`mod:${r.modId}`)} disabled={!!busy}
          title={`Gets the newest ${r.tool.name} and runs it on this mod. It may not help. A backup is kept and Undo puts it back`}
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
    gameTools(gbId).then((t) => { if (live) setTools(t.filter((x) => FIXER.test(x.name))); }).catch(() => { if (live) setTools(null); });
    return () => { live = false; };
  }, [on, gbId]);
  if (!on || !tools) return null;
  // the first time, only the last 30 days count as new
  const since = seen[game] ?? Math.floor(Date.now() / 1000) - 30 * 86_400;
  const fresh = tools.filter((t) => t.added > since);
  if (!fresh.length) return null;
  const dismiss = () => void seenPref.set({ ...seen, [game]: Math.max(...tools.map((t) => t.added)) }, "Dismissed the new fixers");
  return (
    <div className="fx-new" role="status">
      <div className="row">
        <strong className="grow">{fresh.length === 1 ? "A new fixer on GameBanana" : `${fresh.length} new fixers on GameBanana`}</strong>
        <Button size="sm" variant="ghost" icon="check" onClick={dismiss} title="Stop listing these. Newer ones still show up">Dismiss</Button>
      </div>
      <ul className="tp-list">
        {fresh.slice(0, 6).map((t) => (
          <li key={t.id} className="row fx-new-item">
            <button type="button" className="tp-link grow" title="Open its page" onClick={() => openGbTool(t.id)}>{t.name}</button>
            <span className="hint">{[t.submitter, timeAgo(t.added)].filter(Boolean).join(", ")}</span>
            <GetFixer game={game} toolId={t.id} />
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
  if (have.length) return <span className="hint">Downloaded</span>;
  return (
    <Button size="sm" icon="downloads" busy={busy.has(`tool:${toolId}`)} title="Download its newest file into gachamod's fixers folder"
      onClick={() => void downloadNewestFixer(game, toolId)}>Download</Button>
  );
}
