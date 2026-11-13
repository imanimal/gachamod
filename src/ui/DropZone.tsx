// Drop files anywhere on the window: .gachamod files open the pack importer (MODTOOLS), archives and folders install
// into the current game (ONLINE). Uses Tauri's drag-drop events (they carry real paths). Owner: skeleton.
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { inTauri } from "../lib/tauri";
import { currentGame, emitApp } from "../lib/store";
import { toast } from "./toast";

export function DropZone() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!inTauri()) return;
    let off: (() => void) | undefined;
    let gone = false;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") setOver(true);
      else if (p.type === "leave") setOver(false);
      else if (p.type === "drop") {
        setOver(false);
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
        <span>Archives and folders install into {g?.name ?? "the current game"}. A .gachamod file opens to show what is inside.</span>
      </div>
    </div>
  );
}
