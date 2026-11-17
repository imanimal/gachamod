// The note for a game whose skin menu key another app uses too: "Medal takes a screenshot on F7." with "Use F9",
// which moves gachamod's key, "Change Medal's key", which moves the other app's where gachamod can, and "Keep F7",
// which stops asking (otherKeys.ts). Owner: INGAME area.
import { useEffect, useState } from "react";
import type { GameId } from "../../lib/api";
import { Icon } from "../../ui/Icon";
import { t, tb } from "../../lib/i18n";
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
        const menu = c.menuGames.includes(game);
        return (
          <div key={c.id} className="live-blocked key-clash" role="status">
            <Icon name="warn" />
            <p>{tb(menu ? c.text : c.ask)}</p>
            <span className="key-clash-b">
              {c.suggestion && (
                <Button size="sm" variant="primary" busy={busy === `use-${c.id}`} disabled={!!busy} onClick={() => void run(`use-${c.id}`, () => moveKey(c))}
                  title={t("gachamod uses {free} in place of {key}, in every game. {app}'s key stays as it is", { free: c.suggestion, key: c.key, app: c.app })}>
                  {t("Use {key}", { key: c.suggestion })}
                </Button>
              )}
              {c.otherKey && (
                <Button size="sm" busy={busy === `other-${c.id}`} disabled={!!busy} onClick={() => void run(`other-${c.id}`, () => changeOtherKey(c))}
                  title={c.otherNeeds
                    ? t("{app} gets {free} in place of {key}, and gachamod keeps {key}. {needs}. A copy of {app}'s settings is kept next to them before the change", { app: c.app, free: c.otherKey, key: c.key, needs: tb(c.otherNeeds) })
                    : t("{app} gets {free} in place of {key}, and gachamod keeps {key}. A copy of {app}'s settings is kept next to them before the change", { app: c.app, free: c.otherKey, key: c.key })}>
                  {t("Change {app}'s key", { app: c.app })}
                </Button>
              )}
              <Button size="sm" variant="ghost" busy={busy === `keep-${c.id}`} disabled={!!busy} onClick={() => void run(`keep-${c.id}`, () => keepKey(c))}
                title={menu ? t("{key} keeps opening the skin menu and {app} keeps using it too. gachamod stops asking", { key: c.key, app: c.app })
                  : t("{key} keeps showing the key list and {app} keeps using it too. gachamod stops asking", { key: c.key, app: c.app })}>
                {t("Keep {key}", { key: c.key })}
              </Button>
            </span>
          </div>
        );
      })}
    </>
  );
}
