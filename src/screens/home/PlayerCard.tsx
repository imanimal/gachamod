// The player card at the top of the sidebar: banner strip, avatar, name, title line and a UID tag, all from the
// setting "player" (JSON). Click opens the edit dialog. Owner: SYSTEM area.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button, Dialog, Tabs, TextField, Skeleton } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { saved } from "../../ui/motion";
import { dialogs, errorText, fileUrl, settings, type GameId } from "../../lib/api";
import { characterList, type GbCategoryRef } from "../../lib/gamebanana";
import { useGame, useGames, useShownGames } from "../../lib/store";
import "./home.css";

export interface Player {
  name: string;
  title: string;
  uid: string;
  /** An image URL, a local path, or "char:<game>:<character name>". */
  avatar: string | null;
  /** An image URL or local path. */
  banner: string | null;
  /** A game id whose colour the card uses; null for the current game's. */
  color: string | null;
}

const EMPTY: Player = { name: "", title: "", uid: "", avatar: null, banner: null, color: null };
const KEY = "player";
const EVENT = "gm-player";

function parse(v: string | null): Player {
  if (!v) return EMPTY;
  try { return { ...EMPTY, ...(JSON.parse(v) as Partial<Player>) }; } catch { return EMPTY; }
}

/** The saved player card, kept in step across every place that shows it. */
export function usePlayer(): Player {
  const [p, setP] = useState<Player>(EMPTY);
  useEffect(() => {
    let live = true;
    settings.get(KEY).then((v) => { if (live) setP(parse(v)); }).catch(() => {});
    const h = (e: Event) => setP((e as CustomEvent<Player>).detail);
    window.addEventListener(EVENT, h);
    return () => { live = false; window.removeEventListener(EVENT, h); };
  }, []);
  return p;
}

async function savePlayer(p: Player) {
  await settings.setJson(KEY, p);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: p }));
}

// portraits by game, loaded once per session
const portraits = new Map<GameId, Promise<GbCategoryRef[]>>();
function portraitsFor(game: GameId): Promise<GbCategoryRef[]> {
  let p = portraits.get(game);
  if (!p) { p = characterList(game).catch(() => []); portraits.set(game, p); }
  return p;
}

/** An avatar value as an image URL (resolving "char:<game>:<name>" through GameBanana's portraits). */
export function useAvatarUrl(avatar: string | null): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => (avatar && !avatar.startsWith("char:") ? fileUrl(avatar) : undefined));
  useEffect(() => {
    if (!avatar) { setUrl(undefined); return; }
    if (!avatar.startsWith("char:")) { setUrl(fileUrl(avatar)); return; }
    const [, game, ...rest] = avatar.split(":");
    const name = rest.join(":");
    let live = true;
    portraitsFor(game ?? "").then((list) => { if (live) setUrl(list.find((c) => c.name === name)?.icon ?? undefined); }).catch(() => {});
    return () => { live = false; };
  }, [avatar]);
  return url;
}

function Portrait({ src, name, size, accent }: { src?: string; name: string; size: number; accent: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return (
    <span className="player-av" style={{ width: `${size / 16}rem`, height: `${size / 16}rem`, "--g-accent": accent } as CSSProperties} title={name}>
      {src && !broken
        ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
        : <Icon name="user" className="player-av-ph" />}
    </span>
  );
}

export function PlayerCard() {
  const p = usePlayer();
  const game = useGame();
  const all = useGames();
  const [edit, setEdit] = useState(false);
  const avatar = useAvatarUrl(p.avatar);
  const banner = fileUrl(p.banner);
  const [bannerOk, setBannerOk] = useState(true);
  useEffect(() => setBannerOk(true), [banner]);
  const accent = all.find((g) => g.id === p.color)?.accent ?? game?.accent ?? "var(--accent)";
  const name = p.name.trim() || "Proxy";

  return (
    <>
      <button type="button" className="player-card" style={{ "--g-accent": accent } as CSSProperties} onClick={() => setEdit(true)} title="Edit your player card">
        <span className="player-banner" aria-hidden="true">
          {banner && bannerOk && <img src={banner} alt="" loading="lazy" decoding="async" onError={() => setBannerOk(false)} />}
        </span>
        <Portrait src={avatar} name={name} size={44} accent={accent} />
        <span className="player-text">
          <span className="player-name">{name}</span>
          <span className="player-title">{p.title.trim() || (game ? `${game.short} player` : "Player")}</span>
        </span>
        {p.uid.trim() && <span className="player-uid">UID {p.uid.trim()}</span>}
      </button>
      {edit && <PlayerEditor initial={p} onClose={() => setEdit(false)} />}
    </>
  );
}

type PickTab = GameId | "file" | "url";

function PlayerEditor({ initial, onClose }: { initial: Player; onClose: () => void }) {
  const shown = useShownGames();
  const all = useGames();
  const current = useGame();
  const [p, setP] = useState<Player>(initial);
  const [tab, setTab] = useState<PickTab>(current?.id ?? shown[0]?.id ?? "url");
  const [busy, setBusy] = useState(false);
  const preview = useAvatarUrl(p.avatar);
  const set = (patch: Partial<Player>) => setP((x) => ({ ...x, ...patch }));
  const accent = all.find((g) => g.id === p.color)?.accent ?? current?.accent ?? "var(--accent)";
  const ack = useRef<HTMLSpanElement>(null);

  const pickFile = async (field: "avatar" | "banner") => {
    try {
      const r = await dialogs.pickFiles({ title: field === "avatar" ? "Pick a picture" : "Pick a banner image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] });
      if (r?.[0]) set({ [field]: r[0] } as Partial<Player>);
      else if (r === null && !("__TAURI_INTERNALS__" in window)) toast("Picking files works in the app. Paste a URL here instead");
    } catch (e) { toast(errorText(e), true); }
  };

  const save = async () => {
    setBusy(true);
    try { await savePlayer({ ...p, name: p.name.trim(), title: p.title.trim(), uid: p.uid.trim() }); saved(ack.current); onClose(); }
    catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };

  const tabs = [
    ...shown.filter((g) => g.gbCharacterCategory).map((g) => ({ value: g.id as PickTab, label: g.short })),
    { value: "file" as PickTab, label: "Image file", icon: "image" as const },
    { value: "url" as PickTab, label: "URL", icon: "link" as const },
  ];

  return (
    <Dialog title="Player card" icon="user" onClose={onClose} size="lg" className="player-edit" footer={<>
      <Button variant="ghost" onClick={() => setP(EMPTY)} title="Back to the defaults">Reset</Button>
      <span className="grow" />
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <span ref={ack}><Button variant="primary" busy={busy} onClick={() => void save()}>Save</Button></span>
    </>}>
      <div className="player-edit-top">
        <div className="player-edit-preview" style={{ "--g-accent": accent } as CSSProperties}>
          <Portrait src={preview} name={p.name || "Proxy"} size={88} accent={accent} />
        </div>
        <div className="player-edit-fields">
          <TextField label="Name" value={p.name} placeholder="Proxy" onChange={(v) => set({ name: v })} autoFocus />
          <TextField label="Title" value={p.title} placeholder="Trailblazer, Traveler, Rover ..." onChange={(v) => set({ title: v })} />
          <TextField label="UID" value={p.uid} placeholder="Optional, shown as a tag" onChange={(v) => set({ uid: v })} />
        </div>
      </div>

      <h3 className="sub-h">Picture</h3>
      <Tabs value={tab} tabs={tabs} onChange={setTab} />
      <div className="player-pick">
        {tab === "file" && (
          <div className="row">
            <Button icon="image" onClick={() => void pickFile("avatar")}>Choose an image</Button>
            {p.avatar && !p.avatar.startsWith("char:") && !/^https?:/.test(p.avatar) && <span className="hint mono">{p.avatar}</span>}
          </div>
        )}
        {tab === "url" && (
          <TextField label="Image URL" value={p.avatar && /^https?:/.test(p.avatar) ? p.avatar : ""} placeholder="https://images.gamebanana.com/..."
            onChange={(v) => set({ avatar: v.trim() || null })} />
        )}
        {tab !== "file" && tab !== "url" && <PortraitGrid game={tab} value={p.avatar} onPick={(v) => set({ avatar: v })} />}
      </div>

      <h3 className="sub-h">Banner and colour</h3>
      <div className="player-edit-banner">
        <TextField label="Banner image URL" value={p.banner && /^https?:/.test(p.banner) ? p.banner : ""} placeholder="Any wide image"
          onChange={(v) => set({ banner: v.trim() || null })} hint={p.banner && !/^https?:/.test(p.banner) ? p.banner : undefined} />
        <div className="row">
          <Button icon="image" onClick={() => void pickFile("banner")}>Image file</Button>
          {p.banner && <Button variant="ghost" onClick={() => set({ banner: null })}>No banner</Button>}
        </div>
      </div>
      <div className="player-swatches" role="radiogroup" aria-label="Card colour">
        <button type="button" role="radio" aria-checked={p.color === null} className={`player-swatch auto${p.color === null ? " on" : ""}`}
          title="The current game's colour" onClick={() => set({ color: null })}><Icon name="refresh" /></button>
        {all.map((g) => (
          <button key={g.id} type="button" role="radio" aria-checked={p.color === g.id} className={`player-swatch${p.color === g.id ? " on" : ""}`}
            style={{ "--g-accent": g.accent } as CSSProperties} title={`${g.name}'s colour`} onClick={() => set({ color: g.id })} />
        ))}
      </div>
    </Dialog>
  );
}

function PortraitGrid({ game, value, onPick }: { game: GameId; value: string | null; onPick: (v: string) => void }) {
  const [list, setList] = useState<GbCategoryRef[] | null>(null);
  useEffect(() => {
    let live = true;
    setList(null);
    portraitsFor(game).then((l) => { if (live) setList(l); }).catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [game]);
  if (list === null) return <div className="portrait-grid">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="portrait-skel" round />)}</div>;
  if (!list.length) return <p className="hint">No portraits for this game yet. They come from GameBanana when it answers.</p>;
  return (
    <div className="portrait-grid">
      {list.filter((c) => c.icon).map((c) => {
        const v = `char:${game}:${c.name}`;
        return (
          <button key={c.id} type="button" className={`portrait${value === v ? " on" : ""}`} title={c.name} aria-pressed={value === v} onClick={() => onPick(v)}>
            <img src={c.icon ?? undefined} alt="" loading="lazy" decoding="async" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
          </button>
        );
      })}
    </div>
  );
}
