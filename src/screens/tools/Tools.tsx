// Tools, one page at a time like Settings (settings/Paged.tsx): problems and fixes after a game update, conflicts and
// key clashes, switching skins in game, sharing or moving mods, and the mod maker tools (files and logs, finding a
// hash). Settings are in Settings: launch options and 3DMigoto's switches are on its Launch page (settings/Launch.tsx),
// and the search at the top of the page list finds them from here too. The pages and panels with their search words
// are in toolsSearch.ts. Owner: SETTINGS/AI area; MODTOOLS, FIXES and INGAME own their panels. Every page and panel is
// a route: go({ view: "tools", section: "fixes" }) or section: "dev".
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge, Button, PageHeader, Panel, formatBytes } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { dev, dialogs, errorText, shell, type DevStatus, type GameState } from "../../lib/api";
import { allGames, currentGame, emitApp, go, useGame } from "../../lib/store";
import { record } from "../../lib/history";
import { registerCommands, type Command } from "../../lib/search";
import { FixesPanel } from "./FixesPanel";
import { InGamePanel } from "../ingame/InGamePanel";
import { KeyListPanel } from "../ingame/KeyListPanel";
import { Paged } from "../settings/Paged";
import { registerPanels } from "../settings/menuSearch";
import { MOVE_KEYWORDS, TOOL_PAGES, toolsPageOf, toolsWhere } from "./toolsSearch";
import { ConflictsPanel, HashLookupPanel, KeyClashesPanel, PacksPanel, ProblemsPanel } from "../modtools/ToolsPanels";
import { MovePanel } from "../modtools/MovePanel";
import { setToolsPage, useToolsCounts } from "../modtools/toolsBadge";
import { t, tn } from "../../lib/i18n";
import { gameName, gameShort } from "../../lib/games";
import "./tools.css";

async function importPack() {
  try {
    const files = await dialogs.pickFiles({ title: t("Open a .gachamod file"), extensions: ["gachamod"] });
    if (files?.[0]) emitApp({ type: "open-pack", path: files[0] });
  } catch (e) { toast(errorText(e), true); }
}

async function clearShaderCache(g: GameState) {
  if (g.running) { toast(t("Close {game} first. It rebuilds the shader cache on the next start", { game: gameName(g) })); return; }
  try { const b = await dev.clearShaderCache(g.id); toast(b ? t("Freed {size}", { size: formatBytes(b) }) : t("The shader cache is already empty")); }
  catch (e) { toast(errorText(e), true); }
}

// Tools sections in the global search
registerCommands("tools", () => {
  const g = currentGame();
  if (!g) return [];
  const all: Command[] = [
    { id: "tools:fixes", title: t("Fix mods after a game update"), section: "Pages", icon: "wand", where: toolsWhere("problems"), keywords: "fixer fixes broken mods hash game update patch repair",
      run: () => go({ view: "tools", section: "fixes" }) },
    { id: "tools:conflicts", title: t("Conflicts"), section: "Pages", icon: "layers", where: toolsWhere("conflicts"), keywords: "conflict conflicting overlap same parts model clash two mods",
      run: () => go({ view: "tools", section: "conflicts" }) },
    { id: "tools:key-clashes", title: t("Key clashes"), section: "Pages", icon: "keyboard", where: toolsWhere("conflicts"), keywords: "key clash conflict conflicting same key toggles hotkeys keybinds",
      run: () => go({ view: "tools", section: "key-clashes" }) },
    { id: "tools:ingame", title: t("In-game menu"), section: "Pages", icon: "gamepad", where: toolsWhere("ingame"),
      keywords: "in game overlay switch mods without reload f10 toggle menu key keys f7 rebind shortcut",
      run: () => go({ view: "tools", section: "ingame" }) },
    { id: "tools:keylist", title: t("Key list in game"), section: "Pages", icon: "keyboard", where: toolsWhere("ingame"), keywords: "mod keys toggles hotkeys help f8 in game overlay cheat sheet",
      run: () => go({ view: "tools", section: "keylist" }) },
    { id: "tools:dev", title: t("Shader cache and logs"), section: "Pages", icon: "bug", where: toolsWhere("makers"), keywords: "shader cache clear frame dumps log d3dx ini d3dx_user wipe reload",
      run: () => go({ view: "tools", section: "dev" }) },
    { id: "tools:hash", title: t("Find a hash"), section: "Pages", icon: "search", where: toolsWhere("makers"), keywords: "hash lookup search which mod uses texture buffer ib vb",
      run: () => go({ view: "tools", section: "hash" }) },
    { id: "tools:clear-cache", title: t("Clear shader cache"), section: "Actions", icon: "trash", where: toolsWhere("makers"), keywords: "shader cache clear delete wipe rebuild free space",
      run: () => void clearShaderCache(g) },
    { id: "tools:import-pack", title: t("Import a .gachamod"), section: "Actions", icon: "import", where: toolsWhere("packs"), keywords: "import open gachamod pack file shared friend add mods profiles",
      run: () => void importPack() },
    { id: "tools:others", title: t("Mods from other managers"), section: "Pages", icon: "swap", where: toolsWhere("packs"),
      keywords: MOVE_KEYWORDS, run: () => go({ view: "tools", section: "others" }) },
    ...(g.modCount > 0 ? [{ id: "tools:share", title: t("Share {game} library", { game: gameShort(g) }), section: "Actions", icon: "share" as const, hint: ".gachamod", where: toolsWhere("packs"),
      keywords: "export share send friend backup gachamod pack links library mods profiles", run: () => emitApp({ type: "export-pack", game: g.id, scope: "game" }) }] : []),
    ...(allGames().filter((x) => x.modsDir && x.modCount > 0).length > 1 ? [{ id: "tools:share-all", title: t("Share every game"), section: "Actions", icon: "share" as const,
      hint: ".gachamod", where: toolsWhere("packs"), keywords: "export share send friend backup gachamod pack links all games library", run: () => emitApp({ type: "export-pack", game: g.id, scope: "all" }) }] : []),
  ];
  return all;
});

export function Tools() {
  const game = useGame();
  if (!game) return null;
  return <ToolsPages game={game} />;
}

function ToolsPages({ game }: { game: GameState }) {
  // each page shows how many new items it has; the one showing marks its own as seen
  const counts = useToolsCounts();
  const pages = useMemo(() => TOOL_PAGES.map((p) => (counts[p.id] ? { ...p, count: counts[p.id] } : p)), [counts]);
  const onShow = useCallback((id: string | null) => setToolsPage(game.id, id), [game.id]);
  return (
    <div className="page tools pg-screen">
      <PageHeader title={t("Tools")} icon="tools" sub={t("Mod fixes, conflicts, skin switching and mod maker tools for {game}", { game: gameName(game) })} />
      <Paged name="tools" label={t("Tools pages")} pages={pages} fallback={toolsPageOf} onShow={onShow}>
        {{
          problems: <><ProblemsPanel /><FixesPanel game={game.id} /></>,
          conflicts: <><ConflictsPanel /><KeyClashesPanel /></>,
          ingame: <><InGamePanel game={game.id} /><KeyListPanel game={game.id} /></>,
          packs: <><PacksPanel /><MovePanel /></>,
          makers: <><DevSection game={game} /><HashLookupPanel /></>,
        }}
      </Paged>
    </div>
  );
}

// ── dev ──

function DevSection({ game }: { game: GameState }) {
  const [st, setSt] = useState<DevStatus | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const load = useCallback(() => {
    dev.status(game.id).then((s) => { if (live.current) setSt(s); }).catch(() => { if (live.current) setSt(null); });
  }, [game.id]);
  const loadLog = useCallback(() => {
    dev.logTail(game.id, 400).then((text) => { if (live.current) setLog(text); }).catch((e) => toast(errorText(e), true));
  }, [game.id]);
  useEffect(() => { load(); loadLog(); }, [load, loadLog]);

  const run = async (key: string, job: () => Promise<unknown>) => {
    setBusy(key);
    try { await job(); } catch (e) { toast(errorText(e), true); } finally { if (live.current) setBusy(null); load(); }
  };
  // acts at once: the old file is kept as d3dx_user.ini.wiped.bak, and Undo puts it back
  const wipeOptions = async () => {
    const id = game.id;
    if (!await dev.wipeUserConfig(id)) { toast(t("No mod has saved options to reset")); return; }
    record({ label: t("Reset every mod's saved options"), undo: () => dev.unwipeUserConfig(id).finally(load), redo: () => dev.wipeUserConfig(id).finally(load) });
  };
  const open = (p: string | null | undefined) => { if (p) shell.openPath(p).catch((e) => toast(errorText(e), true)); };
  const noImporter = !game.importerDir && !game.modsDir;

  return (
    <Panel title={t("Files and logs")} icon="bug" id="dev">
      {noImporter
        ? <p className="hint">{t("Set {game}'s mod loader folder first.", { game: gameName(game) })} <Button size="sm" variant="ghost" icon="folder" onClick={() => go({ view: "settings", section: "games" })}>{t("Game folders")}</Button></p>
        : <>
          <div className="toolbar tools-open">
            <Button icon="folder" onClick={() => open(game.importerDir)} disabled={!game.importerDir} title={t("Open the folder with d3dx.ini and Mods")}>{t("Loader folder")}</Button>
            <Button icon="file" onClick={() => open(st?.d3dxIni)} disabled={!st?.d3dxIni} title={t("3DMigoto's main settings")}>d3dx.ini</Button>
            <Button icon="file" onClick={() => open(st?.d3dxUserIni)} disabled={!st?.d3dxUserIni} title={t("Saved mod options")}>d3dx_user.ini</Button>
            <Button icon="folder" onClick={() => open(st?.shaderFixes.path)} disabled={!st?.shaderFixes.files} title={st?.shaderFixes.files ? t("Open the ShaderFixes folder") : t("No ShaderFixes folder yet")}>ShaderFixes</Button>
          </div>
          <div className="tools-dev">
            <div className="tools-dev-row">
              <span><b>{t("Reload mods in game")}</b><span className="hint">{t("Brings {game} to the front and presses {key}, its reload key in d3dx.ini", { game: gameShort(game), key: game.reloadKey || "F10" })}</span></span>
              <Button icon="refresh" busy={busy === "reload"} disabled={!game.running} title={game.running ? t("Press {key} in the game", { key: game.reloadKey || "F10" }) : t("{game} isn't running", { game: gameName(game) })}
                onClick={() => void run("reload", async () => { await dev.reload(game.id); toast(t("Reloaded mods in game")); })}>{t("Reload")}</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>{t("Shader cache")}</b><span className="hint">{st ? tn(st.shaderCache.files, "{size}, {n} file. It rebuilds on the next start", "{size}, {n} files. It rebuilds on the next start", { size: formatBytes(st.shaderCache.bytes) }) : "…"}</span></span>
              <Button icon="trash" busy={busy === "cache"} disabled={!st?.shaderCache.bytes || game.running} title={game.running ? t("Close the game first") : t("Delete the shader cache. The game rebuilds it on the next start")}
                onClick={() => void run("cache", async () => { const b = await dev.clearShaderCache(game.id); toast(t("Freed {size}", { size: formatBytes(b) })); })}>{t("Clear")}</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>{t("Frame dumps")}</b><span className="hint">{st ? t("{size} in FrameAnalysis folders", { size: formatBytes(st.frameDumps.bytes) }) : "…"}</span></span>
              <Button icon="trash" busy={busy === "dumps"} disabled={!st?.frameDumps.bytes} title={t("Move the FrameAnalysis folders to the Recycle Bin")}
                onClick={() => void run("dumps", async () => { const b = await dev.clearFrameDumps(game.id); toast(t("Moved {size} of frame dumps to the Recycle Bin", { size: formatBytes(b) })); })}>{t("Delete")}</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>{t("Saved mod options")}</b><span className="hint">{t("Every mod goes back to its first look. A copy of d3dx_user.ini is kept")}</span></span>
              <Button variant="danger" icon="trash" busy={busy === "wipe"} disabled={!st?.d3dxUserIni || game.running} title={game.running ? t("Close the game first") : t("Reset every mod's options. A copy of d3dx_user.ini is kept, and Undo (Ctrl+Z) puts it back")}
                onClick={() => void run("wipe", wipeOptions)}>{t("Wipe")}</Button>
            </div>
          </div>
          <div className="tools-log">
            <div className="row"><b className="grow">{t("3DMigoto log")}</b>{st?.log.bytes ? <Badge>{formatBytes(st.log.bytes)}</Badge> : null}
              <Button size="sm" variant="ghost" icon="refresh" onClick={loadLog} title={t("Read the log again")}>{t("Refresh")}</Button>
              <Button size="sm" variant="ghost" icon="external" disabled={!st?.log.bytes} onClick={() => open(st?.log.path)} title={t("Open the log file")}>{t("Open")}</Button>
              <Button size="sm" variant="ghost" icon="sliders" onClick={() => go({ view: "settings", section: "migoto" })}
                title={t("Opens Settings, Mod maker switches: the log level, hunting mode and the rest of 3DMigoto's switches")}>{t("Log settings")}</Button>
            </div>
            <pre className="tools-log-text selectable">{log === null ? "…" : log || t("No log yet. Pick a log level in Log settings, then start the game.")}</pre>
          </div>
        </>}
    </Panel>
  );
}

// Tools' panels for the search at the top of Settings and Tools (settings/menuSearch.ts), each for the current game
const forGame = (draw: (g: GameState) => ReactNode) => function ToolPanel() {
  const g = useGame();
  return g ? <>{draw(g)}</> : null;
};
registerPanels("tools", {
  problems: ProblemsPanel,
  fixes: forGame((g) => <FixesPanel game={g.id} />),
  conflicts: ConflictsPanel,
  "key-clashes": KeyClashesPanel,
  ingame: forGame((g) => <InGamePanel game={g.id} />),
  keylist: forGame((g) => <KeyListPanel game={g.id} />),
  packs: PacksPanel,
  others: MovePanel,
  dev: forGame((g) => <DevSection game={g} />),
  hash: HashLookupPanel,
});
