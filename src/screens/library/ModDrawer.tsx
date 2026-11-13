// A mod's details in a drawer: big preview, name (edit in place), character, tags, notes, source, folder, then the
// mod's keys and options from MODTOOLS, then Remove. Owner: LIBRARY area.
import { useEffect, useId, useState } from "react";
import { errorText, library, shell, type Character, type GameId, type ModEntry } from "../../lib/api";
import { Badge, Button, Drawer, Row, TextField, Toggle, formatBytes, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { ModInsides } from "../modtools/ModInsides";
import { publish } from "./data";
import { Preview, type NsfwMode } from "./Preview";
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
      <div className="mod-drawer-hero">
        <Preview className="mod-drawer-img" src={mod.preview} blur={blurred} icon="mods" alt={mod.name} />
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
