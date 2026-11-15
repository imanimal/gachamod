// What sort of mod one without a character is, for the type chips at the start of the character row on Mods. Read
// from its group folder (installs file it under its GameBanana category, like "UI" or "OtherMisc"), its name and its
// tags: "RabbitFX" and "Camera Fix" are tools, a mod in "UI" is UI. Owner: LIBRARY area.
import type { ModEntry } from "../../lib/api";
import { K_TOOL } from "../../lib/gamebanana";
import type { IconName } from "../../ui/Icon";

export type LibKind = "ui" | "tool" | "weapon" | "other";

export const LIB_KINDS: Array<{ value: LibKind; label: string; icon: IconName; title: string }> = [
  { value: "ui", label: "UI", icon: "layout", title: "Menus, icons, the HUD and loading screens" },
  { value: "tool", label: "Tools and fixes", icon: "tool", title: "Shader and effect libraries like RabbitFX and ORFix, removers, camera mods and other fixes" },
  { value: "weapon", label: "Weapons", icon: "sword", title: "Weapon models" },
  { value: "other", label: "Other", icon: "box", title: "Mods without a character that aren't UI, tools or weapons, like NPCs, pets and objects" },
];

export const kindName = (k: LibKind) => LIB_KINDS.find((x) => x.value === k)!.label;

// libraries other mods call into (live.rs keeps a list of their namespaces for in-game switching)
const LIBRARY = /rabbit\s*fx|\bor\s*fix\b|slot\s*fix|tex\s*fx|offset\s*fix|skin\s*fix|reshade|3dmigoto/i;
const UI = /(^|[^a-z])ui([^a-z]|$)|interface|\bhud\b|\bmenus?\b|\bicons?\b|\bfonts?\b|loading ?screens?|health ?bars?|mini-?map|subtitles?|crosshair/i;
const WEAPON = /\b(weapons?|swords?|claymores?|polearms?|spears?|bows?|catalysts?|w-?engines?|light ?cones?|guns?|katanas?)\b/i;
const TOOL_GROUP = /\btools?\b|\bfix(es)?\b|shaders?|utilit/i;

/** The type of a mod without a character. The group folder and tags win over words in the name. */
export function libKind(m: Pick<ModEntry, "name" | "folder" | "group" | "tags">): LibKind {
  const where = `${m.group ?? ""} ${m.tags.join(" ")}`;
  // "(1.7 Fix)" and "[FIXED]" are version notes, not what the mod is
  const name = `${m.name} ${m.folder}`.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  if (LIBRARY.test(`${name} ${where}`)) return "tool";
  if (UI.test(where)) return "ui";
  if (WEAPON.test(where)) return "weapon";
  if (TOOL_GROUP.test(where) || K_TOOL.test(name)) return "tool";
  if (UI.test(name)) return "ui";
  if (WEAPON.test(name)) return "weapon";
  return "other";
}
