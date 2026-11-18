// App-wide BROWSE layers: a GameBanana mod's page over any screen (a numeric route.modId), finding a creator by name
// (window event gm-find-creator from CreatorLink), the gbmod and creator menus, the search commands, the variant
// picker (event variants-needed), GameBanana links (app event open-gb-link), installing dropped files (app event
// install-paths), and the Downloads badge (failures count until seen, downloads/seen.ts). Owner: BROWSE area.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Checkbox, Dialog, formatBytes } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { errorText, fileUrl, installs, queue, type Candidate, type QueueItem } from "../../lib/api";
import { held } from "../../lib/tauri";
import { fileIdFromLink, modPage, parseGbLink, queueModFile } from "../../lib/gamebanana";
import { closeRoute, currentGame, emitApp, go, onApp, setBadge, setGame, useGame, useGames, useRoute } from "../../lib/store";
import { record, undo as undoStep } from "../../lib/history";
import { registerBrowseCommands } from "./commands";
import { registerBrowseMenus } from "./menus";
import { ModDrawer } from "./ModDrawer";
import { closeGbTool, gbModOfRoute } from "./state";
import { useQueue } from "./useQueue";
import { setDownloadsCounts } from "./downloadsTip";
import { PICK_EVENT, openVariantPicker } from "./cardQueue";
import { pruneSeen, unseen, useSeen } from "../downloads/seen";
import { withCreator, openCreator } from "./actions";
import { installAllPartsPref } from "../settings/automatic";
import "./browse.css";
import "./gb-inline.css";
import { LazyImg } from "../../ui/LazyImg";
import { notesText } from "../../lib/notes";
import { t, tn } from "../../lib/i18n";

registerBrowseMenus();

export function OnlineOverlays() {
  const snap = useQueue();
  const games = useGames();
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const [pickId, setPickId] = useState<number | null>(null);
  // the mod page on screen: a pick for that mod opens the picker, any other waits behind a toast
  const route = useRoute();
  const game = useGame();
  const onScreen = useRef<{ game: string | undefined; modId: number | null }>({ game: undefined, modId: null });
  onScreen.current = { game: game?.id, modId: gbModOfRoute(route) };
  const announced = useRef<Set<number> | null>(null);

  // the Downloads badge: failures the user hasn't looked at yet come first (they need something done, a running
  // download doesn't), then running and waiting downloads and choices to make. A pick counts until it's made, seen
  // or not, since it still needs you
  const seen = useSeen();
  useEffect(() => {
    const s = snap.summary;
    const fresh = unseen(snap.items, seen);
    const downloading = s.running + s.waiting;
    const picks = snap.items.filter((i) => i.state === "needsChoice").length;
    const failed = fresh.filter((i) => i.state === "failed").length;
    setDownloadsCounts({ downloading, picks, failed });
    if (failed > 0) setBadge("downloads", { count: failed, tone: "bad" });
    else if (downloading + picks > 0) setBadge("downloads", { count: downloading + picks, tone: "run" });
    else setBadge("downloads", null);
  }, [snap, seen]);
  useEffect(() => { pruneSeen(snap.items); }, [snap]);

  // tell the library when an install finished (it also hears the backend's library-changed event)
  const doneSeen = useRef<Set<number> | null>(null);
  useEffect(() => {
    const done = snap.items.filter((i) => i.state === "done");
    if (doneSeen.current === null) { doneSeen.current = new Set(done.map((i) => i.id)); return; }
    const fresh = done.filter((i) => !doneSeen.current!.has(i.id));
    fresh.forEach((i) => doneSeen.current!.add(i.id));
    for (const g of new Set(fresh.map((i) => i.req.game))) emitApp({ type: "library-refresh", game: g });
  }, [snap]);

  // a choice to make: the picker opens by itself only for the mod whose page is open; the rest get a toast with Pick,
  // and wait on the card's Pick badge and in Downloads until asked for
  const announce = useCallback((id: number, itemGame: string, modId: number | null | undefined, parts: number) => {
    const seen = announced.current ??= new Set();
    if (seen.has(id)) return;
    seen.add(id);
    const here = onScreen.current;
    if (modId != null && here.modId === modId && here.game === itemGame) { setPickId((cur) => cur ?? id); return; }
    // no name in the toast: Pick opens the window that names it
    toast(tn(parts, "A download has {n} part inside. Pick the ones to install", "A download has {n} parts inside. Pick the ones to install"),
      false, { label: t("Pick"), run: () => openVariantPicker(id) });
  }, []);
  useEffect(() => {
    if (pickId !== null && !snap.items.some((i) => i.id === pickId && i.state === "needsChoice")) setPickId(null);
    const waiting = snap.items.filter((i) => i.state === "needsChoice");
    if (announced.current === null) {
      // after a restart: one toast for whatever still waits
      announced.current = new Set(waiting.map((i) => i.id));
      if (waiting.length === 1) {
        const i = waiting[0]!;
        announced.current.delete(i.id);
        announce(i.id, i.req.game, i.req.gbModId, i.candidates.length);
      } else if (waiting.length > 1) {
        toast(tn(waiting.length, "{n} download waits for you to pick its parts", "{n} downloads wait for you to pick their parts"), false, { label: t("Show"), run: () => go("downloads") });
      }
      return;
    }
    for (const i of waiting) announce(i.id, i.req.game, i.req.gbModId, i.candidates.length);
  }, [snap, pickId, announce]);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  useEffect(() => held(queue.onVariantsNeeded((p) => {
    const i = snapRef.current.items.find((x) => x.id === p.id);
    announce(p.id, p.game, i?.req.gbModId, p.candidates.length);
  })), [announce]);
  useEffect(() => {
    const h = (e: Event) => { const id = (e as CustomEvent<number>).detail; announced.current?.add(id); setPickId(id); };
    window.addEventListener(PICK_EVENT, h);
    return () => window.removeEventListener(PICK_EVENT, h);
  }, []);

  // dropped files and GameBanana links from anywhere in the app
  useEffect(() => onApp((e) => {
    if (e.type === "install-paths") {
      const game = currentGame();
      if (!game) { toast(t("Set up a game first, then add mods"), true); return; }
      installs.local(game.id, e.paths)
        .then((o) => toast(o.notes.length ? notesText(o.notes) : tn(e.paths.length, "Installing {n} mod", "Installing {n} mods"), false, { label: t("Show"), run: () => go("downloads") }))
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
  const close = useCallback(() => setPickId(null), []);
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
    if (fileIdFromLink(url)) toast(t("That's a link to a file without its mod page. Open the mod's page on GameBanana and copy that link instead"), true);
    else toast(t("That isn't a GameBanana mod link"), true);
    return;
  }
  const here = currentGame();
  try {
    const mod = await modPage(link.modId);
    if (!mod) { toast(t("GameBanana didn't send that mod's page"), true); return; }
    // the mod's own game, when it isn't the one on screen
    const target = mod.game ? games.find((g) => g.gamebananaId === mod.game!.id) : here;
    if (mod.game && !target) { toast(t("That mod is for a game that isn't set up here"), true); return; }
    const game = target ?? here;
    if (!game) { toast(t("Set up a game first, then open the link again"), true); return; }
    if (link.fileId) {
      const file = mod.files.find((f) => f.id === link.fileId);
      if (!file) { toast(t("That file isn't on the mod's page anymore"), true); return; }
      await queueModFile(game.id, mod, file);
      toast(game.id !== here?.id ? t("Downloading the mod for another game") : t("Downloading the mod"),
        false, { label: t("Show"), run: () => go("downloads") });
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
  const name = item.req.meta.name || item.req.fileName || t("This archive");
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
      await installAllPartsPref.set(true);
      const label = t("Archives with several parts now install all of them without asking");
      // its own toast for the Download settings button; Undo goes through the step, so the toast turns into Redo
      const step = record({ label, undo: () => installAllPartsPref.set(false), redo: () => installAllPartsPref.set(true) }, true);
      const id = toast(label, false, { label: t("Undo"), run: () => void undoStep(step, id) },
        { label: t("Download settings"), run: () => go({ view: "settings", section: "set-all-parts" }) });
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
      title={tn(candidates.length, "{name} has {n} part inside", "{name} has {n} parts inside", { name })}
      footer={<>
        <Button variant="ghost" onClick={() => setPicked(all ? new Set() : new Set(candidates.map((c) => c.key)))}>{all ? t("Pick none") : t("Pick all")}</Button>
        <Button variant="ghost" icon="layers" disabled={busy} onClick={() => void always()}
          title={t("Installs all of these now, and from now on every archive with several parts installs all of them without this window. Settings, Downloads and installing turns it off")}>{t("Always install all")}</Button>
        <span className="sp" />
        <Button variant="ghost" disabled={busy} onClick={() => void cancel()} title={t("Cancels this download. Esc closes the window and keeps it waiting in Downloads")}>{t("Don't install")}</Button>
        <Button variant="primary" icon="install" busy={busy} disabled={!keys.length} onClick={() => void choose()}>
          {keys.length > 1 ? t("Install {n}", { n: keys.length }) : t("Install chosen")}
        </Button>
      </>}>
      <p className="hint gb-picker-hint">
        {t("Pick the parts you want. They install as one mod, and you can turn each part on or off in its details.")}
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
                <Badge>{tn(c.iniCount, "{n} ini", "{n} inis")}</Badge><span>{formatBytes(c.size)}</span>
              </span>
              {c.key && <span className="gb-variant-path hint mono" title={c.key}>{c.key}</span>}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
