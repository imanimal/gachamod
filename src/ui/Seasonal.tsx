// Seasonal touches (Settings, Fun extras; off by default): drifting behind every window, a few snowflakes in late
// December, hearts on Valentine's Day, bats and pumpkins the week before Halloween. "By the date" shows nothing the
// rest of the year; picking one season shows it all year. Nothing shows with Animations off. Owner: SETTINGS/AI area.
import { useMemo, type CSSProperties } from "react";
import { seasonNow, seasonPref } from "../lib/fun";

const SIZE: Record<string, [number, number]> = { snow: [4, 6], hearts: [9, 6], halloween: [22, 12] };

export function Seasonal() {
  const kind = seasonNow(seasonPref.use());
  const bits = useMemo(() => Array.from({ length: kind === "halloween" ? 16 : 22 }, (_, i) => {
    const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    const [base, spread] = SIZE[kind ?? "snow"]!;
    return {
      "--x": `${(r(1) * 100).toFixed(1)}%`, "--s": `${base + r(2) * spread}px`, "--o": (0.35 + r(3) * 0.5).toFixed(2),
      "--d": `${14 + r(4) * 14}s`, "--w": `${-r(5) * 28}s`, "--sway": `${(r(6) - 0.5) * 80}px`, "--flap": `${0.2 + r(7) * 0.14}s`,
    } as CSSProperties;
  }), [kind]);
  if (!kind) return null;
  return <div className={`season season-${kind}`} aria-hidden="true">{bits.map((s, i) => <i key={i} style={s} />)}</div>;
}
