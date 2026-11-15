// Tools > Fixes: which installed mods a game update broke, one click to fix them, the fixers gachamod takes its data
// from, and new fixers posted on GameBanana. Owner: FIXES area.
import { useEffect, useRef, useState } from "react";
import { fixes, type FixInfo, type GameId, type ModHealthRow } from "../../lib/api";
import { downloadNewestFixer, fixMods, reloadHealth, showFixer, useFixerBusy, useFixerFiles, useHealthRows } from "../../lib/fixes";
import { gameTools, gbToolId, type GbTool } from "../../lib/gamebanana";
import { fixerInApp, openFixer, openGbTool } from "../browse/state";
import { jsonPref } from "../../lib/prefs";
import { go, useGames } from "../../lib/store";
import { Badge, Button, Panel, Skeleton, plural, timeAgo } from "../../ui/kit";
import { fixesAutoUpdatePref } from "../settings/automatic";
import "../modtools/modtools.css";

/** Words that make a GameBanana tool a fixer (docs/fixers.md). */
const FIXER = /fix|hash|remap|repair|update|convert/i;
/** Per game, the newest tool date (unix seconds) the user has seen. */
const seenPref = jsonPref<Record<string, number>>("fixes.seenTools", {});

export function FixesPanel({ game }: { game: GameId }) {
  const rows = useHealthRows(game);
  const [info, setInfo] = useState<FixInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
  const listed = [...broken, ...stuck].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  const noData = info && !info.pairs && !info.sources.length;

  return (
    <Panel title="Fixes" icon="wand" className="tp tp-fixes" count={rows ? listed.length : undefined}
      actions={<>
        {broken.length > 0 && (
          <Button size="sm" variant="primary" icon="wand" busy={busy === "all"} disabled={!!busy}
            title={`Swap the outdated hashes in ${plural(broken.length, "mod")}. Each gets a backup, and one Undo puts them all back`}
            onClick={() => void run("all", () => fixMods(game, broken.map((r) => r.modId)))}>{broken.length === 1 ? "Fix 1 mod" : `Fix ${broken.length} mods`}</Button>
        )}
        <Button size="sm" variant="ghost" icon="refresh" busy={busy === "check"} disabled={!!busy} title="Check every mod again"
          onClick={() => void run("check", () => reloadHealth(game))}>Check again</Button>
      </>}>
      <p className="hint tp-intro">
        {noData
          ? "gachamod has no fix data for this game yet. The fixers below may still help."
          : `A game update changes the hashes mods use, and mods that still use the old ones stop showing. gachamod knows the hash changes up to ${info?.currentVersion.split(" ")[0] || "the latest version"} and swaps them in the mod's .ini. A backup is kept, and Undo puts the files back.`}
      </p>
      {!rows ? (
        <div className="tp-loading" aria-busy="true"><Skeleton h="2.6rem" /><Skeleton h="2.6rem" /></div>
      ) : listed.length === 0 ? (
        <p className="tp-none muted">{fixed.length ? `No broken mods left. gachamod fixed ${plural(fixed.length, "mod")}.` : "No mods with outdated hashes found."}</p>
      ) : (
        <ul className="tp-list tp-problem-list">
          {listed.map((r) => <HealthRow key={r.modId} game={game} r={r} busy={busy} run={run} />)}
        </ul>
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
      <NewFixers game={game} />
      {info && info.sources.length > 0 && (
        <details className="tp-ignored fx-sources">
          <summary className="hint">Where the fixes come from ({info.sources.length})</summary>
          <ul className="tp-list">
            {info.sources.map((s) => (
              <li key={s.id} className="fx-source">
                <div className="row">
                  <button type="button" className="tp-link grow" title={gbToolId(s.url) ? "Open its page" : `Open ${s.url}`} onClick={() => openFixer({ name: s.name, url: s.url })}>{s.name}</button>
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
  return (
    <li className="tp-problem">
      <div className="tp-problem-h row">
        <button type="button" className="tp-link grow" title="Open in Mods" onClick={() => go({ view: "library", modId: r.modId })}>{r.name}</button>
        {!r.enabled && <Badge tone="muted" title="This mod is off">Off</Badge>}
        {r.status === "broken" ? (
          <Button size="sm" icon="wand" busy={busy === r.modId} disabled={!!busy}
            title={`Swap ${plural(r.swaps, "outdated hash", "outdated hashes")}. A backup is kept and Undo puts it back`}
            onClick={() => void run(r.modId, () => fixMods(game, [r.modId]))}>Fix</Button>
        ) : r.tool && (
          <Button size="sm" icon={fixerInApp(r.tool) ? "downloads" : "external"} title={`It needs more than a hash swap. ${r.tool.name} does the rest. ${fixerInApp(r.tool) ? "Opens its page here, where you can download it" : "Opens its page in your browser"}`}
            onClick={() => openFixer(r.tool!)}>Get {r.tool.name}</Button>
        )}
      </div>
      <ul className="tp-problem-items">
        {r.reasons.slice(0, 4).map((t) => (
          <li key={t} className="tp-problem-item row">
            <Badge tone={r.status === "broken" ? "warn" : "bad"} title={r.status === "broken" ? "gachamod can fix this. Click to fix it" : "gachamod can't fix this by itself. Click to open the fixer's page"}
              onClick={busy ? undefined : () => { if (r.status === "broken") void run(r.modId, () => fixMods(game, [r.modId])); else if (r.tool) openFixer(r.tool); }}>
              {r.status === "broken" ? "Fixable" : "Needs a fixer"}
            </Badge>
            <span className="grow tp-problem-t">{t}</span>
          </li>
        ))}
        {r.reasons.length > 4 && <li className="hint">And {r.reasons.length - 4} more</li>}
      </ul>
    </li>
  );
}

/** New fixer tools for the game on GameBanana, until dismissed. Off with Settings > Automatic > Look for new mod fixers. */
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

/** Download a fixer's newest file in one click, then Show file. gachamod never runs it. */
function GetFixer({ game, toolId }: { game: GameId; toolId: number }) {
  const have = useFixerFiles(game).filter((f) => f.toolId === toolId);
  const busy = useFixerBusy();
  const got = have[have.length - 1];
  if (got) return <Button size="sm" variant="ghost" icon="folder" title={`Show ${got.file} in File Explorer`} onClick={() => showFixer(got)}>Show file</Button>;
  return (
    <Button size="sm" icon="downloads" busy={busy.has(`tool:${toolId}`)} title="Download its newest file into gachamod's fixers folder. gachamod doesn't run it"
      onClick={() => void downloadNewestFixer(game, toolId)}>Download</Button>
  );
}
