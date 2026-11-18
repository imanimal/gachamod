// Which other mod managers have mods gachamod can bring in, for the first-start offer. Tools > Share and import,
// "Mods from other managers" does the moving (screens/modtools/MovePanel.tsx).
import { imm, migrate, nrmm, type GameState } from "./api";
import { t } from "./i18n";

/** Names of the managers with mods for any of these games (games with a Mods folder). Only reads. */
export async function findOtherManagers(list: GameState[]): Promise<string[]> {
  const names = new Set<string>();
  const [i, n] = await Promise.all([imm.detect().catch(() => null), nrmm.detect().catch(() => null)]);
  if (i?.found && i.games.some((g) => g.mods > 0)) names.add(t("Integrated Mod Manager"));
  if (n?.found && n.games.some((g) => g.mods > 0)) names.add(t("No Reload Mod Manager"));
  const found = await Promise.all(list.filter((g) => g.modsDir).map((g) => migrate.detect(g.id).catch(() => [])));
  for (const m of found.flat()) if (m.id !== "imm" && m.outside + m.presets > 0) names.add(m.name);
  return [...names];
}
