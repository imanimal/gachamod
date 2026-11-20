// The title bar: Back and Forward (right-click lists recent pages), a breadcrumb you can click (game, view, then the
// open character, mod, creator or section; the chevrons between them open a menu), the search box in the middle
// (it opens the palette, and grows in when the app opens to show it's there), Undo and Redo (right-click lists the
// history), what gachamod is waiting on (shell/Activity.tsx), Help (shortcuts, feedback) and the window keys. The empty parts drag the window. Owner: SHELL area.
import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Icon } from "../ui/Icon";
import { menuFor, menuIsOpen, openMenu, type MenuEntry } from "../ui/ContextMenu";
import { Glyphs } from "../ui/Deco";
import { inTauri, windowAction } from "../lib/tauri";
import { redo, undo, useHistory } from "../lib/history";
import { allGames, back, currentGame, forward, go, goIndex, recentPages, useDailyGames, useGame, useNav, useRoute, useShownGames, VIEWS, type Route } from "../lib/store";
import { pageName, subCrumbs, useNamesVersion, VIEW_INFO, viewLabel } from "./names";
import { switchEntries } from "./Sidebar";
import { openPalette, toggleHelp, useSearchIntro } from "./state";
import { openKofi } from "../lib/support";
import { openFeedback, openGameCheck } from "../lib/feedback";
import { Activity } from "./Activity";
import { t } from "../lib/i18n";
import { gameName, gameShort } from "../lib/games";

const at = (e: ReactMouseEvent) => ({ x: e.clientX, y: e.clientY });
const below = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; };

function historyMenu(dir: -1 | 1): MenuEntry[] {
  const list = recentPages(dir, 40);
  if (!list.length) return [];
  const here = currentGame()?.id ?? null;
  const items: MenuEntry[] = [];
  let last = "";
  for (const p of list) {
    const g = allGames().find((x) => x.id === p.game);
    const name = pageName(p.route, p.game);
    const label = g && p.game !== here ? t("{page}, {game}", { page: name, game: gameShort(g) }) : name;
    // A run of the same page in the same game is one entry: it jumps to the nearest of them.
    const key = `${p.game ?? ""}|${name}`;
    if (key === last) continue;
    last = key;
    items.push({ label, icon: VIEW_INFO[p.route.view].icon, title: g ? gameName(g) : undefined, onClick: () => goIndex(p.index) });
    if (items.length >= 12) break;
  }
  return [{ header: dir < 0 ? t("Back to") : t("Forward to") }, ...items];
}

export function Titlebar() {
  const nav = useNav();
  const game = useGame();
  const shown = useShownGames();
  const daily = useDailyGames();
  const route = useRoute();
  const hist = useHistory();
  const introN = useSearchIntro();
  useNamesVersion();
  const gameBtn = useRef<HTMLButtonElement>(null);
  // which button's menu is open, for aria-expanded
  const [menuOf, setMenuOf] = useState<string | null>(null);
  const openFrom = (which: string, el: Element, items: MenuEntry[]) => {
    openMenu(below(el), items, () => setMenuOf((m) => (m === which ? null : m)));
    if (menuIsOpen()) setMenuOf(which);
  };
  const gid = game?.id ?? null;
  const subs = subCrumbs(route, gid);

  const gameMenu = (): MenuEntry[] => [
    ...switchEntries(game, daily, shown),
    shown.length > 1 && "-",
    ...(game ? menuFor("game", { id: game.id }) : []),
  ];
  const viewMenu = (): MenuEntry[] => VIEWS.map((v) => ({ label: viewLabel(v, gid), icon: VIEW_INFO[v].icon, checked: route.view === v, onClick: () => go(v) }));
  const undoMenu = (): MenuEntry[] => {
    const done = hist.entries.filter((e) => e.state === "done").slice(0, 15);
    return done.length ? [{ header: t("Undo back to") }, ...done.map((e) => ({ label: e.label, icon: "undo" as const, onClick: () => void undo(e) }))] : [];
  };
  const redoMenu = (): MenuEntry[] => {
    const und = hist.entries.filter((e) => e.state === "undone").reverse().slice(0, 15);
    return und.length ? [{ header: t("Redo up to") }, ...und.map((e) => ({ label: e.label, icon: "redo" as const, onClick: () => void redo(e) }))] : [];
  };
  const nextUndo = hist.entries.find((e) => e.state === "done");
  const nextRedo = [...hist.entries].reverse().find((e) => e.state === "undone");

  const crumbs: Array<{ key: string; label: string; route: Route; menu?: () => MenuEntry[]; title?: string }> = [
    { key: "view", label: viewLabel(route.view, gid), route: { view: route.view }, menu: viewMenu, title: t("Go to {page}", { page: viewLabel(route.view, gid) }) },
    ...subs.map((c, i) => ({ key: `s${i}`, label: c.label, route: c.route, title: c.title })),
  ];

  const helpMenu = (): MenuEntry[] => [
    { label: t("Keyboard and controller shortcuts"), icon: "keyboard", keys: "?", onClick: toggleHelp },
    { label: t("Search anything"), icon: "search", keys: "Ctrl+K", onClick: () => openPalette() },
    "-",
    { label: t("Send feedback"), icon: "help", title: t("Tell the developer about a problem or an idea. It goes straight from here"), onClick: () => openFeedback() },
    { label: t("Check this game"), icon: "check", title: t("Walks through switching skins while you play, then sends what worked to the developer. About ten minutes"), onClick: openGameCheck },
    { label: t("Tip on Ko-fi"), icon: "coffee", title: t("gachamod is free. Tips go to the person making it (ko-fi.com/aanimal)"), onClick: openKofi },
  ];

  return (
    <header className="titlebar" data-tauri-drag-region onDoubleClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).matches(".tb-side, .sp")) void windowAction("toggleMaximize"); }}>
      <div className="tb-side tb-l" data-tauri-drag-region>
        <span className="brand" data-tauri-drag-region title="gachamod"><span className="brand-mark" aria-hidden="true" /></span>
        <span className="tb-nav">
          <button type="button" className="tb-k" disabled={!nav.back} aria-label={t("Back")} title={t("Back (Alt+Left, mouse button 4). Right-click for recent pages")}
            onClick={() => back()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(at(e), historyMenu(-1)); }}><Icon name="left" /></button>
          <button type="button" className="tb-k" disabled={!nav.forward} aria-label={t("Forward")} title={t("Forward (Alt+Right, mouse button 5). Right-click for recent pages")}
            onClick={() => forward()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(at(e), historyMenu(1)); }}><Icon name="right" /></button>
        </span>

        <nav className="crumb" aria-label={t("Where you are")} data-tauri-drag-region>
          {game && (
            <>
              <button ref={gameBtn} type="button" className="crumb-b crumb-game" title={t("{game}. Click for games and more", { game: gameName(game) })}
                aria-haspopup="menu" aria-expanded={menuOf === "game"}
                onClick={(e) => openFrom("game", e.currentTarget, gameMenu())}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(at(e), gameMenu()); }}>
                <span className="crumb-t">{gameShort(game)}</span><Icon name="down" className="crumb-dd" />
              </button>
              <Icon name="chevron" className="crumb-sep" />
            </>
          )}
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              // the page you're on keeps room for a few letters while the parts before it shrink first
              <span key={c.key} className="crumb-part" style={last ? { flexShrink: 0.25, minWidth: "4.5rem" } : { flexShrink: 4 }}>
                <button type="button" className={`crumb-b${last ? " crumb-view" : ""}`} aria-current={last ? "page" : undefined} title={c.title ?? (last ? c.label : t("Go to {page}", { page: c.label }))}
                  onClick={() => go(c.route)}
                  onContextMenu={c.menu ? (e) => { e.preventDefault(); e.stopPropagation(); openMenu(at(e), c.menu!()); } : undefined}>
                  <span className="crumb-t" title={c.label}>{c.label}</span>
                </button>
                {c.menu && (
                  <button type="button" className="crumb-sep crumb-sep-b" aria-label={t("Other pages")} title={t("Other pages")}
                    aria-haspopup="menu" aria-expanded={menuOf === `crumb:${c.key}`}
                    onClick={(e) => openFrom(`crumb:${c.key}`, e.currentTarget, c.menu!())}><Icon name={last ? "down" : "chevron"} /></button>
                )}
                {!c.menu && !last && <Icon name="chevron" className="crumb-sep" />}
              </span>
            );
          })}
        </nav>
        <span className="sp" data-tauri-drag-region><Glyphs run /></span>
      </div>

      <button key={introN} type="button" className="tb-search intro" onClick={() => openPalette()} title={t("Search pages, mods, characters, settings and actions (Ctrl+K, or just start typing)")}>
        <Icon name="search" /><span className="tb-search-t">{t("Search anything")}</span><kbd className="kbd">Ctrl K</kbd>
      </button>

      <div className="tb-side tb-r" data-tauri-drag-region>
        <Activity />
        <span className="tb-nav">
          <button type="button" className="tb-k" disabled={!hist.canUndo} aria-label={t("Undo")}
            title={nextUndo ? t("Undo: {what} (Ctrl+Z). Right-click for more", { what: nextUndo.label }) : t("Nothing to undo (Ctrl+Z)")}
            onClick={() => void undo()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(at(e), undoMenu()); }}><Icon name="undo" /></button>
          <button type="button" className="tb-k" disabled={!hist.canRedo} aria-label={t("Redo")}
            title={nextRedo ? t("Redo: {what} (Ctrl+Y). Right-click for more", { what: nextRedo.label }) : t("Nothing to redo (Ctrl+Y)")}
            onClick={() => void redo()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(at(e), redoMenu()); }}><Icon name="redo" /></button>
        </span>
        <button type="button" className="tb-k tb-help" aria-label={t("Help")} title={t("Help: shortcuts and feedback (? for shortcuts)")}
          aria-haspopup="menu" aria-expanded={menuOf === "help"}
          onClick={(e) => openFrom("help", e.currentTarget, helpMenu())}><Icon name="help" /></button>

        <span className="winkeys">
          <button type="button" className="wk" aria-label={t("Minimise")} onClick={() => void windowAction("minimize")}><Icon name="minus" /></button>
          <button type="button" className="wk" aria-label={t("Maximise")} onClick={() => void windowAction("toggleMaximize")}><Icon name="max" /></button>
          <button type="button" className="wk wk-x" aria-label={t("Close")} onClick={() => { if (inTauri()) void windowAction("close"); }}><Icon name="x" /></button>
        </span>
      </div>
    </header>
  );
}
