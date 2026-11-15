// A mod's parts in its drawer: the folders inside it with their own inis (an archive's several mods installed as
// one), each with an on/off switch and Undo. Shows nothing for a mod without parts. Owner: LIBRARY area.
import { useEffect, useState } from "react";
import { errorText, library, type GameId, type ModEntry, type ModPart } from "../../lib/api";
import { record } from "../../lib/history";
import { Panel, Toggle, formatBytes, plural } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { publish } from "./data";

export function ModParts({ game, mod }: { game: GameId; mod: ModEntry }) {
  const [parts, setParts] = useState<ModPart[]>([]);
  const [busy, setBusy] = useState(false);
  // read again when the mod changes (a toggle, a rescan, an undo)
  useEffect(() => {
    let live = true;
    library.parts(game, mod.id).then((p) => { if (live) setParts(p); }).catch(() => { if (live) setParts([]); });
    return () => { live = false; };
  }, [game, mod.id, mod.iniCount, mod.sizeBytes, mod.path]);
  if (parts.length === 0) return null;

  /** Switch a part by name (its folder name changes each time). */
  const flip = async (name: string, on: boolean) => {
    const now = await library.parts(game, mod.id);
    const p = now.find((x) => x.name === name);
    if (!p) throw new Error(`${name} isn't in ${mod.name} anymore`);
    const m = await library.setPart(game, mod.id, p.folder, on);
    publish(game, { changed: [m], removed: [], notes: [] });
    setParts(await library.parts(game, mod.id));
  };
  const set = async (p: ModPart, on: boolean) => {
    setBusy(true);
    try {
      await flip(p.name, on);
      record({ label: `Turned ${on ? "on" : "off"} ${p.name} in ${mod.name}`, undo: () => flip(p.name, !on), redo: () => flip(p.name, on) });
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };

  const on = parts.filter((p) => p.enabled).length;
  return (
    <Panel title="Parts" icon="layers" className="mi-panel mod-parts" count={`${on} of ${parts.length} on`}>
      <p className="hint">Folders inside this mod with their own .ini. A part that's off isn't loaded, and the rest of the mod stays on.</p>
      <div className="mod-parts-list">
        {parts.map((p) => (
          <Toggle key={p.name} checked={p.enabled} disabled={busy} onChange={(v) => void set(p, v)}
            label={p.name} hint={`${plural(p.iniCount, "ini")}, ${formatBytes(p.sizeBytes)}`} />
        ))}
      </div>
    </Panel>
  );
}
