// A character's picture at any size: the sharp one from lib/portraits.ts when there is one, GameBanana's icon
// otherwise, initials when neither loads. Owner: skeleton.
import { useEffect, useState, type CSSProperties } from "react";
import type { GameId } from "../lib/api";
import { usePortrait } from "../lib/portraits";
import { LazyImg } from "./LazyImg";

export function Portrait({ game, name, icon, size = 40, className, square, ring, title }:
  { game: GameId | null | undefined; name: string; icon?: string | null; size?: number | string; className?: string; square?: boolean; ring?: boolean; title?: string }) {
  const p = usePortrait(game, name, icon);
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => { setBroken(null); }, [p.src]);
  const initials = name.split(/[\s:()]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const dim = typeof size === "number" ? `${size}px` : size;
  const src = p.src && broken !== p.src ? p.src : icon && broken !== icon ? icon : null;
  return (
    <span className={`portrait avatar${square ? " square" : ""}${ring ? " ring" : ""}${p.sharp && src === p.src ? " sharp" : " soft"}${className ? ` ${className}` : ""}`}
      style={{ width: dim, height: dim } as CSSProperties} title={title}>
      {src
        ? <LazyImg src={src} alt="" decoding="async" draggable={false} onError={() => setBroken(src)}
            style={p.crop && src === p.src ? { objectPosition: "50% 8%" } : undefined} />
        : <span className="avatar-t" style={{ fontSize: `calc(${dim} * .38)` }}>{initials}</span>}
    </span>
  );
}
