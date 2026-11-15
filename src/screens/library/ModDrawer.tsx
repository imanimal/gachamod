// A mod's details in a drawer (the route's modId, so Back closes it): big preview, its character and creator as
// links, a warning with Fix when a game update broke it, a quick switch for how mods for adults show, name,
// character, tags and notes (every edit with Undo), its parts, keys and in-game options, then the files.
// Owner: LIBRARY area.
import { Suspense, lazy, useEffect, useId, useRef, useState, type DragEvent } from "react";
import { dialogs, errorText, library, type GameId, type ModEntry } from "../../lib/api";
import { aiShown, askAi, useAiShow } from "../../lib/ai";
import { useFixerBusy, useModHealth } from "../../lib/fixes";
import { gbToolId } from "../../lib/gamebanana";
import { nsfwLabel, setNsfw, useNsfw, type NsfwMode } from "../../lib/prefs";
import { trashPhrase } from "../settings/automatic";
import { closeRoute, go, useRoute } from "../../lib/store";
import { inTauri } from "../../lib/tauri";
import { Button, Drawer, IconButton, Row, Segmented, TextField, Toggle, formatBytes, timeAgo } from "../../ui/kit";
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
import { KindLink } from "./ModCard";
import { ModParts } from "./ModParts";
import { Preview } from "./Preview";

// three.js is large: the 3D view loads the first time it opens
const ModViewer = lazy(() => import("./ModViewer"));

/** Shows the drawer for the route's modId. `mods` is the game's whole library. */
export function ModDrawerHost({ game, mods, loaded }: { game: GameId; mods: ModEntry[]; loaded: boolean }) {
  const route = useRoute();
  const id = typeof route.modId === "string" ? route.modId : null;
  const mod = id ? mods.find((m) => m.id === id) : undefined;
  useEffect(() => {
    if (!id || !loaded || mod) return;
    let live = true;
    library.get(game, id).then((m) => { if (live) publish(game, { changed: [m], removed: [], notes: [] }); })
      .catch(() => { if (live) { toast("That mod isn't installed anymore"); closeRoute(["modId"]); } });
    return () => { live = false; };
  }, [game, id, loaded, mod]);
  return mod ? <ModDrawer game={game} mod={mod} mods={mods} onClose={() => closeRoute(["modId"])} /> : null;
}

const NSFW_OPTIONS: Array<{ value: NsfwMode; label: string; title: string }> = [
  { value: "hide", label: nsfwLabel("hide"), title: "Mods for adults don't show anywhere" },
  { value: "blur", label: nsfwLabel("blur"), title: "Their pictures are blurred until you click Show" },
  { value: "show", label: nsfwLabel("show"), title: "Pictures show unblurred. Warning: No panic button, sorry" },
];

export function ModDrawer({ game, mod, mods, onClose }: { game: GameId; mod: ModEntry; mods: ModEntry[]; onClose: () => void }) {
  const nsfw = useNsfw();
  const health = useModHealth(game).get(mod.id);
  const aiShow = useAiShow();
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
      else if (tries < 16) t = window.setTimeout(find, 200);
    };
    let t = window.setTimeout(find, 250);
    return () => window.clearTimeout(t);
  }, [mod.id]);

  const saveChar = () => {
    const c = character.trim();
    if (c === (mod.character ?? "")) return;
    void setCharacter(game, [mod], names.find((n) => n.toLowerCase() === c.toLowerCase()) ?? c);
  };
  const saveTag = () => {
    const t = tag.trim();
    setTag("");
    if (t) void addTag(game, [mod], t);
  };
  const getPreview = async () => { setFetching(true); await previewFromGb(game, mod); setFetching(false); };

  const parentMod = mod.parent ? mods.find((m) => m.id === mod.parent) : undefined;
  const subs = mods.filter((m) => m.parent === mod.id);
  const blurred = mod.nsfw && nsfw !== "show" && !reveal;
  const broken = health && (health.status === "broken" || health.status === "unfixable");
  const fixerBusy = useFixerBusy();
  return (
    <Drawer className="mod-drawer" title={mod.name} onClose={onClose}
      actions={<Toggle checked={mod.enabled} onChange={(v) => void setOn(game, [mod], v, mods)} label={mod.enabled ? "On" : "Off"} />}
      footer={<>
        <Button variant="danger" icon="trash" onClick={() => { onClose(); void trashMods(game, [mod]); }}
          title={`Its files ${trashPhrase()}. A short record stays in Mods, Trash so you can download it again`}>Move to trash</Button>
        <span className="grow" />
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      {model && !blurred ? (
        <div className="mod-drawer-hero">
          <Suspense fallback={<div className="mod-viewer-wrap"><div className="mod-viewer is-wait"><span className="mod-viewer-msg"><span className="spin" aria-hidden="true" />Opening the 3D view</span></div></div>}>
            <ModViewer game={game} modId={mod.id} onClose={() => setModel(false)} saving={pic.busy}
              onSnapshot={(png) => void pic.fromBlob(png, "preview.png")} />
          </Suspense>
        </div>
      ) : (
      <div ref={pic.heroRef} className={`mod-drawer-hero${pic.over ? " is-drop" : ""}`}
        onDragOver={pic.onDragOver} onDragLeave={() => pic.setOver(false)} onDrop={pic.onDrop}>
        <Preview className="mod-drawer-img" src={mod.preview} blur={blurred} icon="mods" alt={mod.name} />
        <div className="mod-drawer-picact">
          {!blurred && mod.iniCount > 0 && (
            <Button size="sm" className="on-img" icon="box" onClick={() => setModel(true)}
              title="Turn the mod's model around, as its toggles are set now">View in 3D</Button>
          )}
          {!mod.preview && mod.source && (
            <Button size="sm" className="on-img" icon="downloads" busy={fetching} onClick={() => void getPreview()} title="Download the first picture from its GameBanana page">
              Get preview from GameBanana
            </Button>
          )}
          <IconButton size="sm" variant="secondary" className="on-img" icon="edit" disabled={pic.busy} onClick={() => void pic.pick()}
            label={`${mod.customPreview ? "Change" : "Set"} the preview: pick an image, drop one here or paste one with Ctrl+V`} />
          {mod.customPreview && (
            <Button size="sm" className="on-img" icon="undo" disabled={pic.busy} onClick={() => void pic.clear()}
              title="Go back to the picture the mod came with. Also in the mod's menu">Reset preview</Button>
          )}
        </div>
        {pic.over && <span className="mod-drawer-drop" aria-hidden="true">Drop to use as the preview</span>}
        {blurred && <Button size="sm" className="mod-drawer-reveal on-img" icon="eye" onClick={() => setReveal(true)} title="The picture is blurred because the mod is marked for adults">Show</Button>}
        {mod.updateAvailable && mod.source && (
          <div className="mod-drawer-badges">
            <Button size="sm" variant="primary" icon="update" onClick={() => void getUpdate(game, mod)} title="Download the newest version from GameBanana">Get the update</Button>
          </div>
        )}
      </div>
      )}

      <p className="mod-drawer-who">
        {mod.character ? <CharLink game={game} name={mod.character} portrait /> : <KindLink mod={mod} />}
        {mod.source?.submitter && <> <span className="hint">by</span> <CreatorLink name={mod.source.submitter} modId={mod.source.modId} /></>}
        {mod.version && <span className="hint"> · v{mod.version.replace(/^v/i, "")}</span>}
      </p>

      {mod.parent && (
        <div className="mod-drawer-family">
          <Icon name="link" />
          {parentMod
            ? <span>Sub-mod of <button type="button" className="link-btn" onClick={() => openDetails(parentMod)} title={`Open ${parentMod.name}. ${mod.name} turns off with it and comes back with it`}>{parentMod.name}</button></span>
            : <span className="hint">The mod it went with isn't installed anymore</span>}
          <Button size="sm" variant="ghost" onClick={() => void setParent(game, mod, "", mods)}
            title="Make it a mod of its own again, so turning it on asks about the character's other mods">Unlink</Button>
        </div>
      )}
      {subs.length > 0 && (
        <div className="mod-drawer-family">
          <Icon name="link" />
          <span className="hint" title="Add-ons that go with this mod. They turn off with it and come back when it is turned on">Sub-mods</span>
          {subs.map((s) => (
            <span key={s.id} className="mod-drawer-sub">
              <Toggle size="sm" checked={s.enabled} onChange={(v) => void setOn(game, [s], v, mods)} label={<span className="sr-only">{s.enabled ? `${s.name} is on` : `${s.name} is off`}</span>} />
              <button type="button" className="link-btn" onClick={() => openDetails(s)} title={`Open ${s.name}`}>{s.name}</button>
            </span>
          ))}
        </div>
      )}

      {broken && (
        <div className="note t-warn mod-drawer-health" role="status">
          <Icon name="warn" />
          <div className="mod-drawer-health-t">
            <strong>{health.status === "broken" || health.tool ? "A game update broke this mod" : "A game update broke this mod, and gachamod can't fix it by itself"}</strong>
            {health.reasons.length > 0 && <span>{health.reasons.slice(0, 4).join(". ")}</span>}
            <span className="mod-drawer-health-a">
              {health.status === "broken" && (
                <Button size="sm" variant="primary" icon="wand" onClick={() => void fixForUpdate(game, [mod])}
                  title="Rewrites its .ini with the new hashes. A backup is kept and Undo puts it back">Fix</Button>
              )}
              {health.status === "unfixable" && health.tool && (
                <Button size="sm" variant="primary" icon="wand" busy={fixerBusy.has(`mod:${mod.id}`)} onClick={() => void fixForUpdate(game, [mod])}
                  title={`Gets ${health.tool.name} from ${gbToolId(health.tool.url) !== null ? "GameBanana" : "GitHub"} and runs it on this mod. A backup is kept and Undo puts it back`}>Fix</Button>
              )}
              {health.status === "unfixable" && aiShown("useful", aiShow) && (
                <Button size="sm" icon="ai" onClick={() => askAi({ kind: "fix-mod", game, modIds: [mod.id], detail: health.reasons.join("\n") })}
                  title="Your chatbot looks at what broke and suggests a fix">Ask the AI helper</Button>
              )}
              <Button size="sm" variant="ghost" icon="tools" onClick={() => go({ view: "tools", section: "fixes" })} title="Open the mod fixers in Tools">Mod fixers</Button>
            </span>
          </div>
        </div>
      )}

      {mod.nsfw && (
        <div className="mod-drawer-adult">
          <span className="field-l" title="Applies to every mod marked for adults, everywhere in the app">Mods for adults</span>
          <Segmented size="sm" label="Mods for adults" value={nsfw} onChange={setNsfw} options={NSFW_OPTIONS} />
        </div>
      )}

      <div className="mod-drawer-fields">
        <TextField label="Name" value={name} onChange={setName}
          onBlur={() => { if (name.trim() && name.trim() !== mod.name) void renameMod(game, mod, name); else setName(mod.name); }} />
        <label className="field mod-drawer-char">
          <span className="field-l">Character</span>
          <input list={listId} value={character} placeholder="Who it is for" spellCheck={false}
            onChange={(e) => setChar(e.target.value)} onBlur={saveChar}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <datalist id={listId}>{names.map((n) => <option key={n} value={n} />)}</datalist>
        </label>

        <div className="field mod-drawer-tags">
          <span className="field-l">Tags</span>
          <span className="mod-drawer-taglist">
            {mod.tags.map((t) => (
              <button key={t} type="button" className="chip mod-tag" title={`Remove the tag "${t}"`} onClick={() => void removeTag(game, [mod], t)}>
                <span className="chip-t">{t}</span><Icon name="x" />
              </button>
            ))}
            <input className="mod-drawer-tagin" value={tag} placeholder="Add a tag" spellCheck={false}
              onChange={(e) => setTag(e.target.value)} onBlur={saveTag}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); saveTag(); } }} />
          </span>
        </div>

        <TextField label="Notes" multiline value={notes} onChange={setNotes} placeholder="Anything to remember about it"
          onBlur={() => { if (notes.trim() !== (mod.notes ?? "")) void patchMods(game, [mod], () => ({ notes }), `Changed the notes of ${mod.name}`); }} />

        <div className="mod-drawer-flags">
          <Toggle checked={mod.favorite} onChange={(v) => void setFavourite(game, [mod], v)} label="Favourite" />
          <span title="Hidden, blurred or shown as set for mods for adults (Settings, Mods)"><Toggle checked={mod.nsfw} onChange={(v) => void setAdult(game, [mod], v)} label="For adults" /></span>
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
            <button type="button" className="link-btn" onClick={() => openOnGb(mod)} title="Open its GameBanana page">Mod {mod.source.modId} <Icon name="external" /></button>
          </Row>
        )}
        <Row label="Size">{formatBytes(mod.sizeBytes)}, {mod.fileCount === 1 ? "1 file" : `${mod.fileCount} files`}, {mod.iniCount === 1 ? "1 ini" : `${mod.iniCount} inis`}</Row>
        {mod.installedAt > 0 && <Row label="Added">{timeAgo(mod.installedAt)}</Row>}
        <Row label="Folder">
          <span className="mod-drawer-path mono selectable" title={mod.path}>{mod.relPath}</span>
          <Button size="sm" icon="folder" onClick={() => openFolder(mod)} title="Open its folder in File Explorer">Open</Button>
        </Row>
      </div>
    </Drawer>
  );
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const extOfPath = (p: string) => p.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
const extOfType = (type: string) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[type] ?? null;
const NOT_AN_IMAGE = "Use a PNG, JPG, WebP or GIF image";

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
      record({
        label: `New preview for ${m.name}`,
        undo: async () => show(own ? await library.setPreviewData(game, m.id, own.bytes, own.ext) : await library.clearPreview(game, m.id)),
        redo: async () => show(await work()),
      });
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
      const r = await dialogs.pickFiles({ title: "Pick a preview image", extensions: IMAGE_EXTS });
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
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable]") && data?.types.includes("text/plain")) return;
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
