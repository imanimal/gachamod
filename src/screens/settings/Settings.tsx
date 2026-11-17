// Settings (global), for changing one thing fast: one page at a time, picked from a list in groups on the left
// (Paged.tsx), every setting in the global search (settingsSearch.ts), every change saved at once. A page, a panel on
// one or a single setting is a route: go({ view: "settings", section: "mods" }), "storage" or "set-trash-days".
// Page and panel names say what is in them ("About and updates", "Downloads and installing"): a panel holds one
// kind of setting, and a new kind gets its own panel with its own name rather than a row under a vague heading.
// Owner: SETTINGS/AI area.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Badge, Button, Confirm, PageHeader, Panel, Select, Toggle } from "../../ui/kit";
import { openPalette } from "../../shell/state";
import { GameBadge } from "../../ui/GameBadge";
import { toast } from "../../ui/toast";
import { about, app, dialogs, errorText, games, integrations, settings, shell, xxmi, type GameId, type GameState, type Integration, type XxmiStatus } from "../../lib/api";
import { gameMeta } from "../../lib/games";
import { refreshGames, setGames, useGames, useOnlyGame } from "../../lib/store";
import { focusGame } from "../../shell/commands";
import { openKofi } from "../../lib/support";
import { Paged } from "./Paged";
import "./settings.css";
import { AccountSection } from "./AccountSection";
import { HotkeysSection } from "./HotkeysSection";
import { TransferSection, UpdateRow } from "./SettingsTransfer";
import { AppearanceSection, CustomThemesSection, GraphicsSection, LayoutSection } from "./Appearance";
import { AdultSection, AutomaticSection, BrokenModsSection, CreatorsSection, InstallingSection, ModsSection, StorageSection } from "./Sections";
import { AiSection } from "./AiSection";
import { LaunchSections } from "./Launch";
import { ExtensionsSection } from "../extensions/ExtensionsSection";
import { PAGES, sectionOf } from "./settingsSearch";
import { SetRow, openXxmi, useSetting } from "./parts";
import { FunSection } from "./FunSection";
import { AdminRow, FeedbackSection, LogsSection, PrivacySection } from "./Feedback";
import { Installing, SetupError } from "./Onboarding";
import { canInstallLoader, getReady, installLoaders, pickModsFolder, recheck, useSetup } from "../../lib/setup";

export { SetRow, openXxmi, useSetting };

export const XXMI_RELEASES = "https://github.com/SpectrumQT/XXMI-Launcher/releases";


export function Settings() {
  return (
    <div className="page settings pg-screen">
      <PageHeader title="Settings" icon="settings"
        actions={<Button icon="search" onClick={() => openPalette()} title="Every setting is in the search (Ctrl+K, or just start typing)">Find a setting</Button>} />
      <Paged name="settings" label="Settings pages" pages={PAGES} fallback={sectionOf}>
        {{
          games: <><GamesSection /><XxmiSection /></>,
          launch: <><LaunchSections /><GameStartSection /></>,
          mods: <><ModsSection /><AdultSection /><ModFoldersSection /><InstallingSection /><AutomaticSection /><BrokenModsSection /><StorageSection /></>,
          creators: <CreatorsSection />,
          hotkeys: <HotkeysSection />,
          appearance: <><AppearanceSection /><LayoutSection /><CustomThemesSection /><GraphicsSection /></>,
          fun: <FunSection />,
          account: <><AccountSection /><IntegrationsSection /><AiSection /></>,
          extensions: <ExtensionsSection />,
          feedback: <><FeedbackSection /><PrivacySection /><LogsSection /></>,
          about: <><AboutSection /><UpdatesSection /><TransferSection /><RepairSection /></>,
        }}
      </Paged>
    </div>
  );
}

// ── games ──

/** "Detect again": look for XXMI Launcher and the games' folders, and say what turned up. */
function useDetect(list: GameState[]): [boolean, () => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const detect = async () => {
    setBusy(true);
    try {
      const before = list.filter((g) => g.modsDir).length;
      const after = ((await recheck(true)) ?? list).filter((g) => g.modsDir).length;
      toast(after > before ? `Found ${after - before} more` : "Nothing new found");
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };
  return [busy, detect];
}

function GamesSection() {
  const list = useGames();
  const [busy, detect] = useDetect(list);
  const setup = useSetup();
  // a quiet look when the page opens, so a game installed since shows up without pressing anything
  useEffect(() => { void recheck(); }, []);
  const can = list.filter(canInstallLoader);
  const xxmiGames = list.filter((g) => g.xxmi);
  const community = list.filter((g) => !g.xxmi);
  return (
    <Panel title="Games and their folders" icon="controller" id="games" actions={<Button icon="search" busy={busy} onClick={() => void detect()} title="Look for XXMI Launcher and game folders again">Detect again</Button>}>
      {!setup.running && setup.error && can.length > 0 && (
        <div className="set-note">
          <SetupError error={setup.error} />
          <Button size="sm" variant="primary" icon="refresh" onClick={() => void installLoaders(can.map((g) => g.id))}
            title="Installs XXMI Launcher and each game's mod loader from their GitHub pages">Try again</Button>
        </div>
      )}
      {setup.running ? <Installing compact /> : !setup.error && can.length > 1 && (
        <div className="set-note row">
          <span>{can.map((g) => g.short).join(", ")} have no mod loader yet.</span>
          <Button size="sm" variant="primary" icon="install" onClick={() => void installLoaders(can.map((g) => g.id))}
            title="Installs XXMI Launcher and each game's mod loader from their GitHub pages">Install all</Button>
        </div>
      )}
      <OnlyGameRow list={list} />
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

/** gachamod as administrator, so its keys reach games that run as one. On the Launch options page. */
function GameStartSection() {
  return (
    <Panel title="Run as administrator" icon="shield" id="game-start">
      <AdminRow id="set-admin" />
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

/** Uninstall mod loaders (none given: XXMI Launcher and all of them). Files go to the Recycle Bin and Mods folders
 *  stay, so Install again picks them up. */
async function uninstallLoaders(ids?: GameId[]): Promise<boolean> {
  try {
    const r = await xxmi.uninstall(ids);
    setGames(r.games);
    const one = ids?.length === 1 ? r.games.find((g) => g.id === ids[0]) : undefined;
    const what = one ? `${one.short}'s mod loader` : "XXMI Launcher";
    const kept = r.kept.length ? ` Your mods stay in ${r.kept.length === 1 ? r.kept[0] : `${r.kept.length} Mods folders`}` : "";
    toast(`Moved ${what} to the Recycle Bin.${kept}`, false, { label: "Install again", run: () => void installLoaders(ids) });
    return true;
  } catch (e) { toast(errorText(e), true); return false; }
}

function GameRow({ game }: { game: GameState }) {
  const meta = gameMeta(game.id);
  const setup = useSetup();
  const [removing, setRemoving] = useState(false);
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
        {game.modsDir && folder("Mods", game.modsDir, "modsDir", "Where mods live")}
        {notes.map((n) => <span key={n} className="hint set-game-note">{n}</span>)}
        {!game.modsDir && game.xxmi && (
          <span className="row set-game-fix">
            {canInstallLoader(game)
              ? <Button size="sm" variant="primary" icon="install" busy={setup.running} onClick={() => void installLoaders([game.id])}
                  title={`Installs XXMI Launcher and ${game.short}'s mod loader from their GitHub pages, then finds its Mods folder`}>Install mod loader</Button>
              : <Button size="sm" variant="primary" icon="search" busy={setup.running} onClick={() => void getReady(game.id)}
                  title={`Looks for ${game.short} and its mod loader again`}>Find it</Button>}
            <span className="hint">{canInstallLoader(game) ? "No mod loader yet" : `${game.short} wasn't found on this PC. Install it, or set the folders below`}</span>
          </span>
        )}
        {game.viaXxmi && game.importerDir && (
          <span className="row">
            <Button size="sm" variant="ghost" icon="trash" busy={removing} disabled={setup.running}
              onClick={() => { setRemoving(true); void uninstallLoaders([game.id]).finally(() => setRemoving(false)); }}
              title={`Moves ${game.short}'s mod loader to the Recycle Bin. Its Mods folder and saved mod settings stay, and Install again brings it back`}>Uninstall mod loader</Button>
          </span>
        )}
        {!game.xxmi && !game.importerDir && meta.loader && (
          <span className="row"><Button size="sm" variant="ghost" icon="external" onClick={() => shell.openUrl(meta.loader!.url).catch((e) => toast(errorText(e), true))}>{meta.loader.label}</Button></span>
        )}
      </div>
      <Toggle checked={game.shown} onChange={(v) => void show(v)} label="Show" hint="In the sidebar" />
    </div>
  );
}

// ── Mods folders (on the Mods page; the same folders are under Games) ──

/** Where each game's mods live: found by itself, or picked by hand. */
function ModFoldersSection() {
  const list = useGames().filter((g) => g.shown || g.modsDir);
  const [busy, detect] = useDetect(list);
  const setup = useSetup();
  if (!list.length) return null;
  const pick = async (g: GameState) => { if (await pickModsFolder(g.id)) toast(`Saved ${g.short}'s Mods folder`); };
  return (
    <Panel title="Mods folders" icon="folder" id="mod-folders" actions={<Button icon="search" busy={busy} onClick={() => void detect()} title="Look for XXMI Launcher and each game's Mods folder again">Detect again</Button>}>
      <p className="hint set-note">gachamod finds each game's Mods folder from its mod loader. Pick another one here when your mods live somewhere else.</p>
      <div className="set-games">
        {list.map((g) => {
          const dir = g.modsDir;
          return (
            <div key={g.id} className="set-game set-modfolder">
              <GameBadge game={g} size={28} />
              <div className="set-game-main">
                <b>{g.name}</b>
                {dir
                  ? <button type="button" className="set-folder-p mono" title={`Open ${dir}`} onClick={() => shell.openPath(dir).catch((e) => toast(errorText(e), true))}>{dir}</button>
                  : <span className="hint">{canInstallLoader(g) ? "No mod loader yet, so no Mods folder" : "Not found yet"}</span>}
              </div>
              {!dir && (canInstallLoader(g)
                ? <Button size="sm" variant="primary" icon="install" busy={setup.running} onClick={() => void installLoaders([g.id])}
                    title={`Installs XXMI Launcher and ${g.short}'s mod loader from their GitHub pages, then finds its Mods folder`}>Install mod loader</Button>
                : <Button size="sm" variant="primary" icon="search" busy={setup.running} onClick={() => void getReady(g.id)} title={`Looks for ${g.short} and its mod loader again`}>Find it</Button>)}
              <Button size="sm" variant="ghost" onClick={() => void pick(g)} title={`Pick ${g.short}'s Mods folder yourself`}>{dir ? "Change" : "Pick folder"}</Button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ── XXMI ──

function XxmiSection() {
  const setup = useSetup();
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
  const loaderUpdate = !!update || !!st?.importers.some((i) => i.latestVersion && i.deployedVersion && i.latestVersion !== i.deployedVersion);
  const [asking, setAsking] = useState(false);

  return (
    <Panel title="XXMI Launcher" icon="package" id="xxmi">
      {!st ? <p className="hint">Looking…</p> : !st.found ? (
        <div className="set-xxmi-missing">
          <p>XXMI Launcher loads mods into Genshin Impact, Star Rail, Zenless Zone Zero, Wuthering Waves, Honkai Impact 3rd and Endfield. gachamod starts games through it.</p>
          <div className="row">
            <Button variant="primary" icon="install" busy={setup.running} onClick={() => void installLoaders().then(load)}
              title="Downloads XXMI Launcher and the mod loaders of the games on this PC from their GitHub pages (about 65 MB)">Install XXMI Launcher</Button>
            <Button onClick={() => void pick()} title="Pick the folder XXMI Launcher is in">It's in another folder</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="set-kv">
            <span className="muted">Version</span>
            <span>{st.version ?? "Unknown"}{update && <> <Badge tone="info" onClick={openXxmi} title="Opens XXMI Launcher, which installs its own updates">{st.latest} available</Badge></>}{st.running && <> <Badge tone="ok">Open</Badge></>}</span>
            <span className="muted">Folder</span>
            <span className="mono set-path">{st.root}</span>
          </div>
          <div className="set-importers">
            {st.importers.filter((i) => i.deployedVersion || i.importerDir && i.enabled).map((i) => (
              <span key={i.code} className="set-importer" title={i.importerDir ?? ""}>
                <b>{i.code}</b> {i.deployedVersion ?? "not installed"}
                {i.latestVersion && i.deployedVersion && i.latestVersion !== i.deployedVersion && <Badge tone="info" onClick={openXxmi} title={`${i.code} ${i.latestVersion} is out. Opens XXMI Launcher, which updates its mod loaders`}>{i.latestVersion}</Badge>}
              </span>
            ))}
          </div>
          <div className="row">
            <Button icon={loaderUpdate ? "update" : "external"} variant={loaderUpdate ? "primary" : undefined} onClick={openXxmi}
              title={loaderUpdate ? "XXMI Launcher installs the updates when it opens" : undefined}>{loaderUpdate ? "Update in XXMI Launcher" : "Open XXMI Launcher"}</Button>
            <Button variant="ghost" onClick={() => void pick()} title="For a portable copy of XXMI Launcher">Use another folder</Button>
            {root && <Button variant="ghost" onClick={() => void reset()} title="Look for XXMI Launcher where its installer puts it">Use the usual folder</Button>}
            <Button id="set-xxmi-uninstall" variant="ghost" icon="trash" disabled={setup.running} onClick={() => setAsking(true)}
              title="Moves XXMI Launcher and every game's mod loader to the Recycle Bin. Mods folders stay">Uninstall XXMI Launcher</Button>
          </div>
        </>
      )}
      {asking && st && (
        <Confirm title="Uninstall XXMI Launcher?" yes="Uninstall" danger onClose={() => setAsking(false)}
          onYes={async () => { if (await uninstallLoaders()) load(); }}>
          <p>XXMI Launcher, every game's mod loader and their shortcuts go to the Recycle Bin.</p>
          <p className="hint">Your Mods folders and saved mod settings stay in {st.root}. Installing again picks them up.</p>
        </Confirm>
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
    <Panel title="1-click installs and .gachamod files" icon="link" id="integrations">
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

/** Start over: the old data moves to a backup at the next start, then gachamod opens fresh. */
async function resetApp() {
  try {
    await about.reset();
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage may be off */ }
    await about.relaunch();
  } catch (e) { toast(errorText(e), true); }
}

/** The data folder's path, for the panels that name it. */
function useDataDir(): string | null {
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => { about.dataDir().then(setDir).catch(() => {}); }, []);
  return dir;
}

function AboutSection() {
  const [version, setVersion] = useState("");
  const dir = useDataDir();
  useEffect(() => { app.info().then((i) => setVersion(i.version)).catch(() => {}); }, []);
  return (
    <Panel title="About gachamod" icon="info" id="about">
      <div className="set-kv">
        <span className="muted">Version</span><span>gachamod {version}</span>
        <span className="muted">Data folder</span>
        <span>{dir ? <button type="button" className="set-folder-p mono" onClick={() => shell.openPath(dir).catch((e) => toast(errorText(e), true))} title="Open it">{dir}</button> : "…"}</span>
      </div>
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

/** gachamod's own updates: the Update gachamod automatically switch, Check now, and the new version when there is one. */
function UpdatesSection() {
  return <Panel title="gachamod updates" icon="update" id="updates"><UpdateRow /></Panel>;
}

/** What puts gachamod right or takes it away: setup's Repair and Uninstall, and starting over. */
function RepairSection() {
  const [asking, setAsking] = useState(false);
  const [setup, setSetup] = useState(false);
  const dir = useDataDir();
  useEffect(() => { about.setupAvailable().then(setSetup).catch(() => {}); }, []);
  return (
    <Panel title="Repair, reset or uninstall" icon="tool" id="repair">
      <div className="set-rows">
        {setup && (
          <div className="set-row">
            <span><b>Repair or uninstall</b><span className="hint">Opens gachamod setup in this theme. Repair puts gachamod's files and shortcuts back and keeps your mods and settings</span></span>
            <Button size="sm" icon="tool" onClick={() => about.openSetup().catch((e) => toast(errorText(e), true))} title="Opens gachamod setup. A repair closes gachamod while it works">Open setup</Button>
          </div>
        )}
        <div className="set-row" id="set-reset">
          <span><b>Reset gachamod</b><span className="hint">Starts over as if just installed. Your mods stay in their Mods folders, and the old settings, profiles and library go to a backup in the data folder</span></span>
          <Button size="sm" variant="ghost" icon="undo" onClick={() => setAsking(true)} title="Asks first, then restarts gachamod">Reset</Button>
        </div>
      </div>
      {asking && (
        <Confirm title="Reset gachamod?" yes="Reset and restart" danger onClose={() => setAsking(false)} onYes={resetApp}>
          <p>gachamod restarts with nothing set up: no settings, profiles, tags, favourites or GameBanana sign-in.</p>
          <p className="hint">Your mods, games and XXMI Launcher aren't touched. The old data moves to a backup folder{dir ? ` in ${dir}` : ""}, and downloads and caches are deleted.</p>
        </Confirm>
      )}
    </Panel>
  );
}
