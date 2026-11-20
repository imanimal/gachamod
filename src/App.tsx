// The shell: title bar, sidebar, the current screen, and the app-wide layers (each area's overlays, the right-click
// menu, the command palette, the AI helper, drop zone, toasts, shortcuts). Owner: SHELL area. Areas own the
// components it imports from screens/* (docs/spec.md, "Areas").
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog, Waiting } from "./ui/kit";
import { Toasts, toast } from "./ui/toast";
import { DropZone } from "./ui/DropZone";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Backdrop } from "./ui/Deco";
import { ContextMenuHost, menuForFocus } from "./ui/ContextMenu";
import { about as aboutApi, app as appApi, appUpdate, errorText, games as gamesApi, queue as queueApi, settings as settingsApi, shell as shellApi, type GoEvent, type Opened } from "./lib/api";
import { held } from "./lib/tauri";
import { reviewUnsurePref } from "./screens/settings/automatic";
import { allGames, back, currentGame, emitApp, forward, go, onRoute, currentRoute, patchGame, refreshGames, setGame, setOnlyGame, takeRestoreScroll, useDailyGames, useGame, useGames, useNav, useRoute, type View } from "./lib/store";
import { applyGameTheme, setThemePick, themePick, watchSystemScheme } from "./lib/theme";
import { chillPref, HIDDEN_THEME, onKonami, watchKonamiKeys } from "./lib/fun";
import { Seasonal } from "./ui/Seasonal";
import { warmUp } from "./lib/warmup";
import { installKeys } from "./lib/keys";
import { installGamepad } from "./lib/gamepad";
import { installUndoKeys } from "./lib/history";
import { applyTextSize, applyZoom, installZoomKeys } from "./lib/zoom";
import { Titlebar } from "./shell/Titlebar";
import { Sidebar } from "./shell/Sidebar";
import { CommandPalette } from "./shell/CommandPalette";
import { CloseAsk } from "./shell/CloseAsk";
import { ShortcutGroups } from "./shell/Shortcuts";
import { installGlobalInput } from "./shell/globalInput";
import { introSearch, openPalette, setHelpOpen, toggleHelp, toggleSide, useHelpOpen, useSideCollapsed } from "./shell/state";
import { doneHint } from "./shell/hints";
import { KEY_VIEWS, viewLabel } from "./shell/names";
import "./shell/commands";
import { AiHost } from "./screens/ai/AiHost";
import { Home } from "./screens/home/Home";
import { Library } from "./screens/library/Library";
import { Characters } from "./screens/characters/Characters";
import { Browse } from "./screens/browse/Browse";
import { Downloads } from "./screens/downloads/Downloads";
import { OnlineOverlays } from "./screens/browse/OnlineOverlays";
import { Profiles } from "./screens/profiles/Profiles";
import { NewProfileHost } from "./screens/profiles/ProfileEditor";
import { Tools } from "./screens/tools/Tools";
import { Settings } from "./screens/settings/Settings";
import { Extensions } from "./screens/extensions/Extensions";
import { FormatIntro, SetupPage, setupDone, welcome } from "./screens/settings/Onboarding";
import { canInstallLoader, getReady, recheck, watchSetup } from "./lib/setup";
import { FeedbackHost } from "./screens/settings/Feedback";
import { GameCheckHost } from "./screens/settings/GameCheck";
import "./lib/elevation";
import "./lib/places";
import { ModtoolsOverlays } from "./screens/modtools/ModtoolsOverlays";
import { afterInstall } from "./screens/library/afterInstall";
import { watchKeyClashes } from "./screens/ingame/otherKeys";
import { installSmoothScroll } from "./lib/smoothScroll";
import { installModSubWatch } from "./lib/subscriptions";
import { followGame, isPlayLink, quickstart } from "./screens/home/quickstart";
import { splashReady } from "./splash/splash";
import { t } from "./lib/i18n";


export function App() {
  const games = useGames();
  const shown = useDailyGames();
  const game = useGame();
  const route = useRoute();
  const nav = useNav();
  const help = useHelpOpen();
  const collapsed = useSideCollapsed();
  const [loaded, setLoaded] = useState(false);
  // the first look for games is done (on a first start, or while no game is ready)
  const [looked, setLooked] = useState(false);
  // reading the saved games failed at start (shown on the setup page, apart from an empty list)
  const [startError, setStartError] = useState<string | null>(null);
  const ready = games.some((g) => g.modsDir);
  const sawSetup = useRef(false);
  const viewRef = useRef<HTMLElement>(null);

  // games: the saved list at once, then a detection pass on first start and whenever nothing is ready. No window:
  // a game that's ready opens straight away (welcome() says what was found), otherwise the setup page shows
  const start = useRef(async () => {
    let list: Awaited<ReturnType<typeof refreshGames>>;
    try { list = await refreshGames(); }
    catch (e) { setStartError(errorText(e)); setLoaded(true); setLooked(true); return; }
    setStartError(null);
    setLoaded(true);
    const first = (await settingsApi.get("onboarded").catch(() => null)) !== "1";
    // installed with a game's own setup (gachamod-setup-zzz.exe): start in one-game mode for that game
    const named = await aboutApi.setupGame().catch(() => null);
    if (first && named) {
      setOnlyGame(named);
      if (list.some((g) => g.id === named && g.shown)) setGame(named);
    }
    if (!first && list.some((g) => g.modsDir)) { setLooked(true); return; }
    const after = (await recheck(true)) ?? list;
    setLooked(true);
    if (after.some((g) => g.modsDir)) void welcome(after);
    introSearch();
  }).current;
  useEffect(() => { void start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // a later read that worked (Look again, the setup page's own checks) sets a new list: nothing is failing any more,
  // even when that list is empty
  useEffect(() => { setStartError(null); }, [games]);
  // the opening screen plays once the games are read and the first screen is drawn (splash/splash.ts)
  useEffect(() => { if (loaded) splashReady(); }, [loaded]);
  // the setup page made a game ready: that was the first start
  useEffect(() => {
    if (!ready && looked) sawSetup.current = true;
    if (ready && sawSetup.current) { sawSetup.current = false; setupDone(); }
  }, [ready, looked]);
  // a game in the sidebar without its Mods folder (or none ready): look again now and then (lib/setup.ts)
  useEffect(() => watchSetup(), []);
  // the first visit to Browse and Downloads ends their hints (shell/hints.ts)
  useEffect(() => onRoute(() => {
    const v = currentRoute().view;
    if (v === "browse") doneHint("browse");
    if (v === "downloads") doneHint("downloads");
  }), []);

  // the mouse wheel: which box a gesture scrolls, and notches that glide (lib/smoothScroll.ts)
  useEffect(() => installSmoothScroll(), []);
  useEffect(() => installModSubWatch(), []);

  // Settings, Fun extras: chill mode, and the Konami code, which reveals a hidden theme (lib/fun.ts)
  const chill = chillPref.use();
  useEffect(() => { if (chill) document.documentElement.dataset.chill = ""; else delete document.documentElement.dataset.chill; }, [chill]);
  useEffect(() => {
    onKonami((first) => {
      const g = currentGame();
      const use = g && themePick(g.id) !== HIDDEN_THEME ? { label: t("Use it"), run: () => setThemePick(g, HIDDEN_THEME) } : undefined;
      toast(first ? t("You found a hidden theme. It's in Settings, Appearance now") : t("Still there, in Settings, Appearance"), false, use);
    });
    return watchKonamiKeys();
  }, []);

  // the current game's theme
  useEffect(() => { applyGameTheme(game); }, [game?.id, game?.theme, game?.accent]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => watchSystemScheme(currentGame), []);

  // first open of a game this session: its character list and a scan, in the background
  useEffect(() => { if (game) void warmUp(game); }, [game?.id, game?.modsDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // a game starting or stopping
  useEffect(() => held(gamesApi.onState((p) => { patchGame(p.game, { running: p.running }); })), []);
  // another app's key that is also gachamod's (Medal's screenshot key and the skin menu's): ask in a toast
  useEffect(() => (loaded ? watchKeyClashes() : undefined), [loaded]);

  // the tray icon's menu, in this language, for when gachamod runs in the background (src-tauri background.rs)
  useEffect(() => {
    settingsApi.set("tray.labels", JSON.stringify({ open: t("Open gachamod"), play: t("Quickstart"), quit: t("Quit gachamod") })).catch(() => {});
  }, []);

  // the quickstart shortcut starts the game open now, so its icon becomes that game's
  useEffect(() => { if (game) followGame(game.id); }, [game?.id]);

  // links and files the app was started with or handed later, and pages the menu over a game handed over
  useEffect(() => {
    const goTo = (p: GoEvent) => {
      if (currentGame()?.id !== p.game && allGames().some((g) => g.id === p.game)) setGame(p.game);
      if (p.route) go(p.route);
      if (p.ai) emitApp({ type: "ai", task: p.ai });
    };
    const open = (o: Opened) => {
      if (o.kind === "go") goTo(o);
      else if (o.kind === "link" && isPlayLink(o.url)) void quickstart(o.url);
      else if (o.kind === "link") emitApp({ type: "open-gb-link", url: o.url });
      else if (o.path.toLowerCase().endsWith(".gachamod")) emitApp({ type: "open-pack", path: o.path });
      else emitApp({ type: "install-paths", paths: [o.path] });
    };
    // asked once the listeners are in place: from then on the backend sends events instead of keeping them
    const listening = [
      appApi.onDeepLink((p) => open({ kind: "link", url: p.url })),
      appApi.onOpenFile((p) => open({ kind: "file", path: p.path })),
      // the menu over a game handed a page or an AI job to this window, which is in front now (overlay.rs)
      appApi.onGo(goTo),
    ];
    void Promise.allSettled(listening).then(() => appApi.startupOpened()).then((list) => list.forEach(open)).catch(() => {});
    const offs = [
      ...listening.map(held),
      held(appApi.onToast((p) => {
        const o = p.open;
        const review = p.review;
        if (review) {
          void reviewUnsurePref.ready.then(() => {
            if (!reviewUnsurePref.get()) return;
            toast(t("gachamod wasn't sure where some of this mod's files go. Check its folder against the mod's install steps"), false,
              { label: t("Review files"), run: () => { shellApi.openPath(review).catch((e) => toast(errorText(e), true)); } },
              { label: t("Don't show again"), run: () => void reviewUnsurePref.set(false, t("Stopped asking about files gachamod can't place"), true) });
          });
        }
        if (o && p.installed?.length) { void afterInstall(p.text, o.game, p.installed); return; }
        // nowhere to install: offer the loader (or a fresh look) and retry, not a dead end
        const f = p.failed, fg = f && allGames().find((g) => g.id === f.game);
        if (f && fg && !fg.modsDir) {
          toast(p.text, true, { label: canInstallLoader(fg) ? t("Install mod loader") : t("Find Mods folder"),
            run: () => void getReady(f.game).then((ok) => { if (ok) queueApi.retry(f.item).catch((e) => toast(errorText(e), true)); }) });
          return;
        }
        const show = f?.file ?? p.reveal;
        if (!o && show) {
          toast(p.text, !!p.bad, { label: f?.file ? t("Show file") : t("Show folder"), run: () => { shellApi.revealPath(show).catch((e) => toast(errorText(e), true)); } });
          return;
        }
        toast(p.text, !!p.bad, o ? { label: t("Open"), run: () => { if (currentGame()?.id !== o.game) setGame(o.game); go({ view: "library", modId: o.modId }); } } : undefined);
      })),
      // a newer gachamod downloaded in the background (commands/app.rs)
      held(appUpdate.onReady((p) => {
        toast(t("gachamod {version} is ready. It installs when you close gachamod", { version: p.version }), "info",
          { label: t("Restart now"), run: () => { appUpdate.install().catch((e) => toast(errorText(e), true)); } });
      })),
      // updates set to only tell: a newer gachamod is out, nothing downloaded
      held(appUpdate.onFound((p) => {
        toast(t("gachamod {version} is out", { version: p.version }), "info",
          { label: t("Update now"), run: () => { appUpdate.install().catch((e) => toast(errorText(e), true)); } },
          { label: t("View details"), run: () => go({ view: "settings", section: "updates" }) });
      })),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  // a GameBanana link pasted anywhere outside a field opens it in Browse
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const tg = e.target as HTMLElement | null;
      if (tg && (/^(INPUT|TEXTAREA)$/.test(tg.tagName) || tg.isContentEditable)) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (/gamebanana\.com\/(mods|mmdl|dl)\//i.test(text)) { e.preventDefault(); emitApp({ type: "open-gb-link", url: text.trim() }); }
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  }, []);

  // keys, controller, mouse, undo, text size
  useEffect(() => {
    const nextGame = (d: number) => {
      const list = shownRef.current;
      const i = list.findIndex((g) => g.id === currentGame()?.id);
      const n = list[(i + d + list.length) % list.length];
      if (n) setGame(n.id);
    };
    // Set up shares the play-btn class but installs things, so it never answers a shortcut
    const play = () => (document.querySelector(".side .play-btn:not(.play-setup)") as HTMLElement | null)?.click();
    const offKeys = installKeys({
      views: KEY_VIEWS, go: (v) => go(v as View), help: toggleHelp, back: () => back(), forward: () => forward(), nextGame, play,
      palette: (typed) => openPalette(typed, !!typed), sidebar: toggleSide, menu: menuForFocus,
    });
    const offPad = installGamepad({
      // the sidebar's order, the same as Ctrl+1 to Ctrl+8
      nextView: (d) => { const cur = KEY_VIEWS.indexOf(routeRef.current); go(KEY_VIEWS[cur < 0 ? (d > 0 ? 0 : KEY_VIEWS.length - 1) : (cur + d + KEY_VIEWS.length) % KEY_VIEWS.length]!); },
      nextGame, back: () => back(), play, menu: menuForFocus, palette: () => openPalette(),
    });
    const offMouse = installGlobalInput();
    const offUndo = installUndoKeys();
    applyTextSize();
    applyZoom();
    const offZoom = installZoomKeys();
    return () => { offKeys(); offPad(); offMouse(); offUndo(); offZoom(); };
  }, []);
  const shownRef = useLatest(shown);
  const routeRef = useLatest(route.view);

  // Back and Forward bring the page back where it was scrolled (screens load in steps, so try for a moment)
  useLayoutEffect(() => {
    const want = takeRestoreScroll();
    const el = viewRef.current;
    if (want === undefined || !el) return;
    let raf = 0;
    const until = performance.now() + 1200;
    const step = () => {
      el.style.scrollBehavior = "auto";
      el.scrollTop = want;
      el.style.scrollBehavior = "";
      if (Math.abs(el.scrollTop - want) > 2 && performance.now() < until) raf = requestAnimationFrame(step);
    };
    step();
    const stop = () => cancelAnimationFrame(raf);
    el.addEventListener("wheel", stop, { once: true, passive: true });
    return () => { stop(); el.removeEventListener("wheel", stop); };
  }, [nav.n]);

  // focus never drops to the page body: a new screen takes it (Tab starts there), and a focused control that goes away
  // (Attempt fix, Play anyway) hands it to the nearest one left
  const mainKey = `${game?.id}-${route.view}${route.ext ? `-${route.ext}` : ""}`;
  useLayoutEffect(() => {
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) viewRef.current?.focus({ preventScroll: true });
  }, [mainKey, route.character, nav.n]);
  useEffect(() => keepFocus(), []);

  const view = route.view;
  const screen = !loaded ? <Waiting className="nogame" what={t("Reading your games")} />
    : !ready && view !== "settings" && view !== "extensions" ? <SetupPage looking={!looked} error={startError} retry={start} />
    : view === "home" ? <Home />
    : view === "library" ? <Library />
    : view === "characters" ? <Characters />
    : view === "browse" ? <Browse />
    : view === "downloads" ? <Downloads />
    : view === "profiles" ? <Profiles />
    : view === "tools" ? <Tools />
    : view === "extensions" ? <Extensions />
    : <Settings />;

  // quiet parts that failed come back when the page changes
  const navKey = `${mainKey}-${nav.n}`;
  // the last resort: the feedback form and toasts go down with the window, so its page brings its own
  const lastResort = <><ErrorBoundary where={t("Feedback")} quiet><FeedbackHost /></ErrorBoundary><Toasts /></>;

  return (
    <ErrorBoundary where="gachamod" whole extra={lastResort}>
    <div className="app" data-side={collapsed ? "rail" : "full"}>
      <Backdrop game={game} />
      <ErrorBoundary where={t("Title bar")} slot="titlebar" windowKeys resetKey={navKey}><Titlebar /></ErrorBoundary>
      <ErrorBoundary where={t("Sidebar")} slot="side" resetKey={navKey}><Sidebar /></ErrorBoundary>

      <main ref={viewRef} className="view" key={mainKey} tabIndex={-1} style={{ outline: "none" }}>
        <ErrorBoundary where={viewLabel(view, game?.id)}>{screen}</ErrorBoundary>
      </main>

      {games.length > 0 && <ErrorBoundary where={t("Online")} quiet resetKey={navKey}><OnlineOverlays /></ErrorBoundary>}
      {games.length > 0 && <ErrorBoundary where={t("Mod tools")} quiet resetKey={navKey}><ModtoolsOverlays /></ErrorBoundary>}
      {games.length > 0 && <ErrorBoundary where={t("Profiles")} quiet resetKey={navKey}><NewProfileHost /></ErrorBoundary>}
      <ErrorBoundary where={t("Feedback")} quiet resetKey={navKey}><FeedbackHost /></ErrorBoundary>
      <ErrorBoundary where={t("Check this game")} quiet resetKey={navKey}><GameCheckHost /></ErrorBoundary>
      <DropZone />
      <ErrorBoundary where={t("AI helper")} quiet resetKey={navKey}><AiHost /></ErrorBoundary>
      <ErrorBoundary where={t("Mods layout")} quiet resetKey={navKey}><FormatIntro /></ErrorBoundary>
      <CommandPalette />
      {help && (
        <Dialog icon="keyboard" title={t("Shortcuts")} onClose={() => setHelpOpen(false)}>
          <ShortcutGroups game={game?.id} />
        </Dialog>
      )}
      <Seasonal />
      <ContextMenuHost />
      <CloseAsk />
      <Toasts />
    </div>
    </ErrorBoundary>
  );
}

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const REGIONS = ".app > .view, .app > .side, .app > .titlebar";

/** When a focused control in the screen, sidebar or title bar is removed, focus the nearest control in the same place,
 *  preferring the one below it. Windows and menus hand focus back on their own, so they're left alone. */
function keepFocus() {
  let last: HTMLElement | null = null, region = "", at = { x: 0, y: 0 };
  const onIn = (e: FocusEvent) => {
    const tg = e.target as HTMLElement | null;
    const r = tg?.closest?.(REGIONS);
    if (!tg || !r || tg === r || tg.closest(".overlay, .popover, .ctx, [role='dialog']")) { last = null; return; }
    const b = tg.getBoundingClientRect();
    last = tg; region = r.classList.contains("view") ? ".app > .view" : r.classList.contains("side") ? ".app > .side" : ".app > .titlebar";
    at = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  };
  const check = () => {
    if (!last || last.isConnected) return;
    last = null;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    const root = document.querySelector<HTMLElement>(region);
    if (!root) return;
    let best: HTMLElement | null = null, score = Infinity;
    for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      const dx = b.left + b.width / 2 - at.x, dy = b.top + b.height / 2 - at.y;
      const s = Math.abs(dx) + Math.abs(dy) * 2 + (dy < -4 ? 400 : 0);
      if (s < score) { score = s; best = el; }
    }
    (best ?? (region === ".app > .view" ? root : null))?.focus({ preventScroll: true });
  };
  const obs = new MutationObserver(check);
  const app = document.querySelector(".app");
  if (app) obs.observe(app, { childList: true, subtree: true });
  document.addEventListener("focusin", onIn);
  return () => { obs.disconnect(); document.removeEventListener("focusin", onIn); };
}

function useLatest<T>(v: T) { const r = useRef(v); r.current = v; return r; }
