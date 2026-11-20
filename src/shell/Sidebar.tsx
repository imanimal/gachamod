// The sidebar: the GameBanana account, the current game (with a row of the other games when two or more are shown), big
// view buttons, the game's profiles one click away, and Play at the bottom. Browse and Downloads carry the soft
// first-time rings (hints.ts). Folds to an icon rail with Ctrl+B or its
// button (remembered). When the window is short the profile list scrolls and the rest stays.
// Layout attributes on <html> (set by lib/theme.ts): data-density, data-sidebar, data-nav.
// Owner: SHELL area.
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { errorText, queue, type GameState, type Profile } from "../lib/api";
import { charNoun, gameName, gameShort } from "../lib/games";
import { stops, t, tn } from "../lib/i18n";
import { extensionPages, useExtensions } from "../lib/extensions";
import { allGames, currentGame, currentRoute, go, setGame, useBadges, useDailyGames, useGame, useGames, useRoute, useShownGames, type View } from "../lib/store";
import { showsPage } from "../lib/here";
import { Icon } from "../ui/Icon";
import { GameBadge, gameIconNow } from "../ui/GameBadge";
import { menuFor, openMenu, type MenuEntry } from "../ui/ContextMenu";
import { withoutKeys } from "../lib/menuHints";
import { SideDeco } from "../ui/Deco";
import { toast } from "../ui/toast";
import { PlayButton } from "../screens/home/PlayButton";
import { extIcon } from "../screens/extensions/Extensions";
import { quickNewProfile, switchTo } from "../screens/profiles/actions";
import { useProfiles, useSwitching } from "../screens/profiles/data";
import { newProfileMenu } from "../screens/profiles/menus";
import { ProfileThumb } from "../screens/profiles/ProfileThumb";
import { downloadsTipText, useDownloadsCounts } from "../screens/browse/downloadsTip";
import { AccountCard, MiniAccount } from "./AccountCard";
import { useHint } from "./hints";
import { KEY_VIEWS, VIEW_INFO } from "./names";
import { toggleSide, useSideCollapsed } from "./state";
import { checkModUpdates, openModsFolder, rescan } from "./commands";

// Profiles has its own list under the views
const NAV: View[] = KEY_VIEWS.filter((v) => v !== "profiles");

const below = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; };
const beside = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.right + 6, y: r.top }; };

export function Sidebar() {
  const game = useGame();
  const ready = useGames().some((g) => g.modsDir);
  const collapsed = useSideCollapsed();
  return (
    <aside className="side" aria-label={t("Sidebar")} data-collapsed={collapsed ? "" : undefined}>
      <div className="side-top">
        {collapsed ? <MiniAccount /> : <AccountCard />}
        <button type="button" className="side-fold" onClick={toggleSide} aria-label={collapsed ? t("Expand the sidebar") : t("Collapse the sidebar")}
          title={collapsed ? t("Expand the sidebar (Ctrl+B)") : t("Collapse the sidebar (Ctrl+B)")}>
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
    { header: t("Switch game") },
    ...(daily.length > 1 ? daily : []).map((g) => ({ label: gameName(g), img: gameIconNow(g.id), checked: g.id === cur?.id, onClick: () => setGame(g.id) })),
    rest.length > 0 && { label: t("Other games"), icon: "swap", title: cur ? t("One-game mode keeps these out of the way. Untick \"Only show {game}\" below to bring them back", { game: gameShort(cur) }) : t("One-game mode keeps these out of the way"), items: rest.map((g) => ({ label: gameName(g), img: gameIconNow(g.id), onClick: () => setGame(g.id) })) },
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
        <button type="button" className="side-game-add" onClick={() => go({ view: "settings", section: "games" })} title={t("Set up a game in Settings")}>
          <Icon name="plus" /><span className="side-game-t">{t("Set up a game")}</span>
        </button>
      </div>
    );
  }
  const many = daily.length > 1;
  const sw = switchEntries(game, daily, shown);
  // on Settings' Games page already (where games are added), the next game page is Launch
  const menu = (): MenuEntry[] => [...sw, sw.length > 0 && "-", ...menuFor("game", { id: game.id }), "-", showsPage("settings", "games")
    ? { label: t("Launch options"), icon: "sliders", onClick: () => go({ view: "settings", section: "launch" }) }
    : { label: t("Add or show a game"), icon: "plus", onClick: () => go({ view: "settings", section: "games" }) }];
  const others = daily.filter((g) => g.id !== game.id);

  return (
    <div className={`side-game${sw.length ? " has-switch" : ""}`} style={{ "--g-accent": game.accent } as CSSProperties}>
      <button type="button" className="side-game-cur" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }, menu()); }}
        title={many ? t("{game}. Click to switch games (Ctrl+Tab) and more", { game: gameName(game) }) : t("{game}. Click for more", { game: gameName(game) })}
        onClick={(e) => openMenu(collapsed ? beside(e.currentTarget) : below(e.currentTarget), menu())}>
        <GameBadge game={game} size={collapsed ? 40 : 34} />
        <span className="side-game-text">
          <span className="side-game-t">{gameName(game)}</span>
          <span className="side-game-s">{game.running ? t("Running") : game.modCount ? tn(game.modCount, "{on} of {n} mod on", "{on} of {n} mods on", { on: game.enabledCount }) : game.importer}</span>
        </span>
        <Icon name="down" className="side-game-dd" />
      </button>
      {many && !collapsed && <GameStrip others={others} next={daily[(daily.findIndex((g) => g.id === game.id) + 1) % daily.length]?.id} more={(el) => openMenu(below(el), sw)} />}
    </div>
  );
}

/** The other games as one row of icons. When they don't all fit, the last place opens a menu with the rest. */
/** `next`: the game Ctrl+Tab goes to, the only icon whose tip names the key. */
function GameStrip({ others, next, more }: { others: GameState[]; next?: string; more: (el: Element) => void }) {
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
    <div className="side-games" role="group" aria-label={t("Other games")} ref={ref}>
      <span className="side-games-h" aria-hidden="true"><Icon name="swap" />{t("Switch")}</span>
      {list.map((g) => (
        <button key={g.id} type="button" className={`side-g${g.running ? " running" : ""}`} title={g.id === next ? t("Switch to {game} (Ctrl+Tab)", { game: gameName(g) }) : t("Switch to {game}", { game: gameName(g) })} aria-label={t("Switch to {game}", { game: gameName(g) })}
          onClick={() => setGame(g.id)} onContextMenu={ctx(g)} style={{ "--g-accent": g.accent } as CSSProperties}>
          <GameBadge game={g} size={26} />
        </button>
      ))}
      {rest > 0 && (
        <button type="button" className="side-g side-g-more" title={t("{n} more: {games}", { n: rest, games: others.slice(list.length).map((g) => gameShort(g)).join(", ") })} aria-label={tn(rest, "{n} more game", "{n} more games")}
          onClick={(e) => more(e.currentTarget)}>+{rest}</button>
      )}
    </div>
  );
}

// ── views ──

/** Right-click on a nav item: the everyday actions for that page. Others get the page menu. */
const navMenu = (v: View) => {
  if (v !== "library" && v !== "downloads") return undefined;
  return (e: ReactMouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const at = { x: e.clientX, y: e.clientY };
    if (v === "library") {
      const g = currentGame();
      if (!g) return;
      openMenu(at, [
        { label: t("Check for updates"), icon: "update", onClick: () => void checkModUpdates(g) },
        { label: t("Rescan mods"), icon: "refresh", title: t("Reads the Mods folder again, then checks every mod for updates on GameBanana"), disabled: !g.modsDir, onClick: () => void rescan(g) },
        { label: t("Open Mods folder"), icon: "folder", disabled: !g.modsDir, title: g.modsDir ?? undefined, onClick: () => openModsFolder(g) },
      ]);
      return;
    }
    void queue.get().then((s) => {
      const failed = s.items.filter((i) => i.state === "failed" && allGames().find((g) => g.id === i.req.game)?.modsDir);
      openMenu(at, [
        // in Downloads already: Browse, where downloads come from
        currentRoute().view === "downloads"
          ? { label: t("Browse GameBanana"), icon: "browse", keys: `Ctrl+${KEY_VIEWS.indexOf("browse") + 1}`, onClick: () => go("browse") }
          : { label: t("Open Downloads"), icon: "downloads", keys: `Ctrl+${KEY_VIEWS.indexOf("downloads") + 1}`, onClick: () => go("downloads") },
        failed.length > 0 && { label: t("Retry failed ({n})", { n: failed.length }), icon: "refresh", title: t("Try every failed download again"),
          onClick: () => void Promise.all(failed.map((i) => queue.retry(i.id))).catch((err) => toast(errorText(err), true)) },
      ]);
    }).catch((err) => toast(errorText(err), true));
  };
};

function Nav({ disabled }: { disabled: boolean }) {
  const route = useRoute();
  const badges = useBadges();
  const dl = useDownloadsCounts();
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
    <nav className="side-nav" aria-label={t("Views")} ref={navRef}>
      {NAV.map((v) => {
        const b = badges[v];
        const label = v === "characters" ? charNoun(game?.id) : VIEW_INFO[v].label;
        const key = KEY_VIEWS.indexOf(v) + 1;
        const ring = (v === "browse" && ringBrowse) || (v === "downloads" && ringDownloads);
        const off = disabled && v !== "settings";
        const count = v === "downloads" ? (b?.count ? downloadsTipText(dl) : "") : b?.count ? (v === "library" ? t("{n} with updates", { n: b.count }) : t("{n} to look at", { n: b.count })) : "";
        // each part is a whole sentence of its own
        const tip = stops([t("{page} (Ctrl+{key})", { page: label, key }), count,
          ring ? (v === "browse" ? t("Find mods on GameBanana and install them in one click") : t("See how your downloads are going")) : ""]
          .filter(Boolean));
        // Extensions opens from Settings, so Settings stays marked there
        const on = route.view === v || (v === "settings" && route.view === "extensions" && !route.ext);
        return (
          <button key={v} type="button" className={`nv${on ? " on" : ""}${ring ? " is-hint" : ""}`} aria-current={on ? "page" : undefined}
            onClick={() => go(v)} title={tip} disabled={off} data-view={v} onContextMenu={off ? undefined : navMenu(v)}>
            <Icon name={VIEW_INFO[v].icon} /><span className="nv-t" title={label}>{label}</span>
            {b && <span className={`nv-b t-${b.tone ?? "accent"}`}>{b.count ? b.count : ""}</span>}
          </button>
        );
      })}
      {pages.map((e) => {
        const p = e.manifest!.page!;
        const on = route.view === "extensions" && route.ext === e.id;
        return (
          <button key={e.id} type="button" className={`nv nv-ext${on ? " on" : ""}`} aria-current={on ? "page" : undefined} disabled={disabled}
            onClick={() => go({ view: "extensions", ext: e.id })} title={p.title === e.manifest!.name ? p.title : t("{page}, from {extension}", { page: p.title, extension: e.manifest!.name })} data-view="extensions">
            <Icon name={extIcon(p.icon)} /><span className="nv-t" title={p.title}>{p.title}</span>
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
  // a switch started anywhere (this list, Home, a menu, search) shows here
  const sw = useSwitching();
  const busy = sw?.game === game.id ? sw.id : null;

  const pick = (p: Profile) => {
    if (p.active) { go({ view: "profiles", profile: p.id }); return; }
    if (!sw) void switchTo(game.id, p, list);
  };

  const create = () => void quickNewProfile(game.id);
  const createMenu = (e: ReactMouseEvent) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }, newProfileMenu(game.id)); };

  const ctx = (p: Profile) => (e: ReactMouseEvent) => {
    const items = withoutKeys(menuFor("profile", { game: game.id, id: p.id }));
    const fallback: MenuEntry[] = [
      { label: p.active ? t("Active") : t("Switch to {name}", { name: p.name }), icon: "swap", disabled: p.active, onClick: () => void pick(p) },
      currentRoute().view === "profiles" && currentRoute().profile === undefined
        ? { label: t("View mods"), icon: "mods", title: t("See the mods in this profile, and add or take out mods"), onClick: () => go({ view: "profiles", profile: p.id }) }
        : { label: t("Manage profiles"), icon: "profiles", onClick: () => go("profiles") },
    ];
    e.preventDefault(); e.stopPropagation();
    openMenu({ x: e.clientX, y: e.clientY }, items.length ? items : fallback);
  };

  return (
    <section className="side-prof" aria-label={t("Profiles")}>
      <div className="side-prof-h">
        <span className="side-h">{t("Profiles")}</span>
        <button type="button" className="side-hk" onClick={() => go("profiles")} aria-label={t("Manage profiles")} title={t("Manage profiles (Ctrl+6)")}><Icon name="sliders" /></button>
      </div>
      <div className="side-prof-list" role="list">
        {list === null && <span className="side-prof-wait" aria-hidden="true" />}
        {(list ?? []).map((p) => (
          // the list item adds no box, so the button stays the list's flex item
          <div key={p.id} role="listitem" style={{ display: "contents" }}>
            <button type="button" className={`side-p${p.active ? " on" : ""}`} aria-current={p.active ? "true" : undefined}
              style={p.color ? ({ "--p-color": p.color } as CSSProperties) : undefined}
              title={busy === p.id ? t("Switching to {name}", { name: p.name })
                : p.active ? (p.hotkey ? t("{name} is on ({key} in game). Click to see the mods", { name: p.name, key: p.hotkey }) : t("{name} is on. Click to see the mods", { name: p.name }))
                : p.hotkey ? t("Switch to {name} ({key} in game)", { name: p.name, key: p.hotkey }) : t("Switch to {name}", { name: p.name })}
              onClick={() => void pick(p)} onContextMenu={ctx(p)}>
              <ProfileThumb game={game.id} profileId={p.id} profile={p} size="mini" px={collapsed ? 34 : 28} />
              <span className="side-p-t" title={p.name}>{p.name}</span>
              {busy === p.id ? <span className="spin" aria-hidden="true" /> : p.active ? <Icon name="check" className="side-p-on" /> : p.hotkey ? <kbd className="side-p-k">{p.hotkey}</kbd> : null}
            </button>
          </div>
        ))}
        {list !== null && (
          <div role="listitem" style={{ display: "contents" }}>
            <button type="button" className="side-p side-p-add" onClick={create} onContextMenu={createMenu}
              title={t("New profile from the mods on now. Right-click for one with no mods, or to pick the name and icon first")}>
              <span className="side-p-plus"><Icon name="plus" /></span>
              <span className="side-p-t">{t("New profile")}</span>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
