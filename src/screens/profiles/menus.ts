// The right-click menu for a profile (the same on the Profiles screen, Home and the sidebar) and the global search's
// profile commands ("Switch to Story mode", found by "loadout" or "preset" too). Imported by Profiles.tsx, which the
// app loads at start. Owner: HOME/PROFILES area.
import type { GameId } from "../../lib/api";
import { registerCommands, type Command } from "../../lib/search";
import { currentGame, currentRoute, go } from "../../lib/store";
import { menuFor, registerMenu, type MenuEntry } from "../../ui/ContextMenu";
import { deleteProfile, duplicateProfile, exportProfile, quickNewProfile, requestEdit, saveInto, startNewProfile, switchTo } from "./actions";
import { knownProfiles, loadProfiles, switchingNow } from "./data";

registerMenu("profile", ({ game, id }: { game: GameId; id: number }): MenuEntry[] => {
  const list = knownProfiles(game);
  const p = list?.find((x) => x.id === id);
  if (!list || !p) return [{ label: "Loading profiles", disabled: true }];
  const only = list.length <= 1;
  const sw = switchingNow();
  return [
    { header: p.name },
    { label: sw?.id === p.id ? `Switching to ${p.name}` : p.active ? "On now" : `Switch to ${p.name}`, icon: p.active ? "check" : "swap", disabled: p.active || !!sw,
      title: sw && sw.id !== p.id ? `Switching to ${sw.name} first` : undefined, onClick: () => void switchTo(game, p, list) },
    { label: "View mods", icon: "mods", title: "See the mods in this profile, and add or take out mods",
      disabled: currentRoute().profile === p.id, onClick: () => go({ view: "profiles", profile: p.id }) },
    "-",
    { label: "Edit", icon: "edit", title: "Name, icon, colour, banner and hotkey", onClick: () => requestEdit(p.id) },
    { label: "Rename", icon: "edit", keys: "F2", onClick: () => requestEdit(p.id, "rename") },
    { label: "Change icon and colour", icon: "palette", onClick: () => requestEdit(p.id, "icon") },
    { label: "Duplicate", icon: "copy", onClick: () => void duplicateProfile(game, p) },
    { label: "Replace with the mods on now", icon: "pin", disabled: p.active,
      title: p.active ? "It's on now, so it follows your changes already" : `Replaces ${p.name}'s mods with the ones on now`, onClick: () => void saveInto(game, p) },
    { label: p.hotkey ? `Hotkey: ${p.hotkey}` : "Set a hotkey", icon: "keyboard", title: "A key combo that switches to it while the game runs, like Ctrl+Alt+1",
      onClick: () => requestEdit(p.id, "hotkey") },
    { label: "Share as .gachamod", icon: "share", title: "A small file with links to its mods and your settings, to send to a friend or another PC", onClick: () => exportProfile(game, p) },
    "-",
    { label: "Delete", icon: "trash", danger: true, keys: "Del", disabled: only, title: only ? "The only profile can't be deleted" : "Your mods stay installed. Undo brings it back",
      onClick: () => void deleteProfile(game, p, list) },
  ];
});

/** Right-click on a "New profile" button (sidebar, Home): the ways to make one besides the one-click default. */
export const newProfileMenu = (game: GameId): MenuEntry[] => [
  { label: "New profile from the mods on now", icon: "plus", onClick: () => void quickNewProfile(game) },
  { label: "New profile with no mods", icon: "plus", title: "Every mod off, for playing without mods", onClick: () => startNewProfile(game, "empty") },
  { label: "New profile with options...", icon: "edit", title: "Pick the name, icon, colour and hotkey first", onClick: () => startNewProfile(game) },
];

registerCommands("profiles", async () => {
  const g = currentGame();
  if (!g) return [];
  const list = knownProfiles(g.id) ?? await loadProfiles(g.id).catch(() => []);
  const out: Command[] = list.map((p) => ({
    id: `profile:${p.id}`,
    title: switchingNow()?.id === p.id ? `Switching to ${p.name}` : p.active ? `${p.name} (on now)` : `Switch to ${p.name}`,
    section: "Profiles",
    icon: p.active ? "check" : "profiles",
    keywords: `profile loadout preset set outfit switch load use ${p.description ?? ""}`,
    hint: p.hotkey ?? undefined,
    priority: p.active ? 0 : 3,
    run: () => void switchTo(g.id, p, list),
    menu: () => menuFor("profile", { game: g.id, id: p.id }),
  }));
  out.push(
    { id: "profile:new", title: "New profile from the mods on now", section: "Profiles", icon: "plus", keywords: "save loadout preset create add snapshot remember current",
      run: () => startNewProfile(g.id) },
    { id: "profile:empty", title: "New profile with no mods", section: "Profiles", icon: "plus", keywords: "empty clean vanilla blank loadout preset create",
      run: () => startNewProfile(g.id, "empty") },
  );
  return out;
});
