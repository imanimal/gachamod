// Tools, one page at a time like Settings (settings/Paged.tsx): problems and fixes after a game update, conflicts and
// key clashes, switching skins in game, sharing or moving mods, and the mod maker tools (files and logs, finding a
// hash). Settings are in Settings: launch options and 3DMigoto's switches are on its Launch options page
// (settings/Launch.tsx). Owner: SETTINGS/AI area; MODTOOLS, FIXES and INGAME own their panels. Every page and panel is
// a route: go({ view: "tools", section: "fixes" }) or section: "dev".
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Confirm, PageHeader, Panel, formatBytes, plural } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { KEY_LIST_SHOWN, dev, errorText, shell, type DevStatus, type GameState } from "../../lib/api";
import { allGames, currentGame, emitApp, go, useGame } from "../../lib/store";
import { registerCommands, type Command } from "../../lib/search";
import { FixesPanel } from "./FixesPanel";
import { InGamePanel } from "../ingame/InGamePanel";
import { KeyListPanel } from "../ingame/KeyListPanel";
import { Paged, type PageInfo } from "../settings/Paged";
import { ConflictsPanel, HashLookupPanel, ImmPanel, KeyClashesPanel, PacksPanel, ProblemsPanel } from "../modtools/ToolsPanels";
import "./tools.css";

// Tools sections in the global search
registerCommands("tools", () => {
  const g = currentGame();
  if (!g) return [];
  const all: Command[] = [
    { id: "tools:fixes", title: "Fix mods after a game update", section: "Pages", icon: "wand", where: "Tools › Problems and fixes", keywords: "fixer fixes broken mods hash game update patch repair",
      run: () => go({ view: "tools", section: "fixes" }) },
    { id: "tools:ingame", title: "In-game menu", section: "Pages", icon: "gamepad", where: "Tools › Switch skins in game", keywords: "in game overlay switch mods without reload f10 toggle menu",
      run: () => go({ view: "tools", section: "ingame" }) },
    { id: "tools:keylist", title: "Key list in game", section: "Pages", icon: "keyboard", where: "Tools › Switch skins in game", keywords: "mod keys toggles hotkeys help f8 in game overlay cheat sheet",
      run: () => go({ view: "tools", section: "keylist" }) },
    { id: "tools:dev", title: "Shader cache and logs", section: "Pages", icon: "bug", where: "Tools › Mod makers", keywords: "shader cache clear frame dumps log d3dx ini d3dx_user wipe reload",
      run: () => go({ view: "tools", section: "dev" }) },
    ...(g.modCount > 0 ? [{ id: "tools:share", title: `Share ${g.short} library`, section: "Actions", icon: "share" as const, hint: ".gachamod", where: "Tools › Share and move",
      keywords: "export share send friend backup gachamod pack links library mods profiles", run: () => emitApp({ type: "export-pack", game: g.id, scope: "game" }) }] : []),
    ...(allGames().filter((x) => x.modsDir && x.modCount > 0).length > 1 ? [{ id: "tools:share-all", title: "Share every game", section: "Actions", icon: "share" as const,
      hint: ".gachamod", where: "Tools › Share and move", keywords: "export share send friend backup gachamod pack links all games library", run: () => emitApp({ type: "export-pack", game: g.id, scope: "all" }) }] : []),
  ];
  return all.filter((c) => KEY_LIST_SHOWN || c.id !== "tools:keylist");
});

/** Tools' pages in order. A page holds the panels that belong together. */
const PAGES: PageInfo[] = [
  { id: "problems", label: "Problems and fixes", icon: "warn", tip: "What stops a mod from showing right in game, and the fixers for mods a game update broke" },
  { id: "conflicts", label: "Conflicts", icon: "layers", tip: "Mods that are on and change the same parts of a model, or use the same keys" },
  { id: "ingame", label: "Switch skins in game", icon: "swap" },
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
  return (
    <div className="page tools pg-screen">
      <PageHeader title="Tools" icon="tools" sub={`Mod fixes, conflicts, skin switching and mod maker tools for ${game.name}`} />
      <Paged name="tools" label="Tools pages" pages={PAGES} fallback={pageOf}>
        {{
          problems: <><ProblemsPanel /><FixesPanel game={game.id} /></>,
          conflicts: <><ConflictsPanel /><KeyClashesPanel /></>,
          ingame: <><InGamePanel game={game.id} />{KEY_LIST_SHOWN && <KeyListPanel game={game.id} />}</>,
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
  const [wipe, setWipe] = useState(false);
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
              <Button icon="trash" busy={busy === "cache"} disabled={!st?.shaderCache.bytes} title="Delete the shader cache. The game rebuilds it on the next start"
                onClick={() => void run("cache", async () => { const b = await dev.clearShaderCache(game.id); toast(`Freed ${formatBytes(b)}`); })}>Clear</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>Frame dumps</b><span className="hint">{st ? `${formatBytes(st.frameDumps.bytes)} in FrameAnalysis folders` : "…"}</span></span>
              <Button icon="trash" busy={busy === "dumps"} disabled={!st?.frameDumps.bytes} title="Delete the FrameAnalysis folders"
                onClick={() => void run("dumps", async () => { const b = await dev.clearFrameDumps(game.id); toast(`Freed ${formatBytes(b)}`); })}>Delete</Button>
            </div>
            <div className="tools-dev-row">
              <span><b>Saved mod options</b><span className="hint">Every mod goes back to its first look. A copy of d3dx_user.ini is kept</span></span>
              <Button variant="danger" icon="trash" disabled={!st?.d3dxUserIni || game.running} title={game.running ? "Close the game first" : "Reset every mod's options. A copy of d3dx_user.ini is kept"}
                onClick={() => setWipe(true)}>Wipe</Button>
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
      {wipe && (
        <Confirm title="Wipe saved mod options?" yes="Wipe" danger onClose={() => setWipe(false)}
          onYes={async () => { try { await dev.wipeUserConfig(game.id); toast("Mod options are back to their defaults"); load(); } catch (e) { toast(errorText(e), true); } }}>
          Every mod's chosen options (outfits, colours, toggles) go back to their first value. gachamod keeps a copy of the old file as d3dx_user.ini.wiped.bak.
        </Confirm>
      )}
    </Panel>
  );
}
