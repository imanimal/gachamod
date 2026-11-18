// The Mods layouts (lib/theme.ts ModsFormat) as small drawn previews, each picked with one click. Shown in Settings,
// Appearance and at the first start (Onboarding.tsx). Owner: SETTINGS/AI area.
import { useRef } from "react";
import { setModsFormat, useModsFormat, type ModsFormat } from "../../lib/theme";
import { moveInGrid } from "../library/gridNav";
import { t } from "../../lib/i18n";

/** Each layout: its name and what it looks like (the hover tip). */
export const FORMATS: Array<{ id: ModsFormat; name: string; what: string }> = [
  { id: "cards", name: t("Cards"), what: t("Characters as a row of chips over the mod cards. A mod's details slide in from the side") },
  { id: "chars", name: t("Character list"), what: t("Characters down the left with their pictures, the picked one's mods as cards beside them") },
  { id: "panes", name: t("Three panes"), what: t("Characters on the left, mods in the middle and the picked mod's details always open on the right") },
  { id: "rows", name: t("Compact list"), what: t("One line per mod with its switch first and its character and size in columns") },
];

/** The layouts side by side; the arrow keys move between them. `onPick` runs after a pick is applied. */
export function FormatPicker({ onPick, className }: { onPick?: (f: ModsFormat) => void; className?: string }) {
  const value = useModsFormat();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={`fmt-picker${className ? ` ${className}` : ""}`} role="radiogroup" aria-label={t("Mods layout")}
      onKeyDown={(e) => moveInGrid(e, ref.current, ".fmt-card")}>
      {FORMATS.map((f) => (
        <button key={f.id} type="button" role="radio" aria-checked={value === f.id} className={`card card-btn fmt-card${value === f.id ? " sel" : ""}`}
          title={f.what} onClick={() => { setModsFormat(f.id); onPick?.(f.id); }}>
          <FormatPreview id={f.id} />
          <span className="fmt-card-t"><b>{f.name}</b></span>
        </button>
      ))}
    </div>
  );
}

const bits = (n: number, cls: string) => Array.from({ length: n }, (_, i) => <span key={i} className={cls} />);

/** A miniature of the layout, drawn with boxes: the list, the cards, the details pane or the rows. */
function FormatPreview({ id }: { id: ModsFormat }) {
  return (
    <span className={`fmt-prev is-${id}`} aria-hidden="true">
      {id === "cards" && <><span className="fmt-chips">{bits(4, "fmt-chip")}</span><span className="fmt-grid">{bits(6, "fmt-tile")}</span></>}
      {(id === "chars" || id === "panes") && <span className="fmt-list">{bits(5, "fmt-li")}</span>}
      {id === "chars" && <span className="fmt-grid">{bits(6, "fmt-tile")}</span>}
      {id === "panes" && <><span className="fmt-grid">{bits(4, "fmt-tile")}</span><span className="fmt-info"><span className="fmt-info-pic" /></span></>}
      {id === "rows" && <span className="fmt-rows">{bits(6, "fmt-row")}</span>}
    </span>
  );
}
