// A mod's details in a drawer (the route's modId, so Back closes it): big preview, its character and creator as
// links, a warning with Fix when a game update broke it, a quick switch for how mods for adults show, name,
// character, tags and notes (every edit with Undo), its parts, keys and in-game options, then the files.
// Owner: LIBRARY area.
import { Component, Fragment, Suspense, lazy, useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { dialogs, errorKind, errorText, library, type GameId, type ModEntry } from "../../lib/api";
import { fixLabel, stopWaiting, triedNote, useFixerBusy, useModHealth } from "../../lib/fixes";
import { holdMods, holdOn, releaseMods, useHolds } from "../../lib/holds";
import { gbToolId, isAbort, modPage, type GbMod } from "../../lib/gamebanana";
import { ModStats } from "../browse/ModStats";
import { openGbMod } from "../browse/state";
import { nsfwLabel, setNsfw, useNsfw, type NsfwMode } from "../../lib/prefs";
import { trashDaysPref } from "../settings/automatic";
import { sentences, stops, t, tn, tx } from "../../lib/i18n";
import { closeRoute, go, useRoute } from "../../lib/store";
import { inTauri } from "../../lib/tauri";
import { Button, Drawer, IconButton, Row, Segmented, Spinner, TextField, Toggle, formatBytes, timeAgo } from "../../ui/kit";
import { nsfwTip } from "../browse/menus";
import { addDropTarget } from "../../ui/DropZone";
import { Icon } from "../../ui/Icon";
import { KeyEditor } from "../../ui/KeyEditor";
import { CharLink, CreatorLink } from "../../ui/Links";
import { toast } from "../../ui/toast";
import { record } from "../../lib/history";
import { InGameOptions } from "../ingame/InGameOptions";
import { ModInsides } from "../modtools/ModInsides";
import { characterNames } from "../characters/roster";
import {
  addTag, fixForUpdate, getUpdate, openDetails, openFolder, openOnGb, patchMods, previewFromGb, removeTag, renameMod, setAdult, setCharacter,
  clearDrawerSection, drawerSectionFor, ownPreview, previewSaved, resetPreview, setFavourite, setOn, setParent, trashMods,
} from "./actions";
import { publish } from "./data";
import { libraryTags } from "./LibDialogs";
import { KindLink } from "./ModCard";
import { ModParts } from "./ModParts";
import { Preview } from "./Preview";

// three.js is large: the 3D view loads the first time it opens. lazy keeps a failed load, so a failed load is
// forgotten and Try again makes a new lazy component that loads it again
let viewerLoad: Promise<typeof import("./ModViewer")> | null = null;
const loadViewer = () => (viewerLoad ??= import("./ModViewer").catch((e: unknown) => { viewerLoad = null; throw e; }));
let ModViewer = lazy(loadViewer);
const retryViewer = () => { if (!viewerLoad) ModViewer = lazy(loadViewer); };

/** Shows the drawer for the route's modId. `mods` is the game's whole library. `docked`: a pane in the page that
 *  stays open (the "Three panes" Mods layout), saying what it's for while no mod is picked. */
export function ModDrawerHost({ game, mods, loaded, docked }: { game: GameId; mods: ModEntry[]; loaded: boolean; docked?: boolean }) {
  const route = useRoute();
  const id = typeof route.modId === "string" ? route.modId : null;
  const mod = id ? mods.find((m) => m.id === id) : undefined;
  useEffect(() => {
    if (!id || !loaded || mod) return;
    let live = true;
    library.get(game, id).then((m) => { if (live) publish(game, { changed: [m], removed: [], notes: [] }); })
      .catch((e) => {
        if (!live) return;
        closeRoute(["modId"]);
        // "invalid" is the library's answer for a mod it has no row for; anything else is a failed read, said as it is
        if (errorKind(e) === "invalid") toast(t("That mod isn't installed anymore"), false, { label: t("View trash"), run: () => go({ view: "library", tab: "archive" }) });
        else toast(errorText(e), true);
      });
    return () => { live = false; };
  }, [game, id, loaded, mod]);
  if (docked) {
    return mod ? <ModDrawer key={mod.id} game={game} mod={mod} mods={mods} docked onClose={() => closeRoute(["modId"])} /> : (
      <aside className="drawer is-docked mod-pane is-empty" aria-label={t("Mod details")}>
        <Icon name="mods" />
        <p className="hint">{t("Click a mod to see its details here: its picture, toggles, conflicts and files. Enter does it from the keyboard")}</p>
      </aside>
    );
  }
  return mod ? <ModDrawer game={game} mod={mod} mods={mods} onClose={() => closeRoute(["modId"])} /> : null;
}

/** Keeps a failing 3D view (three.js didn't load, the model broke it) inside its box, with a way back to the picture. */
class ViewerBoundary extends Component<{ children: () => ReactNode; onClose: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("3D view failed:", error); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children();
    return (
      <div className="mod-viewer-wrap">
        <div className="mod-viewer is-wait" role="alert">
          <span className="mod-viewer-msg">{t("Couldn't show the 3D view. {error}", { error: error.message })}</span>
          <div className="mod-drawer-picact">
            <Button size="sm" className="on-img" icon="refresh" onClick={() => { retryViewer(); this.setState({ error: null }); }} title={t("Open the 3D view again")}>{t("Try again")}</Button>
            <IconButton size="sm" variant="secondary" className="on-img" icon="x" label={t("Close the 3D view")} onClick={this.props.onClose} />
          </div>
        </div>
      </div>
    );
  }
}

const NSFW_OPTIONS: Array<{ value: NsfwMode; label: string; title: string }> = [
  { value: "hide", label: nsfwLabel("hide"), title: nsfwTip("hide") },
  { value: "blur", label: nsfwLabel("blur"), title: nsfwTip("blur") },
  { value: "show", label: nsfwLabel("show"), title: nsfwTip("show") },
];

export function ModDrawer({ game, mod, mods, onClose, docked }: { game: GameId; mod: ModEntry; mods: ModEntry[]; onClose: () => void; docked?: boolean }) {
  const nsfw = useNsfw();
  const health = useModHealth(game).get(mod.id);
  const hold = holdOn(useHolds(game), mod);
  const [name, setName] = useState(mod.name);
  const [character, setChar] = useState(mod.character ?? "");
  const [notes, setNotes] = useState(mod.notes ?? "");
  const [tag, setTag] = useState("");
  const [reveal, setReveal] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  /** The 3D view is open in place of the picture. */
  const [model, setModel] = useState(() => drawerSectionFor(mod.id) === "model");
  const modelFor = useRef(mod.id);
  useEffect(() => {
    if (modelFor.current === mod.id) return;
    modelFor.current = mod.id;
    setModel(drawerSectionFor(mod.id) === "model");
  }, [mod.id]);
  const listId = useId();
  const tagListId = useId();
  const pic = usePreviewSetter(game, mod);
  // follow the mod when it changes elsewhere (a toggle, an undo)
  useEffect(() => { setName(mod.name); }, [mod.name]);
  useEffect(() => { setChar(mod.character ?? ""); }, [mod.character]);
  useEffect(() => { setNotes(mod.notes ?? ""); }, [mod.notes]);
  useEffect(() => { void characterNames(game).then((l) => setNames(l.map((c) => c.name))); }, [game]);
  // a tag on the card (Toggles, Conflict, No ini) opens the drawer at what it names; the conflicts panel loads a
  // moment later, so look for it for a few seconds
  useEffect(() => {
    const sec = drawerSectionFor(mod.id);
    if (!sec) return;
    if (sec === "model") { setModel(true); clearDrawerSection(); return; }
    const sel = { parts: ".mod-parts", keys: "#mod-keys", conflicts: ".mi-conflicts", files: ".mod-drawer-facts", ingame: ".mi-ingame" }[sec];
    let tries = 0;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`.mod-drawer ${sel}`);
      if (el || ++tries >= 16) clearDrawerSection();
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
      else if (tries < 16) timer = window.setTimeout(find, 200);
    };
    let timer = window.setTimeout(find, 250);
    return () => window.clearTimeout(timer);
  }, [mod.id]);

  const saveChar = () => {
    const c = character.trim();
    if (c === (mod.character ?? "")) return;
    void setCharacter(game, [mod], names.find((n) => n.toLowerCase() === c.toLowerCase()) ?? c, true);
  };
  const saveTag = () => {
    const tg = tag.trim();
    setTag("");
    if (tg) void addTag(game, [mod], tg);
  };
  const getPreview = async () => { setFetching(true); await previewFromGb(game, mod); setFetching(false); };

  const parentMod = mod.parent ? mods.find((m) => m.id === mod.parent) : undefined;
  const subs = mods.filter((m) => m.parent === mod.id);
  const blurred = mod.nsfw && nsfw !== "show" && !reveal;
  const broken = health && (health.status === "broken" || health.status === "unfixable");
  const fixerBusy = useFixerBusy();
  return (
    <Drawer className={docked ? "mod-drawer mod-pane" : "mod-drawer"} docked={docked} title={mod.name} onClose={onClose}
      actions={<Toggle checked={mod.enabled} onChange={(v, shift) => void setOn(game, [mod], v, mods, undefined, shift)} label={mod.enabled ? t("On") : t("Off")} ariaLabel={mod.name}
        title={mod.enabled || !mod.character ? undefined : t("Shift+click keeps {name}'s other mods on too", { name: mod.character })} />}
      footer={<>
        <Button variant="danger" icon="trash" onClick={() => { onClose(); void trashMods(game, [mod]); }}
          title={trashDaysPref.get() > 0
            ? tn(trashDaysPref.get(), "The files stay on your PC for {n} day. A short record stays in Mods, Trash so you can download it again", "The files stay on your PC for {n} days. A short record stays in Mods, Trash so you can download it again")
            : t("The files are deleted right away. A short record stays in Mods, Trash so you can download it again")}>{t("Move to trash")}</Button>
        <span className="grow" />
        <Button variant="ghost" onClick={onClose}>{t("Close")}</Button>
      </>}>
      {model && !blurred ? (
        <div className="mod-drawer-hero">
          <ViewerBoundary key={mod.id} onClose={() => setModel(false)}>
            {() => <Suspense fallback={<div className="mod-viewer-wrap"><div className="mod-viewer is-wait"><span className="mod-viewer-msg"><span className="spin" aria-hidden="true" />{t("Opening the 3D view")}</span></div></div>}>
              <ModViewer game={game} modId={mod.id} onClose={() => setModel(false)} saving={pic.busy}
                onSnapshot={(png) => void pic.fromBlob(png, "preview.png")} />
            </Suspense>}
          </ViewerBoundary>
        </div>
      ) : (
      <div ref={pic.heroRef} className={`mod-drawer-hero${pic.over ? " is-drop" : ""}`}
        onDragOver={pic.onDragOver} onDragLeave={() => pic.setOver(false)} onDrop={pic.onDrop}>
        <Preview className="mod-drawer-img" src={mod.preview} blur={blurred} icon="mods" alt={mod.name} />
        <div className="mod-drawer-picact">
          {!blurred && mod.iniCount > 0 && (
            <Button size="sm" className="on-img" icon="box" onClick={() => setModel(true)}
              title={t("Turn the mod's model around, as its toggles are set now")}>{t("View in 3D")}</Button>
          )}
          {!mod.preview && mod.source && (
            <Button size="sm" className="on-img" icon="downloads" busy={fetching} onClick={() => void getPreview()} title={t("Download the first picture from its GameBanana page")}>
              {t("Get preview from GameBanana")}
            </Button>
          )}
          <IconButton size="sm" variant="secondary" className="on-img" icon="edit" disabled={pic.busy} onClick={() => void pic.pick()}
            label={mod.customPreview ? t("Change the preview: pick an image, drop one here or paste one with Ctrl+V") : t("Set the preview: pick an image, drop one here or paste one with Ctrl+V")} />
          {mod.customPreview && (
            <Button size="sm" className="on-img" icon="undo" disabled={pic.busy} onClick={() => void pic.clear()}
              title={t("Go back to the picture the mod came with. Also in the mod's menu")}>{t("Reset preview")}</Button>
          )}
        </div>
        {pic.over && <span className="mod-drawer-drop" aria-hidden="true">{t("Drop to use as the preview")}</span>}
        {blurred && <Button size="sm" className="mod-drawer-reveal on-img" icon="eye" onClick={() => setReveal(true)} title={t("The picture is blurred because the mod is marked for adults")}>{t("Show")}</Button>}
        {mod.updateAvailable && mod.source && (
          <div className="mod-drawer-badges">
            <Button size="sm" variant="primary" icon="update" onClick={() => void getUpdate(game, mod)} title={t("Download the newest version from GameBanana")}>{t("Update")}</Button>
          </div>
        )}
      </div>
      )}

      <p className="mod-drawer-who">
        {mod.character ? <CharLink game={game} name={mod.character} portrait /> : <KindLink mod={mod} />}
        {mod.source?.submitter && t("by {creator}").split("{creator}").map((part, i) => (
          <Fragment key={i}>{i > 0 && <CreatorLink name={mod.source!.submitter!} modId={mod.source!.modId} />}{part.trim() && <span className="hint">{part.trim()}</span>}</Fragment>
        ))}
        {mod.version && <span className="hint"> · v{mod.version.replace(/^v/i, "")}</span>}
      </p>
      {mod.source?.site === "gamebanana" && mod.source.modId > 0 && <GbStats key={mod.source.modId} mod={mod} modId={mod.source.modId} />}

      {mod.parent && (
        <div className="mod-drawer-family">
          <Icon name="link" />
          {parentMod
            ? <span>{tx("Sub-mod of {mod}", { mod: <button type="button" className="link-btn" onClick={() => openDetails(parentMod)} title={t("Open {parent}. {mod} turns off with it and comes back with it", { parent: parentMod.name, mod: mod.name })}>{parentMod.name}</button> })}</span>
            : <span className="hint">{t("The mod it went with isn't installed anymore")}</span>}
          <Button size="sm" variant="ghost" onClick={() => void setParent(game, mod, "", mods)}
            title={t("Make it a separate mod again, so turning it on asks about the character's other mods")}>{t("Unlink")}</Button>
        </div>
      )}
      {subs.length > 0 && (
        <div className="mod-drawer-family">
          <Icon name="link" />
          <span className="hint" title={t("Add-ons that go with this mod. They turn off with it and come back when it is turned on")}>{t("Sub-mods")}</span>
          {subs.map((s) => (
            <span key={s.id} className="mod-drawer-sub">
              <Toggle size="sm" checked={s.enabled} onChange={(v, shift) => void setOn(game, [s], v, mods, undefined, shift)} label={<span className="sr-only">{s.enabled ? t("{mod} is on", { mod: s.name }) : t("{mod} is off", { mod: s.name })}</span>} />
              <button type="button" className="link-btn" onClick={() => openDetails(s)} title={t("Open {mod}", { mod: s.name })}>{s.name}</button>
            </span>
          ))}
        </div>
      )}

      {broken && (
        <div className="note t-warn mod-drawer-health" role="status">
          <Icon name="warn" />
          <div className="mod-drawer-health-t">
            <strong>{health.needsAuthor ? t("A game update broke this mod, and a fixer can't repair it")
              : health.tried ? t("A game update broke this mod, and the fixer didn't repair it")
              : health.status === "broken" || health.tool ? t("A game update broke this mod") : t("A game update broke this mod, and gachamod can't fix it by itself")}</strong>
            {health.reasons.length > 0 && <span>{stops(health.reasons)}</span>}
            {triedNote(health) && <span>{stops([triedNote(health)!], true)}</span>}
            <span className="mod-drawer-health-a">
              {health.status === "broken" && (
                <Button size="sm" variant="primary" icon="wand" onClick={() => void fixForUpdate(game, [mod])}
                  title={t("Rewrites its .ini with the new hashes. A backup is kept and Undo puts it back")}>{fixLabel(health)}</Button>
              )}
              {health.status === "unfixable" && health.tool && (
                <Button size="sm" variant={health.tried || health.needsAuthor ? undefined : "primary"} icon="wand" busy={fixerBusy.has(`mod:${mod.id}`)} onClick={() => void fixForUpdate(game, [mod])}
                  title={sentences([
                    t("Gets {tool} from {site} and runs it on this mod.", { tool: health.tool.name, site: gbToolId(health.tool.url) !== null ? "GameBanana" : "GitHub" }),
                    health.tried && t("It gets the fixer's newest version first."),
                    health.needsAuthor && t("It may not help: the game changed the model, which a fixer can't redo."),
                    t("A backup is kept and Undo puts it back"),
                  ].filter((x): x is string => !!x))}>{fixLabel(health)}</Button>
              )}
              {fixerBusy.has("waiting") && fixerBusy.has(`mod:${mod.id}`) && (
                <Button size="sm" variant="ghost" onClick={stopWaiting}
                  title={t("The fixer is open in a separate window. gachamod carries on by itself a few seconds after the fixer stops changing files. This carries on now, with what it changed so far")}>{t("Stop waiting")}</Button>
              )}
              {(health.tried || health.needsAuthor) && mod.source && (<>
                <Button size="sm" icon="downloads" onClick={() => void getUpdate(game, mod)}
                  title={t("Looks on GameBanana for a newer file of this mod and downloads it")}>{t("Update")}</Button>
                <Button size="sm" variant="ghost" icon="link" onClick={() => openOnGb(mod)}
                  title={t("Open the mod's GameBanana page. The author or the comments often say when a fix is coming")}>{t("Open on GameBanana")}</Button>
              </>)}
              {(health.tried || health.needsAuthor) && !mod.source && (
                <Button size="sm" icon="search" onClick={() => go({ view: "browse", search: mod.name })}
                  title={t("Search GameBanana for a newer version of this mod")}>{t("Search GameBanana")}</Button>
              )}
              <Button size="sm" variant="ghost" icon="tools" onClick={() => go({ view: "tools", section: "fixes" })} title={t("Open the mod fixers in Tools")}>{t("Mod fixers")}</Button>
              <Button size="sm" variant="ghost" icon="bell-off" onClick={() => void holdMods(game, [mod], "update")}
                title={t("Stops this warning until you install a newer version from its author. If that one is still broken, it warns again")}>{t("Wait for an update")}</Button>
              <Button size="sm" variant="ghost" icon="hide" onClick={() => void holdMods(game, [mod], "ignore")}
                title={t("Stops every warning about this mod: the red marks, the Problems filter and Tools. Conflicts with it are ignored too")}>{t("Ignore problems")}</Button>
            </span>
          </div>
        </div>
      )}

      {hold && (
        <div className="note mod-drawer-health" role="status">
          <Icon name={hold.kind === "update" ? "bell-off" : "hide"} />
          <div className="mod-drawer-health-t">
            <strong>{hold.kind === "update" ? t("Waiting for an update from its author") : t("Ignoring this mod's problems")}</strong>
            <span>{hold.kind === "update"
              ? t("The game update warning is hidden until you install a newer version. If that one is still broken, it warns again.")
              : t("No red marks, no Problems filter and nothing in Tools for this mod.")}</span>
            <span className="mod-drawer-health-a">
              {hold.kind === "update" && mod.source && (<>
                <Button size="sm" icon="downloads" onClick={() => void getUpdate(game, mod)}
                  title={t("Looks on GameBanana for a newer file of this mod and downloads it")}>{t("Update")}</Button>
                <Button size="sm" variant="ghost" icon="link" onClick={() => openOnGb(mod)}
                  title={t("Open the mod's GameBanana page. The author or the comments often say when a fix is coming")}>{t("Open on GameBanana")}</Button>
              </>)}
              <Button size="sm" variant="ghost" icon="eye" onClick={() => void releaseMods(game, [mod])}
                title={hold.kind === "update" ? t("Stop waiting and show the warning again now") : t("Warn about its problems again")}>{t("Show problems again")}</Button>
            </span>
          </div>
        </div>
      )}

      {mod.nsfw && (
        <div className="mod-drawer-adult">
          <span className="field-l" title={t("Applies to every mod marked for adults, everywhere in the app")}>{t("Mods for adults")}</span>
          <Segmented size="sm" label={t("Mods for adults")} value={nsfw} onChange={setNsfw} options={NSFW_OPTIONS} />
        </div>
      )}

      <div className="mod-drawer-fields">
        <TextField label={t("Name")} value={name} onChange={setName}
          onBlur={() => { if (name.trim() && name.trim() !== mod.name) void renameMod(game, mod, name); else setName(mod.name); }} />
        <label className="field mod-drawer-char">
          <span className="field-l">{t("Character")}</span>
          <input list={listId} value={character} placeholder={t("Who it is for")} spellCheck={false}
            onChange={(e) => setChar(e.target.value)} onBlur={saveChar}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <datalist id={listId}>{names.map((n) => <option key={n} value={n} />)}</datalist>
        </label>

        <div className="field mod-drawer-tags">
          <span className="field-l">{t("Tags")}</span>
          <span className="mod-drawer-taglist">
            {mod.tags.map((tag) => (
              <span key={tag} className="chip mod-tag">
                <button type="button" className="chip-t" title={t("Show every mod tagged \"{tag}\" in Mods", { tag })}
                  onClick={() => go({ view: "library", search: tag })}>{tag}</button>
                <button type="button" aria-label={t("Remove the tag \"{tag}\"", { tag })} title={t("Remove the tag \"{tag}\"", { tag })}
                  onClick={() => void removeTag(game, [mod], tag)}><Icon name="x" /></button>
              </span>
            ))}
            <input className="mod-drawer-tagin" list={tagListId} value={tag} placeholder={t("Add a tag")} spellCheck={false}
              onChange={(e) => setTag(e.target.value)} onBlur={saveTag}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); saveTag(); } }} />
            <datalist id={tagListId}>
              {libraryTags(mods).filter((k) => !mod.tags.some((x) => x.toLowerCase() === k.toLowerCase())).map((k) => <option key={k} value={k} />)}
            </datalist>
          </span>
        </div>

        <TextField label={t("Notes")} multiline value={notes} onChange={setNotes} placeholder={t("Anything to remember about it")}
          onBlur={() => { if (notes.trim() !== (mod.notes ?? "")) void patchMods(game, [mod], () => ({ notes }), t("Changed the notes of {mod}", { mod: mod.name })); }} />

        <div className="mod-drawer-flags">
          <Toggle checked={mod.favorite} onChange={(v) => void setFavourite(game, [mod], v)} label={t("Favourite")} />
          <span title={t("Marks it for adults, so it's hidden, blurred or shown like every other mod for adults")}><Toggle checked={mod.nsfw} onChange={(v) => void setAdult(game, [mod], v)} label={t("For adults")} /></span>
        </div>
      </div>

      <section id="mod-keys" className="mod-drawer-sec">
        <ModParts game={game} mod={mod} />
        <KeyEditor game={game} modId={mod.id} />
        <InGameOptions game={game} modId={mod.id} />
        <ModInsides mod={mod} />
      </section>

      <div className="mod-drawer-facts">
        {mod.source && (
          <Row label="GameBanana">
            <button type="button" className="link-btn" onClick={() => openOnGb(mod)} title={t("Open its GameBanana page")}>{t("Mod {id}", { id: String(mod.source.modId) })} <Icon name="external" /></button>
          </Row>
        )}
        <Row label={t("Size")}>{t("{size}, {files}, {inis}", { size: formatBytes(mod.sizeBytes), files: tn(mod.fileCount, "{n} file", "{n} files"), inis: tn(mod.iniCount, "{n} ini", "{n} inis") })}</Row>
        {mod.installedAt > 0 && <Row label={t("Added")}>{timeAgo(mod.installedAt)}</Row>}
        <Row label={t("Folder")}>
          <span className="mod-drawer-path mono selectable" title={mod.path}>{mod.relPath}</span>
          <Button size="sm" icon="folder" onClick={() => openFolder(mod)} title={t("Open its folder in File Explorer")}>{t("Open")}</Button>
        </Row>
      </div>
    </Drawer>
  );
}

/** In use this long without a like, the heart beats now and then. */
const NUDGE_AFTER_S = 3 * 24 * 3600;

/** Like, subscribe and thank on its GameBanana page, with the page's counts. Downloads and comments open the page. */
function GbStats({ mod, modId }: { mod: ModEntry; modId: number }) {
  const [page, setPage] = useState<GbMod | null | undefined>(undefined);
  useEffect(() => {
    const ask = new AbortController();
    modPage(modId, ask.signal).then(setPage, (e: unknown) => { if (!isAbort(e)) setPage(null); });
    return () => ask.abort();
  }, [modId]);
  if (page === null) return null;
  if (!page) return <p className="mod-drawer-gb hint"><Spinner /> {t("Asking GameBanana for its likes")}</p>;
  const old = mod.installedAt > 0 && Date.now() / 1000 - mod.installedAt > NUDGE_AFTER_S;
  return (
    <div className="mod-drawer-gb">
      <ModStats mod={page} act nudge={old} onFiles={() => openGbMod(modId)} onComments={() => openGbMod(modId)} />
    </div>
  );
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const extOfPath = (p: string) => p.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
const extOfType = (type: string) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[type] ?? null;
const NOT_AN_IMAGE = t("Use a PNG, JPG, WebP or GIF image");

/** Setting the mod's own preview: pick a file, drop one on the preview (Tauri gives paths, the browser gives
 *  files) or paste one while the drawer is open. */
function usePreviewSetter(game: GameId, mod: ModEntry) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const modRef = useRef(mod);
  modRef.current = mod;

  const show = (e: ModEntry) => previewSaved(game, e);
  /** Set a preview. Undo puts back the user's own one from before, or the picture the mod came with. */
  const run = async (work: () => Promise<ModEntry>) => {
    const m = modRef.current;
    setBusy(true);
    try {
      const own = await ownPreview(game, m);
      show(await work());
      // the new picture shows in place: Ctrl+Z still puts the old one back
      record({
        label: t("New preview for {mod}", { mod: m.name }),
        undo: async () => show(own ? await library.setPreviewData(game, m.id, own.bytes, own.ext) : await library.clearPreview(game, m.id)),
        redo: async () => show(await work()),
      }, true);
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };
  const fromPath = (path: string) => {
    if (!IMAGE_EXTS.includes(extOfPath(path))) { toast(NOT_AN_IMAGE, true); return; }
    const id = modRef.current.id;
    void run(() => library.setPreview(game, id, path));
  };
  const fromBlob = async (blob: Blob, name = "") => {
    const ext = extOfType(blob.type) ?? (IMAGE_EXTS.includes(extOfPath(name)) ? extOfPath(name) : null);
    if (!ext) { toast(NOT_AN_IMAGE, true); return; }
    const id = modRef.current.id;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    void run(() => library.setPreviewData(game, id, bytes, ext));
  };

  const pick = async () => {
    if (inTauri()) {
      const r = await dialogs.pickFiles({ title: t("Pick a preview image"), extensions: IMAGE_EXTS });
      if (r?.[0]) fromPath(r[0]);
      return;
    }
    // the browser demo has no file dialog command: a plain file input does the same
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTS.map((x) => `.${x}`).join(",");
    input.onchange = () => { const f = input.files?.[0]; if (f) void fromBlob(f, f.name); };
    input.click();
  };
  const clear = async () => {
    setBusy(true);
    try { await resetPreview(game, modRef.current); }
    finally { setBusy(false); }
  };

  // paste an image anywhere while the drawer is open (text pastes into a field are left alone)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      const file = Array.from(data?.items ?? []).find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
      if (!file) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, [contenteditable]") && data?.types.includes("text/plain")) return;
      e.preventDefault();
      void fromBlob(file, file.name);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [game]);

  // drops in the app arrive as paths through the window's drop handler
  useEffect(() => addDropTarget({
    el: () => heroRef.current,
    accepts: (paths) => paths.length === 1 && IMAGE_EXTS.includes(extOfPath(paths[0]!)),
    onOver: setOver,
    onDrop: (paths) => fromPath(paths[0]!),
  }), [game]);

  // drops in the browser demo carry the file itself
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setOver(true);
  };
  const onDrop = (e: DragEvent) => {
    const f = e.dataTransfer.files[0];
    setOver(false);
    if (!f) return;
    e.preventDefault();
    void fromBlob(f, f.name);
  };

  return { busy, over, setOver, heroRef, pick, clear, onDragOver, onDrop, fromBlob };
}
