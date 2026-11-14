// The player card at the top of the sidebar: banner strip, avatar, name, title line and a UID, all from the setting
// "player" (JSON). Each part changes right where it is and is kept at once, with Undo, so there is no Save step:
// click the name or the line under it to type, the picture for a portrait picker, the rest of the card for the
// banner, colour and UID. F2 renames; right-click (R3 on a controller) lists all of it. Owner: SYSTEM area.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Button, Tabs, Skeleton } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { Popover } from "../../ui/Popover";
import { menuHandler, type MenuEntry } from "../../ui/ContextMenu";
import { toast } from "../../ui/toast";
import { dialogs, errorText, fileUrl, type GameId } from "../../lib/api";
import { characterList, type GbCategoryRef } from "../../lib/gamebanana";
import { entries, record, type Entry } from "../../lib/history";
import { cachedPortrait, portraitNow, usePortrait, usePortraitBatch, usePortraitsVersion } from "../../lib/portraits";
import { pref } from "../../lib/prefs";
import { useGame, useGames, useDailyGames } from "../../lib/store";
import { LiveField } from "./LiveField";
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
const player = pref<Player>("player", EMPTY, (raw) => ({ ...EMPTY, ...(JSON.parse(raw) as Partial<Player>) }), (v) => JSON.stringify(v));

/** The saved player card, kept in step across every place that shows it. */
export const usePlayer = (): Player => player.use();

// ── keeping changes ──

let lastStep: { key: string; at: number; entry: Entry; retarget: (v: Partial<Player>) => void } | null = null;
const put = (x: Partial<Player>) => player.set({ ...player.get(), ...x });

/** Keep a change now, with Undo. Changes to one part (`key`) a few seconds apart, with nothing else in between, are
 *  one step: clicking through ten portraits undoes back to the first picture in one go. */
async function change(patch: Partial<Player>, label: string, key: string) {
  const now = player.get();
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  for (const k of Object.keys(patch) as Array<keyof Player>) {
    if (patch[k] === now[k]) continue;
    before[k] = now[k];
    after[k] = patch[k];
  }
  if (!Object.keys(after).length) return;
  try { await put(after); } catch (e) { toast(errorText(e), true); return; }
  const t = Date.now();
  const last = lastStep;
  if (last && last.key === key && t - last.at < 15000 && last.entry.state === "done" && entries()[0]?.id === last.entry.id) {
    last.retarget(after);
    last.at = t;
    return;
  }
  let target = after;
  const entry = record({ label, undo: () => put(before), redo: () => put(target) });
  lastStep = { key, at: t, entry, retarget: (v) => { target = v; } };
}

const isUrl = (v: string | null | undefined) => !!v && /^https?:/i.test(v);
const PICTURE_TYPES = ["png", "jpg", "jpeg", "webp", "gif"];

/** A picture from the PC: its path in the app, or its data in the browser demo (which can't see paths). Null when
 *  cancelled. */
async function pickPicture(title: string): Promise<string | null> {
  if ("__TAURI_INTERNALS__" in window) return (await dialogs.pickFiles({ title, extensions: PICTURE_TYPES }))?.[0] ?? null;
  return new Promise((done) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = PICTURE_TYPES.map((x) => `.${x}`).join(",");
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) { done(null); return; }
      const r = new FileReader();
      r.onload = () => done(typeof r.result === "string" ? r.result : null);
      r.onerror = () => done(null);
      r.readAsDataURL(f);
    };
    input.click();
  });
}
const pictureName = (v: string) => (v.startsWith("data:") ? "Picked picture" : v.split(/[\\/]/).pop() ?? v);

/** Focus moves to the first thing in a picker when it opens, for the keyboard and a controller. */
function useFocusIn(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const t = window.setTimeout(() => ref.current?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(t);
  }, [ref]);
}

// portraits by game, loaded once per session
const portraits = new Map<GameId, Promise<GbCategoryRef[]>>();
function portraitsFor(game: GameId): Promise<GbCategoryRef[]> {
  let p = portraits.get(game);
  if (!p) { p = characterList(game).catch(() => []); portraits.set(game, p); }
  return p;
}

export interface Avatar {
  src?: string;
  /** a tall wiki picture: show its top part (the face) */
  crop: boolean;
  /** GameBanana's small icon, for when the sharp picture fails to load */
  fallback?: string;
}

const CROP: CSSProperties = { objectPosition: "50% 8%" };

/** An avatar value as a picture. "char:<game>:<name>" gets the sharp wiki portrait (lib/portraits.ts), with
 *  GameBanana's 40 px icon until it arrives. */
export function useAvatar(avatar: string | null): Avatar {
  const char = avatar?.startsWith("char:") ? avatar.split(":") : null;
  const game = char?.[1] as GameId | undefined;
  const name = char ? char.slice(2).join(":") : undefined;
  const [icon, setIcon] = useState<{ key: string; src?: string }>();
  useEffect(() => {
    if (!game || !name) return;
    let live = true;
    portraitsFor(game).then((list) => { if (live) setIcon({ key: `${game}:${name}`, src: list.find((c) => c.name === name)?.icon ?? undefined }); }).catch(() => {});
    return () => { live = false; };
  }, [game, name]);
  const fallback = icon?.key === `${game}:${name}` ? icon?.src : undefined;
  const sharp = usePortrait(game, name, fallback);
  if (!avatar) return { crop: false };
  if (!char) return { src: fileUrl(avatar), crop: false };
  return { src: sharp.src ?? undefined, crop: sharp.crop, fallback };
}

function Portrait({ av, size, accent }: { av: Avatar; size: number; accent: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => setBroken(null), [av.src]);
  const src = av.src && broken !== av.src ? av.src : av.fallback && broken !== av.fallback ? av.fallback : undefined;
  return (
    <span className="player-av" style={{ width: `${size / 16}rem`, height: `${size / 16}rem`, "--g-accent": accent } as CSSProperties}>
      {src
        ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(src)} style={av.crop && src === av.src ? CROP : undefined} />
        : <Icon name="user" className="player-av-ph" />}
    </span>
  );
}

type Line = "name" | "title";
type Open = "picture" | "card";

export function PlayerCard() {
  const p = usePlayer();
  const game = useGame();
  const all = useGames();
  const [editing, setEditing] = useState<Line | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const bgRef = useRef<HTMLButtonElement>(null);
  const avRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const avatar = useAvatar(p.avatar);
  const banner = fileUrl(p.banner);
  const [bannerOk, setBannerOk] = useState(true);
  useEffect(() => setBannerOk(true), [banner]);
  const accent = all.find((g) => g.id === p.color)?.accent ?? game?.accent ?? "var(--accent)";
  const name = p.name.trim() || "Proxy";
  const usualTitle = game ? `${game.short} player` : "Player";
  const uid = p.uid.trim();
  const isDefault = !p.name.trim() && !p.title.trim() && !uid && !p.avatar && !p.banner && !p.color;

  const edit = (line: Line) => { setOpen(null); setEditing(line); };
  const show = (what: Open, toggle = false) => { setEditing(null); setOpen((o) => (toggle && o === what ? null : what)); };
  const endEdit = (line: Line, how: "key" | "blur") => {
    setEditing(null);
    // after Enter or Esc the keyboard or pad carries on from the same line
    if (how === "key") window.setTimeout(() => (line === "name" ? nameRef : titleRef).current?.focus({ preventScroll: true }), 0);
  };
  // closing a picker from inside it (Esc, B) puts focus back on what opened it
  const closeTo = (back: RefObject<HTMLElement | null>) => () => {
    const inside = !!document.activeElement?.closest(".popover");
    setOpen(null);
    if (inside) back.current?.focus({ preventScroll: true });
  };
  const reset = () => void change(EMPTY, "Reset your player card", "reset");

  const menu = (): MenuEntry[] => [
    { header: "Player card" },
    { label: "Rename", icon: "edit", keys: "F2", onClick: () => edit("name") },
    { label: "Change title", icon: "tag", title: `The line under your name. Left empty it says "${usualTitle}"`, onClick: () => edit("title") },
    { label: "Change picture", icon: "user", onClick: () => show("picture") },
    { label: "Banner, colour and UID", icon: "image", onClick: () => show("card") },
    "-",
    { label: "Reset card", icon: "refresh", title: "Back to the default name, picture and colour. Ctrl+Z undoes it", disabled: isDefault, onClick: reset },
  ];

  return (
    <>
      <div className="player-card" style={{ "--g-accent": accent } as CSSProperties} onContextMenu={menuHandler(menu)}
        onKeyDown={(e) => { if (e.key === "F2" && !editing) { e.preventDefault(); edit("name"); } }}>
        <span className="player-banner" aria-hidden="true">
          {banner && bannerOk && <img src={banner} alt="" loading="lazy" decoding="async" onError={() => setBannerOk(false)} />}
        </span>
        <button ref={bgRef} type="button" className={`player-bg${open === "card" ? " on" : ""}`} onClick={() => show("card", true)}
          aria-haspopup="dialog" aria-expanded={open === "card"} aria-label="Banner, colour and UID"
          title="Change the banner, colour and UID. Right-click for everything on the card" />
        <button ref={avRef} type="button" className={`player-av-btn${open === "picture" ? " on" : ""}`} onClick={() => show("picture", true)}
          aria-haspopup="dialog" aria-expanded={open === "picture"} aria-label="Change your picture" title="Change your picture">
          <Portrait av={avatar} size={44} accent={accent} />
        </button>
        <span className="player-text">
          {editing === "name"
            ? <LiveField value={p.name} placeholder="Proxy" ariaLabel="Your name" maxLength={40} autoFocus className="player-in player-name"
                onCommit={(v) => {
                  const n = v.trim();
                  // an empty name keeps the old one
                  if (!n) return p.name;
                  void change({ name: n }, `Changed your name to ${n}`, "name");
                  return n;
                }}
                onEnd={(how) => endEdit("name", how)} />
            : <button ref={nameRef} type="button" className="player-name" onClick={() => edit("name")}
                title={`${uid ? `UID ${uid}. ` : ""}Click to rename (F2)`}>{name}</button>}
          {editing === "title"
            ? <LiveField value={p.title} placeholder={usualTitle} ariaLabel="The line under your name" maxLength={60} autoFocus className="player-in player-title"
                onCommit={(v) => {
                  const t = v.trim();
                  void change({ title: t }, t ? `Changed your title to ${t}` : "Cleared your title", "title");
                  return t;
                }}
                onEnd={(how) => endEdit("title", how)} />
            : <button ref={titleRef} type="button" className="player-title" onClick={() => edit("title")}
                title="Click to change the line under your name, like Trailblazer or Traveler">{p.title.trim() || usualTitle}</button>}
        </span>
        {uid && <span className="player-uid">UID {uid}</span>}
      </div>

      {open === "picture" && (
        <Popover anchor={avRef.current} onClose={closeTo(avRef)} width="26rem" label="Your picture" align="start">
          <PicturePicker value={p.avatar} onPick={(v) => void change({ avatar: v }, v ? "Changed your picture" : "Removed your picture", "avatar")} />
        </Popover>
      )}
      {open === "card" && (
        <Popover anchor={bgRef.current} onClose={closeTo(bgRef)} width="22rem" label="Banner, colour and UID" align="start">
          <CardPicker p={p} canReset={!isDefault} onReset={reset} />
        </Popover>
      )}
    </>
  );
}

/** Portraits by game on top; an image file, a link or no picture below. */
function PicturePicker({ value, onPick }: { value: string | null; onPick: (v: string | null) => void }) {
  const shown = useDailyGames();
  const current = useGame();
  const games = shown.filter((g) => g.gbCharacterCategory);
  const [tab, setTab] = useState<GameId | null>(() => {
    const has = (id: string | undefined): id is GameId => !!id && games.some((g) => g.id === id);
    const charGame = value?.startsWith("char:") ? value.split(":")[1] : undefined;
    if (has(charGame)) return charGame;
    return has(current?.id) ? current!.id : games[0]?.id ?? null;
  });
  const box = useRef<HTMLDivElement>(null);
  useFocusIn(box);
  const local = value && !value.startsWith("char:") && !isUrl(value) ? value : null;
  const pick = async () => {
    try { const v = await pickPicture("Pick a picture"); if (v) onPick(v); } catch (e) { toast(errorText(e), true); }
  };

  return (
    <div className="player-pop" ref={box}>
      {tab && (
        <>
          {games.length > 1 && <Tabs value={tab} tabs={games.map((g) => ({ value: g.id, label: g.short }))} onChange={setTab} />}
          <PortraitGrid game={tab} value={value} onPick={onPick} />
        </>
      )}
      <div className="player-pop-file">
        <Button icon="image" onClick={() => void pick()} title="A picture from this PC. PNG, JPG, WebP or GIF; a square one fits best">
          {local ? "Another image" : "Image file"}
        </Button>
        {value && <Button variant="ghost" icon="x" onClick={() => onPick(null)} title="Show the plain person icon instead">No picture</Button>}
        {local && <span className="hint">{pictureName(local)}</span>}
      </div>
      <LiveField value={isUrl(value) ? value! : ""} ariaLabel="Picture link" placeholder="Or paste a link to a picture"
        onCommit={(v) => { const u = v.trim(); onPick(u || null); return u; }} />
    </div>
  );
}

function CardPicker({ p, canReset, onReset }: { p: Player; canReset: boolean; onReset: () => void }) {
  const all = useGames();
  const box = useRef<HTMLDivElement>(null);
  useFocusIn(box);
  const local = p.banner && !isUrl(p.banner) ? p.banner : null;
  const setBanner = (v: string | null) => void change({ banner: v }, v ? "Changed your banner" : "Removed your banner", "banner");
  const pick = async () => {
    try { const v = await pickPicture("Pick a banner image"); if (v) setBanner(v); } catch (e) { toast(errorText(e), true); }
  };

  return (
    <div className="player-pop" ref={box}>
      <span className="field-l">Banner</span>
      <div className="player-pop-file">
        <Button icon="image" onClick={() => void pick()} title="Use a picture from this PC">{local ? "Pick another image" : "Image file"}</Button>
        {p.banner && <Button variant="ghost" icon="x" onClick={() => setBanner(null)} title="Just the card colour">No banner</Button>}
      </div>
      {local && <span className="hint">{pictureName(local)}</span>}
      <LiveField value={isUrl(p.banner) ? p.banner! : ""} ariaLabel="Banner image link" placeholder="Or paste a link to a wide image"
        onCommit={(v) => { const u = v.trim(); setBanner(u || null); return u; }} />

      <span className="field-l">Colour</span>
      <div className="player-swatches" role="radiogroup" aria-label="Card colour">
        <button type="button" role="radio" aria-checked={p.color === null} className={`player-swatch auto${p.color === null ? " on" : ""}`}
          title="The current game's colour" onClick={() => void change({ color: null }, "Changed your card colour", "color")}><Icon name="refresh" /></button>
        {all.map((g) => (
          <button key={g.id} type="button" role="radio" aria-checked={p.color === g.id} className={`player-swatch${p.color === g.id ? " on" : ""}`}
            style={{ "--g-accent": g.accent } as CSSProperties} title={`${g.name}'s colour`} aria-label={`${g.name}'s colour`}
            onClick={() => void change({ color: g.id }, "Changed your card colour", "color")} />
        ))}
      </div>

      <LiveField label="UID" value={p.uid} placeholder="Optional" maxLength={20} hint="Shows when you point at your name"
        onCommit={(v) => {
          const u = v.trim();
          void change({ uid: u }, u ? `Changed your UID to ${u}` : "Cleared your UID", "uid");
          return u;
        }} />

      <div className="player-pop-foot">
        <Button size="sm" variant="ghost" icon="refresh" disabled={!canReset} onClick={onReset}
          title="Back to the default name, picture and colour. Ctrl+Z undoes it">Reset card</Button>
      </div>
    </div>
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
  // sharp wiki portraits for the whole roster in one go; GameBanana's icon shows until each arrives
  usePortraitsVersion();
  usePortraitBatch(game, useMemo(() => (list ?? []).map((c) => c.name), [list]));
  if (list === null) return <div className="portrait-grid">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="portrait-skel" round />)}</div>;
  if (!list.length) return <p className="hint">No portraits for this game yet. They come from GameBanana when it answers.</p>;
  return (
    <div className="portrait-grid">
      {list.filter((c) => c.icon).map((c) => {
        const v = `char:${game}:${c.name}`;
        const src = portraitNow(game, c.name, c.icon) ?? undefined;
        const hit = cachedPortrait(game, c.name);
        const crop = !!hit?.crop && hit.src === src;
        return (
          <button key={c.id} type="button" className={`portrait${value === v ? " on" : ""}`} title={c.name} aria-pressed={value === v} onClick={() => onPick(v)}>
            <img src={src} alt="" loading="lazy" decoding="async" style={crop ? CROP : undefined}
              onError={(e) => {
                const img = e.currentTarget;
                if (c.icon && img.src !== c.icon) { img.style.objectPosition = ""; img.src = c.icon; } else img.style.visibility = "hidden";
              }} />
          </button>
        );
      })}
    </div>
  );
}
