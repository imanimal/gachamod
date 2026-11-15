// App-wide BROWSE layers: a GameBanana mod's page over any screen (a numeric route.modId), finding a creator by name
// (window event gm-find-creator from CreatorLink), the gbmod and creator menus, the search commands, the variant
// picker (event variants-needed), GameBanana links (app event open-gb-link), installing dropped files (app event
// install-paths), and the Downloads badge. Owner: BROWSE area.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Checkbox, Dialog, formatBytes, plural } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { errorText, fileUrl, installs, queue, type Candidate, type QueueItem } from "../../lib/api";
import { held } from "../../lib/tauri";
import { fileIdFromLink, modPage, parseGbLink, queueModFile } from "../../lib/gamebanana";
import { closeRoute, currentGame, emitApp, go, onApp, setBadge, setGame, useGame, useGames, useRoute } from "../../lib/store";
import { registerBrowseCommands } from "./commands";
import { registerBrowseMenus } from "./menus";
import { ModDrawer } from "./ModDrawer";
import { closeGbTool, gbModOfRoute } from "./state";
import { useQueue } from "./useQueue";
import { withCreator, openCreator } from "./actions";
import { installAllPartsPref } from "../settings/automatic";
import "./browse.css";
import { LazyImg } from "../../ui/LazyImg";

registerBrowseMenus();

const PICK_EVENT = "gm-pick-variants";

/** Open the variant picker for a queue item that waits for a choice (Downloads' "Pick variants" button). */
export function openVariantPicker(id: number) { window.dispatchEvent(new CustomEvent(PICK_EVENT, { detail: id })); }

export function OnlineOverlays() {
  const snap = useQueue();
  const games = useGames();
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const [pickId, setPickId] = useState<number | null>(null);
  const dismissed = useRef(new Set<number>());

  // the Downloads badge
  useEffect(() => {
    const s = snap.summary;
    const busy = s.running + s.waiting + s.needsChoice;
    if (busy > 0) setBadge("downloads", { count: busy, tone: "run" });
    else if (s.failed > 0) setBadge("downloads", { count: s.failed, tone: "bad" });
    else setBadge("downloads", null);
  }, [snap.summary]);

  // tell the library when an install finished (it also hears the backend's library-changed event)
  const doneSeen = useRef<Set<number> | null>(null);
  useEffect(() => {
    const done = snap.items.filter((i) => i.state === "done");
    if (doneSeen.current === null) { doneSeen.current = new Set(done.map((i) => i.id)); return; }
    const fresh = done.filter((i) => !doneSeen.current!.has(i.id));
    fresh.forEach((i) => doneSeen.current!.add(i.id));
    for (const g of new Set(fresh.map((i) => i.req.game))) emitApp({ type: "library-refresh", game: g });
  }, [snap]);

  // a choice to make: from the event, or found in the queue (after a restart)
  useEffect(() => {
    if (pickId !== null && !snap.items.some((i) => i.id === pickId && i.state === "needsChoice")) { setPickId(null); return; }
    const next = snap.items.find((i) => i.state === "needsChoice" && !dismissed.current.has(i.id));
    if (pickId === null && next) setPickId(next.id);
  }, [snap, pickId]);
  useEffect(() => held(queue.onVariantsNeeded((p) => { dismissed.current.delete(p.id); setPickId((cur) => cur ?? p.id); })), []);
  useEffect(() => {
    const h = (e: Event) => { const id = (e as CustomEvent<number>).detail; dismissed.current.delete(id); setPickId(id); };
    window.addEventListener(PICK_EVENT, h);
    return () => window.removeEventListener(PICK_EVENT, h);
  }, []);

  // dropped files and GameBanana links from anywhere in the app
  useEffect(() => onApp((e) => {
    if (e.type === "install-paths") {
      const game = currentGame();
      if (!game) { toast("Set up a game first, then add mods", true); return; }
      installs.local(game.id, e.paths)
        .then((o) => toast(o.notes[0] ?? `Installing ${plural(e.paths.length, "mod")}`, false, { label: "Show", run: () => go("downloads") }))
        .catch((err) => toast(errorText(err), true));
    } else if (e.type === "open-gb-link") {
      void openLink(e.url, gamesRef.current);
    }
  }), []);

  // a creator's name without their id (CreatorLink): find it, then open their page
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ name?: string; modId?: number | null }>).detail;
      if (d?.name) void withCreator({ name: d.name, modId: d.modId ?? null }, (c) => openCreator(c.id));
    };
    window.addEventListener("gm-find-creator", h);
    return () => window.removeEventListener("gm-find-creator", h);
  }, []);

  const item = pickId === null ? undefined : snap.items.find((i) => i.id === pickId);
  const close = useCallback(() => { if (pickId !== null) dismissed.current.add(pickId); setPickId(null); }, [pickId]);
  return (
    <>
      <GbModHost />
      <GbToolHost />
      <BrowseCommands />
      {item && item.state === "needsChoice" && <VariantPicker key={item.id} item={item} candidates={item.candidates} onClose={close} />}
    </>
  );
}

/** The mod page drawer for a numeric route.modId, on any screen. */
function GbModHost() {
  const route = useRoute();
  const game = useGame();
  const id = gbModOfRoute(route);
  const close = useCallback(() => closeRoute(["modId"]), []);
  if (!id || !game) return null;
  return <ModDrawer key={id} game={game} modId={id} onClose={close} />;
}

/** The same drawer for a GameBanana tool (route.toolId), with Download in place of Install. */
function GbToolHost() {
  const route = useRoute();
  const game = useGame();
  const id = typeof route.toolId === "number" && route.toolId > 0 ? route.toolId : null;
  const close = useCallback(() => closeGbTool(), []);
  if (!id || !game) return null;
  return <ModDrawer key={`tool-${id}`} game={game} modId={id} tool onClose={close} />;
}

function BrowseCommands() {
  const game = useGame();
  useEffect(() => registerBrowseCommands(game), [game]);
  return null;
}

async function openLink(url: string, games: ReturnType<typeof useGames>) {
  const link = parseGbLink(url);
  if (!link) {
    if (fileIdFromLink(url)) toast("That's a link to a file without its mod page. Open the mod's page on GameBanana and copy that link instead", true);
    else toast("That isn't a GameBanana mod link", true);
    return;
  }
  const here = currentGame();
  try {
    const mod = await modPage(link.modId);
    if (!mod) { toast("GameBanana didn't send that mod's page", true); return; }
    // the mod's own game, when it isn't the one on screen
    const target = mod.game ? games.find((g) => g.gamebananaId === mod.game!.id) : here;
    if (mod.game && !target) { toast(`${mod.name} is a mod for ${mod.game.name}, which isn't set up here`, true); return; }
    const game = target ?? here;
    if (!game) { toast("Set up a game first, then open the link again", true); return; }
    if (link.fileId) {
      const file = mod.files.find((f) => f.id === link.fileId);
      if (!file) { toast(`That file isn't on ${mod.name}'s page anymore`, true); return; }
      await queueModFile(game.id, mod, file);
      toast(`Downloading ${mod.name}${game.id !== here?.id ? ` for ${game.short}` : ""}`, false, { label: "Show", run: () => go("downloads") });
      return;
    }
    if (game.id !== here?.id) setGame(game.id);
    go({ view: "browse", modId: link.modId });
  } catch (e) {
    if (link.fileId) toast(errorText(e), true);
    else go({ view: "browse", modId: link.modId });
  }
}

function VariantPicker({ item, candidates, onClose }: { item: QueueItem; candidates: Candidate[]; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates[0] ? [candidates[0].key] : []));
  const [busy, setBusy] = useState(false);
  const name = item.req.meta.name || item.req.fileName || "This archive";
  const toggle = (k: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(k); else n.delete(k); return n; });
  const all = picked.size === candidates.length;
  const keys = useMemo(() => candidates.filter((c) => picked.has(c.key)).map((c) => c.key), [candidates, picked]);

  const choose = async () => {
    setBusy(true);
    try { await queue.choose(item.id, keys); onClose(); }
    catch (e) { toast(errorText(e), true); setBusy(false); }
  };
  /** Install every one now, and every archive after this without asking. */
  const always = async () => {
    setBusy(true);
    try {
      await queue.choose(item.id, candidates.map((c) => c.key));
      await installAllPartsPref.set(true, "Archives with several mods now install all of them without asking");
      onClose();
    } catch (e) { toast(errorText(e), true); setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try { await queue.cancel(item.id); onClose(); }
    catch (e) { toast(errorText(e), true); setBusy(false); }
  };

  return (
    <Dialog icon="layers" size="lg" className="gb-picker" onClose={onClose}
      title={`${name} has ${candidates.length} mods inside`}
      footer={<>
        <Button variant="ghost" onClick={() => setPicked(all ? new Set() : new Set(candidates.map((c) => c.key)))}>{all ? "Pick none" : "Pick all"}</Button>
        <Button variant="ghost" icon="layers" disabled={busy} onClick={() => void always()}
          title="Installs all of these now, and from now on every archive with several mods installs all of them without this window. Turn it off in Settings, Automatic">Always install all</Button>
        <span className="sp" />
        <Button variant="ghost" disabled={busy} onClick={() => void cancel()} title="Don't install anything from this archive">Cancel</Button>
        <Button variant="primary" icon="install" busy={busy} disabled={!keys.length} onClick={() => void choose()}>
          {keys.length > 1 ? `Install ${keys.length}` : "Install chosen"}
        </Button>
      </>}>
      <p className="hint gb-picker-hint">
        Pick the ones you want. They install as one mod, and you can turn each part on or off in its details.
      </p>
      <div className="gb-picker-grid">
        {candidates.map((c) => {
          const on = picked.has(c.key);
          const img = fileUrl(c.preview);
          return (
            <div key={c.key} className={`card gb-variant${on ? " sel" : ""}`}>
              <span className="gb-variant-img">
                {img ? <LazyImg src={img} alt="" decoding="async" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <Icon name="image" />}
              </span>
              <Checkbox checked={on} onChange={(v) => toggle(c.key, v)} label={<span className="gb-variant-t">{c.label}</span>} />
              <span className="gb-variant-meta hint">
                <Badge>{plural(c.iniCount, "ini")}</Badge><span>{formatBytes(c.size)}</span>
              </span>
              {c.key && <span className="gb-variant-path hint mono" title={c.key}>{c.key}</span>}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
