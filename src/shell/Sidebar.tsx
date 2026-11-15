// The sidebar: the GameBanana account, the current game (with a row of the other games when two or more are shown), big
// view buttons, the game's profiles one click away, and Play at the bottom. Browse and Downloads carry the soft
// first-time rings (hints.ts). Folds to an icon rail with Ctrl+B or its
// button (remembered). When the window is short the profile list scrolls and the rest stays.
// Layout attributes on <html> (set by lib/theme.ts): data-density, data-sidebar, data-nav, data-corners.
// Owner: SHELL area.
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { errorText, type GameState, type Profile } from "../lib/api";
import { charNoun } from "../lib/games";
import { extensionPages, useExtensions } from "../lib/extensions";
import { go, setGame, useBadges, useDailyGames, useGame, useGames, useRoute, useShownGames, type View } from "../lib/store";
import { Icon } from "../ui/Icon";
import { GameBadge, gameIconNow } from "../ui/GameBadge";
import { menuFor, openMenu, type MenuEntry } from "../ui/ContextMenu";
import { SideDeco } from "../ui/Deco";
import { toast } from "../ui/toast";
import { PlayButton } from "../screens/home/PlayButton";
import { extIcon } from "../screens/extensions/Extensions";
import { startNewProfile } from "../screens/profiles/actions";
import { switchProfile, useProfiles } from "../screens/profiles/data";
import { ProfileThumb } from "../screens/profiles/ProfileThumb";
import { AccountCard, MiniAccount } from "./AccountCard";
import { useHint } from "./hints";
import { KEY_VIEWS, VIEW_INFO } from "./names";
import { toggleSide, useSideCollapsed } from "./state";

// Profiles has its own list under the views
const NAV: View[] = KEY_VIEWS.filter((v) => v !== "profiles");

const below = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; };
const beside = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.right + 6, y: r.top }; };

export function Sidebar() {
  const game = useGame();
  const ready = useGames().some((g) => g.modsDir);
  const collapsed = useSideCollapsed();
  return (
    <aside className="side" aria-label="Sidebar" data-collapsed={collapsed ? "" : undefined}>
      <div className="side-top">
        {collapsed ? <MiniAccount /> : <AccountCard />}
        <button type="button" className="side-fold" onClick={toggleSide} aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          title={collapsed ? "Expand the sidebar (Ctrl+B)" : "Collapse the sidebar (Ctrl+B)"}>
          <Icon name={collapsed ? "expand" : "collapse"} />
        </button>
      </div>
      <GameHeader />
      <Nav disabled={!game || !ready} />
      {game?.modsDir && <ProfileList game={game} />}
      <SideDeco game={game} />
      <div className="side-foot">{game?.modsDir && <PlayButton />}</div>
    </aside>
  );
}

// ── the current game, and switching ──

/** The game menu's switching part: the everyday games, then (in one-game mode) the rest in a submenu. */
export function switchEntries(cur: GameState | null, daily: GameState[], shown: GameState[]): MenuEntry[] {
  const rest = shown.filter((g) => !daily.some((d) => d.id === g.id));
  if (daily.length < 2 && !rest.length) return [];
  return [
    { header: "Switch game" },
    ...(daily.length > 1 ? daily : []).map((g) => ({ label: g.name, img: gameIconNow(g.id), checked: g.id === cur?.id, onClick: () => setGame(g.id) })),
    rest.length > 0 && { label: "Other games", icon: "swap", title: "One-game mode keeps these out of the way. Turn it off in Settings, Games", items: rest.map((g) => ({ label: g.name, img: gameIconNow(g.id), onClick: () => setGame(g.id) })) },
  ];
}

function GameHeader() {
  const game = useGame();
  const daily = useDailyGames();
  const shown = useShownGames();
  const collapsed = useSideCollapsed();
  if (!game) {
    return (
      <div className="side-game">
        <button type="button" className="side-game-add" onClick={() => go({ view: "settings", section: "games" })} title="Set up a game in Settings">
          <Icon name="plus" /><span className="side-game-t">Set up a game</span>
        </button>
      </div>
    );
  }
  const many = daily.length > 1;
  const sw = switchEntries(game, daily, shown);
  const menu = (): MenuEntry[] => [...sw, sw.length > 0 && "-", ...menuFor("game", { id: game.id }), "-", { label: "Add or show a game", icon: "plus", onClick: () => go({ view: "settings", section: "games" }) }];
  const others = daily.filter((g) => g.id !== game.id);

  return (
    <div className={`side-game${sw.length ? " has-switch" : ""}`} style={{ "--g-accent": game.accent } as CSSProperties}>
      <button type="button" className="side-game-cur" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }, menu()); }}
        title={many ? `${game.name}. Click to switch games (Ctrl+Tab) and more` : `${game.name}. Click for more`}
        onClick={(e) => openMenu(collapsed ? beside(e.currentTarget) : below(e.currentTarget), menu())}>
        <GameBadge game={game} size={collapsed ? 40 : 34} />
        <span className="side-game-text">
          <span className="side-game-t">{game.name}</span>
          <span className="side-game-s">{game.running ? "Running" : game.modCount ? `${game.enabledCount} of ${game.modCount} mods on` : game.importer}</span>
        </span>
        <Icon name="down" className="side-game-dd" />
      </button>
      {many && !collapsed && <GameStrip others={others} more={(el) => openMenu(below(el), sw)} />}
    </div>
  );
}

/** The other games as one row of icons. When they don't all fit, the last place opens a menu with the rest. */
function GameStrip({ others, more }: { others: GameState[]; more: (el: Element) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(others.length);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.columnGap) || 0;
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        - ((el.querySelector(".side-games-h") as HTMLElement | null)?.offsetWidth ?? 0) - gap;
      const slot = (el.querySelector(".side-g") as HTMLElement | null)?.offsetWidth || 30;
      setFit(Math.max(1, Math.floor((room + gap) / (slot + gap))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const over = others.length > fit;
  const list = over ? others.slice(0, fit - 1) : others;
  const rest = others.length - list.length;
  const ctx = (g: GameState) => (e: ReactMouseEvent) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }, menuFor("game", { id: g.id })); };
  return (
    <div className="side-games" role="group" aria-label="Other games" ref={ref}>
      <span className="side-games-h" aria-hidden="true"><Icon name="swap" />Switch</span>
      {list.map((g) => (
        <button key={g.id} type="button" className={`side-g${g.running ? " running" : ""}`} title={`Switch to ${g.name} (Ctrl+Tab)`} aria-label={`Switch to ${g.name}`}
          onClick={() => setGame(g.id)} onContextMenu={ctx(g)} style={{ "--g-accent": g.accent } as CSSProperties}>
          <GameBadge game={g} size={26} />
        </button>
      ))}
      {rest > 0 && (
        <button type="button" className="side-g side-g-more" title={`${rest} more: ${others.slice(list.length).map((g) => g.short).join(", ")}`} aria-label={`${rest} more games`}
          onClick={(e) => more(e.currentTarget)}>+{rest}</button>
      )}
    </div>
  );
}

// ── views ──

function Nav({ disabled }: { disabled: boolean }) {
  const route = useRoute();
  const badges = useBadges();
  const game = useGame();
  const pages = extensionPages(useExtensions(), game?.id);
  const ringBrowse = useHint("browse") && !disabled && route.view !== "browse";
  const ringDownloads = useHint("downloads") && !!badges.downloads?.count && route.view !== "downloads";
  // a hinted view looks like the selected one, faded: take the theme's own selection colour from the selected button
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const on = nav?.querySelector<HTMLElement>(".nv.on");
    if (!nav || !on || !(ringBrowse || ringDownloads)) return;
    const bg = getComputedStyle(on).backgroundColor;
    if (bg && bg !== "transparent" && !/,\s*0\)$/.test(bg)) nav.style.setProperty("--nv-on-bg", bg);
  });
  return (
    <nav className="side-nav" aria-label="Views" ref={navRef}>
      {NAV.map((v) => {
        const b = badges[v];
        const label = v === "characters" ? charNoun(game?.id) : VIEW_INFO[v].label;
        const key = KEY_VIEWS.indexOf(v) + 1;
        const ring = (v === "browse" && ringBrowse) || (v === "downloads" && ringDownloads);
        const off = disabled && v !== "settings";
        const tip = `${label} (Ctrl+${key})${b?.count ? `. ${b.count} ${v === "library" ? "with updates" : v === "downloads" ? "downloading" : "to look at"}` : ""}`
          + (ring ? (v === "browse" ? ". Find mods on GameBanana and install them in one click" : ". See how your downloads are going") : "");
        // Extensions opens from Settings, so Settings stays marked there
        const on = route.view === v || (v === "settings" && route.view === "extensions" && !route.ext);
        return (
          <button key={v} type="button" className={`nv${on ? " on" : ""}${ring ? " is-hint" : ""}`} aria-current={on ? "page" : undefined}
            onClick={() => go(v)} title={tip} disabled={off} data-view={v}>
            <Icon name={VIEW_INFO[v].icon} /><span className="nv-t">{label}</span>
            {b && <span className={`nv-b t-${b.tone ?? "accent"}`}>{b.count ? b.count : ""}</span>}
          </button>
        );
      })}
      {pages.map((e) => {
        const p = e.manifest!.page!;
        const on = route.view === "extensions" && route.ext === e.id;
        return (
          <button key={e.id} type="button" className={`nv nv-ext${on ? " on" : ""}`} aria-current={on ? "page" : undefined} disabled={disabled}
            onClick={() => go({ view: "extensions", ext: e.id })} title={p.title === e.manifest!.name ? p.title : `${p.title}, from ${e.manifest!.name}`} data-view="extensions">
            <Icon name={extIcon(p.icon)} /><span className="nv-t">{p.title}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ── profiles ──

function ProfileList({ game }: { game: GameState }) {
  const { list } = useProfiles(game.id);
  const collapsed = useSideCollapsed();
  const [busy, setBusy] = useState<number | null>(null);
  const active = list?.find((p) => p.active) ?? null;

  const pick = async (p: Profile) => {
    if (p.active) { go({ view: "profiles", profile: p.id }); return; }
    if (busy !== null) return;
    setBusy(p.id);
    try { await switchProfile(game.id, p, active); } catch (e) { toast(errorText(e), true); } finally { setBusy(null); }
  };

  const create = () => startNewProfile(game.id);

  const ctx = (p: Profile) => (e: ReactMouseEvent) => {
    const items = menuFor("profile", { game: game.id, id: p.id });
    const fallback: MenuEntry[] = [
      { label: p.active ? "Active" : `Switch to ${p.name}`, icon: "swap", disabled: p.active, onClick: () => void pick(p) },
      { label: "Manage profiles", icon: "profiles", onClick: () => go("profiles") },
    ];
    e.preventDefault(); e.stopPropagation();
    openMenu({ x: e.clientX, y: e.clientY }, items.length ? items : fallback);
  };

  return (
    <section className="side-prof" aria-label="Profiles">
      <div className="side-prof-h">
        <span className="side-h">Profiles</span>
        <button type="button" className="side-hk" onClick={() => go("profiles")} aria-label="Manage profiles" title="Manage profiles (Ctrl+6)"><Icon name="sliders" /></button>
      </div>
      <div className="side-prof-list" role="list">
        {list === null && <span className="side-prof-wait" />}
        {(list ?? []).map((p) => (
          <button key={p.id} type="button" role="listitem" className={`side-p${p.active ? " on" : ""}`} aria-current={p.active ? "true" : undefined}
            style={p.color ? ({ "--p-color": p.color } as CSSProperties) : undefined}
            title={p.active ? `${p.name} is on${p.hotkey ? ` (${p.hotkey} in game)` : ""}. Click to see its mods` :`Switch to ${p.name}${p.hotkey ? ` (${p.hotkey} in game)` : ""}`}
            onClick={() => void pick(p)} onContextMenu={ctx(p)}>
            <ProfileThumb game={game.id} profileId={p.id} profile={p} size="mini" px={collapsed ? 34 : 28} />
            <span className="side-p-t">{p.name}</span>
            {busy === p.id ? <span className="spin" aria-hidden="true" /> : p.active ? <Icon name="check" className="side-p-on" /> : p.hotkey ? <kbd className="side-p-k">{p.hotkey}</kbd> : null}
          </button>
        ))}
        {list !== null && (
          <button type="button" className="side-p side-p-add" onClick={create} title="New profile from the mods on now">
            <span className="side-p-plus"><Icon name="plus" /></span>
            <span className="side-p-t">New profile</span>
          </button>
        )}
      </div>
    </section>
  );
}
