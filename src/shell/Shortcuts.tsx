// The lists of keys, drawn from lib/keys.ts by the shortcuts sheet (? in App.tsx), Settings > Hotkeys and Tools >
// Switch skins in game, so they always agree. Owner: SHELL area.
import type { GameId } from "../lib/api";
import { t } from "../lib/i18n";
import { MOD_SHORTCUTS, OVERLAY_SHORTCUTS, PAD_SHORTCUTS, SHORTCUTS, gameShortcuts } from "../lib/keys";
import { go, reloadKeyOf } from "../lib/store";
import { Button, Waiting } from "../ui/kit";
import { useLive } from "../screens/ingame/data";
import { useKeyList } from "../screens/ingame/KeyListParts";
import { setHelpOpen } from "./state";

/** Keys and what they do, one per line. */
export function KeyRows({ rows }: { rows: ReadonlyArray<readonly [string, string]> }) {
  return <div className="keys-list">{rows.map(([k, what], i) => <div key={`${i}-${k}`}><kbd>{k}</kbd><span>{what}</span></div>)}</div>;
}

/** The app's keys, the keys on a mod and the controller's buttons. `game`: also the keys while that game runs. */
export function ShortcutGroups({ game }: { game?: GameId | null }) {
  return (
    <>
      <KeyRows rows={SHORTCUTS} />
      <h3 className="sub-h">{t("On a mod")}</h3>
      <KeyRows rows={MOD_SHORTCUTS} />
      <h3 className="sub-h">{t("Controller")}</h3>
      <KeyRows rows={PAD_SHORTCUTS} />
      {game && <InGame game={game} />}
    </>
  );
}

/** The keys while the game runs, as this game has them, with the way to change them. */
function InGame({ game }: { game: GameId }) {
  const info = useLive(game);
  const { list } = useKeyList(game);
  const open = () => { setHelpOpen(false); go({ view: "settings", section: "menu-keys" }); };
  return (
    <>
      <h3 className="sub-h">{t("In game")}</h3>
      {!info || !list ? <Waiting what={t("Reading the game's keys")} />
        : <KeyRows rows={gameShortcuts({ menu: info.all ? info.menu.key : undefined, list: list.settings.on && list.available ? list.settings.key : undefined, reload: reloadKeyOf(game) })} />}
      {info?.all && (
        <>
          <h3 className="sub-h">{t("In the menu over the game")}</h3>
          <KeyRows rows={OVERLAY_SHORTCUTS} />
        </>
      )}
      <p className="hint row"><span>{t("The in-game keys can be changed in Settings, Hotkeys.")}</span>
        <Button size="sm" variant="ghost" icon="keyboard" onClick={open} title={t("Opens Settings, Hotkeys, with the skin menu's keys and the profile hotkeys")}>{t("Hotkey settings")}</Button></p>
    </>
  );
}
