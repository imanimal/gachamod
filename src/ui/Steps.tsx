// A list of steps with the current one marked. gachamod setup's progress (src/setup) and the app's own update panel
// (Settings, About and updates) draw the same list, so an update reads as one thing from the first click to the new
// version opening.
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Progress, Spinner } from "./kit";
import "./steps.css";

export interface StepItem {
  id: string;
  label: ReactNode;
  state: "todo" | "now" | "ok";
  /** A bar under the current step: 0 to 1 when it can be told, null when it only says it's working. */
  value?: number | null;
  /** The bar's name for screen readers. */
  valueLabel?: string;
  /** Under the label: a hint or a button. */
  extra?: ReactNode;
}

export function Steps({ items, compact }: { items: StepItem[]; compact?: boolean }) {
  return (
    <ol className={`step-list${compact ? " compact" : ""}`}>
      {items.map((s) => (
        <li key={s.id} className={`step-item ${s.state}`}>
          <span className="step-item-i">{s.state === "ok" ? <Icon name="check" /> : s.state === "now" ? <Spinner /> : <span className="step-dot" />}</span>
          <span className="step-item-b">
            <span className="step-item-t">{s.label}</span>
            {s.state === "now" && s.value !== undefined && <Progress value={s.value} label={s.valueLabel} />}
            {s.extra}
          </span>
        </li>
      ))}
    </ol>
  );
}
