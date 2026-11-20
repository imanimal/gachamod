// The list of mods hidden with Not interested: what they are, Show again for one, Show all again for the lot.
// It sits in Browse's Filters popover. Owner: BROWSE area.
import { hideMod, showAllHiddenMods, useHiddenMods, useHiddenNames } from "../../lib/prefs";
import { Button, IconButton } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { openGbMod } from "./state";
import { t, tn } from "../../lib/i18n";

export function HiddenMods({ onPick }: { onPick: () => void }) {
  const ids = useHiddenMods();
  const names = useHiddenNames();
  if (!ids.length) return <p className="hint">{t("No mods are hidden.")}</p>;
  return (
    <div className="gbb-saved">
      <Button size="sm" variant="secondary" icon="eye" onClick={showAllHiddenMods}
        title={t("Show every hidden mod in Browse again (Undo in the toast)")}>{tn(ids.length, "Show {n} mod again", "Show all {n} mods again")}</Button>
      <ul className="gbb-saved-l">
        {[...ids].reverse().map((id) => {
          const name = names[String(id)] ?? t("Mod {id}", { id });
          return (
            <li key={id} className="gbb-saved-i">
              <button type="button" className="gbb-saved-b" title={t("Open the mod's page")} onClick={() => { openGbMod(id); onPick(); }}>
                <Icon name="hide" /><span>{name}</span>
              </button>
              <IconButton size="sm" icon="eye" label={t("Show in Browse again")} onClick={() => hideMod(id, name, false)} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
