// Settings (global), for changing one thing fast: a list of sections on the left, every setting in the global search
// (settingsSearch.ts), every change saved at once. A section or a single setting is a route:
// go({ view: "settings", section: "storage" }) or section: "set-trash-days". Owner: SETTINGS/AI area.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Badge, Button, PageHeader, Panel, Select, Toggle } from "../../ui/kit";
import { GameBadge } from "../../ui/GameBadge";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { about, app, dialogs, errorText, games, integrations, settings, shell, xxmi, type GameId, type GameState, type Integration, type XxmiStatus } from "../../lib/api";
import { gameMeta } from "../../lib/games";
import { consumeRoute, refreshGames, setGames, useGames, useOnlyGame, useRoute } from "../../lib/store";
import { focusGame } from "../../shell/commands";
import { useAiShow } from "../../lib/ai";
import { openKofi } from "../../lib/support";
import { scrollToElement } from "../../lib/smoothScroll";
import "./settings.css";
import { AccountSection } from "./AccountSection";
import { HotkeysSection } from "./HotkeysSection";
import { TransferSection, UpdateRow } from "./SettingsTransfer";
import { AppearanceSection, CustomThemesSection } from "./Appearance";
import { AutomaticSection, CreatorsSection, ModsSection, StorageSection } from "./Sections";
import { AiSection } from "./AiSection";
import { ExtensionsSection } from "../extensions/ExtensionsSection";
import { SECTIONS, sectionOf } from "./settingsSearch";
import { SetRow, openXxmi, useSetting } from "./parts";
import { FunSection } from "./FunSection";
import { AdminRow, FeedbackSection } from "./Feedback";

export { SetRow, openXxmi, useSetting };

export const XXMI_RELEASES = "https://github.com/SpectrumQT/XXMI-Launcher/releases";


export function Settings() {
  const route = useRoute();
  const aiShow = useAiShow();
  const [active, setActive] = useState(SECTIONS[0]!.id);
  const [present, setPresent] = useState<string[]>(SECTIONS.map((s) => s.id));
  const main = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);

  // the section list sticks just under the page header (its height differs per theme) and only scrolls when the
  // window is too short to show all of it
  useLayoutEffect(() => {
    const el = nav.current;
    const view = el?.closest(".view") as HTMLElement | null;
    const head = view?.querySelector(".page-h") as HTMLElement | null;
    if (!el || !view) return;
    const fit = () => {
      if (getComputedStyle(el).position !== "sticky") return;
      // stick where it starts (below the header), so scrolling the page never moves it at all
      const h = head && getComputedStyle(head).position === "sticky" ? head.offsetHeight : 0;
      const start = el.parentElement!.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
      const top = Math.max(h + 8, Math.round(start));
      el.style.top = `${top}px`;
      el.style.maxHeight = `${view.clientHeight - top - 8}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(view);
    if (head) ro.observe(head);
    return () => ro.disconnect();
  }, []);

  // scroll to a section or a single setting, mark its section in the list and light it up once it gets there.
  // Sections near the end can't reach the top of the page, so without the highlight it isn't clear which one it was.
  const pinned = useRef(false);
  const reveals = useRef(0);
  const reveal = useCallback((id: string) => {
    const el = document.getElementById(id) ?? document.getElementById(sectionOf(id) ?? "");
    const view = el?.closest<HTMLElement>(".view");
    if (!el || !view) return;
    const row = el.id.startsWith("set-");
    const section = row ? sectionOf(el.id) : el.id;
    if (section) setActive(section);
    pinned.current = true;
    const n = ++reveals.current;
    scrollToElement(view, el, row ? "center" : "start", () => {
      if (reveals.current !== n) return;
      pinned.current = false;
      const cls = row ? "set-flash" : "set-ring";
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    });
  }, []);

  // a section or a single setting from the route. A row whose data is still loading may not be there on the first
  // frame, so it waits a moment for it before settling for its section.
  useEffect(() => {
    const id = route.section;
    if (!id) return;
    const t0 = performance.now();
    let raf = 0;
    const go = () => {
      if (!document.getElementById(id) && performance.now() - t0 < 400) { raf = requestAnimationFrame(go); return; }
      reveal(id);
      consumeRoute(["section"]);
    };
    raf = requestAnimationFrame(go);
    return () => cancelAnimationFrame(raf);
  }, [route.section, reveal]);

  // sections that render nothing (a part still being built) stay out of the list
  useEffect(() => {
    const check = () => setPresent(SECTIONS.map((s) => s.id).filter((id) => { const el = document.getElementById(id); return !!el && el.childElementCount > 0; }));
    check();
    const t = window.setTimeout(check, 800);
    return () => window.clearTimeout(t);
  }, [aiShow]);

  // the section in view is the one marked in the list (except while scrolling to one that was picked)
  useEffect(() => {
    const root = main.current?.closest(".view") ?? null;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = SECTIONS.find((s) => seen.get(s.id));
      if (first && !pinned.current) setActive(first.id);
    }, { root, rootMargin: "0px 0px -65% 0px" });
    for (const s of SECTIONS) { const el = document.getElementById(s.id); if (el) io.observe(el); }
    return () => io.disconnect();
  }, [present]);

  return (
    <div className="page settings">
      <PageHeader title="Settings" icon="settings" />
      <div className="set-layout">
        <nav ref={nav} className="set-nav" aria-label="Settings sections">
          {SECTIONS.filter((s) => present.includes(s.id)).map((s) => (
            <button key={s.id} type="button" className={`set-nav-i${active === s.id ? " on" : ""}`} onClick={() => reveal(s.id)} aria-current={active === s.id ? "true" : undefined}>
              <Icon name={s.icon} /><span>{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="set-main" ref={main}>
          <GamesSection />
          <XxmiSection />
          <IntegrationsSection />
          <AppearanceSection />
          <CustomThemesSection />
          <ExtensionsSection />
          <ModsSection />
          <AutomaticSection />
          <StorageSection />
          <CreatorsSection />
          <HotkeysSection />
          <div className="set-ext" id="account"><AccountSection /></div>
          <AiSection />
          <TransferSection />
          <FunSection />
          <FeedbackSection />
          <AboutSection />
        </div>
      </div>
    </div>
  );
}

// ── games ──

function GamesSection() {
  const list = useGames();
  const [busy, setBusy] = useState(false);
  const detect = async () => {
    setBusy(true);
    try {
      const before = list.filter((g) => g.modsDir).length;
      const after = (await refreshGames(true)).filter((g) => g.modsDir).length;
      toast(after > before ? `Found ${after - before} more` : "Nothing new found");
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };
  const xxmiGames = list.filter((g) => g.xxmi);
  const community = list.filter((g) => !g.xxmi);
  return (
    <Panel title="Games" icon="controller" id="games" actions={<Button icon="search" busy={busy} onClick={() => void detect()} title="Look for XXMI Launcher and game folders again">Detect again</Button>}>
      <OnlyGameRow list={list} />
      <AdminRow />
      <div className="set-games">{xxmiGames.map((g) => <GameRow key={g.id} game={g} />)}</div>
      {community.length > 0 && <>
        <h3 className="sub-h" id="set-community">Community games</h3>
        <p className="hint set-note" title="3DMigoto is the program that loads mods into the game. XXMI Launcher bundles one per game for the games above">
          XXMI Launcher doesn't support these. Each needs its own 3DMigoto loader: get it from the link, then pick its folder (the one with d3dx.ini). Installing, turning mods on and off, profiles and Browse work the same.</p>
        <div className="set-games">{community.map((g) => <GameRow key={g.id} game={g} />)}</div>
      </>}
    </Panel>
  );
}

/** One-game mode: pick the game you play, and the others stay out of the sidebar and menus. */
function OnlyGameRow({ list }: { list: GameState[] }) {
  const only = useOnlyGame();
  const shown = list.filter((g) => g.shown);
  if (shown.length < 2 && !only) return null;
  return (
    <div className="set-rows">
      <SetRow id="set-only-game" label="One-game mode" hint="Only this game shows in the sidebar and menus. The others stay set up, and search still finds them">
        <Select value={only?.id ?? ""} onChange={(v) => focusGame(v ? (v as GameId) : null)}
          options={[{ value: "", label: "Off" }, ...shown.map((g) => ({ value: g.id, label: g.name }))]} />
      </SetRow>
    </div>
  );
}

function GameRow({ game }: { game: GameState }) {
  const meta = gameMeta(game.id);
  const change = async (field: "gameDir" | "importerDir" | "modsDir") => {
    try {
      const picked = await dialogs.pickFolder(field === "gameDir" ? `${game.name}'s game folder` : field === "importerDir" ? `${game.name}'s mod loader folder (holds d3dx.ini)` : `${game.name}'s Mods folder`);
      if (!picked) { if (!("__TAURI_INTERNALS__" in window)) toast("Picking folders works in the app"); return; }
      const next = {
        gameDir: game.gameDir, importerDir: game.importerDir, modsDir: game.modsDir, viaXxmi: game.viaXxmi,
        [field]: picked,
        ...(field === "importerDir" ? { modsDir: null, viaXxmi: false } : {}),
      };
      setGames(await games.setPaths(game.id, next));
      toast(`Saved ${game.short}'s folder`);
    } catch (e) { toast(errorText(e), true); }
  };
  const show = async (v: boolean) => {
    try { setGames(await games.setShown(game.id, v)); } catch (e) { toast(errorText(e), true); }
  };
  const folder = (label: string, path: string | null, field: "gameDir" | "importerDir" | "modsDir", tip: string) => (
    <div className="set-folder">
      <span className="set-folder-l" title={tip}>{label}</span>
      {path
        ? <button type="button" className="set-folder-p mono" title={`Open ${path}`} onClick={() => shell.openPath(path).catch((e) => toast(errorText(e), true))}>{path}</button>
        : <span className="set-folder-p hint">Not set</span>}
      <Button size="sm" variant="ghost" onClick={() => void change(field)} title={`Pick the ${label.toLowerCase()} folder`}>{path ? "Change" : "Set"}</Button>
    </div>
  );
  // what's different for this game, said once and plainly
  const notes: string[] = [];
  if (!game.gbCharacterCategory) notes.push(`GameBanana has no character categories for ${game.short}, so its mods aren't sorted by character. Set a mod's character yourself in its details.`);
  return (
    <div className={`set-game${game.shown ? " shown" : ""}`} style={{ "--g-accent": game.accent } as CSSProperties}>
      <GameBadge game={game} size={40} />
      <div className="set-game-main">
        <div className="set-game-h">
          <b>{game.name}</b>
          {game.viaXxmi && <Badge tone="accent">{game.importer} via XXMI</Badge>}
          {!game.viaXxmi && game.importerDir && <Badge>{game.importer}</Badge>}
          {game.running && <Badge tone="ok">Running</Badge>}
          {game.modCount > 0 && <span className="hint">{game.enabledCount}/{game.modCount} mods on</span>}
        </div>
        {folder("Game", game.gameDir, "gameDir", "Where the game's exe is")}
        {folder("Mod loader", game.importerDir, "importerDir", "The folder with d3dx.ini and Mods")}
        {game.modsDir && game.importerDir && game.modsDir.toLowerCase() !== `${game.importerDir}\\Mods`.toLowerCase() && folder("Mods", game.modsDir, "modsDir", "Where mods live")}
        {notes.map((n) => <span key={n} className="hint set-game-note">{n}</span>)}
        {!game.xxmi && !game.importerDir && meta.loader && (
          <span className="row"><Button size="sm" variant="ghost" icon="external" onClick={() => shell.openUrl(meta.loader!.url).catch((e) => toast(errorText(e), true))}>{meta.loader.label}</Button></span>
        )}
      </div>
      <Toggle checked={game.shown} onChange={(v) => void show(v)} label="Show" hint="In the sidebar" />
    </div>
  );
}

// ── XXMI ──

function XxmiSection() {
  const [st, setSt] = useState<XxmiStatus | null>(null);
  const [root, setRoot] = useState("");
  const load = useCallback(() => {
    xxmi.status().then(setSt).catch((e) => toast(errorText(e), true));
    settings.get("xxmi.root").then((v) => setRoot(v ?? "")).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const pick = async () => {
    try {
      const p = await dialogs.pickFolder("XXMI Launcher's folder (holds XXMI Launcher Config.json)");
      if (!p) return;
      await settings.set("xxmi.root", p);
      load();
      await refreshGames(true);
    } catch (e) { toast(errorText(e), true); }
  };
  const reset = async () => {
    try { await settings.set("xxmi.root", ""); load(); await refreshGames(true); } catch (e) { toast(errorText(e), true); }
  };
  const update = st?.version && st.latest && st.version !== st.latest;

  return (
    <Panel title="XXMI Launcher" icon="package" id="xxmi">
      {!st ? <p className="hint">Looking…</p> : !st.found ? (
        <div className="set-xxmi-missing">
          <p>XXMI Launcher loads mods into Genshin Impact, Star Rail, Zenless Zone Zero, Wuthering Waves, Honkai Impact 3rd and Endfield. gachamod starts games through it.</p>
          <div className="row">
            <Button variant="primary" icon="external" onClick={() => shell.openUrl(XXMI_RELEASES).catch((e) => toast(errorText(e), true))}>Get XXMI Launcher</Button>
            <Button onClick={() => void pick()} title="Pick the folder XXMI Launcher is in">It's in another folder</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="set-kv">
            <span className="muted">Version</span>
            <span>{st.version ?? "Unknown"}{update && <> <Badge tone="info">{st.latest} available</Badge></>}{st.running && <> <Badge tone="ok">Open</Badge></>}</span>
            <span className="muted">Folder</span>
            <span className="mono set-path">{st.root}</span>
          </div>
          <div className="set-importers">
            {st.importers.filter((i) => i.deployedVersion || i.importerDir && i.enabled).map((i) => (
              <span key={i.code} className="set-importer" title={i.importerDir ?? ""}>
                <b>{i.code}</b> {i.deployedVersion ?? "not installed"}
                {i.latestVersion && i.deployedVersion && i.latestVersion !== i.deployedVersion && <Badge tone="info">{i.latestVersion}</Badge>}
              </span>
            ))}
          </div>
          <div className="row">
            <Button icon="external" onClick={openXxmi}>Open XXMI Launcher</Button>
            <Button variant="ghost" onClick={() => void pick()} title="For a portable copy of XXMI Launcher">Use another folder</Button>
            {root && <Button variant="ghost" onClick={() => void reset()} title="Look for XXMI Launcher where its installer puts it">Use the usual folder</Button>}
          </div>
        </>
      )}
    </Panel>
  );
}

// ── links and files ──

/** Per integration: the row id, what it does when on, and the toasts. */
const LINKS: Record<string, { row: string; on: string; toastOn: string; toastOff: string }> = {
  "scheme:gachamod": { row: "set-links", on: "GameBanana's 1-click install buttons send mods here",
    toastOn: "1-click installs open in gachamod", toastOff: "1-click installs no longer open gachamod" },
  "file:.gachamod": { row: "set-files", on: "Double-clicking a mod pack opens it here",
    toastOn: ".gachamod files open in gachamod", toastOff: ".gachamod files no longer open gachamod" },
};

function IntegrationsSection() {
  const [list, setList] = useState<Integration[] | null>(null);
  useEffect(() => { integrations.get().then(setList).catch(() => setList([])); }, []);
  const set = async (i: Integration, on: boolean) => {
    const t = LINKS[i.id];
    try { setList(await integrations.set(i.id, on)); toast(on ? t?.toastOn ?? "Turned on" : t?.toastOff ?? "Turned off"); }
    catch (e) { toast(errorText(e), true); }
  };
  return (
    <Panel title="Links and files" icon="link" id="integrations">
      <div className="set-rows">
        {list === null && <p className="hint">Checking…</p>}
        {list?.length === 0 && <p className="hint">Only available in the Windows app.</p>}
        {list?.map((i) => (
          <SetRow key={i.id} id={LINKS[i.id]?.row} label={i.label}
            hint={i.ours ? LINKS[i.id]?.on : i.owner ? `${i.owner} has these now. Turn on to take them back` : "Off"}>
            <Toggle checked={i.ours} disabled={!i.supported} onChange={(v) => void set(i, v)} />
          </SetRow>
        ))}
      </div>
    </Panel>
  );
}

// ── about ──

function AboutSection() {
  const [version, setVersion] = useState("");
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    app.info().then((i) => setVersion(i.version)).catch(() => {});
    about.dataDir().then(setDir).catch(() => {});
  }, []);
  return (
    <Panel title="About" icon="info" id="about">
      <div className="set-kv">
        <span className="muted">Version</span><span>gachamod {version}</span>
        <span className="muted">Data folder</span>
        <span>{dir ? <button type="button" className="set-folder-p mono" onClick={() => shell.openPath(dir).catch((e) => toast(errorText(e), true))} title="Open it">{dir}</button> : "…"}</span>
      </div>
      <UpdateRow />
      <div className="set-rows set-update">
        <div className="set-row">
          <span><b>Tip jar</b><span className="hint">gachamod is free and has no ads. If it saves you some time, a tip on Ko-fi helps keep it going</span></span>
          <Button size="sm" icon="coffee" onClick={openKofi} title="Opens ko-fi.com/aanimal in your browser">Tip on Ko-fi</Button>
        </div>
      </div>
      <p className="hint set-note">Mods and previews come from GameBanana. XXMI Launcher and the model importers are separate projects by their own authors.
        Fonts: Manrope, Rubik, Anton and JetBrains Mono, under the SIL Open Font License.</p>
    </Panel>
  );
}
