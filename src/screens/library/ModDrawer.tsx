// A mod's details in a drawer: big preview, name (edit in place), character, tags, notes, source, folder, then the
// mod's keys and options from MODTOOLS, then Remove. Owner: LIBRARY area.
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { dialogs, errorText, library, shell, type Character, type GameId, type ModEntry } from "../../lib/api";
import { inTauri } from "../../lib/tauri";
import { Badge, Button, Drawer, IconButton, Row, TextField, Toggle, formatBytes, timeAgo } from "../../ui/kit";
import { addDropTarget } from "../../ui/DropZone";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { ModInsides } from "../modtools/ModInsides";
import { publish } from "./data";
import { Preview, previewChanged, type NsfwMode } from "./Preview";
import type { MetaPatch } from "../../lib/api/library";

export function ModDrawer({ game, mod, chars, nsfw, onClose, onToggle, onRemove, onUpdate }: {
  game: GameId; mod: ModEntry; chars: Character[]; nsfw: NsfwMode;
  onClose: () => void; onToggle: (mod: ModEntry, on: boolean) => void; onRemove: (mod: ModEntry) => void; onUpdate: (mod: ModEntry) => void;
}) {
  const [name, setName] = useState(mod.name);
  const [character, setCharacter] = useState(mod.character ?? "");
  const [notes, setNotes] = useState(mod.notes ?? "");
  const [tag, setTag] = useState("");
  const [reveal, setReveal] = useState(false);
  const listId = useId();
  const pic = usePreviewSetter(game, mod);
  // follow the mod when it changes elsewhere (a toggle, an undo)
  useEffect(() => { setName(mod.name); }, [mod.name]);
  useEffect(() => { setCharacter(mod.character ?? ""); }, [mod.character]);
  useEffect(() => { setNotes(mod.notes ?? ""); }, [mod.notes]);

  const save = async (patch: MetaPatch) => {
    try {
      const e = await library.updateMeta(game, mod.id, patch);
      publish(game, { changed: [e], removed: [], notes: [] });
    } catch (e) { toast(errorText(e), true); }
  };
  const addTag = () => {
    const t = tag.trim();
    setTag("");
    if (t && !mod.tags.some((x) => x.toLowerCase() === t.toLowerCase())) void save({ tags: [...mod.tags, t] });
  };

  const blurred = mod.nsfw && nsfw !== "show" && !reveal;
  return (
    <Drawer className="mod-drawer" title={mod.name} onClose={onClose}
      actions={<Toggle checked={mod.enabled} onChange={(v) => onToggle(mod, v)} label={mod.enabled ? "On" : "Off"} />}
      footer={<>
        <Button variant="danger" icon="trash" onClick={() => onRemove(mod)} title="Moves it to Recently removed, where it stays 14 days">Remove</Button>
        <span className="grow" />
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      <div ref={pic.heroRef} className={`mod-drawer-hero${pic.over ? " is-drop" : ""}`}
        onDragOver={pic.onDragOver} onDragLeave={() => pic.setOver(false)} onDrop={pic.onDrop}>
        <Preview className="mod-drawer-img" src={mod.preview} blur={blurred} icon="mods" alt={mod.name} />
        <div className="mod-drawer-picact">
          <Button size="sm" icon="image" busy={pic.busy} onClick={() => void pic.pick()}
            title="Pick an image for this mod. You can also drop one here or paste one with Ctrl+V">
            {mod.customPreview ? "Change preview" : "Set preview"}
          </Button>
          {mod.customPreview && <IconButton size="sm" variant="secondary" icon="x" label="Remove custom preview" disabled={pic.busy} onClick={() => void pic.clear()} />}
        </div>
        {pic.over && <span className="mod-drawer-drop" aria-hidden="true">Drop to use as the preview</span>}
        {blurred && <Button size="sm" className="mod-drawer-reveal" icon="eye" onClick={() => setReveal(true)}>Show</Button>}
        <div className="mod-drawer-badges">
          {mod.updateAvailable && mod.source && <Button size="sm" variant="primary" icon="update" onClick={() => onUpdate(mod)}>Get the update</Button>}
          {mod.conflicts > 0 && <Badge tone="bad" icon="warn">Conflicts with {mod.conflicts === 1 ? "1 mod" : `${mod.conflicts} mods`}</Badge>}
        </div>
      </div>

      <div className="mod-drawer-fields">
        <TextField label="Name" value={name} onChange={setName}
          onBlur={() => { if (name.trim() !== mod.name) void save({ name }); }} />
        <label className="field mod-drawer-char">
          <span className="field-l">Character</span>
          <input list={listId} value={character} placeholder="Who it is for" spellCheck={false}
            onChange={(e) => setCharacter(e.target.value)}
            onBlur={() => { if (character.trim() !== (mod.character ?? "")) void save({ character }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <datalist id={listId}>{chars.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          <span className="hint">Used for the one-skin-per-character rule. The folder stays where it is.</span>
        </label>

        <div className="field mod-drawer-tags">
          <span className="field-l">Tags</span>
          <span className="mod-drawer-taglist">
            {mod.tags.map((t) => (
              <button key={t} type="button" className="chip mod-tag" title={`Remove the tag "${t}"`}
                onClick={() => void save({ tags: mod.tags.filter((x) => x !== t) })}>
                <span className="chip-t">{t}</span><Icon name="x" />
              </button>
            ))}
            <input className="mod-drawer-tagin" value={tag} placeholder="Add a tag" spellCheck={false}
              onChange={(e) => setTag(e.target.value)} onBlur={addTag}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }} />
          </span>
        </div>

        <TextField label="Notes" multiline value={notes} onChange={setNotes} placeholder="Anything to remember about it"
          onBlur={() => { if (notes.trim() !== (mod.notes ?? "")) void save({ notes }); }} />

        <div className="mod-drawer-flags">
          <Toggle checked={mod.favorite} onChange={(v) => void save({ favorite: v })} label="Favourite" />
          <Toggle checked={mod.nsfw} onChange={(v) => void save({ nsfw: v })} label="NSFW" hint="Blurred or hidden as set in Settings" />
        </div>
      </div>

      <div className="mod-drawer-facts">
        {mod.source && (
          <Row label="GameBanana">
            <button type="button" className="link-btn" onClick={() => void shell.openUrl(mod.source!.url).catch((e) => toast(errorText(e), true))}>
              {mod.source.submitter ? `by ${mod.source.submitter}` : `Mod ${mod.source.modId}`} <Icon name="external" />
            </button>
          </Row>
        )}
        {mod.version && <Row label="Version">{mod.version}</Row>}
        <Row label="Size">{formatBytes(mod.sizeBytes)}, {mod.fileCount === 1 ? "1 file" : `${mod.fileCount} files`}, {mod.iniCount === 1 ? "1 ini" : `${mod.iniCount} inis`}</Row>
        {mod.installedAt > 0 && <Row label="Added">{timeAgo(mod.installedAt)}</Row>}
        <Row label="Folder">
          <span className="mod-drawer-path mono selectable" title={mod.path}>{mod.relPath}</span>
          <Button size="sm" icon="folder" onClick={() => void shell.openPath(mod.path).catch((e) => toast(errorText(e), true))}>Open</Button>
        </Row>
      </div>

      <ModInsides mod={mod} />
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

  const run = async (work: () => Promise<ModEntry>, done: string) => {
    setBusy(true);
    try {
      const e = await work();
      previewChanged(e.preview);
      publish(game, { changed: [e], removed: [], notes: [] });
      toast(done);
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };
  const fromPath = (path: string) => {
    if (!IMAGE_EXTS.includes(extOfPath(path))) { toast(NOT_AN_IMAGE, true); return; }
    void run(() => library.setPreview(game, modRef.current.id, path), "Preview set");
  };
  const fromBlob = (blob: Blob, name = "") => {
    const ext = extOfType(blob.type) ?? (IMAGE_EXTS.includes(extOfPath(name)) ? extOfPath(name) : null);
    if (!ext) { toast(NOT_AN_IMAGE, true); return; }
    void run(async () => library.setPreviewData(game, modRef.current.id, new Uint8Array(await blob.arrayBuffer()), ext), "Preview set");
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
    input.onchange = () => { const f = input.files?.[0]; if (f) fromBlob(f, f.name); };
    input.click();
  };
  const clear = () => run(() => library.clearPreview(game, modRef.current.id), "Removed your preview");

  // paste an image anywhere while the drawer is open (text pastes into a field are left alone)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      const file = Array.from(data?.items ?? []).find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
      if (!file) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable]") && data?.types.includes("text/plain")) return;
      e.preventDefault();
      fromBlob(file, file.name);
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
    fromBlob(f, f.name);
  };

  return { busy, over, setOver, heroRef, pick, clear, onDragOver, onDrop };
}
