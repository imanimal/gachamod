// The shell: title bar, game rail, sidebar (player card, profile switch, views, Play), the current screen, and the
// app-wide layers (each area's overlays, drop zone, toasts, shortcuts). Owner: skeleton. Areas own the components it
// imports from screens/* (docs/spec.md, "Areas").
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "./ui/Icon";
import { Dialog, IconButton } from "./ui/kit";
import { Toasts, toast } from "./ui/toast";
import { GameBadge } from "./ui/GameBadge";
import { DropZone } from "./ui/DropZone";
import { Backdrop, Glyphs, SideDeco } from "./ui/Deco";
import { app as appApi, games as gamesApi, settings as settingsApi } from "./lib/api";
import { held, inTauri, windowAction } from "./lib/tauri";
import { currentGame, emitApp, go, patchGame, refreshGames, setGame, useBadges, useGame, useGames, useRoute, useShownGames, VIEWS, type View } from "./lib/store";
import { applyGameTheme, watchSystemScheme } from "./lib/theme";
import { warmUp } from "./lib/warmup";
import { SHORTCUTS, installKeys } from "./lib/keys";
import { installGamepad } from "./lib/gamepad";
import { installUndoKeys } from "./lib/history";
import { applyTextSize, installZoomKeys } from "./lib/zoom";
import { Home } from "./screens/home/Home";
import { PlayButton } from "./screens/home/PlayButton";
import { PlayerCard } from "./screens/home/PlayerCard";
import { Library } from "./screens/library/Library";
import { Characters } from "./screens/characters/Characters";
import { Browse } from "./screens/browse/Browse";
import { Downloads } from "./screens/downloads/Downloads";
import { OnlineOverlays } from "./screens/browse/OnlineOverlays";
import { Profiles } from "./screens/profiles/Profiles";
import { ProfileSwitch } from "./screens/profiles/ProfileSwitch";
import { Tools } from "./screens/tools/Tools";
import { Settings } from "./screens/settings/Settings";
import { Onboarding } from "./screens/settings/Onboarding";
import { ModtoolsOverlays } from "./screens/modtools/ModtoolsOverlays";

const NAV: Array<{ id: View; label: string; icon: IconName }> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "library", label: "Mods", icon: "mods" },
  { id: "characters", label: "Characters", icon: "characters" },
  { id: "browse", label: "Browse", icon: "browse" },
  { id: "downloads", label: "Downloads", icon: "downloads" },
  { id: "profiles", label: "Profiles", icon: "profiles" },
  { id: "tools", label: "Tools", icon: "tools" },
];

export function App() {
  const games = useGames();
  const shown = useShownGames();
  const game = useGame();
  const route = useRoute();
  const badges = useBadges();
  const [help, setHelp] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [onboard, setOnboard] = useState(false);

  // games: the saved list at once, then a detection pass on first start (and whenever nothing is set up)
  useEffect(() => {
    refreshGames().then((list) => {
      setLoaded(true);
      if (!list.some((g) => g.modsDir)) setOnboard(true);
      else settingsApi.get("onboarded").then((v) => { if (v !== "1") setOnboard(true); }).catch(() => {});
    }).catch((e) => { setLoaded(true); toast(String((e as { message?: string }).message ?? e), true); });
  }, []);

  // the current game's theme
  useEffect(() => { applyGameTheme(game); }, [game?.id, game?.theme, game?.accent]);
  useEffect(() => watchSystemScheme(currentGame), []);

  // first open of a game this session: its character list and a scan, in the background
  useEffect(() => { if (game) void warmUp(game); }, [game?.id, game?.modsDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // a game starting or stopping
  useEffect(() => held(gamesApi.onState((p) => patchGame(p.game, { running: p.running }))), []);

  // links and files the app was started with or handed later
  useEffect(() => {
    const route = (o: { kind: "link"; url: string } | { kind: "file"; path: string }) => {
      if (o.kind === "file") emitApp({ type: "open-pack", path: o.path });
      else emitApp({ type: "open-gb-link", url: o.url });
    };
    appApi.startupOpened().then((list) => list.forEach(route)).catch(() => {});
    const offs = [
      held(appApi.onDeepLink((p) => route({ kind: "link", url: p.url }))),
      held(appApi.onOpenFile((p) => route({ kind: "file", path: p.path }))),
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

  // keys, controller, undo, text size
  useEffect(() => {
    const views = [...NAV.map((n) => n.id), "settings" as View];
    const nextGame = (d: number) => {
      const list = shownRef.current;
      const i = list.findIndex((g) => g.id === currentGame()?.id);
      const n = list[(i + d + list.length) % list.length];
      if (n) setGame(n.id);
    };
    const play = () => (document.querySelector(".side .play-btn button, .side .play-btn") as HTMLElement | null)?.click();
    const back = () => window.dispatchEvent(new Event("gm-back"));
    const offKeys = installKeys({ views, go: (v) => go(v as View), help: () => setHelp((h) => !h), back, nextGame, play });
    const offPad = installGamepad({
      nextView: (d) => { const cur = VIEWS.indexOf(routeRef.current); go(VIEWS[(cur + d + VIEWS.length) % VIEWS.length]!); },
      help: () => setHelp((h) => !h), back, play,
    });
    const offUndo = installUndoKeys();
    applyTextSize();
    const offZoom = installZoomKeys((px) => toast(`Text size ${px}px (Ctrl+0 resets)`));
    return () => { offKeys(); offPad(); offUndo(); offZoom(); };
  }, []);
  const shownRef = useLatest(shown);
  const routeRef = useLatest(route.view);

  const view = route.view;
  const screen = !game && view !== "settings" ? <NoGame loaded={loaded} />
    : view === "home" ? <Home />
    : view === "library" ? <Library />
    : view === "characters" ? <Characters />
    : view === "browse" ? <Browse />
    : view === "downloads" ? <Downloads />
    : view === "profiles" ? <Profiles />
    : view === "tools" ? <Tools />
    : <Settings />;

  return (
    <div className="app">
      <Backdrop game={game} />
      <header className="titlebar" data-tauri-drag-region onDoubleClick={(e) => { if (e.target === e.currentTarget) void windowAction("toggleMaximize"); }}>
        <span className="brand" data-tauri-drag-region><span className="brand-mark" aria-hidden="true" /><span className="brand-t">gachamod</span></span>
        <span className="crumb" data-tauri-drag-region>
          {game && <span className="crumb-game">{game.name}</span>}
          <span className="crumb-view">{view === "settings" ? "Settings" : NAV.find((n) => n.id === view)?.label}</span>
        </span>
        <span className="sp" data-tauri-drag-region><Glyphs run /></span>
        <IconButton icon="keyboard" label="Shortcuts (?)" size="sm" onClick={() => setHelp(true)} />
        <span className="winkeys">
          <button type="button" className="wk" aria-label="Minimise" onClick={() => void windowAction("minimize")}><Icon name="minus" /></button>
          <button type="button" className="wk" aria-label="Maximise" onClick={() => void windowAction("toggleMaximize")}><Icon name="max" /></button>
          <button type="button" className="wk wk-x" aria-label="Close" onClick={() => { if (inTauri()) void windowAction("close"); }}><Icon name="x" /></button>
        </span>
      </header>

      <nav className="rail" aria-label="Games">
        <div className="rail-games">
          {shown.map((g, i) => (
            <button key={g.id} type="button" className={`rail-g${g.id === game?.id ? " on" : ""}${g.running ? " running" : ""}`}
              title={`${g.name}${i < 9 ? ` (Ctrl+Tab to switch)` : ""}`} aria-pressed={g.id === game?.id} onClick={() => setGame(g.id)}
              style={{ "--g-accent": g.accent } as CSSProperties}>
              <GameBadge game={g} size={44} />
            </button>
          ))}
          <button type="button" className="rail-add" title="Add a game" aria-label="Add a game" onClick={() => go({ view: "settings", section: "games" })}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="rail-foot">
          <button type="button" className={`rail-k${view === "settings" ? " on" : ""}`} title="Settings (Ctrl+8)" aria-label="Settings" onClick={() => go("settings")}><Icon name="settings" /></button>
        </div>
      </nav>

      <aside className="side" aria-label="Views">
        <PlayerCard />
        {game && <ProfileSwitch />}
        <div className="side-nav">
          {NAV.map((n, i) => {
            const b = badges[n.id];
            return (
              <button key={n.id} type="button" className={`nv${view === n.id ? " on" : ""}`} onClick={() => go(n.id)} title={`${n.label} (Ctrl+${i + 1})`} disabled={!game}>
                <Icon name={n.icon} /><span className="nv-t">{n.label}</span>
                {b && <span className={`nv-b t-${b.tone ?? "accent"}`}>{b.count ? b.count : ""}</span>}
              </button>
            );
          })}
        </div>
        <SideDeco game={game} />
        <div className="side-foot">{game && <PlayButton />}</div>
      </aside>

      <main className="view" key={`${game?.id}-${view}`}>{screen}</main>

      {games.length > 0 && <OnlineOverlays />}
      {games.length > 0 && <ModtoolsOverlays />}
      {onboard && <Onboarding onDone={() => setOnboard(false)} />}
      <DropZone />
      {help && (
        <Dialog icon="keyboard" title="Shortcuts" onClose={() => setHelp(false)}>
          <div className="keys-list">{SHORTCUTS.map(([k, what]) => <div key={k}><kbd>{k}</kbd><span>{what}</span></div>)}</div>
          <h3 className="sub-h">Controller</h3>
          <div className="keys-list">
            {[["D-pad, left stick", "Move between buttons"], ["A", "Press"], ["B", "Back, close"], ["X", "The focused mod's main action"], ["Y", "Find"],
              ["LB, RB", "Previous, next view"], ["LT, RT, right stick", "Scroll"], ["View", "This list"], ["Menu", "Play"]].map(([k, what]) => <div key={k}><kbd>{k}</kbd><span>{what}</span></div>)}
          </div>
        </Dialog>
      )}
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
