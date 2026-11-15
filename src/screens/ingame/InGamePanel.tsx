// Tools > In-game menu: the menu that opens over the game while playing (src-tauri overlay.rs, docs/ingame.md). On or
// off, its key, the controller shortcut, and what to do when the game runs as administrator. Owner: INGAME area.
import { useEffect, useState } from "react";
import { errorText, ingame, type GameId, type MenuSettings } from "../../lib/api";
import { toast } from "../../ui/toast";
import { Button, Checkbox, Panel, Skeleton, Toggle } from "../../ui/kit";
import { HotkeyField } from "../profiles/HotkeyField";
import { Icon } from "../../ui/Icon";
import { oxford } from "../../lib/notes";
import { setMenu, useMenuInfo } from "./data";
import "./ingame.css";

export function InGamePanel({ game }: { game: GameId }) {
  const info = useMenuInfo(game);
  return (
    <Panel title="Menu while playing" icon="gamepad">
      {info === null ? <Skeleton h="6rem" /> : <>
        {info.blocked && <Blocked />}
        <MenuOptions game={game} menu={info.menu} />
      </>}
    </Panel>
  );
}

/** The game runs as administrator and gachamod doesn't: what that costs, and the one click that fixes it. */
function Blocked() {
  const [busy, setBusy] = useState(false);
  const restart = () => {
    setBusy(true);
    // true: gachamod is closing for the new copy, so the button stays busy until then
    ingame.restartAsAdmin().then((ok) => { if (!ok) setBusy(false); }).catch((e) => { toast(errorText(e), true); setBusy(false); });
  };
  return (
    <div className="live-blocked" role="status">
      <Icon name="warn" />
      <p>
        This game runs as administrator and gachamod doesn't, so Windows keeps the menu key away from gachamod, and
        gachamod can't press F10 for you. Restarting gachamod as administrator fixes both.
      </p>
      <Button size="sm" variant="primary" busy={busy} disabled={busy} onClick={restart}
        title="Closes gachamod and opens it again as administrator. Windows asks you first">Restart as administrator</Button>
    </div>
  );
}

function MenuOptions({ game, menu }: { game: GameId; menu: MenuSettings }) {
  const set = (patch: Partial<MenuSettings>) => void setMenu(game, menu, { ...menu, ...patch });
  const on = menu.style !== "off";
  // mods that use the same key fire too when it opens the menu
  const [users, setUsers] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    setUsers([]);
    if (on) ingame.keyUsers(game).then((u) => { if (live) setUsers(u); }, () => {});
    return () => { live = false; };
  }, [game, on, menu.key]);
  return (
    <div className="live-menu">
      <Toggle checked={on} onChange={(v) => set({ style: v ? "window" : "off" })} label="Open a menu over the game"
        hint={`Press ${menu.key} in the game to open gachamod's menu over it. Pick a skin and that character's other mods turn off, the menu closes, and the game reloads its mods. The game has to run borderless or windowed.`} />
      {on && (
        <div className="live-menu-row">
          <HotkeyField label="Key that opens it" value={menu.key} bareF keep onChange={(key) => { if (key && key !== menu.key) set({ key }); }} />
          <Checkbox checked={menu.pad} onChange={(pad) => set({ pad })} label="Pressing both sticks in opens it too" />
        </div>
      )}
      {on && users.length > 0 && (
        <p className="hint live-key-users">
          <Icon name="warn" /> {oxford(users)} {users.length === 1 ? "uses" : "use"} {menu.key} too, so {users.length === 1 ? "it reacts" : "they react"} each
          time the menu opens. Pick another key above.
        </p>
      )}
    </div>
  );
}
