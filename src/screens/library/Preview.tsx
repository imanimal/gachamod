// A mod's preview image: lazy, covers its box, a plain placeholder when there is none or it fails to load, and a
// blur for NSFW previews when the setting says so. Owner: LIBRARY area.
import { useEffect, useState } from "react";
import { fileUrl, settings } from "../../lib/api";
import { Icon, type IconName } from "../../ui/Icon";

export type NsfwMode = "hide" | "blur" | "show";

let nsfwCache: NsfwMode | null = null;
/** Setting "ui.nsfw" (default blur), read once per session and refreshed when a screen mounts. */
export function useNsfwMode(): NsfwMode {
  const [mode, setMode] = useState<NsfwMode>(nsfwCache ?? "blur");
  useEffect(() => {
    let live = true;
    settings.get("ui.nsfw").then((v) => {
      const m: NsfwMode = v === "hide" || v === "show" ? v : "blur";
      nsfwCache = m;
      if (live) setMode(m);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return mode;
}

// A new custom preview often has the same path as the last one (preview.png), so the webview would keep showing
// the cached picture. A version number on the URL makes every Preview of that path load it again.
const versions = new Map<string, number>();
export function previewChanged(path: string | null | undefined) { if (path) versions.set(path, (versions.get(path) ?? 0) + 1); }

/** `portrait` and `label` fill the box when the mod has no picture: the character's portrait over its name. */
export function Preview({ src, className, blur, icon = "image", alt = "", portrait, label }:
  { src: string | null | undefined; className?: string; blur?: boolean; icon?: IconName; alt?: string; portrait?: string | null; label?: string | null }) {
  const base = fileUrl(src);
  const v = src ? versions.get(src) : undefined;
  const url = base && v && !/^(data|blob):/.test(base) ? `${base}${base.includes("?") ? "&" : "?"}v=${v}` : base;
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [url]);
  return (
    <span className={`mod-img${blur ? " is-blurred" : ""}${className ? ` ${className}` : ""}`}>
      {url && !broken
        ? <img src={url} alt={alt} loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
        : portrait || label
          ? <span className="mod-img-none mod-img-stand" aria-hidden="true">
              {label && <span className="mod-img-ghost">{label}</span>}
              {portrait ? <img className="mod-img-portrait" src={portrait} alt="" loading="lazy" decoding="async" draggable={false} /> : <Icon name={icon} />}
            </span>
          : <span className="mod-img-none" aria-hidden="true"><Icon name={icon} /></span>}
    </span>
  );
}
