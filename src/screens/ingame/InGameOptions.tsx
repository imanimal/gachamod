// In a mod's details: switch it in game without a reload. A live mod shows its group and a button to show it; a mod
// whose character has other mods offers to make all of them live. Owner: INGAME area.
import { useState } from "react";
import type { GameId } from "../../lib/api";
import { go } from "../../lib/store";
import { Button, Panel } from "../../ui/kit";
import { makeLive, pickLive, stopLive, useLive } from "./data";
import "./ingame.css";

export function InGameOptions({ game, modId }: { game: GameId; modId: string }) {
  const info = useLive(game);
  const [busy, setBusy] = useState(false);
  const run = async (job: () => Promise<unknown>) => { setBusy(true); try { await job(); } finally { setBusy(false); } };
  if (!info) return null;
  const g = info.groups.find((x) => x.mods.some((m) => m.modId === modId));
  const me = g?.mods.find((m) => m.modId === modId);
  if (g && me) {
    const showing = g.active === me.slot;
    return (
      <Panel title="In game" icon="swap" className="mi-panel mi-ingame">
        <p className="hint">
          {showing ? `Showing now. ${g.character}'s other live skins are hidden.` : `Hidden in game. It switches with ${g.character}'s ${g.mods.length - 1 === 1 ? "other live skin" : `${g.mods.length - 1} other live skins`}.`}
        </p>
        <div className="row live-opts">
          <Button size="sm" variant={showing ? "secondary" : "primary"} icon={showing ? "check" : "swap"} disabled={busy || showing} busy={busy}
            title={info.running ? "Sends it to the game, which comes to the front for a moment" : "Shows next time you start the game"}
            onClick={() => void run(() => pickLive(game, g, me.slot))}>{showing ? "Showing" : "Show in game"}</Button>
          <Button size="sm" variant="ghost" icon="tools" onClick={() => go({ view: "tools", section: "ingame" })}
            title="All live characters in Tools">View live skins</Button>
          <span className="grow" />
          <Button size="sm" variant="ghost" icon="x" disabled={busy} onClick={() => void run(() => stopLive(game, [modId], me.name))}
            title={showing ? "It stays on and always shows" : "It's turned off"}>Stop switching</Button>
        </div>
      </Panel>
    );
  }
  // with the switch in Tools off, nothing switches in game, so there's nothing to offer one mod at a time
  const ready = info.ready.find((r) => r.mods.some((m) => m.modId === modId));
  if (!ready || !info.all || (!info.allowed && !info.groups.length)) return null;
  const grouped = info.groups.find((x) => x.character.toLowerCase() === ready.character.toLowerCase());
  return (
    <Panel title="In game" icon="swap" className="mi-panel mi-ingame">
      <p className="hint">
        {grouped ? `${ready.character}'s other skins switch in game already. Add this one to pick it there too.`
          : `${ready.character} has ${ready.mods.length} mods. Make them live to pick which one shows while you play, without a reload.`}
      </p>
      <div className="row live-opts">
        <Button size="sm" icon="swap" busy={busy} disabled={busy}
          title={`Every ${ready.character} mod stays loaded and you pick which one shows. The game reloads once to start`}
          onClick={() => void run(() => grouped ? makeLive(game, [modId], ready.mods.find((m) => m.modId === modId)?.name ?? "This mod") : makeLive(game, ready.mods.map((m) => m.modId), ready.character))}>
          {grouped ? "Add to live skins" : `Switch ${ready.character} in game`}
        </Button>
      </div>
    </Panel>
  );
}
