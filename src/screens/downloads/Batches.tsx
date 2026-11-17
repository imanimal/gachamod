// Finished downloads as batches: downloads that ran at the same time or close together are one batch, so a night of
// installs (or a bundle of 18 outfits) can be turned on or off together. Each finished row lists the mods it installed
// with a switch each. Owner: BROWSE area (docs/spec.md, "Downloads and Browse").
import { useEffect, useMemo, useState } from "react";
import { Button, IconButton, Toggle } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { errorText, library, type ModEntry, type QueueItem } from "../../lib/api";
import { held } from "../../lib/tauri";
import { go } from "../../lib/store";
import { onPublish, toggleMods } from "../library/data";
import { t, tn } from "../../lib/i18n";

/** Downloads that start within this long of the last one finishing join its batch. */
const GAP_SECS = 10 * 60;

/** Finished items in batches, newest batch first and newest item first inside. An item joins a batch when it was
 *  added before the batch's last item finished (they overlapped) or within ten minutes of it. */
export function batches(done: QueueItem[]): QueueItem[][] {
  const end = (i: QueueItem) => i.finishedAt ?? i.addedAt;
  const sorted = [...done].sort((a, b) => a.addedAt - b.addedAt);
  const out: { items: QueueItem[]; until: number }[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.addedAt <= last.until + GAP_SECS) { last.items.push(i); last.until = Math.max(last.until, end(i)); }
    else out.push({ items: [i], until: end(i) });
  }
  // failures first in each batch, so one doesn't sit below thirty finished rows
  const rank = (i: QueueItem) => (i.state === "failed" || i.state === "needsChoice" ? 0 : 1);
  return out.reverse().map((b) => b.items.sort((x, y) => rank(x) - rank(y) || end(y) - end(x)));
}

/** "Today at 2:04 AM", "Yesterday at 9:15 PM", "Nov 3 at 6:40 PM". */
export function batchWhen(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return t("Today at {time}", { time });
  if (diff === 1) return t("Yesterday at {time}", { time });
  return t("{date} at {time}", { date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), time });
}

/** Every mod of these games by id, kept current with on/off changes and installs. */
export function useInstalled(gameIds: string[]): Map<string, ModEntry> {
  return useInstalledState(gameIds).byId;
}

/** useInstalled, plus which games' lists have loaded (until then a missing mod isn't "removed", just not read yet). */
export function useInstalledState(gameIds: string[]): { byId: Map<string, ModEntry>; loaded: Set<string> } {
  const key = [...new Set(gameIds)].sort().join(",");
  const [byId, setById] = useState<Map<string, ModEntry>>(new Map());
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    const games = key ? key.split(",") : [];
    const load = (g: string) => library.list(g as ModEntry["game"]).then((l) => {
      if (!live) return;
      setLoaded((s) => (s.has(g) ? s : new Set(s).add(g)));
      setById((prev) => {
        const n = new Map([...prev].filter(([, m]) => m.game !== g));
        for (const m of l) n.set(m.id, m);
        return n;
      });
    }).catch(() => {});
    games.forEach((g) => void load(g));
    const offPub = onPublish((g, change) => {
      if (!live || !games.includes(g)) return;
      setById((prev) => {
        const n = new Map(prev);
        for (const m of change.changed) n.set(m.id, m);
        for (const id of change.removed) n.delete(id);
        return n;
      });
    });
    const offBackend = held(library.onChanged((p) => { if (games.includes(p.game)) void load(p.game); }));
    return () => { live = false; offPub(); offBackend(); };
  }, [key]);
  return { byId, loaded };
}

/** Turn these mods on or off as one action, with the usual Undo and one-skin rule. `all` is every mod of the game. */
export async function setMods(mods: ModEntry[], on: boolean, all: Map<string, ModEntry>) {
  const game = mods[0]?.game;
  if (!game) return;
  const ids = mods.filter((m) => m.enabled !== on).map((m) => m.id);
  if (!ids.length) {
    const name = mods[0]!.name;
    toast(mods.length === 1
      ? on ? t("{name} is on already", { name }) : t("{name} is off already", { name })
      : on ? t("They're all on already") : t("They're all off already"));
    return;
  }
  try { await toggleMods(game, ids, on, [...all.values()].filter((m) => m.game === game)); }
  catch (e) { toast(errorText(e), true); }
}

/** The mods a finished item installed that are still in the library. */
export const modsOf = (i: QueueItem, all: Map<string, ModEntry>): ModEntry[] =>
  i.state === "done" ? (i.modIds ?? []).map((id) => all.get(id)).filter((m): m is ModEntry => !!m) : [];

const onCount = (mods: ModEntry[]) => mods.filter((m) => m.enabled).length;

/** Turn all on / Turn all off, for a row's mods or a batch's. */
export function AllSwitches({ mods, all, from }: { mods: ModEntry[]; all: Map<string, ModEntry>; from: "download" | "batch" }) {
  const [busy, setBusy] = useState<"on" | "off" | null>(null);
  const on = onCount(mods);
  const run = (v: boolean) => { setBusy(v ? "on" : "off"); void setMods(mods, v, all).finally(() => setBusy(null)); };
  return (
    <>
      <Button size="sm" icon="power" busy={busy === "on"} disabled={on === mods.length || !!busy} onClick={() => run(true)}
        title={from === "batch" ? t("Turn on every mod from this batch. A character's other skins turn off as usual") : t("Turn on every mod from this download. A character's other skins turn off as usual")}>{t("Turn all on")}</Button>
      <Button size="sm" variant="ghost" busy={busy === "off"} disabled={on === 0 || !!busy} onClick={() => run(false)}
        title={from === "batch" ? t("Turn off every mod from this batch") : t("Turn off every mod from this download")}>{t("Turn all off")}</Button>
    </>
  );
}

/** One switch for a row that installed one mod. */
export function ModSwitch({ mod, all }: { mod: ModEntry; all: Map<string, ModEntry> }) {
  return <Toggle size="sm" checked={mod.enabled} onChange={(v) => void setMods([mod], v, all)} label={mod.enabled ? t("On") : t("Off")}
    title={mod.enabled ? t("Turn {name} off", { name: mod.name }) : t("Turn {name} on. Its character's other skin turns off as usual", { name: mod.name })} />;
}

/** The button that shows or hides a row's mods: "3 of 18 on". */
export function ModsToggle({ mods, open, onToggle }: { mods: ModEntry[]; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`dl-mods-btn${open ? " open" : ""}`} aria-expanded={open} onClick={onToggle}
      title={open ? t("Hide the mods this installed") : t("Show the mods this installed, to turn each on or off")}>
      <Icon name="chevron" />{t("{on} of {n} on", { on: onCount(mods), n: mods.length })}
    </button>
  );
}

/** A finished row's mods, each with a switch and a way to open it in Mods. */
export function InstalledList({ mods, all, gone }: { mods: ModEntry[]; all: Map<string, ModEntry>; gone: number }) {
  return (
    <div className="dl-installed">
      <div className="dl-installed-bar">
        <AllSwitches mods={mods} all={all} from="download" />
        {gone > 0 && <span className="hint">{tn(gone, "{n} mod from it was removed since", "{n} mods from it were removed since")}</span>}
      </div>
      <ul>
        {mods.map((m) => (
          <li key={m.id}>
            <Toggle size="sm" checked={m.enabled} onChange={(v) => void setMods([m], v, all)}
              title={m.enabled ? t("Turn {name} off", { name: m.name }) : t("Turn {name} on. Its character's other skin turns off as usual", { name: m.name })} />
            <button type="button" className="dl-installed-name" title={t("Open {name} in Mods", { name: m.name })} onClick={() => go({ view: "library", modId: m.id })}>{m.name}</button>
            {m.character && <span className="dl-c">{m.character}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A batch's heading: when it ran, what it holds, and switches for all of it. */
export function BatchHead({ items, all, onClear, onRetry }: { items: QueueItem[]; all: Map<string, ModEntry>; onClear: () => void; onRetry?: () => void }) {
  const mods = useMemo(() => items.flatMap((i) => modsOf(i, all)), [items, all]);
  const when = Math.max(...items.map((i) => i.finishedAt ?? i.addedAt));
  const failed = items.filter((i) => i.state === "failed").length;
  const parts = [
    tn(items.length, "{n} download", "{n} downloads"),
    mods.length ? tn(mods.length, "{n} mod, {on} on", "{n} mods, {on} on", { on: onCount(mods) }) : "",
    failed ? t("{n} failed", { n: failed }) : "",
  ].filter(Boolean);
  return (
    <div className="dl-batch-h">
      <span className="dl-batch-t">{batchWhen(when)}</span>
      <span className="hint">{parts.join(" · ")}</span>
      <span className="dl-batch-act">
        {failed > 0 && onRetry && <Button size="sm" icon="refresh" onClick={onRetry} title={tn(failed, "Try the {n} failed download in this batch again", "Try the {n} failed downloads in this batch again")}>{t("Retry failed")}</Button>}
        {mods.length > 1 && <AllSwitches mods={mods} all={all} from="batch" />}
        <IconButton icon="x" size="sm" label={t("Clear this batch from the list. Its mods stay installed")} onClick={onClear} />
      </span>
    </div>
  );
}
