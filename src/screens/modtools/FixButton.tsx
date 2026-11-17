// The button that makes one fix from modtools.lint, in the Tools Problems panel and a mod's drawer. Owner: MODTOOLS area.
import { useState } from "react";
import type { GameId, ModProblems, ProblemFix } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button, IconButton, Menu } from "../../ui/kit";
import { Popover } from "../../ui/Popover";
import { applyFix, fixHint, fixLabel } from "./problems";

/** One fix. "keep" makes the first variant the default and lists the others in a menu. */
export function FixButton({ game, m, fix, busyKey, busy, run, onDone }: {
  game: GameId; m: ModProblems; fix: ProblemFix; busyKey: string; busy: string | null;
  run: (key: string, job: () => Promise<unknown>) => Promise<void>; onDone?: () => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const make = (f: ProblemFix) => void run(busyKey, async () => { if (await applyFix(game, m, f)) onDone?.(); });
  const others = fix.kind === "keep" ? fix.inis.filter((i) => i !== fix.ini) : [];
  return (
    <span className="tp-fix row">
      <Button size="sm" variant="primary" icon="wand" busy={busy === busyKey} disabled={!!busy} title={fixHint(fix)} onClick={() => make(fix)}>{fixLabel(fix)}</Button>
      {others.length > 0 && (
        <IconButton icon="more" size="sm" label={t("Keep a different one on")} disabled={!!busy} aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : e.currentTarget)} />
      )}
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} label={t("Keep which one on")} width="18em">
          <Menu items={others.map((ini) => ({ label: t("Keep {ini} on", { ini }), icon: "check" as const, onClick: () => { setMenu(null); make({ ...fix, ini }); } }))} />
        </Popover>
      )}
    </span>
  );
}
