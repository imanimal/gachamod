// The skin menu's keys, the same in Tools > Switch skins in game and Settings > Hotkeys: the key that opens it, the
// controller switch, the menu's own keys and the keys that can't be changed. Both read the one store in data.ts and
// save with patchMenu, so a change in one shows in the other, with the same checks, messages and Undo. Owner: INGAME
// area.
import type { GameId, MenuSettings } from "../../lib/api";
import { t } from "../../lib/i18n";
import { OVERLAY_SHORTCUTS, reloadShortcut } from "../../lib/keys";
import { reloadKeyOf } from "../../lib/store";
import { Checkbox } from "../../ui/kit";
import { KeyRows } from "../../shell/Shortcuts";
import { HotkeyField } from "../profiles/HotkeyField";
import { useSetting } from "../settings/parts";
import { KeptKeys } from "./KeyClash";
import { MenuKeys } from "./MenuKeys";
import { patchMenu } from "./data";
import "./ingame.css";

/** `open`: the Menu keys fold starts open. */
export function MenuKeyFields({ game, menu, open }: { game: GameId; menu: MenuSettings; open?: boolean }) {
  // each change starts from the one before it, so quick changes don't put each other back
  const set = (patch: Partial<MenuSettings>) => void patchMenu(game, menu, patch);
  // otherkeys.rs ASK: the toasts that ask when another app has the key that opens the menu
  const [ask, setAsk] = useSetting("otherKeys.ask", "1");
  return (
    <>
      <div className="live-menu-row">
        <HotkeyField label={t("Key that opens it")} value={menu.key} bareF keep reloadKey={reloadKeyOf(game)} reset="F7" onChange={(key) => { if (key && key !== menu.key) set({ key }); }} />
        <Checkbox checked={ask !== "0"} onChange={(v) => setAsk(v ? "1" : "0")} label={t("Say when another app uses this key")}
          title={t("When Medal, OBS, Steam or another recorder listens for the key that opens the skin menu, gachamod says so and offers a free key. The note on this page shows either way")} />
        <Checkbox checked={menu.pad} onChange={(pad) => set({ pad })} label={t("Use a controller in the menu")}
          title={t("Both sticks pressed in open it, the D-pad moves, A shows a skin and B closes it. Menu keys changes the buttons")} />
      </div>
      <KeptKeys />
      <MenuKeys menu={menu} open={open} onChange={(update, label, say) => void patchMenu(game, menu, (m) => ({ binds: update(m.binds) }), label, say)} />
      <details className="live-binds">
        <summary title={t("Keys in gachamod's menu over the game that stay the same, and the game's reload key")}>{t("Other keys")}</summary>
        <KeyRows rows={[reloadShortcut(reloadKeyOf(game)), ...OVERLAY_SHORTCUTS]} />
      </details>
    </>
  );
}
