// A mod's parts in its drawer: the folders inside it with their own inis (an archive's several mods installed as
// one), each with an on/off switch and Undo. Shows nothing for a mod without parts. Owner: LIBRARY area.
import { useEffect, useState } from "react";
import { errorText, library, type GameId, type ModEntry, type ModPart } from "../../lib/api";
import { record } from "../../lib/history";
import { Panel, Toggle, formatBytes } from "../../ui/kit";
import { t, tn } from "../../lib/i18n";
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
    if (!p) throw new Error(t("{part} isn't in {mod} anymore", { part: name, mod: mod.name }));
    const m = await library.setPart(game, mod.id, p.folder, on);
    publish(game, { changed: [m], removed: [], notes: [] });
    setParts(await library.parts(game, mod.id));
  };
  const set = async (p: ModPart, on: boolean) => {
    setBusy(true);
    try {
      await flip(p.name, on);
      // the part's switch shows it: Ctrl+Z still undoes it
      record({ label: on ? t("Turned on {part} in {mod}", { part: p.name, mod: mod.name }) : t("Turned off {part} in {mod}", { part: p.name, mod: mod.name }), undo: () => flip(p.name, !on), redo: () => flip(p.name, on) }, true);
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };

  const on = parts.filter((p) => p.enabled).length;
  return (
    <Panel title={t("Parts")} icon="layers" className="mi-panel mod-parts" count={t("{on} of {n} on", { on, n: parts.length })}>
      <p className="hint">{t("Folders inside this mod that have an .ini. A part that's off isn't loaded, and the rest of the mod stays on.")}</p>
      <div className="mod-parts-list">
        {parts.map((p) => (
          <Toggle key={p.name} checked={p.enabled} disabled={busy} onChange={(v) => void set(p, v)}
            label={p.name} hint={tn(p.iniCount, "{n} ini, {size}", "{n} inis, {size}", { size: formatBytes(p.sizeBytes) })} />
        ))}
      </div>
    </Panel>
  );
}
