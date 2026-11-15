// A profile's picture made from its mods: a mural of up to six mod previews ("card"), or the single most telling one
// ("mini", for the sidebar and switcher: the icon the user picked, else the first character mod with a preview, else
// the default face from ProfileIcon). Cheap: one mod list and one member list per profile, cached and shared by every thumb,
// dropped when the library changes. Mods for adults are left out unless they are shown. Owner: SHELL area.
import { useEffect, useState, type CSSProperties } from "react";
import { fileUrl, library, profiles, type GameId, type ModEntry, type Profile } from "../../lib/api";
import { useNsfw } from "../../lib/prefs";
import { onApp } from "../../lib/store";
import { held } from "../../lib/tauri";
import { useCharacters } from "./data";
import { ProfileIcon } from "./ProfileIcon";
import { LazyImg } from "../../ui/LazyImg";

const TTL = 20_000;
const modLists = new Map<GameId, { at: number; p: Promise<Map<string, ModEntry>> }>();
const memberLists = new Map<string, { at: number; p: Promise<string[]> }>();
const profileLists = new Map<GameId, { at: number; p: Promise<Profile[]> }>();
const subs = new Set<() => void>();
let watching = false;

function drop(game: GameId) {
  modLists.delete(game);
  profileLists.delete(game);
  for (const k of [...memberLists.keys()]) if (k.startsWith(`${game}:`)) memberLists.delete(k);
  subs.forEach((f) => f());
}
function watch() {
  if (watching) return;
  watching = true;
  held(library.onChanged((p) => drop(p.game)));
  onApp((e) => { if (e.type === "library-refresh") drop(e.game); });
}

function cachedJob<T>(map: Map<string, { at: number; p: Promise<T> }>, key: string, job: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = job();
  map.set(key, { at: Date.now(), p });
  p.catch(() => map.delete(key));
  return p;
}
const modsOf = (game: GameId) => cachedJob(modLists as Map<string, { at: number; p: Promise<Map<string, ModEntry>> }>, game,
  async () => new Map((await library.list(game)).map((m) => [m.id, m])));
const profilesOf = (game: GameId) => cachedJob(profileLists as Map<string, { at: number; p: Promise<Profile[]> }>, game, () => profiles.list(game));

export interface ThumbPic { src: string; character: string | null; name: string }

/** The previews of a profile's mods that are on, character mods first. */
export function useProfilePictures(game: GameId, profileId: number, profile?: Profile | null): { profile: Profile | null; pics: ThumbPic[] | null } {
  const nsfw = useNsfw();
  const [state, setState] = useState<{ profile: Profile | null; pics: ThumbPic[] | null }>({ profile: profile ?? null, pics: null });
  const [tick, setTick] = useState(0);
  useEffect(() => { watch(); const f = () => setTick((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  // a profile's members change with what it holds: key them by its stamp
  const stamp = profile ? `${profile.updatedAt}:${profile.modCount}:${profile.active ? 1 : 0}` : "";
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const p = profile ?? (await profilesOf(game)).find((x) => x.id === profileId) ?? null;
        const [mods, ids] = await Promise.all([
          modsOf(game),
          cachedJob(memberLists, `${game}:${profileId}:${stamp}`, () => profiles.members(profileId)),
        ]);
        const pics: ThumbPic[] = [];
        for (const id of ids) {
          const m = mods.get(id);
          if (!m?.preview || (m.nsfw && nsfw !== "show")) continue;
          const src = fileUrl(m.preview);
          if (src) pics.push({ src, character: m.character, name: m.name });
        }
        pics.sort((a, b) => Number(!!b.character) - Number(!!a.character));
        if (live) setState({ profile: p, pics });
      } catch { if (live) setState((s) => ({ ...s, pics: [] })); }
    })();
    return () => { live = false; };
  }, [game, profileId, stamp, nsfw, tick, profile]);
  return state;
}

export function ProfileThumb({ game, profileId, size = "card", className, profile, px = 32 }: {
  game: GameId; profileId: number; size?: "mini" | "card"; className?: string;
  /** The profile when the caller has it (saves a lookup). */
  profile?: Profile | null;
  /** mini only: the edge in px. */
  px?: number;
}) {
  const { profile: p, pics } = useProfilePictures(game, profileId, profile);
  const chars = useCharacters(game);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const ok = (pics ?? []).filter((x) => !broken.has(x.src));
  const lose = (src: string) => setBroken((b) => new Set(b).add(src));
  const color = p?.color ? ({ "--p-color": p.color } as CSSProperties) : {};

  if (size === "mini") {
    // an icon the user picked wins over the mods' pictures
    const first = p?.icon ? undefined : ok[0];
    return (
      <span className={`pthumb pthumb-mini${first ? " has-img" : ""}${className ? ` ${className}` : ""}`} style={{ ...color, width: px, height: px }}>
        {first ? <LazyImg src={first.src} alt="" decoding="async" draggable={false} onError={() => lose(first.src)} />
          : p ? <ProfileIcon profile={p} chars={chars} size={px} /> : null}
      </span>
    );
  }
  const shown = ok.slice(0, 6);
  return (
    <span className={`pthumb pthumb-card${shown.length ? " has-img" : ""}${className ? ` ${className}` : ""}`} data-n={shown.length} style={color}>
      {shown.length
        ? shown.map((x) => <LazyImg key={x.src} src={x.src} alt="" title={x.name} decoding="async" draggable={false} onError={() => lose(x.src)} />)
        : p ? <span className="pthumb-face"><ProfileIcon profile={p} chars={chars} size={56} /></span> : null}
    </span>
  );
}
