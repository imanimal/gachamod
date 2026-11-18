// Settings (global), for changing one thing fast: one page at a time, picked from a list in groups on the left
// (Paged.tsx), every setting in the search above that list and in the global search (settingsSearch.ts), every change
// saved at once. A page, a panel on one or a single setting is a route: go({ view: "settings", section: "mods" }),
// "storage" or "set-trash-days". Page names are a word or two ("Mods") with a tip listing what is on them. Panel names
// say what is in them ("Downloads and installing"): a panel holds one kind of setting, and a new kind gets its own
// panel with its own name rather than a row under a vague heading.
// Owner: SETTINGS/AI area.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Badge, Button, Confirm, PageHeader, Panel, Select, Toggle } from "../../ui/kit";
import { GameBadge } from "../../ui/GameBadge";
import { toast } from "../../ui/toast";
import { about, app, dialogs, errorText, games, integrations, settings, shell, xxmi, type GameId, type GameState, type Integration, type XxmiStatus } from "../../lib/api";
import { gameMeta, gameName, gameShort } from "../../lib/games";
import { t, tb, tn } from "../../lib/i18n";
import { oxford } from "../../lib/notes";
import { refreshGames, setGames, useGames, useOnlyGame } from "../../lib/store";
import { focusGame } from "../../shell/commands";
import { openKofi } from "../../lib/support";
import { Paged } from "./Paged";
import "./settings.css";
import { AccountSection } from "./AccountSection";
import { HotkeysSection, MenuKeysSection, ShortcutsSection } from "./HotkeysSection";
import { TransferSection, UpdateRow } from "./SettingsTransfer";
import { AppearanceSection, CustomThemesSection, GeneralSection, GraphicsSection, LayoutSection } from "./Appearance";
import { AdultSection, AutomaticSection, BrokenModsSection, CreatorsSection, InstallingSection, ModsSection, StorageSection } from "./Sections";
import { AiSection } from "./AiSection";
import { LaunchSections } from "./Launch";
import { ExtensionsSection } from "../extensions/ExtensionsSection";
import { PAGES, sectionOf } from "./settingsSearch";
import { registerPanels } from "./menuSearch";
import { SetRow, openXxmi, useSetting } from "./parts";
import { FunSection } from "./FunSection";
import { BackgroundSection, DesktopShortcutsSection } from "./DesktopShortcuts";
import { AdminRow, FeedbackSection, LogsSection, PrivacySection } from "./Feedback";
import { Installing, SetupError } from "./Onboarding";
import { MovePanel } from "../modtools/MovePanel";
import { BiggestModsPanel, DuplicatesPanel, StoragePage, StoragePanel, storageShown } from "./Storage";
import { canInstallLoader, getReady, installLoaders, pickModsFolder, recheck, useSetup } from "../../lib/setup";

export { SetRow, openXxmi, useSetting };

export const XXMI_RELEASES = "https://github.com/SpectrumQT/XXMI-Launcher/releases";

// Settings' panels for the search at the top of Settings and Tools (menuSearch.ts), by the ids in settingsSearch.ts
registerPanels("settings", {
  general: GeneralSection, "desktop-shortcuts": DesktopShortcutsSection, background: BackgroundSection,
  games: GamesSection, xxmi: XxmiSection,
  launch: LaunchSections, migoto: LaunchSections, "game-start": GameStartSection,
  others: MovePanel, mods: ModsSection, adult: AdultSection, "mod-folders": ModFoldersSection, installing: InstallingSection,
  automatic: AutomaticSection, "broken-mods": BrokenModsSection, storage: StorageSection,
  disk: StoragePanel, "disk-big": BiggestModsPanel, "disk-dupes": DuplicatesPanel,
  creators: CreatorsSection, hotkeys: HotkeysSection, "menu-keys": MenuKeysSection, shortcuts: ShortcutsSection,
  appearance: AppearanceSection, layout: LayoutSection, themes: CustomThemesSection, graphics: GraphicsSection,
  fun: FunSection,
  account: AccountSection, integrations: IntegrationsSection, ai: AiSection,
  extensions: ExtensionsSection,
  feedback: FeedbackSection, privacy: PrivacySection, logs: LogsSection,
  about: AboutSection, updates: UpdatesSection, transfer: TransferSection, repair: RepairSection,
});


export function Settings() {
  return (
    <div className="page settings pg-screen">
      <PageHeader title={t("Settings")} icon="settings" />
      <Paged name="settings" label={t("Settings pages")} pages={PAGES} fallback={sectionOf} onShow={storageShown}>
        {{
          general: <><GeneralSection /><BackgroundSection /><DesktopShortcutsSection /><GraphicsSection /></>,
          appearance: <><AppearanceSection /><LayoutSection /><CustomThemesSection /></>,
          hotkeys: <><HotkeysSection /><MenuKeysSection /><ShortcutsSection /></>,
          fun: <FunSection />,
          games: <><GamesSection /><XxmiSection /></>,
          launch: <><LaunchSections /><GameStartSection /></>,
          mods: <><MovePanel /><ModsSection /><ModFoldersSection /><AutomaticSection /><BrokenModsSection /><StorageSection /></>,
          downloads: <InstallingSection />,
          disk: <StoragePage />,
          gamebanana: <><AccountSection /><IntegrationsSection /><CreatorsSection /><AdultSection /></>,
          ai: <AiSection />,
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
      toast(after > before ? tn(after - before, "Found {n} more Mods folder", "Found {n} more Mods folders") : t("Nothing new found"));
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
    <Panel title={t("Games and their folders")} icon="controller" id="games" actions={<Button icon="search" busy={busy} onClick={() => void detect()} title={t("Look for XXMI Launcher and game folders again")}>{t("Detect again")}</Button>}>
      {!setup.running && setup.error && can.length > 0 && (
        <div className="set-note">
          <SetupError error={setup.error} />
          <Button size="sm" variant="primary" icon="refresh" onClick={() => void installLoaders(can.map((g) => g.id))}
            title={t("Installs XXMI Launcher and each game's mod loader from their GitHub pages")}>{t("Try again")}</Button>
        </div>
      )}
      {setup.running ? <Installing compact /> : !setup.error && can.length > 1 && (
        <div className="set-note row">
          <span>{t("{games} have no mod loader yet.", { games: oxford(can.map((g) => gameShort(g)), 12) })}</span>
          <Button size="sm" variant="primary" icon="install" onClick={() => void installLoaders(can.map((g) => g.id))}
            title={t("Installs XXMI Launcher and each game's mod loader from their GitHub pages")}>{t("Install all")}</Button>
        </div>
      )}
      <OnlyGameRow list={list} />
      <div className="set-games">{xxmiGames.map((g) => <GameRow key={g.id} game={g} />)}</div>
      {community.length > 0 && <>
        <h3 className="sub-h" id="set-community">{t("Community games")}</h3>
        <p className="hint set-note" title={t("3DMigoto is the program that loads mods into the game. XXMI Launcher bundles one per game for the games above")}>
          {t("XXMI Launcher doesn't support these. Each needs a separate 3DMigoto loader: get it from the link, then pick its folder (the one with d3dx.ini). Installing, turning mods on and off, profiles and Browse work the same.")}</p>
        <div className="set-games">{community.map((g) => <GameRow key={g.id} game={g} />)}</div>
      </>}
    </Panel>
  );
}

/** gachamod as administrator, so its keys reach games that run as one. On the Launch options page. */
function GameStartSection() {
  return (
    <Panel title={t("Run as administrator")} icon="shield" id="game-start">
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
      <SetRow id="set-only-game" label={t("One-game mode")} hint={t("Only this game shows in the sidebar and menus. The others stay set up, and search still finds them")}>
        <Select value={only?.id ?? ""} onChange={(v) => focusGame(v ? (v as GameId) : null)}
          options={[{ value: "", label: t("Off") }, ...shown.map((g) => ({ value: g.id, label: gameName(g) }))]} />
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
    const moved = ids?.length === 1 ? t("Moved the mod loader to the Recycle Bin.") : t("Moved XXMI Launcher to the Recycle Bin.");
    const kept = !r.kept.length ? "" : r.kept.length === 1 ? t("Your mods stay in the Mods folder") : tn(r.kept.length, "Your mods stay in {n} Mods folder", "Your mods stay in {n} Mods folders");
    toast(kept ? `${moved} ${kept}` : moved, false, { label: t("Install again"), run: () => void installLoaders(ids) });
    return true;
  } catch (e) { toast(errorText(e), true); return false; }
}

function GameRow({ game }: { game: GameState }) {
  const meta = gameMeta(game.id);
  const setup = useSetup();
  const [removing, setRemoving] = useState(false);
  const change = async (field: "gameDir" | "importerDir" | "modsDir") => {
    try {
      const picked = await dialogs.pickFolder(field === "gameDir" ? t("{game}'s game folder", { game: gameName(game) }) : field === "importerDir" ? t("{game}'s mod loader folder (holds d3dx.ini)", { game: gameName(game) }) : t("{game}'s Mods folder", { game: gameName(game) }));
      if (!picked) { if (!("__TAURI_INTERNALS__" in window)) toast(t("Picking folders works in the app")); return; }
      const next = {
        gameDir: game.gameDir, importerDir: game.importerDir, modsDir: game.modsDir, viaXxmi: game.viaXxmi,
        [field]: picked,
        ...(field === "importerDir" ? { modsDir: null, viaXxmi: false } : {}),
      };
      // the row shows the new path
      setGames(await games.setPaths(game.id, next));
    } catch (e) { toast(errorText(e), true); }
  };
  const show = async (v: boolean) => {
    try { setGames(await games.setShown(game.id, v)); } catch (e) { toast(errorText(e), true); }
  };
  const folder = (label: string, path: string | null, field: "gameDir" | "importerDir" | "modsDir", tip: string, pickTip: string) => (
    <div className="set-folder">
      <span className="set-folder-l" title={tip}>{label}</span>
      {path
        ? <button type="button" className="set-folder-p mono" title={t("Open {path}", { path })} onClick={() => shell.openPath(path).catch((e) => toast(errorText(e), true))}>{path}</button>
        : <span className="set-folder-p hint">{t("Not set")}</span>}
      <Button size="sm" variant="ghost" onClick={() => void change(field)} title={pickTip}>{path ? t("Change") : t("Set")}</Button>
    </div>
  );
  // what's different for this game, said once and plainly
  const notes: string[] = [];
  if (!game.gbCharacterCategory) notes.push(t("GameBanana has no character categories for {game}, so its mods aren't sorted by character. Set a mod's character yourself in its details.", { game: gameShort(game) }));
  return (
    <div className={`set-game${game.shown ? " shown" : ""}`} style={{ "--g-accent": game.accent } as CSSProperties}>
      <GameBadge game={game} size={40} />
      <div className="set-game-main">
        <div className="set-game-h">
          <b>{gameName(game)}</b>
          {game.viaXxmi && <Badge tone="accent">{t("{importer} via XXMI", { importer: game.importer })}</Badge>}
          {!game.viaXxmi && game.importerDir && <Badge>{game.importer}</Badge>}
          {game.running && <Badge tone="ok">{t("Running")}</Badge>}
          {game.modCount > 0 && <span className="hint">{t("{on}/{total} mods on", { on: game.enabledCount, total: game.modCount })}</span>}
        </div>
        {folder(t("Game"), game.gameDir, "gameDir", t("Where the game's exe is"), t("Pick the game folder"))}
        {folder(t("Mod loader"), game.importerDir, "importerDir", t("The folder with d3dx.ini and Mods"), t("Pick the mod loader folder"))}
        {game.modsDir && folder(t("Mods"), game.modsDir, "modsDir", t("Where mods are"), t("Pick the mods folder"))}
        {notes.map((n) => <span key={n} className="hint set-game-note">{n}</span>)}
        {!game.modsDir && game.xxmi && (
          <span className="row set-game-fix">
            {canInstallLoader(game)
              ? <Button size="sm" variant="primary" icon="install" busy={setup.running} onClick={() => void installLoaders([game.id])}
                  title={t("Installs XXMI Launcher and {game}'s mod loader from their GitHub pages, then finds its Mods folder", { game: gameShort(game) })}>{t("Install mod loader")}</Button>
              : <Button size="sm" variant="primary" icon="search" busy={setup.running} onClick={() => void getReady(game.id)}
                  title={t("Looks for {game} and its mod loader again", { game: gameShort(game) })}>{t("Find it")}</Button>}
            <span className="hint">{canInstallLoader(game) ? t("No mod loader yet") : t("{game} wasn't found on this PC. Install it, or set the folders below", { game: gameShort(game) })}</span>
          </span>
        )}
        {game.viaXxmi && game.importerDir && (
          <span className="row">
            <Button size="sm" variant="ghost" icon="trash" busy={removing} disabled={setup.running}
              onClick={() => { setRemoving(true); void uninstallLoaders([game.id]).finally(() => setRemoving(false)); }}
              title={t("Moves {game}'s mod loader to the Recycle Bin. The Mods folder and saved mod settings stay, and Install again brings it back", { game: gameShort(game) })}>{t("Uninstall mod loader")}</Button>
          </span>
        )}
        {!game.xxmi && !game.importerDir && meta.loader && (
          <span className="row"><Button size="sm" variant="ghost" icon="external" onClick={() => shell.openUrl(meta.loader!.url).catch((e) => toast(errorText(e), true))}>{meta.loader.label}</Button></span>
        )}
      </div>
      <Toggle checked={game.shown} onChange={(v) => void show(v)} label={t("Show")} hint={t("In the sidebar")} />
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
  // the row shows the new path, so picking one says nothing more
  const pick = (g: GameState) => pickModsFolder(g.id);
  return (
    <Panel title={t("Mods folders")} icon="folder" id="mod-folders" actions={<Button icon="search" busy={busy} onClick={() => void detect()} title={t("Look for XXMI Launcher and each game's Mods folder again")}>{t("Detect again")}</Button>}>
      <p className="hint set-note">{t("gachamod finds each game's Mods folder from its mod loader. Pick another one here when your mods are somewhere else.")}</p>
      <div className="set-games">
        {list.map((g) => {
          const dir = g.modsDir;
          return (
            <div key={g.id} className="set-game set-modfolder">
              <GameBadge game={g} size={28} />
              <div className="set-game-main">
                <b>{gameName(g)}</b>
                {dir
                  ? <button type="button" className="set-folder-p mono" title={t("Open {path}", { path: dir })} onClick={() => shell.openPath(dir).catch((e) => toast(errorText(e), true))}>{dir}</button>
                  : <span className="hint">{canInstallLoader(g) ? t("No mod loader yet, so no Mods folder") : t("Not found yet")}</span>}
              </div>
              {!dir && (canInstallLoader(g)
                ? <Button size="sm" variant="primary" icon="install" busy={setup.running} onClick={() => void installLoaders([g.id])}
                    title={t("Installs XXMI Launcher and {game}'s mod loader from their GitHub pages, then finds its Mods folder", { game: gameShort(g) })}>{t("Install mod loader")}</Button>
                : <Button size="sm" variant="primary" icon="search" busy={setup.running} onClick={() => void getReady(g.id)} title={t("Looks for {game} and its mod loader again", { game: gameShort(g) })}>{t("Find it")}</Button>)}
              <Button size="sm" variant="ghost" onClick={() => void pick(g)} title={t("Pick {game}'s Mods folder yourself", { game: gameShort(g) })}>{dir ? t("Change") : t("Pick folder")}</Button>
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
      const p = await dialogs.pickFolder(t("XXMI Launcher's folder (holds XXMI Launcher Config.json)"));
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
    <Panel title={t("XXMI Launcher")} icon="package" id="xxmi">
      {!st ? <p className="hint">{t("Looking…")}</p> : !st.found ? (
        <div className="set-xxmi-missing">
          <p>{t("XXMI Launcher loads mods into Genshin Impact, Star Rail, Zenless Zone Zero, Wuthering Waves, Honkai Impact 3rd and Endfield. gachamod starts games through it.")}</p>
          <div className="row">
            <Button variant="primary" icon="install" busy={setup.running} onClick={() => void installLoaders().then(load)}
              title={t("Downloads XXMI Launcher and the mod loaders of the games on this PC from their GitHub pages (about 65 MB)")}>{t("Install XXMI Launcher")}</Button>
            <Button onClick={() => void pick()} title={t("Pick the folder XXMI Launcher is in")}>{t("It's in another folder")}</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="set-kv">
            <span className="muted">{t("Version")}</span>
            <span>{st.version ?? t("Unknown")}{update && <> <Badge tone="info" onClick={openXxmi} title={t("Opens XXMI Launcher, which installs the update")}>{t("{version} available", { version: st.latest ?? "" })}</Badge></>}{st.running && <> <Badge tone="ok">{t("Open")}</Badge></>}</span>
            <span className="muted">{t("Folder")}</span>
            <span className="mono set-path">{st.root}</span>
          </div>
          <div className="set-importers">
            {st.importers.filter((i) => i.deployedVersion || i.importerDir && i.enabled).map((i) => (
              <span key={i.code} className="set-importer" title={i.importerDir ?? ""}>
                <b>{i.code}</b> {i.deployedVersion ?? t("not installed")}
                {i.latestVersion && i.deployedVersion && i.latestVersion !== i.deployedVersion && <Badge tone="info" onClick={openXxmi} title={t("{loader} {version} is out. Opens XXMI Launcher, which updates its mod loaders", { loader: i.code, version: i.latestVersion })}>{i.latestVersion}</Badge>}
              </span>
            ))}
          </div>
          <div className="row">
            <Button icon={loaderUpdate ? "update" : "external"} variant={loaderUpdate ? "primary" : undefined} onClick={openXxmi}
              title={loaderUpdate ? t("XXMI Launcher installs the updates when it opens") : undefined}>{loaderUpdate ? t("Update in XXMI Launcher") : t("Open XXMI Launcher")}</Button>
            <Button variant="ghost" onClick={() => void pick()} title={t("For a portable copy of XXMI Launcher")}>{t("Use another folder")}</Button>
            {root && <Button variant="ghost" onClick={() => void reset()} title={t("Look for XXMI Launcher where its installer puts it")}>{t("Use the usual folder")}</Button>}
            <Button id="set-xxmi-uninstall" variant="ghost" icon="trash" disabled={setup.running} onClick={() => setAsking(true)}
              title={t("Moves XXMI Launcher and every game's mod loader to the Recycle Bin. Mods folders stay")}>{t("Uninstall XXMI Launcher")}</Button>
          </div>
        </>
      )}
      {asking && st && (
        <Confirm title={t("Uninstall XXMI Launcher?")} yes={t("Uninstall")} danger onClose={() => setAsking(false)}
          onYes={async () => { if (await uninstallLoaders()) load(); }}>
          <p>{t("XXMI Launcher, every game's mod loader and their shortcuts go to the Recycle Bin.")}</p>
          <p className="hint">{t("Your Mods folders and saved mod settings stay in {folder}. Installing again picks them up.", { folder: st.root ?? "" })}</p>
        </Confirm>
      )}
    </Panel>
  );
}

// ── links and files ──

/** Per integration: the row id and what it does when on. The switch shows the change, so it doesn't toast. */
const LINKS: Record<string, { row: string; on: string }> = {
  "scheme:gachamod": { row: "set-links", on: t("GameBanana's 1-click install buttons send mods here") },
  "file:.gachamod": { row: "set-files", on: t("Double-clicking a mod pack opens it here") },
};

function IntegrationsSection() {
  const [list, setList] = useState<Integration[] | null>(null);
  useEffect(() => { integrations.get().then(setList).catch(() => setList([])); }, []);
  const set = async (i: Integration, on: boolean) => {
    try { setList(await integrations.set(i.id, on)); }
    catch (e) { toast(errorText(e), true); }
  };
  return (
    <Panel title={t("1-click installs and .gachamod files")} icon="link" id="integrations">
      <div className="set-rows">
        {list === null && <p className="hint">{t("Checking…")}</p>}
        {list?.length === 0 && <p className="hint">{t("Only available in the Windows app.")}</p>}
        {list?.map((i) => (
          <SetRow key={i.id} id={LINKS[i.id]?.row} label={tb(i.label)}
            hint={i.ours ? LINKS[i.id]?.on : i.owner ? t("{app} has these now. Turn on to take them back", { app: i.owner }) : t("Off")}>
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
    <Panel title={t("About gachamod")} icon="info" id="about">
      <div className="set-kv">
        <span className="muted">{t("Version")}</span><span>gachamod {version}</span>
        <span className="muted">{t("Data folder")}</span>
        <span>{dir ? <button type="button" className="set-folder-p mono" onClick={() => shell.openPath(dir).catch((e) => toast(errorText(e), true))} title={t("Open it")}>{dir}</button> : "…"}</span>
      </div>
      <div className="set-rows set-update">
        <div className="set-row">
          <span><b>{t("Tip jar")}</b><span className="hint">{t("gachamod is free and has no ads. If it saves you some time, a tip on Ko-fi helps keep it going")}</span></span>
          <Button size="sm" icon="coffee" onClick={openKofi} title={t("Opens {url} in your browser", { url: "ko-fi.com/aanimal" })}>{t("Tip on Ko-fi")}</Button>
        </div>
      </div>
      <p className="hint set-note">{t("Mods and previews come from GameBanana. XXMI Launcher and the model importers are separate projects by other authors.")}{" "}
        {t("Fonts: {fonts}, under the SIL Open Font License.", { fonts: oxford(["Manrope", "Rubik", "Anton", "JetBrains Mono"]) })}</p>
    </Panel>
  );
}

/** gachamod's own updates: the Update gachamod automatically switch, Check now, and the new version when there is one. */
function UpdatesSection() {
  return <Panel title={t("gachamod updates")} icon="update" id="updates"><UpdateRow /></Panel>;
}

/** What puts gachamod right or takes it away: setup's Repair and Uninstall, and starting over. */
function RepairSection() {
  const [asking, setAsking] = useState(false);
  const [setup, setSetup] = useState(false);
  const dir = useDataDir();
  useEffect(() => { about.setupAvailable().then(setSetup).catch(() => {}); }, []);
  return (
    <Panel title={t("Repair, reset or uninstall")} icon="tool" id="repair">
      <div className="set-rows">
        {setup && (
          <div className="set-row">
            <span><b>{t("Repair or uninstall")}</b><span className="hint">{t("Opens gachamod setup in this theme. Repair puts gachamod's files and shortcuts back and keeps your mods and settings")}</span></span>
            <Button size="sm" icon="tool" onClick={() => about.openSetup().catch((e) => toast(errorText(e), true))} title={t("Opens gachamod setup. A repair closes gachamod while it works")}>{t("Open setup")}</Button>
          </div>
        )}
        <div className="set-row" id="set-reset">
          <span><b>{t("Reset gachamod")}</b><span className="hint">{t("Starts over as if just installed. Your mods stay in their Mods folders, and the old settings, profiles and library go to a backup in the data folder")}</span></span>
          <Button size="sm" variant="ghost" icon="undo" onClick={() => setAsking(true)} title={t("Asks first, then restarts gachamod")}>{t("Reset")}</Button>
        </div>
      </div>
      {asking && (
        <Confirm title={t("Reset gachamod?")} yes={t("Reset and restart")} danger onClose={() => setAsking(false)} onYes={resetApp}>
          <p>{t("gachamod restarts with nothing set up: no settings, profiles, tags, favourites or GameBanana sign-in.")}</p>
          <p className="hint">{dir
            ? t("Your mods, games and XXMI Launcher aren't touched. The old data moves to a backup folder in {folder}, and downloads and caches are deleted.", { folder: dir })
            : t("Your mods, games and XXMI Launcher aren't touched. The old data moves to a backup folder, and downloads and caches are deleted.")}</p>
        </Confirm>
      )}
    </Panel>
  );
}
