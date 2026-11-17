// The note for a game whose skin menu key another app uses too: "Medal takes a screenshot on F7." with "Use F9",
// which moves gachamod's key, "Change Medal's key", which moves the other app's where gachamod can, and "Keep F7",
// which stops asking (otherKeys.ts). Owner: INGAME area.
import { useEffect, useState } from "react";
import type { GameId } from "../../lib/api";
import { Icon } from "../../ui/Icon";
import { Button } from "../../ui/kit";
import { useLive } from "./data";
import { changeOtherKey, keepKey, moveKey, reloadKeyClashes, useKeyClashes } from "./otherKeys";
import "./ingame.css";

export function KeyClashNote({ game }: { game: GameId }) {
  const info = useLive(game);
  const clashes = useKeyClashes(game);
  const [busy, setBusy] = useState<string | null>(null);
  // read again when the game's key changes, or it gets its menu (the first character that switches in game)
  const key = info?.menu.key;
  const hasMenu = !!info?.groups.length;
  useEffect(() => { void reloadKeyClashes(); }, [game, key, hasMenu]);
  const run = async (id: string, job: () => Promise<void>) => { setBusy(id); try { await job(); } finally { setBusy(null); } };
  return (
    <>
      {clashes.map((c) => {
        const job = c.menuGames.includes(game) ? "opening the skin menu" : "showing the key list";
        return (
          <div key={c.id} className="live-blocked key-clash" role="status">
            <Icon name="warn" />
            <p>{c.menuGames.includes(game) ? c.text : c.ask}</p>
            <span className="key-clash-b">
              {c.suggestion && (
                <Button size="sm" variant="primary" busy={busy === `use-${c.id}`} disabled={!!busy} onClick={() => void run(`use-${c.id}`, () => moveKey(c))}
                  title={`gachamod uses ${c.suggestion} in place of ${c.key}, in every game. ${c.app}'s key stays as it is`}>
                  Use {c.suggestion}
                </Button>
              )}
              {c.otherKey && (
                <Button size="sm" busy={busy === `other-${c.id}`} disabled={!!busy} onClick={() => void run(`other-${c.id}`, () => changeOtherKey(c))}
                  title={`${c.app} gets ${c.otherKey} in place of ${c.key}, and gachamod keeps ${c.key}. ${c.otherNeeds ?? ""}. A copy of ${c.app}'s settings is kept next to them before the change`}>
                  Change {c.app}'s key
                </Button>
              )}
              <Button size="sm" variant="ghost" busy={busy === `keep-${c.id}`} disabled={!!busy} onClick={() => void run(`keep-${c.id}`, () => keepKey(c))}
                title={`${c.key} keeps ${job} and ${c.app} keeps using it too. gachamod stops asking`}>
                Keep {c.key}
              </Button>
            </span>
          </div>
        );
      })}
    </>
  );
}
