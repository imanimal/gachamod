import { ICONS, type IconName } from "./icons";

export type { IconName } from "./icons";

/** Stroke in px for an icon drawn `size` px wide. The stroke doesn't scale with the icon, so small ones get a thinner line. */
const strokeFor = (size: number) => (size <= 14 ? 1.2 : size < 22 ? 1.35 : 1.7);

/** A line icon in the current text colour. `size` is in px (default 1.15em via CSS when omitted). */
export function Icon({ name, size, className = "", title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg className={`i ${className}`.trim()} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}
      style={size ? ({ width: size, height: size, "--i-sw": strokeFor(size) } as React.CSSProperties) : undefined}>
      {title && <title>{title}</title>}
      <path d={ICONS[name]} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
