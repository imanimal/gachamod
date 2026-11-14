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
import { setFilters } from "./state";
import "./browse.css";

export function Browse() {
  const game = useGame();
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
      <PageHeader title="Browse" icon="browse" sub={`Mods for ${game.name} on GameBanana`}
        actions={<IconButton icon="external" label="Open GameBanana in the browser"
          onClick={() => shell.openUrl(`https://gamebanana.com/games/${game.gamebananaId}`).catch((e) => toast(errorText(e), true))} />} />
      <GbBrowser game={game.id} />
    </div>
  );
}
