// Tools > Switch skins in game: pick a character's skin while playing and it changes at once, without a reload
// (gacha-core live.rs, docs/ingame.md). One switch turns it on or off for every character; on by default in Zenless
// Zone Zero and Genshin Impact. Every game has it with the menu over the game; the menu the game draws is a tester
// option outside those two, Star Rail and Honkai Impact 3rd (live.rs drawn_menu_open). Owner: INGAME area.
import { useState } from "react";
import { fileUrl, type GameId, type LiveGroup, type LiveMod, type MenuSettings } from "../../lib/api";
import { Badge, Button, Checkbox, IconButton, Panel, Segmented, Skeleton, Toggle } from "../../ui/kit";
import { HotkeyField } from "../profiles/HotkeyField";
import { KeyClashNote } from "./KeyClash";
import { MenuKeys } from "./MenuKeys";
import { Icon } from "../../ui/Icon";
import { CharLink } from "../../ui/Links";
import { makeLive, patchMenu, pickLive, reloadLive, setAll, setTester, stopLive, useLive, useLiveError } from "./data";
import { useSetting } from "../settings/parts";
import "./ingame.css";
import { LazyImg } from "../../ui/LazyImg";
import { go, reloadKeyOf, useGames } from "../../lib/store";
import { openGameCheck } from "../../lib/feedback";
import { AdminRow } from "../settings/Feedback";
import { menuHandler } from "../../ui/ContextMenu";


export function InGamePanel({ game }: { game: GameId }) {
  const info = useLive(game);
  const name = useGames().find((g) => g.id === game)?.name ?? "this game";
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, job: () => Promise<unknown>) => { setBusy(key); try { await job(); } finally { setBusy(null); } };
  const error = useLiveError(game);

  if (error) {
    return (
      <Panel title="Switch skins in game" icon="swap">
        <p className="hint row"><span>Couldn't read the game's skins: {error}</span>
          <Button size="sm" icon="refresh" busy={busy === "retry"} onClick={() => void run("retry", () => reloadLive(game))} title="Read the game's skins again">Try again</Button></p>
      </Panel>
    );
  }

  // one switch: on, every character's skins stay loaded and the menu key works; off, none of it shows
  const on = !!info?.all;
  return (
    <Panel title="Switch skins in game" icon="swap" count={info?.groups.length || undefined}>
      {info && (
        <div className="live-all">
          <Toggle checked={on} disabled={!!busy} onChange={(v) => void run("all", () => setAll(game, v))} label={`Pick skins with ${info.menu.key} while you play`}
            hint={on ? `Every character's mods stay loaded, so the skin you pick shows at once, without pressing ${reloadKeyOf(game)}. New mods join by themselves. With many mods the game takes longer to load them.`
              : `Off: ${info.menu.key} does nothing in the game, and each character shows one skin until you change it in Mods.`} />
        </div>
      )}
      {on && info?.blocked && <Blocked game={game} menu={info.menu} drawn={info.allowed} />}
      {on && <KeyClashNote game={game} />}
      {on && info && <MenuOptions game={game} name={name} menu={info.menu} blocked={info.blocked} drawn={info.allowed} checked={info.checked} />}
      {info === null && <div className="live-list"><Skeleton h="4.5rem" /><Skeleton h="4.5rem" /></div>}
      {info && info.groups.length > 0 && (
        <div className="live-list">
          {info.groups.map((g) => (
            <LiveRow key={g.group} game={game} g={g} busy={busy} run={run} />
          ))}
        </div>
      )}
      {on && info && info.ready.length > 0 && (
        <>
          <h3 className="live-h">{info.groups.length ? "More characters with several skins" : "Characters with several skins"}</h3>
          <div className="live-ready">
            {info.ready.map((r) => {
              const live = info.groups.some((g) => g.character.toLowerCase() === r.character.toLowerCase());
              return (
                <div key={r.character} className="live-ready-row">
                  <CharLink game={game} name={r.character} portrait />
                  <span className="hint">{r.mods.length} {live ? (r.mods.length === 1 ? "new mod" : "new mods") : "mods"}</span>
                  <span className="grow" />
                  <Button size="sm" variant={live ? "secondary" : "primary"} icon="swap" busy={busy === `add-${r.character}`} disabled={!!busy}
                    title={live ? `Add ${r.mods.map((m) => m.name).join(", ")} to ${r.character}'s live skins`
                      : `Every ${r.character} mod stays loaded and you pick which one shows. The game reloads once to start`}
                    onClick={() => void run(`add-${r.character}`, () => makeLive(game, r.mods.map((m) => m.modId), `${r.character}`))}>
                    {live ? "Add to live skins" : "Switch in game"}
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {on && info && !info.groups.length && !info.ready.length && (
        <p className="muted">None of your mods has a character yet, so there's nothing to switch. Mods without a character always stay as they are.</p>
      )}
    </Panel>
  );
}

/** `drawn`: the game has the menu it draws itself (live.rs `allowed`). */
const MENU_HINT: Record<MenuSettings["style"], (key: string, drawn: boolean) => string> = {
  window: (key, drawn) => `Press ${key} while you play and gachamod's menu opens over the game, with previews, search and every character. `
    + (drawn ? `In exclusive fullscreen, or when gachamod can't hear the key, ${key} opens the plainer menu the game draws.` : "It needs borderless or windowed mode."),
  game: (key) => `Press ${key} while you play and the game draws a plain menu itself. Use this when you play in exclusive fullscreen. Borderless or windowed gets the better menu with Over the game.`,
};

/** The game runs as administrator and gachamod doesn't: what that costs, and the setting that fixes it (restart now,
 *  or always, the same row as in Settings). */
function Blocked({ game, menu, drawn }: { game: GameId; menu: MenuSettings; drawn: boolean }) {
  return (
    <>
      <div className="live-blocked" role="status">
        <Icon name="warn" />
        <p>
          This game runs as administrator and gachamod doesn't, so Windows keeps gachamod's keys away from it.
          {drawn ? ` ${menu.key} opens the plainer menu the game draws, not gachamod's menu over the game. ` : ` ${menu.key} can't open gachamod's menu over the game. `}
          After a change here, press {reloadKeyOf(game)} in the game to load it. Running gachamod as administrator fixes both.
        </p>
      </div>
      <AdminRow />
    </>
  );
}

/** How the menu opens while playing: gachamod's window over the game, or the plainer one the game draws. `drawn`: the
 *  game has the drawn menu (live.rs drawn_menu_open, or tester options on); `checked`: it has it without tester
 *  options, so it isn't marked as one. */
function MenuOptions({ game, name, menu, blocked, drawn, checked }:
  { game: GameId; name: string; menu: MenuSettings; blocked: boolean; drawn: boolean; checked: boolean }) {
  // each change starts from the one before it, so quick changes don't put each other back
  const set = (patch: Partial<MenuSettings>) => void patchMenu(game, menu, patch);
  // otherkeys.rs ASK: the toasts that ask when another app has the key that opens the menu
  const [ask, setAsk] = useSetting("otherKeys.ask", "1");
  return (
    <div className="live-menu">
      {drawn && (
        <div className="live-menu-row">
          <span className="live-menu-l">Menu while you play</span>
          <Segmented label="Menu while you play" size="sm" value={menu.style} onChange={(style) => set({ style })} options={[
            { value: "window", label: "Over the game", title: "gachamod's own menu on top of the game. The better one. Needs borderless or windowed" },
            { value: "game", label: "Inside the game", title: `A plainer menu the game draws itself. Works in exclusive fullscreen${checked ? "" : `. A tester option in ${name}`}` },
          ]} />
          {!checked && <Badge tone="info" onClick={openGameCheck}
            title={`In ${name} the menu the game draws is a tester option. Click to check this game and send what works`}>Tester option</Badge>}
        </div>
      )}
      <div className="live-menu-row">
        <HotkeyField label="Key that opens it" value={menu.key} bareF keep reloadKey={reloadKeyOf(game)} reset="F7" onChange={(key) => { if (key && key !== menu.key) set({ key }); }} />
        <Checkbox checked={ask !== "0"} onChange={(v) => setAsk(v ? "1" : "0")} label="Say when another app uses this key"
          title="When Medal, OBS, Steam or another recorder listens for the key that opens the skin menu, gachamod says so and offers a free key. The note on this page shows either way" />
        <Checkbox checked={menu.pad} onChange={(pad) => set({ pad })} label="Use a controller in the menu"
          title="Both sticks pressed in open it, the D-pad moves, A shows a skin and B closes it. Menu keys changes the buttons" />
      </div>
      <MenuKeys menu={menu} onChange={(update, label) => void patchMenu(game, menu, (m) => ({ binds: update(m.binds) }), label)} />
      {drawn && <Checkbox checked={menu.fastSave} onChange={(fastSave) => set({ fastSave })} label="Show skins picked in the game right away"
        title="The game saves its values every second instead of every minute (settings_auto_save_interval in d3dx.ini), so a skin picked in its own menu shows here at once. Starts after the game reloads its mods" />}
      <p className="hint">{MENU_HINT[menu.style](menu.key, drawn)} {blocked ? `Press ${reloadKeyOf(game)} in the game after a change here.` : "The game reloads once after a change here."}</p>
      {!drawn && (
        <p className="hint row"><span>Playing in exclusive fullscreen? Tester options add the menu the game draws.</span>
          <Button size="sm" variant="ghost" icon="settings" onClick={() => void setTester(true)}
            title="Turns on tester options. It asks first and says what they risk">Tester options</Button></p>
      )}
      <p className="hint live-keys">The menu's Keys tab lists the toggle keys of the mods showing now. Click a key there to rebind it.
        <Button size="sm" variant="ghost" icon="keyboard" onClick={() => go({ view: "tools", section: "keylist" })} title="Opens Key list in game: its key, where it shows and which mods it lists">Key list settings</Button></p>
    </div>
  );
}

function LiveRow({ game, g, busy, run }: { game: GameId; g: LiveGroup; busy: string | null; run: (k: string, job: () => Promise<unknown>) => Promise<void> }) {
  const pick = (slot: number) => void run(`pick-${g.group}`, () => pickLive(game, g, slot));
  return (
    <div className="live-row">
      <div className="live-row-h">
        <CharLink game={game} name={g.character} portrait />
        {g.waiting && <span className="hint" title="gachamod couldn't key the pick into the game, so the game shows it at its next reload">
          Shows after the game reloads its mods ({reloadKeyOf(game)})</span>}
        <span className="grow" />
        <IconButton size="sm" icon="x" label={`Stop switching ${g.character} in game. The skin showing stays on, the others turn off`}
          disabled={!!busy} onClick={() => void run(`stop-${g.group}`, () => stopLive(game, g.mods.map((m) => m.modId), g.character))} />
      </div>
      <div className="live-chips" role="radiogroup" aria-label={`${g.character}'s skin`}>
        <button type="button" role="radio" aria-checked={g.active === 0} className={`live-chip${g.active === 0 ? " on" : ""}`}
          disabled={busy === `pick-${g.group}`} onClick={() => pick(0)}
          title={`None of these: vanilla ${g.character} (or a mod that isn't live)`}>
          <span className="live-thumb"><Icon name="block" /></span>
          <span className="live-chip-t">None</span>
        </button>
        {g.mods.map((m) => <Chip key={m.modId} m={m} on={g.active === m.slot} busy={busy === `pick-${g.group}`} onPick={() => pick(m.slot)}
          onStop={() => void run(`stop-${g.group}`, () => stopLive(game, [m.modId], m.name))} />)}
      </div>
    </div>
  );
}

function Chip({ m, on, busy, onPick, onStop }: { m: LiveMod; on: boolean; busy: boolean; onPick: () => void; onStop: () => void }) {
  const src = fileUrl(m.preview);
  const menu = menuHandler(() => [
    { label: "Show in game", icon: "check", disabled: on || busy, onClick: onPick },
    { label: "View in Mods", icon: "mods", onClick: () => go({ view: "library", modId: m.modId }) },
    { label: "Stop switching this skin", icon: "x", disabled: busy, title: "Takes it out of the menu while you play", onClick: onStop },
  ]);
  return (
    <button type="button" role="radio" aria-checked={on} className={`live-chip${on ? " on" : ""}${m.enabled ? "" : " is-off"}`} disabled={busy} onClick={onPick}
      onContextMenu={menu}
      title={on ? `${m.name} is showing` : m.enabled ? `Show ${m.name}` : `${m.name} is off. Picking it turns it on, and it shows after the game reloads`}>
      <span className="live-thumb">{src ? <LazyImg src={src} alt="" draggable={false} /> : <Icon name="mods" />}</span>
      <span className="live-chip-t">{m.name}</span>
      {on && <Icon name="check" className="live-chip-on" />}
    </button>
  );
}
