// What Browse adds to the global search: "Search GameBanana for <text>", the creators you follow, and
// "<character> mods online" for every character of the current game. Owner: BROWSE area.
import type { GameState } from "../../lib/api";
import { charNoun } from "../../lib/games";
import { characterList } from "../../lib/gamebanana";
import { creatorsPref } from "../../lib/prefs";
import { registerCommands, type Command } from "../../lib/search";
import { go } from "../../lib/store";
import { menuFor } from "../../ui/ContextMenu";
import { openCreator } from "./actions";
import { gameShort } from "../../lib/games";
import { t } from "../../lib/i18n";

export function registerBrowseCommands(game: GameState | null): () => void {
  const offs = [
    registerCommands("browse-search", (query) => {
      const q = query.trim();
      if (!q || !game) return [];
      return [{
        id: "browse-search", title: t("Search GameBanana for \"{q}\"", { q }), section: "Online", icon: "browse",
        keywords: `${q} gamebanana online browse find download mods skins`, hint: gameShort(game), fallback: true,
        run: () => go({ view: "browse", search: q }),
      }];
    }),
    registerCommands("browse-creators", () => Object.values(creatorsPref.get())
      .filter((c) => (c.sub || c.fav || c.prio) && !c.blocked)
      .map((c): Command => ({
        id: `creator-${c.id}`, title: c.name, section: "Creators", img: c.avatar ?? null, icon: "user",
        keywords: `creator modder member author gamebanana ${c.fav ? "favourite favorite" : ""} ${c.prio ? "priority" : ""} following followed`,
        hint: c.prio ? t("Prioritized") : c.fav ? t("Favourite") : t("Following"), priority: c.fav ? 2 : c.prio ? 1 : 0,
        run: () => openCreator(c.id),
        menu: () => menuFor("creator", { id: c.id, name: c.name, avatar: c.avatar ?? null }),
      }))),
  ];
  if (game) {
    const noun = charNoun(game.id, true).toLowerCase();
    offs.push(registerCommands("browse-characters", async () => (await characterList(game.id)).map((c): Command => ({
      id: `gb-char-${game.id}-${c.id}`, title: t("{name} mods online", { name: c.name }), section: "Characters", img: c.icon,
      keywords: `${c.name} gamebanana browse download skins online new ${noun}`, hint: t("Browse"),
      run: () => go({ view: "browse", character: c.name }),
    }))));
  }
  return () => offs.forEach((f) => f());
}
