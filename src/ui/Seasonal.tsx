// Seasonal touches (Settings, Fun extras; off by default): a few snowflakes in late December, hearts on Valentine's Day,
// drifting behind every window. Nothing shows the rest of the year or with Animations off. Owner: SETTINGS/AI area.
import { useMemo, type CSSProperties } from "react";
import { season, seasonalPref } from "../lib/fun";

export function Seasonal() {
  const on = seasonalPref.use();
  const kind = on ? season() : null;
  const bits = useMemo(() => Array.from({ length: 22 }, (_, i) => {
    const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    return {
      "--x": `${(r(1) * 100).toFixed(1)}%`, "--s": `${(kind === "hearts" ? 9 : 4) + r(2) * 6}px`, "--o": (0.35 + r(3) * 0.5).toFixed(2),
      "--d": `${14 + r(4) * 14}s`, "--w": `${-r(5) * 28}s`, "--sway": `${(r(6) - 0.5) * 80}px`,
    } as CSSProperties;
  }), [kind]);
  if (!kind) return null;
  return <div className={`season season-${kind}`} aria-hidden="true">{bits.map((s, i) => <i key={i} style={s} />)}</div>;
}
