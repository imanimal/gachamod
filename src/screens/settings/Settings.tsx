// Settings (global): games and their folders, XXMI Launcher, appearance, mod behaviour, links and files, about.
// Every change applies at once. Sections have ids for go({ view: "settings", section }). Owner: SYSTEM area.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Badge, Button, Card, PageHeader, Panel, Segmented, Toggle } from "../../ui/kit";
import { GameBadge } from "../../ui/GameBadge";
import { toast } from "../../ui/toast";
import { saved } from "../../ui/motion";
import { about, app, dialogs, errorText, games, integrations, settings, shell, xxmi, type GameState, type Integration, type XxmiStatus } from "../../lib/api";
import { consumeRoute, currentGame, refreshGames, setGames, useGame, useGames, useRoute } from "../../lib/store";
import { THEMES, accentPick, setAccentPick, setMotion, setScheme, setThemePick, themePick, useTheme, type SchemeChoice } from "../../lib/theme";
import { SIZES, getTextSize, setTextSize } from "../../lib/zoom";
import "./settings.css";
import { HotkeysSection } from "./HotkeysSection";
import { TransferSection, UpdateRow } from "./SettingsTransfer";

export const XXMI_RELEASES = "https://github.com/SpectrumQT/XXMI-Launcher/releases";

export function Settings() {
  const route = useRoute();
  useEffect(() => {
    const id = route.section;
    if (!id) return;
    const t = window.setTimeout(() => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); consumeRoute(["section"]); }, 120);
    return () => window.clearTimeout(t);
  }, [route.section]);

  return (
    <div className="page settings">
      <PageHeader title="Settings" icon="settings" />
      <GamesSection />
      <XxmiSection />
      <AppearanceSection />
      <ModsSection />
      <HotkeysSection />
      <IntegrationsSection />
      <TransferSection />
      <AboutSection />
    </div>
  );
}

// ── a setting with a default, saved on change ──

function useSetting(key: string, fallback: string): [string, (v: string) => void] {
  const [v, setV] = useState(fallback);
  useEffect(() => {
    let live = true;
    settings.get(key).then((x) => { if (live && x !== null) setV(x); }).catch(() => {});
    return () => { live = false; };
  }, [key]);
  const set = useCallback((nv: string) => {
    setV(nv);
    settings.set(key, nv).catch((e) => toast(errorText(e), true));
  }, [key]);
  return [v, set];
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
      <div className="set-games">{xxmiGames.map((g) => <GameRow key={g.id} game={g} />)}</div>
      <h3 className="sub-h">Other 3DMigoto games</h3>
      <p className="hint set-note">These use a community 3DMigoto loader. Pick the loader's folder, the one that holds d3dx.ini and Mods.</p>
      <div className="set-games">{community.map((g) => <GameRow key={g.id} game={g} />)}</div>
    </Panel>
  );
}

function GameRow({ game }: { game: GameState }) {
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
      <Button size="sm" variant="ghost" onClick={() => void change(field)}>Change</Button>
    </div>
  );
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
      </div>
      <Toggle checked={game.shown} onChange={(v) => void show(v)} label="Show" hint="In the game rail" />
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
            <Button onClick={() => void pick()}>It's in another folder</Button>
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
            <Button icon="external" onClick={() => xxmi.open().catch((e) => toast(errorText(e), true))}>Open XXMI Launcher</Button>
            <Button variant="ghost" onClick={() => void pick()} title="For a portable copy of XXMI Launcher">Use another folder</Button>
            {root && <Button variant="ghost" onClick={() => void reset()}>Use the usual folder</Button>}
          </div>
        </>
      )}
    </Panel>
  );
}

// ── appearance ──

function AppearanceSection() {
  const game = useGame();
  const theme = useTheme();
  const [pick, setPick] = useState(() => (game ? themePick(game.id) : "auto"));
  const [size, setSize] = useState(getTextSize());
  useEffect(() => { setPick(game ? themePick(game.id) : "auto"); }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: Event) => setSize((e as CustomEvent<number>).detail);
    window.addEventListener("pm-text-size", h);
    return () => window.removeEventListener("pm-text-size", h);
  }, []);

  const choose = (id: string) => { if (!game) return; setThemePick(game, id); setPick(id); };
  const defaultFor = THEMES.find((t) => t.id === (game?.theme || "default")) ?? THEMES[0]!;
  const themeInfo = THEMES.find((t) => t.id === theme.id);
  const accents = themeInfo?.accents ?? [];
  const themeName = themeInfo?.name ?? "the theme";
  const [accent, setAccent] = useState(() => accentPick(theme.id));
  useEffect(() => { setAccent(accentPick(theme.id)); }, [theme.id]);

  return (
    <Panel title="Appearance" icon="palette" id="appearance">
      <div className="field-l">Theme {game ? `for ${game.name}` : ""}</div>
      <div className="set-themes">
        <ThemeCard id={defaultFor.id} name="Game's own" description={`${defaultFor.name}, the one ${game?.short ?? "the game"} uses`} on={pick === "auto"} onClick={() => choose("auto")} disabled={!game} />
        {THEMES.map((t) => <ThemeCard key={t.id} id={t.id} name={t.name} description={t.description} on={pick === t.id} onClick={() => choose(t.id)} disabled={!game} />)}
      </div>
      <div className="set-rows">
        {accents.length > 1 && (
          <div className="set-row">
            <span><b>Accent</b><span className="hint">The colour {themeName} uses for what is picked or on</span></span>
            <span className="set-accents" role="radiogroup" aria-label="Accent">
              {accents.map((a) => (
                <button key={a.id} type="button" role="radio" aria-checked={accent === a.id} className={`swatch${accent === a.id ? " on" : ""}`} title={a.name} aria-label={a.name}
                  style={{ "--c": a.color } as CSSProperties} onClick={() => { setAccentPick(theme.id, a.id, currentGame()); setAccent(a.id); }} />
              ))}
            </span>
          </div>
        )}
        <div className="set-row">
          <span><b>Colours</b><span className="hint">{theme.id === "zzz" ? "New Eridu is dark only" : "System follows Windows' light or dark setting"}</span></span>
          <Segmented<SchemeChoice> value={theme.choice} onChange={(v) => setScheme(v, currentGame())} label="Colours"
            options={[{ value: "dark", label: "Dark", icon: "moon" }, { value: "light", label: "Light", icon: "sun" }, { value: "system", label: "System" }]} />
        </div>
        <div className="set-row">
          <span><b>Text size</b><span className="hint">Ctrl+= and Ctrl+- work anywhere, Ctrl+0 resets</span></span>
          <Segmented value={String(size)} onChange={(v) => { setTextSize(Number(v)); setSize(Number(v)); }} label="Text size"
            options={SIZES.map((s) => ({ value: String(s), label: String(s) }))} size="sm" />
        </div>
        <div className="set-row">
          <span><b>Animations</b><span className="hint">Off keeps every change instant</span></span>
          <Toggle checked={theme.motion} onChange={(v) => setMotion(v, currentGame())} />
        </div>
      </div>
    </Panel>
  );
}

function ThemeCard({ id, name, description, on, onClick, disabled }: { id: string; name: string; description: string; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <Card className="theme-card" selected={on} onClick={onClick} disabled={disabled} title={description}>
      <span className="theme-preview" data-theme={id} data-scheme="dark" aria-hidden="true">
        <span className="theme-preview-rail" />
        <span className="theme-preview-body">
          <span className="theme-preview-line" />
          <span className="theme-preview-line short" />
          <span className="theme-preview-btn" />
        </span>
      </span>
      <span className="theme-card-t"><b>{name}</b><span className="hint">{description}</span></span>
    </Card>
  );
}

// ── mods ──

function ModsSection() {
  const shown = useGames().filter((g) => g.shown);
  const [nsfw, setNsfw] = useSetting("ui.nsfw", "blur");
  const [updates, setUpdates] = useSetting("updates.check", "1");
  const [keep, setKeep] = useSetting("downloads.keep", "0");
  return (
    <Panel title="Mods" icon="mods" id="mods">
      <div className="set-rows">
        <div className="set-row">
          <span><b>Mature content</b><span className="hint">For previews marked NSFW on GameBanana or by you</span></span>
          <Segmented value={nsfw} onChange={setNsfw} label="Mature content"
            options={[{ value: "hide", label: "Hide" }, { value: "blur", label: "Blur" }, { value: "show", label: "Show" }]} />
        </div>
        <div className="set-row">
          <span><b>Check for updates</b><span className="hint">Looks up your GameBanana mods when you open Mods, and every 30 minutes</span></span>
          <Toggle checked={updates !== "0"} onChange={(v) => setUpdates(v ? "1" : "0")} />
        </div>
        <div className="set-row">
          <span><b>Keep downloaded archives</b><span className="hint">Off deletes the .zip or .7z after it's installed</span></span>
          <Toggle checked={keep === "1"} onChange={(v) => setKeep(v ? "1" : "0")} />
        </div>
      </div>
      {shown.length > 0 && (
        <div className="set-pergame">
          <div className="set-pergame-h"><span /><span>One skin per character</span><span>Reload in game</span></div>
          {shown.map((g) => <PerGame key={g.id} game={g} />)}
          <p className="hint">One skin per character turns off a character's other skins when you turn one on. Reload in game presses F10 for you when you switch back to the game.</p>
        </div>
      )}
    </Panel>
  );
}

function PerGame({ game }: { game: GameState }) {
  const [one, setOne] = useSetting(`${game.id}.oneSkin`, "1");
  const [auto, setAuto] = useSetting(`${game.id}.autoReload`, "1");
  return (
    <div className="set-pergame-r">
      <span className="row"><GameBadge game={game} size={24} />{game.name}</span>
      <Toggle size="sm" checked={one !== "0"} onChange={(v) => setOne(v ? "1" : "0")} />
      <Toggle size="sm" checked={auto !== "0"} onChange={(v) => setAuto(v ? "1" : "0")} />
    </div>
  );
}

// ── links and files ──

function IntegrationsSection() {
  const [list, setList] = useState<Integration[] | null>(null);
  const ack = useRef<HTMLDivElement>(null);
  useEffect(() => { integrations.get().then(setList).catch(() => setList([])); }, []);
  const register = async (id: string) => {
    try { setList(await integrations.register(id)); saved(ack.current); } catch (e) { toast(errorText(e), true); }
  };
  return (
    <Panel title="Links and files" icon="link" id="integrations">
      <div className="set-rows" ref={ack}>
        {list === null && <p className="hint">Checking…</p>}
        {list?.length === 0 && <p className="hint">Only available in the Windows app.</p>}
        {list?.map((i) => (
          <div key={i.id} className="set-row">
            <span><b>{i.label}</b><span className="hint">{i.ours ? "Set to gachamod" : i.owner ? `${i.owner} has these now` : "Not set"}</span></span>
            {i.ours ? <Badge tone="ok" icon="check">On</Badge>
              : <Button disabled={!i.supported} onClick={() => void register(i.id)} title={i.owner ? `Takes them over from ${i.owner}` : undefined}>Use gachamod</Button>}
          </div>
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
      <p className="hint set-note">Mods and previews come from GameBanana. XXMI Launcher and the model importers are separate projects by their own authors.
        Fonts: Manrope, Rubik, Anton and JetBrains Mono, under the SIL Open Font License.</p>
    </Panel>
  );
}
