// Settings, Feedback and privacy, Online lookups: the requests gachamod makes by itself to sites other than
// GameBanana's mod lists (App Store icons, game wiki portraits, the daily character list, extension lists, mod of the
// day), each with a switch, who is asked and what is sent. Every one is on until turned off. The same switches show
// where they are used (Extensions, Fun extras) and share one state. Owner: SETTINGS/AI area.
import { motdPref } from "../../lib/motd";
import { onlineCharactersPref, onlineExtensionsPref, onlinePicturesPref } from "../../lib/prefs";
import { go } from "../../lib/store";
import { t } from "../../lib/i18n";
import { Button, Panel, Toggle } from "../../ui/kit";
import { SetRow } from "./parts";

export function OnlineLookupsSection() {
  const pictures = onlinePicturesPref.use();
  const characters = onlineCharactersPref.use();
  const motd = motdPref.use();
  return (
    <Panel title={t("Online lookups")} icon="web" id="lookups">
      <div className="set-rows">
        <p className="hint set-note">
          {t("These are asked for on their own, apart from mod lists on GameBanana. Each site sees your IP address like any web page does. No mod names, file paths or account details are sent.")}
        </p>
        <SetRow id="set-lookups-pictures" label={t("Sharp icons and portraits")}
          hint={t("Asks the App Store (itunes.apple.com) for each game's icon, sending the game's App Store number, and the game's community wiki (such as genshin-impact.fandom.com) for character portraits, sending character names. Off: games without a known folder show a lettered badge and characters use GameBanana's small icons. Pictures already saved still show")}>
          <Toggle checked={pictures} onChange={(v) => void onlinePicturesPref.set(v, v ? t("Turned on icon and portrait lookups") : t("Turned off icon and portrait lookups"))} />
        </SetRow>
        <SetRow id="set-lookups-characters" label={t("Refresh character lists")}
          hint={t("When a game opens, copies the game's character names and icons from GameBanana, at most once a day. Nothing is sent but the request. Off: that daily refresh stops. The Characters page, Browse and Home still ask GameBanana for the list when you open them")}>
          <Toggle checked={characters} onChange={(v) => void onlineCharactersPref.set(v, v ? t("Turned on character list refresh") : t("Turned off character list refresh"))} />
        </SetRow>
        <ExtensionListsRow id="set-lookups-extensions" />
        <SetRow id="set-lookups-motd" label={t("Mod of the day")}
          hint={t("Reads a small list from GitHub (raw.githubusercontent.com) every 12 hours. Nothing is sent but the request. Off: the gift button in Browse stays hidden")}>
          <Toggle checked={motd} onChange={(v) => void motdPref.set(v, v ? t("Showing mod of the day") : t("Hiding mod of the day"))} />
        </SetRow>
        <div className="set-note row">
          <span className="hint">{t("Checks for new versions of gachamod and your mods have their own switches")}</span>
          <Button size="sm" variant="ghost" onClick={() => go({ view: "settings", section: "automatic" })} title={t("Opens Mod update checks and rescans")}>{t("Update checks")}</Button>
        </div>
      </div>
    </Panel>
  );
}

/** Fetching the extension lists when Extensions opens. Shown here and under Extensions, one state. `id` differs per
 *  place so each row can be a route and a search result. */
export function ExtensionListsRow({ id }: { id: string }) {
  const on = onlineExtensionsPref.use();
  return (
    <SetRow id={id} label={t("Check extension lists when Extensions opens")}
      hint={t("Fetches gachamod's list and any list you added from their web addresses (GitHub, unless you added another site), and keeps each for 6 hours. Nothing is sent but the request. Off: only the Check the lists again button on Extensions fetches them")}>
      <Toggle checked={on} onChange={(v) => void onlineExtensionsPref.set(v, v ? t("Turned on extension list checks") : t("Turned off extension list checks"))} />
    </SetRow>
  );
}
