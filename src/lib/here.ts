// What's on screen now, for menus. An entry that would open the page already showing offers its counterpart instead:
// Settings and Tools for each other, Mods and Browse for each other, a character's page and their mods in Mods
// (docs/spec.md, "Product rules"). Owner: skeleton.
import { currentRoute } from "./store";

type Paged = "settings" | "tools";
const pages = new Map<Paged, string>();

/** Settings and Tools say which of their pages shows (settings/Paged.tsx), and null when they close. */
export function setShownPage(screen: Paged, page: string | null) {
  if (page) pages.set(screen, page);
  else pages.delete(screen);
}

/** Whether Settings or Tools is open on this page ("games", "launch"). */
export const showsPage = (screen: Paged, page: string) => currentRoute().view === screen && pages.get(screen) === page;

/** Whether this character's page is open, on any of its tabs. */
export function onCharacterPage(name: string): boolean {
  const r = currentRoute();
  return r.view === "characters" && !!r.character && r.character.toLowerCase() === name.toLowerCase();
}
