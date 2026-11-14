// Tools > Switch skins in game: pick a character's skin while playing and it changes at once, without a reload
// (gacha-core live.rs, docs/ingame.md). Characters with two or more mods can be made live with one click. Owner: INGAME
// area.
import { useState } from "react";
import { fileUrl, type GameId, type LiveGroup, type LiveMod } from "../../lib/api";
import { Button, IconButton, Panel, Skeleton } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CharLink } from "../../ui/Links";
import { makeLive, pickLive, stopLive, useLive } from "./data";
import "./ingame.css";

export function InGamePanel({ game }: { game: GameId }) {
  const info = useLive(game);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, job: () => Promise<unknown>) => { setBusy(key); try { await job(); } finally { setBusy(null); } };

  return (
    <Panel title="Switch skins in game" icon="swap" count={info?.groups.length || undefined}>
      <p className="hint">
        Pick a character's skin here while you play and it changes in the game at once, without a reload. gachamod
        brings the game to the front for a moment to send it. This hasn't been tried in a real game yet.
      </p>
      {info === null && <div className="live-list"><Skeleton h="4.5rem" /><Skeleton h="4.5rem" /></div>}
      {info && info.groups.length > 0 && (
        <div className="live-list">
          {info.groups.map((g) => (
            <LiveRow key={g.group} game={game} g={g} busy={busy} run={run} />
          ))}
        </div>
      )}
      {info && info.ready.length > 0 && (
        <>
          <h3 className="live-h">{info.groups.length ? "More characters with several skins" : "Characters with several skins"}</h3>
          <div className="live-ready">
            {info.ready.map((r) => {
              const live = info.groups.some((g) => g.character.toLowerCase() === r.character.toLowerCase());
              return (
                <div key={r.character} className="live-ready-row">
                  <CharLink game={game} name={r.character} portrait />
                  <span className="hint">{r.mods.length} {live ? (r.mods.length === 1 ? "new mod" : "new mods") : "mods"}</span>
                  <span className="grow" />
                  <Button size="sm" variant={live ? "secondary" : "primary"} icon="swap" busy={busy === `add-${r.character}`} disabled={!!busy}
                    title={live ? `Add ${r.mods.map((m) => m.name).join(", ")} to ${r.character}'s live skins`
                      : `Every ${r.character} mod stays loaded and you pick which one shows. The game reloads once to start`}
                    onClick={() => void run(`add-${r.character}`, () => makeLive(game, r.mods.map((m) => m.modId), `${r.character}`))}>
                    {live ? "Add to live skins" : "Switch in game"}
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {info && !info.groups.length && !info.ready.length && (
        <p className="muted">This needs two or more mods for one character. Mods without a character can't be switched here.</p>
      )}
    </Panel>
  );
}

function LiveRow({ game, g, busy, run }: { game: GameId; g: LiveGroup; busy: string | null; run: (k: string, job: () => Promise<unknown>) => Promise<void> }) {
  const pick = (slot: number) => void run(`pick-${g.group}`, () => pickLive(game, g, slot));
  return (
    <div className="live-row">
      <div className="live-row-h">
        <CharLink game={game} name={g.character} portrait />
        <span className="grow" />
        <IconButton size="sm" icon="x" label={`Stop switching ${g.character} in game. The skin showing stays on, the others turn off`}
          disabled={!!busy} onClick={() => void run(`stop-${g.group}`, () => stopLive(game, g.mods.map((m) => m.modId), g.character))} />
      </div>
      <div className="live-chips" role="radiogroup" aria-label={`${g.character}'s skin`}>
        <button type="button" role="radio" aria-checked={g.active === 0} className={`live-chip${g.active === 0 ? " on" : ""}`}
          disabled={busy === `pick-${g.group}`} onClick={() => pick(0)}
          title={`None of these: ${g.character} wears the game's own look (or a mod that isn't live)`}>
          <span className="live-thumb"><Icon name="block" /></span>
          <span className="live-chip-t">None</span>
        </button>
        {g.mods.map((m) => <Chip key={m.modId} m={m} on={g.active === m.slot} busy={busy === `pick-${g.group}`} onPick={() => pick(m.slot)} />)}
      </div>
    </div>
  );
}

function Chip({ m, on, busy, onPick }: { m: LiveMod; on: boolean; busy: boolean; onPick: () => void }) {
  const src = fileUrl(m.preview);
  return (
    <button type="button" role="radio" aria-checked={on} className={`live-chip${on ? " on" : ""}${m.enabled ? "" : " is-off"}`} disabled={busy} onClick={onPick}
      title={on ? `${m.name} is showing` : m.enabled ? `Show ${m.name}` : `${m.name} is off. Picking it turns it on, and it shows after the game reloads`}>
      <span className="live-thumb">{src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <Icon name="mods" />}</span>
      <span className="live-chip-t">{m.name}</span>
      {on && <Icon name="check" className="live-chip-on" />}
    </button>
  );
}
