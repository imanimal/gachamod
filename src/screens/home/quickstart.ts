// The quickstart shortcut (gachamod.exe gachamod://play, made by setup or Settings, General): start the game gachamod
// last had open, with mods, the way Play does. A game's own quickstart (gachamod://play/zzz) starts that game instead.
// It comes in as a link (App.tsx), at start or handed over by a second start. gachamod's window stays hidden and
// gachamod stays in the tray or quits after the game (src-tauri background.rs), unless "Open gachamod with quickstart"
// is on (lib/prefs quickstartOpensPref). Anything that needs the player (nothing set up, missing folders, a question, a
// game that didn't start) shows the window. Owner: HOME/PROFILES area.
import { app as appApi, shortcuts } from "../../lib/api";
import { allGames, currentGame, go, setGame, whenGames } from "../../lib/store";
import { t } from "../../lib/i18n";
import { toast } from "../../ui/toast";
import { canPlay, play } from "./PlayButton";

export const isPlayLink = (url: string) => /^gachamod:\/\/play\/?(?:[a-z0-9-]+\/?)?$/i.test(url.trim());

const showWindow = () => { appApi.showWindow().catch(() => {}); };

/** The game open now is the one quickstart starts: the shortcut's icon becomes that game's (gacha-core shortcuts.rs). */
export function followGame(id: string) { shortcuts.follow(id).catch(() => {}); }

export async function quickstart(url: string) {
  await whenGames();
  const id = /^gachamod:\/\/play\/([a-z0-9-]+)/i.exec(url.trim())?.[1]?.toLowerCase();
  const game = (id && allGames().find((g) => g.id === id && g.shown)) || currentGame();
  // nothing set up yet: the first-start page is showing and says what to do
  if (!game) { showWindow(); return; }
  if (currentGame()?.id !== game.id) setGame(game.id);
  if (!canPlay(game)) {
    showWindow();
    toast(t("Quickstart can't start the game until the game's folders are set"), true,
      { label: t("Game settings"), run: () => go({ view: "settings", section: "games" }) });
    return;
  }
  await play(game, false, showWindow);
}
