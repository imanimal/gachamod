// Drop files anywhere on the window: .gachamod files open the pack importer (MODTOOLS), archives and folders install
// into the current game (ONLINE). Uses Tauri's drag-drop events (they carry real paths). Owner: skeleton.
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { inTauri } from "../lib/tauri";
import { currentGame, emitApp } from "../lib/store";
import { toast } from "./toast";

/** A part of a screen that takes some drops itself (a mod's preview takes images). It wins over the window-wide
 *  drop while the pointer is over its element and `accepts` the dragged paths. */
export interface DropTarget {
  el: () => HTMLElement | null;
  accepts: (paths: string[]) => boolean;
  onOver: (over: boolean) => void;
  onDrop: (paths: string[]) => void;
}
const targets = new Set<DropTarget>();
export function addDropTarget(t: DropTarget): () => void {
  targets.add(t);
  return () => { targets.delete(t); t.onOver(false); };
}
function targetAt(pos: { x: number; y: number }, paths: string[]): DropTarget | null {
  // Tauri gives physical pixels; element boxes are CSS pixels
  const x = pos.x / window.devicePixelRatio, y = pos.y / window.devicePixelRatio;
  for (const t of targets) {
    const r = t.el()?.getBoundingClientRect();
    if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && t.accepts(paths)) return t;
  }
  return null;
}

export function DropZone() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!inTauri()) return;
    let off: (() => void) | undefined;
    let gone = false;
    let dragged: string[] = [];
    let hot: DropTarget | null = null;
    const setHot = (t: DropTarget | null) => { if (t !== hot) { hot?.onOver(false); hot = t; t?.onOver(true); } };
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") {
        if (p.type === "enter") dragged = p.paths;
        const t = targetAt(p.position, dragged);
        setHot(t);
        setOver(!t);
      } else if (p.type === "leave") { setHot(null); setOver(false); }
      else if (p.type === "drop") {
        setOver(false);
        const t = targetAt(p.position, p.paths);
        setHot(null);
        if (t) { t.onDrop(p.paths); return; }
        const packs = p.paths.filter((x) => x.toLowerCase().endsWith(".gachamod"));
        const rest = p.paths.filter((x) => !x.toLowerCase().endsWith(".gachamod"));
        packs.forEach((path) => emitApp({ type: "open-pack", path }));
        if (rest.length) {
          if (!currentGame()) toast("Set up a game first, then drop mods on the window", true);
          else emitApp({ type: "install-paths", paths: rest });
        }
      }
    })).then((u) => { if (gone) u(); else off = u; });
    return () => { gone = true; off?.(); };
  }, []);
  if (!over) return null;
  const g = currentGame();
  return (
    <div className="dropzone" aria-hidden="true">
      <div className="dropzone-card">
        <Icon name="import" />
        <strong>Drop to add</strong>
        <span>Archives and folders install into {g?.name ?? "the current game"}, zips inside zips too. A .gachamod file opens to show what is inside.</span>
      </div>
    </div>
  );
}
