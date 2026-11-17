// Browse: GameBanana mods for the current game (the GbBrowser component with every filter), and creator pages at
// { view: "browse", user: id }. A mod's page opens over any screen from the route (OnlineOverlays).
// Owner: BROWSE area (docs/spec.md, "Downloads and Browse").
import { useEffect } from "react";
import { shell, errorText } from "../../lib/api";
import { consumeRoute, useGame, useRoute } from "../../lib/store";
import { IconButton, PageHeader } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { CreatorPage } from "./CreatorPage";
import { GbBrowser } from "./GbBrowser";
import { openGbMod, setFilters } from "./state";
import { useMotd } from "../../lib/motd";
import { PullButton } from "./Pull";
import { gameName } from "../../lib/games";
import { t } from "../../lib/i18n";
import "./browse.css";

export function Browse() {
  const game = useGame();
  const motd = useMotd(game?.id ?? "");
  const route = useRoute();

  // one-shot route fields: a search or a character to show
  useEffect(() => {
    if (!game) return;
    if (route.search === undefined && !route.character) return;
    const patch: Parameters<typeof setFilters>[1] = {};
    if (route.search !== undefined) patch.search = route.search.trim();
    if (route.character) patch.character = route.character;
    setFilters(game.id, patch);
    consumeRoute(["search", "character"]);
  }, [game, route.search, route.character]);

  if (!game) return null;
  if (route.user) return <CreatorPage key={route.user} id={route.user} game={game} />;
  return (
    <div className="page gb-browse">
      <PageHeader title={t("Browse")} icon="browse" sub={t("Mods for {game} on GameBanana", { game: gameName(game) })}
        actions={<>
          <PullButton game={game} />
          {motd && <IconButton icon="gift" label={(motd.name ? t("Mod of the day, picked by animal: {name}", { name: motd.name }) : t("Mod of the day, picked by animal")) + (motd.note ? `. ${motd.note}` : "")} onClick={() => openGbMod(motd.modId)} />}
          <IconButton icon="external" label={t("Open GameBanana in the browser")}
            onClick={() => shell.openUrl(`https://gamebanana.com/games/${game.gamebananaId}`).catch((e) => toast(errorText(e), true))} />
        </>} />
      <GbBrowser game={game.id} />
    </div>
  );
}
