// Tools, one page at a time like Settings (settings/Paged.tsx): problems and fixes after a game update, conflicts and
// key clashes, switching skins in game, sharing or moving mods, and the mod maker tools (files and logs, finding a
// hash). Settings are in Settings: launch options and 3DMigoto's switches are on its Launch options page
// (settings/Launch.tsx). Owner: SETTINGS/AI area; MODTOOLS, FIXES and INGAME own their panels. Every page and panel is
// a route: go({ view: "tools", section: "fixes" }) or section: "dev".
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, PageHeader, Panel, formatBytes, plural } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { dev, dialogs, errorText, imm, shell, type DevStatus, type GameState } from "../../lib/api";
import { allGames, currentGame, emitApp, go, useGame } from "../../lib/store";
import { record } from "../../lib/history";
import { registerCommands, type Command } from "../../lib/search";
import { FixesPanel } from "./FixesPanel";
import { InGamePanel } from "../ingame/InGamePanel";
import { KeyListPanel } from "../ingame/KeyListPanel";
import { Paged, type PageInfo } from "../settings/Paged";
import { ConflictsPanel, HashLookupPanel, ImmPanel, KeyClashesPanel, PacksPanel, ProblemsPanel } from "../modtools/ToolsPanels";
import { setToolsPage, useToolsCounts } from "../modtools/toolsBadge";
import "./tools.css";

// IMM is looked for once per search session, so "Move mods from IMM" shows only when it has mods to move
let immSeen: { at: number; games: string[] } | null = null;
const lookForImm = () => {
  if (immSeen && Date.now() - immSeen.at < 60_000) return;
  immSeen = { at: Date.now(), games: immSeen?.games ?? [] };
  imm.detect().then((i) => { immSeen = { at: Date.now(), games: i.found ? i.games.filter((x) => x.mods > 0).map((x) => x.game) : [] }; }).catch(() => {});
};

async function importPack() {
  try {
    const files = await dialogs.pickFiles({ title: "Open a .gachamod file", extensions: ["gachamod"] });
    if (files?.[0]) emitApp({ type: "open-pack", path: files[0] });
  } catch (e) { toast(errorText(e), true); }
}

async function clearShaderCache(g: GameState) {
  if (g.running) { toast(`Close ${g.name} first. It rebuilds the shader cache on the next start`); return; }
  try { const b = await dev.clearShaderCache(g.id); toast(b ? `Freed ${formatBytes(b)}` : "The shader cache is already empty"); }
  catch (e) { toast(errorText(e), true); }
}

// Tools sections in the global search
registerCommands("tools", () => {
  const g = currentGame();
  if (!g) return [];
  lookForImm();
  const all: Command[] = [
    { id: "tools:fixes", title: "Fix mods after a game update", section: "Pages", icon: "wand", where: "Tools › Problems and fixes", keywords: "fixer fixes broken mods hash game update patch repair",
      run: () => go({ view: "tools", section: "fixes" }) },
    { id: "tools:conflicts", title: "Conflicts", section: "Pages", icon: "layers", where: "Tools › Conflicts", keywords: "conflict conflicting overlap same parts model clash two mods",
      run: () => go({ view: "tools", section: "conflicts" }) },
    { id: "tools:key-clashes", title: "Key clashes", section: "Pages", icon: "keyboard", where: "Tools › Conflicts", keywords: "key clash conflict conflicting same key toggles hotkeys keybinds",
      run: () => go({ view: "tools", section: "key-clashes" }) },
    { id: "tools:ingame", title: "In-game menu", section: "Pages", icon: "gamepad", where: "Tools › Switch skins in game",
      keywords: "in game overlay switch mods without reload f10 toggle menu key keys f7 rebind shortcut",
      run: () => go({ view: "tools", section: "ingame" }) },
    { id: "tools:keylist", title: "Key list in game", section: "Pages", icon: "keyboard", where: "Tools › Switch skins in game", keywords: "mod keys toggles hotkeys help f8 in game overlay cheat sheet",
      run: () => go({ view: "tools", section: "keylist" }) },
    { id: "tools:dev", title: "Shader cache and logs", section: "Pages", icon: "bug", where: "Tools › Mod makers", keywords: "shader cache clear frame dumps log d3dx ini d3dx_user wipe reload",
      run: () => go({ view: "tools", section: "dev" }) },
    { id: "tools:hash", title: "Find a hash", section: "Pages", icon: "search", where: "Tools › Mod makers", keywords: "hash lookup search which mod uses texture buffer ib vb",
      run: () => go({ view: "tools", section: "hash" }) },
    { id: "tools:clear-cache", title: "Clear shader cache", section: "Actions", icon: "trash", where: "Tools › Mod makers", keywords: "shader cache clear delete wipe rebuild free space",
      run: () => void clearShaderCache(g) },
    { id: "tools:import-pack", title: "Import a .gachamod", section: "Actions", icon: "import", where: "Tools › Share and move", keywords: "import open gachamod pack file shared friend add mods profiles",
      run: () => void importPack() },
    ...(immSeen?.games.length ? [{ id: "tools:imm", title: "Move mods from IMM", section: "Actions", icon: "swap" as const, where: "Tools › Share and move",
      keywords: "imm integrated mod manager import move take over migrate", run: () => go({ view: "tools", section: "imm" }) }] : []),
    ...(g.modCount > 0 ? [{ id: "tools:share", title: `Share ${g.short} library`, section: "Actions", icon: "share" as const, hint: ".gachamod", where: "Tools › Share and move",
      keywords: "export share send friend backup gachamod pack links library mods profiles", run: () => emitApp({ type: "export-pack", game: g.id, scope: "game" }) }] : []),
    ...(allGames().filter((x) => x.modsDir && x.modCount > 0).length > 1 ? [{ id: "tools:share-all", title: "Share every game", section: "Actions", icon: "share" as const,
      hint: ".gachamod", where: "Tools › Share and move", keywords: "export share send friend backup gachamod pack links all games library", run: () => emitApp({ type: "export-pack", game: g.id, scope: "all" }) }] : []),
  ];
  return all;
});

/** Tools' pages in order. A page holds the panels that belong together. */
const PAGES: PageInfo[] = [
  { id: "problems", label: "Problems and fixes", icon: "warn", tip: "What stops a mod from showing right in game, and the fixers for mods a game update broke" },
  { id: "conflicts", label: "Conflicts", icon: "layers", tip: "Mods that are on and change the same parts of a model, or use the same keys" },
  { id: "ingame", label: "Switch skins in game", icon: "swap", tip: "The menu over the game for picking skins without a reload, and the key list" },
  { id: "packs", label: "Share and move", icon: "package", tip: "Share mods and profiles as a .gachamod file, or move mods out of Integrated Mod Manager" },
  { id: "makers", label: "Mod makers", icon: "code", tip: "Reloading mods in game, the shader cache, 3DMigoto's files and log, and looking up a hash" },
];
/** The page each of the other panels is on, for a route to one that isn't shown. */
const PANEL_PAGE: Record<string, string> = { fixes: "problems", "key-clashes": "conflicts", imm: "packs", dev: "makers", hash: "makers" };
const pageOf = (id: string): string | undefined => PANEL_PAGE[id];

export function Tools() {
  const game = useGame();
  if (!game) return null;
  return <ToolsPages game={game} />;
}

function ToolsPages({ game }: { game: GameState }) {
  // each page shows how many new items it has; the one showing marks its own as seen
  const counts = useToolsCounts();
  const pages = useMemo(() => PAGES.map((p) => (counts[p.id] ? { ...p, count: counts[p.id] } : p)), [counts]);
  const onShow = useCallback((id: string | null) => setToolsPage(game.id, id), [game.id]);
  return (
    <div className="page tools pg-screen">
      <PageHeader title="Tools" icon="tools" sub={`Mod fixes, conflicts, skin switching and mod maker tools for ${game.name}`} />
      <Paged name="tools" label="Tools pages" pages={pages} fallback={pageOf} onShow={onShow}>
        {{
          problems: <><ProblemsPanel /><FixesPanel game={game.id} /></>,
          conflicts: <><ConflictsPanel /><KeyClashesPanel /></>,
          ingame: <><InGamePanel game={game.id} /><KeyListPanel game={game.id} /></>,
          packs: <><PacksPanel /><ImmPanel /></>,
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
    dev.logTail(game.id, 400).then((t) => { if (live.current) setLog(t); }).catch((e) => toast(errorText(e), true));
  }, [game.id]);
  useEffect(() => { load(); loadLog(); }, [load, loadLog]);

  const run = async (key: string, job: () => Promise<unknown>) => {
    setBusy(key);
    try { await job(); } catch (e) { toast(errorText(e), true); } finally { if (live.current) setBusy(null); load(); }
  };
  // acts at once: the old file is kept as d3dx_user.ini.wiped.bak, and Undo puts it back
  const wipeOptions = async () => {
    const id = game.id;
    if (!await dev.wipeUserConfig(id)) { toast("No mod has saved options to reset"); return; }
    record({ label: "Reset every mod's saved options", undo: () => dev.unwipeUserConfig(id).finally(load), redo: () => dev.wipeUserConfig(id).finally(load) });
  };
  const open = (p: string | null | undefined) => { if (p) shell.openPath(p).catch((e) => toast(errorText(e), true)); };
  const noImporter = !game.importerDir && !game.modsDir;

  return (
    <Panel title="Files and logs" icon="bug" id="dev">
      {noImporter
        ? <p className="hint">Set {game.name}'s mod loader folder first. <Button size="sm" variant="ghost" icon="folder" onClick={() => go({ view: "settings", section: "games" })}>Game folders</Button></p>
        : <>
          <div className="toolbar tools-open">
            <Button icon="folder" onClick={() => open(game.importerDir)} disabled={!game.importerDir} title="Open the folder with d3dx.ini and Mods">Loader folder</Button>
            <Button icon="file" onClick={() => open(st?.d3dxIni)} disabled={!st?.d3dxIni} title="3DMigoto's main settings">d3dx.ini</Button>
            <Button icon="file" onClick={() => open(st?.d3dxUserIni)} disabled={!st?.d3dxUserIni} title="Saved mod options">d3dx_user.ini</Button>
            <Button icon="folder" onClick={() => open(st?.shaderFixes.path)} disabled={!st?.shaderFixes.files} title={st?.shaderFixes.files ? "Open the ShaderFixes folder" : "No ShaderFixes folder yet"}>ShaderFixes</Button>
          </div>
          <div className="tools-dev">
            <div className="tools-dev-row">
              <span><b>Reload mods in game</b><span className="hint">Brings {game.short} to the front and presses {game.reloadKey || "F10"}, its reload key in d3dx.ini</span></span>
              <Button icon="refresh" busy={busy === "reload"} disabled={!game.running} title={game.running ? `Press ${game.reloadKey || "F10"} in the game` : `${game.name} isn't running`}
                onClick={() => void run("reload", async () => { await dev.reload(game.id); toast("Reloaded mods in game"); })}>Reload</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>Shader cache</b><span className="hint">{st ? `${formatBytes(st.shaderCache.bytes)}, ${plural(st.shaderCache.files, "file")}. It rebuilds on the next start` : "…"}</span></span>
              <Button icon="trash" busy={busy === "cache"} disabled={!st?.shaderCache.bytes || game.running} title={game.running ? "Close the game first" : "Delete the shader cache. The game rebuilds it on the next start"}
                onClick={() => void run("cache", async () => { const b = await dev.clearShaderCache(game.id); toast(`Freed ${formatBytes(b)}`); })}>Clear</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>Frame dumps</b><span className="hint">{st ? `${formatBytes(st.frameDumps.bytes)} in FrameAnalysis folders` : "…"}</span></span>
              <Button icon="trash" busy={busy === "dumps"} disabled={!st?.frameDumps.bytes} title="Move the FrameAnalysis folders to the Recycle Bin"
                onClick={() => void run("dumps", async () => { const b = await dev.clearFrameDumps(game.id); toast(`Moved ${formatBytes(b)} of frame dumps to the Recycle Bin`); })}>Delete</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>Saved mod options</b><span className="hint">Every mod goes back to its first look. A copy of d3dx_user.ini is kept</span></span>
              <Button variant="danger" icon="trash" busy={busy === "wipe"} disabled={!st?.d3dxUserIni || game.running} title={game.running ? "Close the game first" : "Reset every mod's options. A copy of d3dx_user.ini is kept, and Undo (Ctrl+Z) puts it back"}
                onClick={() => void run("wipe", wipeOptions)}>Wipe</Button>
            </div>
          </div>
          <div className="tools-log">
            <div className="row"><b className="grow">3DMigoto log</b>{st?.log.bytes ? <Badge>{formatBytes(st.log.bytes)}</Badge> : null}
              <Button size="sm" variant="ghost" icon="refresh" onClick={loadLog} title="Read the log again">Refresh</Button>
              <Button size="sm" variant="ghost" icon="external" disabled={!st?.log.bytes} onClick={() => open(st?.log.path)} title="Open the log file">Open</Button>
              <Button size="sm" variant="ghost" icon="sliders" onClick={() => go({ view: "settings", section: "migoto" })}
                title="Opens Settings, Mod maker switches: the log level, hunting mode and the rest of 3DMigoto's switches">Log settings</Button>
            </div>
            <pre className="tools-log-text selectable">{log === null ? "…" : log || "No log yet. Pick a log level in Log settings, then start the game."}</pre>
          </div>
        </>}
    </Panel>
  );
}
