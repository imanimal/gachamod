// The shell: title bar, sidebar, the current screen, and the app-wide layers (each area's overlays, the right-click
// menu, the command palette, the AI helper, drop zone, toasts, shortcuts). Owner: SHELL area. Areas own the
// components it imports from screens/* (docs/spec.md, "Areas").
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./ui/Icon";
import { Dialog } from "./ui/kit";
import { Toasts, toast } from "./ui/toast";
import { DropZone } from "./ui/DropZone";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Backdrop } from "./ui/Deco";
import { ContextMenuHost, menuForFocus } from "./ui/ContextMenu";
import { app as appApi, games as gamesApi, settings as settingsApi } from "./lib/api";
import { held } from "./lib/tauri";
import { back, currentGame, emitApp, forward, go, patchGame, refreshGames, setGame, takeRestoreScroll, useDailyGames, useGame, useGames, useNav, useRoute, VIEWS, type View } from "./lib/store";
import { applyGameTheme, watchSystemScheme } from "./lib/theme";
import { warmUp } from "./lib/warmup";
import { PAD_SHORTCUTS, SHORTCUTS, installKeys } from "./lib/keys";
import { installGamepad } from "./lib/gamepad";
import { installUndoKeys } from "./lib/history";
import { applyTextSize, installZoomKeys } from "./lib/zoom";
import { Titlebar } from "./shell/Titlebar";
import { Sidebar } from "./shell/Sidebar";
import { CommandPalette } from "./shell/CommandPalette";
import { installGlobalInput } from "./shell/globalInput";
import { offerTour, openPalette, setHelpOpen, toggleHelp, toggleSide, useHelpOpen, useSideCollapsed } from "./shell/state";
import { Tour } from "./shell/Tour";
import { viewLabel } from "./shell/names";
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
import { Onboarding } from "./screens/settings/Onboarding";
import { ModtoolsOverlays } from "./screens/modtools/ModtoolsOverlays";
import { installSmoothScroll } from "./lib/smoothScroll";

/** Ctrl+1 … Ctrl+8, in the sidebar's order. */
const KEY_VIEWS: View[] = ["home", "library", "characters", "browse", "downloads", "profiles", "tools", "settings"];

export function App() {
  const games = useGames();
  const shown = useDailyGames();
  const game = useGame();
  const route = useRoute();
  const nav = useNav();
  const help = useHelpOpen();
  const collapsed = useSideCollapsed();
  const [loaded, setLoaded] = useState(false);
  const [onboard, setOnboard] = useState(false);
  const viewRef = useRef<HTMLElement>(null);

  // games: the saved list at once, then a detection pass on first start (and whenever nothing is set up)
  useEffect(() => {
    refreshGames().then((list) => {
      setLoaded(true);
      if (!list.some((g) => g.modsDir)) setOnboard(true);
      else settingsApi.get("onboarded").then((v) => { if (v !== "1") setOnboard(true); }).catch(() => {});
    }).catch((e) => { setLoaded(true); toast(String((e as { message?: string }).message ?? e), true); });
  }, []);

  // the mouse wheel glides instead of jumping (lib/smoothScroll.ts)
  useEffect(() => installSmoothScroll(), []);

  // the current game's theme
  useEffect(() => { applyGameTheme(game); }, [game?.id, game?.theme, game?.accent]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => watchSystemScheme(currentGame), []);

  // first open of a game this session: its character list and a scan, in the background
  useEffect(() => { if (game) void warmUp(game); }, [game?.id, game?.modsDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // a game starting or stopping
  useEffect(() => held(gamesApi.onState((p) => patchGame(p.game, { running: p.running }))), []);

  // links and files the app was started with or handed later
  useEffect(() => {
    const open = (o: { kind: "link"; url: string } | { kind: "file"; path: string }) => {
      if (o.kind === "file") emitApp({ type: "open-pack", path: o.path });
      else emitApp({ type: "open-gb-link", url: o.url });
    };
    appApi.startupOpened().then((list) => list.forEach(open)).catch(() => {});
    const offs = [
      held(appApi.onDeepLink((p) => open({ kind: "link", url: p.url }))),
      held(appApi.onOpenFile((p) => open({ kind: "file", path: p.path }))),
      held(appApi.onToast((p) => toast(p.text, !!p.bad))),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  // a GameBanana link pasted anywhere outside a field opens it in Browse
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
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
    const play = () => (document.querySelector(".side .play-btn") as HTMLElement | null)?.click();
    const offKeys = installKeys({
      views: KEY_VIEWS, go: (v) => go(v as View), help: toggleHelp, back: () => back(), forward: () => forward(), nextGame, play,
      palette: () => openPalette(), sidebar: toggleSide, menu: menuForFocus,
    });
    const offPad = installGamepad({
      nextView: (d) => { const cur = VIEWS.indexOf(routeRef.current); go(VIEWS[(cur + d + VIEWS.length) % VIEWS.length]!); },
      back: () => back(), play, menu: menuForFocus, palette: () => openPalette(),
    });
    const offMouse = installGlobalInput();
    const offUndo = installUndoKeys();
    applyTextSize();
    const offZoom = installZoomKeys((px) => toast(`Text size ${px}px (Ctrl+0 resets)`));
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

  const view = route.view;
  const screen = !game && view !== "settings" ? <NoGame loaded={loaded} />
    : view === "home" ? <Home />
    : view === "library" ? <Library />
    : view === "characters" ? <Characters />
    : view === "browse" ? <Browse />
    : view === "downloads" ? <Downloads />
    : view === "profiles" ? <Profiles />
    : view === "tools" ? <Tools />
    : view === "extensions" ? <Extensions />
    : <Settings />;

  return (
    <div className="app" data-side={collapsed ? "rail" : "full"}>
      <Backdrop game={game} />
      <Titlebar />
      <Sidebar />

      <main ref={viewRef} className="view" key={`${game?.id}-${view}${route.ext ? `-${route.ext}` : ""}`}>
        <ErrorBoundary where={viewLabel(view, game?.id)}>{screen}</ErrorBoundary>
      </main>

      {games.length > 0 && <ErrorBoundary where="Online" quiet><OnlineOverlays /></ErrorBoundary>}
      {games.length > 0 && <ErrorBoundary where="Mod tools" quiet><ModtoolsOverlays /></ErrorBoundary>}
      {games.length > 0 && <ErrorBoundary where="Profiles" quiet><NewProfileHost /></ErrorBoundary>}
      {onboard && <Onboarding onDone={() => { setOnboard(false); offerTour((text, action) => toast(text, false, action)); }} />}
      <DropZone />
      <ErrorBoundary where="AI helper" quiet><AiHost /></ErrorBoundary>
      <CommandPalette />
      {help && (
        <Dialog icon="keyboard" title="Shortcuts" onClose={() => setHelpOpen(false)}>
          <div className="keys-list">{SHORTCUTS.map(([k, what]) => <div key={k}><kbd>{k}</kbd><span>{what}</span></div>)}</div>
          <h3 className="sub-h">Controller</h3>
          <div className="keys-list">{PAD_SHORTCUTS.map(([k, what]) => <div key={k}><kbd>{k}</kbd><span>{what}</span></div>)}</div>
        </Dialog>
      )}
      <ContextMenuHost />
      <Tour />
      <Toasts />
    </div>
  );
}

function NoGame({ loaded }: { loaded: boolean }) {
  if (!loaded) return null;
  return (
    <div className="nogame">
      <h1>No game set up yet</h1>
      <p>gachamod looks for XXMI Launcher and your games on its own. If it found nothing, pick a game's Mods folder in Settings.</p>
      <button type="button" className="btn btn-primary btn-lg" onClick={() => go({ view: "settings", section: "games" })}><Icon name="settings" /><span className="btn-t">Set up a game</span></button>
    </div>
  );
}

function useLatest<T>(v: T) { const r = useRef(v); r.current = v; return r; }
