import { ICONS, type IconName } from "./icons";

export type { IconName } from "./icons";

/** A line icon in the current text colour. `size` is in px (default 1.15em via CSS when omitted). */
export function Icon({ name, size, className = "", title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg className={`i ${className}`.trim()} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}
      style={size ? { width: size, height: size } : undefined}>
      {title && <title>{title}</title>}
      <path d={ICONS[name]} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
