// Small windows the mod and character menus open from anywhere (a menu is built outside React): rename a mod, set
// the character of some mods, edit their tags, and pick a character's picture. They mount themselves on first use.
// Owner: LIBRARY area.
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { dialogs, errorText, fileUrl, library, type GameId, type ModEntry } from "../../lib/api";
import { inTauri } from "../../lib/tauri";
import { portraitKey, portraitPref, setCustomPortrait } from "../../lib/prefs";
import { Button, Dialog, TextField } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { Portrait } from "../../ui/Portrait";
import { toast } from "../../ui/toast";
import { characterNames } from "../characters/roster";
import { addTag, modsName, removeTag, renameMod, setCharacter } from "./actions";
import { Preview } from "./Preview";

type Ask =
  | { kind: "rename"; game: GameId; mod: ModEntry }
  | { kind: "character"; game: GameId; mods: ModEntry[] }
  | { kind: "tags"; game: GameId; mods: ModEntry[] }
  | { kind: "portrait"; game: GameId; name: string };

let current: Ask | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let mounted = false;

/** Open one of the windows. */
export function askLib(a: Ask) {
  if (!mounted) {
    mounted = true;
    const el = document.createElement("div");
    el.className = "lib-dialogs";
    document.body.appendChild(el);
    createRoot(el).render(<Host />);
  }
  current = a;
  emit();
}
const close = () => { current = null; emit(); };

function Host() {
  const a = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current);
  if (!a) return null;
  if (a.kind === "rename") return <RenameDialog key={a.mod.id} game={a.game} mod={a.mod} />;
  if (a.kind === "character") return <CharacterDialog game={a.game} mods={a.mods} />;
  if (a.kind === "tags") return <TagsDialog game={a.game} ids={a.mods.map((m) => m.id)} first={a.mods} />;
  return <PortraitDialog game={a.game} name={a.name} />;
}

/** Every tag used in the library, once each (the first spelling met), for a tag field's suggestions. */
export function libraryTags(mods: ModEntry[]): string[] {
  const seen = new Map<string, string>();
  for (const m of mods) for (const t of m.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function RenameDialog({ game, mod }: { game: GameId; mod: ModEntry }) {
  const [name, setName] = useState(mod.name);
  const input = useRef<HTMLInputElement>(null);
  // the name starts selected, as in Explorer, so typing replaces it
  useEffect(() => {
    const f = requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
    return () => cancelAnimationFrame(f);
  }, []);
  const save = async () => { await renameMod(game, mod, name); close(); };
  return (
    <Dialog title="Rename" icon="edit" size="sm" onClose={close} footer={<>
      <Button variant="ghost" onClick={close}>Cancel</Button>
      <Button variant="primary" disabled={!name.trim()} onClick={() => void save()}>Rename</Button>
    </>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="field">
          <span className="field-l">Name</span>
          <input ref={input} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          <span className="hint">Only the name shown here changes. The folder stays as it is.</span>
        </label>
      </form>
    </Dialog>
  );
}

function CharacterDialog({ game, mods }: { game: GameId; mods: ModEntry[] }) {
  const listId = useId();
  const firstChar = mods.every((m) => m.character === mods[0]?.character) ? mods[0]?.character ?? "" : "";
  const [name, setName] = useState(firstChar);
  const [names, setNames] = useState<Array<{ name: string; icon: string | null }>>([]);
  useEffect(() => { void characterNames(game).then(setNames); }, [game]);
  const save = async (n: string) => { await setCharacter(game, mods, n); close(); };
  const q = name.trim().toLowerCase();
  const picks = q ? names.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8) : [];
  return (
    <Dialog title={`Character of ${modsName(mods)}`} icon="characters" size="sm" onClose={close} footer={<>
      {firstChar && <Button variant="ghost" onClick={() => void save("")} title="The mods won't belong to any character">Clear</Button>}
      <span className="grow" />
      <Button variant="ghost" onClick={close}>Cancel</Button>
      <Button variant="primary" disabled={!name.trim()} onClick={() => void save(name)}>Set</Button>
    </>}>
      <form className="lib-ask" onSubmit={(e) => { e.preventDefault(); if (q) void save(names.find((c) => c.name.toLowerCase() === q)?.name ?? name); }}>
        <label className="field">
          <span className="field-l">Character</span>
          <input list={listId} value={name} autoFocus spellCheck={false} placeholder="Type a name, like Ellen" onChange={(e) => setName(e.target.value)} />
          <datalist id={listId}>{names.map((c) => <option key={c.name} value={c.name} />)}</datalist>
        </label>
        {picks.length > 0 && (
          <div className="lib-ask-picks">
            {picks.map((c) => (
              <button key={c.name} type="button" className="chip" onClick={() => void save(c.name)}>
                <Portrait game={game} name={c.name} icon={c.icon} size="1.5rem" />
                <span className="chip-t">{c.name}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </Dialog>
  );
}

function TagsDialog({ game, ids, first }: { game: GameId; ids: string[]; first: ModEntry[] }) {
  const [mods, setMods] = useState(first);
  const [tag, setTag] = useState("");
  const listId = useId();
  const [known, setKnown] = useState<string[]>([]);
  useEffect(() => { library.list(game).then((all) => setKnown(libraryTags(all))).catch(() => {}); }, [game]);
  // follow the mods as tags change, so counts stay right
  const refresh = async () => {
    const all = await library.list(game).catch(() => null);
    if (all) { const want = new Set(ids); setMods(all.filter((m) => want.has(m.id))); }
  };
  const counts = new Map<string, { tag: string; n: number }>();
  for (const m of mods) for (const t of m.tags) {
    const k = t.toLowerCase();
    const c = counts.get(k) ?? { tag: t, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  const add = async () => { const t = tag.trim(); setTag(""); if (t && await addTag(game, mods, t)) await refresh(); };
  return (
    <Dialog title={`Tags for ${modsName(mods)}`} icon="tag" size="sm" onClose={close} footer={<Button variant="primary" onClick={close}>Done</Button>}>
      <form className="lib-ask" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label className="field">
          <span className="field-l">Add a tag</span>
          <input list={listId} value={tag} autoFocus spellCheck={false} placeholder="Like outfit or summer" onChange={(e) => setTag(e.target.value)} />
          <datalist id={listId}>{known.filter((t) => !counts.has(t.toLowerCase()) || counts.get(t.toLowerCase())!.n < mods.length).map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        {counts.size > 0 && (
          <div className="lib-ask-picks">
            {[...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)).map((c) => (
              <button key={c.tag} type="button" className="chip" title={`Remove "${c.tag}"${mods.length > 1 ? ` from the ${c.n === 1 ? "mod that has it" : `${c.n} mods that have it`}` : ""}`}
                onClick={() => void removeTag(game, mods, c.tag).then((ok) => { if (ok) void refresh(); })}>
                <span className="chip-t">{c.tag}</span>
                {mods.length > 1 && <span className="chip-n">{c.n}</span>}
                <Icon name="x" />
              </button>
            ))}
          </div>
        )}
      </form>
    </Dialog>
  );
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];

/** A file the browser read, shrunk to 320 px so it fits in the settings. */
function shrink(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 320 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/webp", 0.88));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't an image")); };
    img.src = url;
  });
}

function PortraitDialog({ game, name }: { game: GameId; name: string }) {
  const custom = portraitPref.use()[portraitKey(game, name)];
  const [url, setUrl] = useState("");
  const [previews, setPreviews] = useState<ModEntry[]>([]);
  useEffect(() => {
    void library.list(game).then((l) => setPreviews(l.filter((m) => m.preview && !m.nsfw && m.character?.toLowerCase() === name.toLowerCase()).slice(0, 8))).catch(() => {});
  }, [game, name]);
  const use = (src: string | null) => { setCustomPortrait(game, name, src); close(); };
  const pick = async () => {
    if (inTauri()) {
      const r = await dialogs.pickFiles({ title: `A picture for ${name}`, extensions: IMAGE_EXTS });
      const src = r?.[0] ? fileUrl(r[0]) : undefined;
      if (src) use(src);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTS.map((x) => `.${x}`).join(",");
    input.onchange = () => { const f = input.files?.[0]; if (f) shrink(f).then(use).catch((e) => toast(errorText(e), true)); };
    input.click();
  };
  const okUrl = /^https?:\/\/\S+$/i.test(url.trim());
  return (
    <Dialog title={`Picture for ${name}`} icon="image" size="sm" onClose={close} footer={<>
      {custom && <Button variant="ghost" onClick={() => use(null)} title="Use the usual portrait again">Back to the default</Button>}
      <span className="grow" />
      <Button onClick={close} variant="ghost">Cancel</Button>
      <Button icon="folder" onClick={() => void pick()} title="Use a picture from this PC">Pick a file</Button>
    </>}>
      <form className="lib-ask" onSubmit={(e) => { e.preventDefault(); if (okUrl) use(url.trim()); }}>
        <div className="lib-ask-now"><Portrait game={game} name={name} size="4.5rem" ring /></div>
        <div className="lib-ask-url">
          <TextField label="Image link" value={url} onChange={setUrl} placeholder="https://..." />
          <Button type="submit" disabled={!okUrl}>Use</Button>
        </div>
        {previews.length > 0 && <>
          <span className="field-l">Or one of {name}'s mod previews</span>
          <div className="lib-ask-previews">
            {previews.map((m) => (
              <button key={m.id} type="button" className="lib-ask-prev" title={m.name} onClick={() => use(fileUrl(m.preview) ?? m.preview!)}>
                <Preview src={m.preview} thumb={m.thumb} alt={m.name} />
              </button>
            ))}
          </div>
        </>}
      </form>
    </Dialog>
  );
}
