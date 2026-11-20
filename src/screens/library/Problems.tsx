// Mods' Problems tab: what's wrong with the current game's mods, on one page. These are the panels Tools shows on its
// Problems and Conflicts pages, so both places share one state and always agree: problems in a mod's files, mods a game
// update broke, and conflicts between mods that are on, each with its fixes. Looking at it clears the Tools badge
// (ModtoolsOverlays.tsx), and the tab shows that badge's count. Owner: LIBRARY area; MODTOOLS and FIXES own the panels.
import type { ReactNode } from "react";
import type { GameId } from "../../lib/api";
import { t } from "../../lib/i18n";
import { PageHeader } from "../../ui/kit";
import { ConflictsPanel, ProblemsPanel } from "../modtools/ToolsPanels";
import { FixesPanel } from "../tools/FixesPanel";

/** What the tab lists, for its hover tip and the page's subtitle. */
export const problemsTip = () => t("Conflicts, broken files and mods a game update broke");

export function Problems({ game, tabs }: { game: GameId; tabs: ReactNode }) {
  return (
    <>
      <PageHeader title={t("Mods")} icon="mods" sub={problemsTip()} actions={tabs} />
      <div className="lib-problems">
        <ProblemsPanel />
        <FixesPanel game={game} />
        <ConflictsPanel />
      </div>
    </>
  );
}
