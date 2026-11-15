// Tools > Switch skins in game: pick a character's skin while playing and it changes at once, without a reload
// (gacha-core live.rs, docs/ingame.md). Characters with two or more mods can be made live with one click. Owner: INGAME
// area.
import { useState } from "react";
import { errorText, fileUrl, live, type GameId, type LiveGroup, type LiveMod, type MenuSettings } from "../../lib/api";
import { toast } from "../../ui/toast";
import { Button, Checkbox, IconButton, Panel, Segmented, Skeleton, Toggle } from "../../ui/kit";
import { HotkeyField } from "../profiles/HotkeyField";
import { Icon } from "../../ui/Icon";
import { CharLink } from "../../ui/Links";
import { makeLive, pickLive, setAll, setMenu, stopLive, useLive } from "./data";
import "./ingame.css";

export function InGamePanel({ game }: { game: GameId }) {
  const info = useLive(game);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, job: () => Promise<unknown>) => { setBusy(key); try { await job(); } finally { setBusy(null); } };

  return (
    <Panel title="Switch skins in game" icon="swap" count={info?.groups.length || undefined}>
      <p className="hint">
        A character set up here keeps every skin loaded, so the one showing changes at once, without pressing F10. Pick
        it from the menu while you play, here, in Mods, or by switching profiles with a hotkey.
      </p>
      {info?.blocked && <Blocked menu={info.menu} />}
      {info && <MenuOptions game={game} menu={info.menu} blocked={info.blocked} />}
      {info && (
        <div className="live-all">
          <Toggle checked={info.all} disabled={!!busy} onChange={(on) => void run("all", () => setAll(game, on))} label="Every character"
            hint="Every mod that has a character stays loaded, so the menu lists all of them and any one shows at once. New mods join by themselves. With many mods the game takes longer to load them." />
        </div>
      )}
      {info === null && <div className="live-list"><Skeleton h="4.5rem" /><Skeleton h="4.5rem" /></div>}
      {info && info.groups.length > 0 && (
        <div className="live-list">
          {info.groups.map((g) => (
            <LiveRow key={g.group} game={game} g={g} busy={busy} run={run} />
          ))}
        </div>
      )}
      {info && info.ready.length > 0 && (
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
      {info && !info.groups.length && !info.ready.length && (
        <p className="muted">This needs two or more mods for one character. Mods without a character can't be switched here.</p>
      )}
    </Panel>
  );
}

const MENU_HINT: Record<MenuSettings["style"], (key: string) => string> = {
  window: (key) => `Press ${key} while you play and gachamod's menu opens over the game, with previews, search and every character. The game has to run borderless or windowed, and when it runs as administrator (Zenless Zone Zero does) gachamod has to as well. Otherwise ${key} opens the plainer menu the game draws.`,
  game: (key) => `Press ${key} while you play and the game draws a plain menu itself. Use this when you play in exclusive fullscreen. Borderless or windowed gets the better menu with Over the game.`,
  off: () => "No menu while you play. Skins still switch from here, from Mods and with profile hotkeys.",
};

/** How the menu opens while playing: gachamod's window over the game, the plainer one the game draws, or none. */
/** The game runs as administrator and gachamod doesn't: what that costs, and the one click that fixes it. */
function Blocked({ menu }: { menu: MenuSettings }) {
  const [busy, setBusy] = useState(false);
  const restart = () => { setBusy(true); live.restartAsAdmin().catch((e) => { toast(errorText(e), true); setBusy(false); }); };
  return (
    <div className="live-blocked" role="status">
      <Icon name="warn" />
      <p>
        This game runs as administrator and gachamod doesn't, so Windows keeps gachamod's keys away from it.
        {menu.style === "off" ? " " : ` ${menu.key} opens the plainer menu the game draws, not gachamod's menu over the game. `}
        After a change here, press F10 in the game to load it. Restarting gachamod as administrator fixes both.
      </p>
      <Button size="sm" variant="primary" busy={busy} disabled={busy} onClick={restart}
        title="Closes gachamod and opens it again as administrator. Windows asks you first">Restart as administrator</Button>
    </div>
  );
}

function MenuOptions({ game, menu, blocked }: { game: GameId; menu: MenuSettings; blocked: boolean }) {
  const set = (patch: Partial<MenuSettings>) => void setMenu(game, menu, { ...menu, ...patch });
  return (
    <div className="live-menu">
      <div className="live-menu-row">
        <span className="live-menu-l">Menu while you play</span>
        <Segmented label="Menu while you play" size="sm" value={menu.style} onChange={(style) => set({ style })} options={[
          { value: "window", label: "Over the game", title: "gachamod's own menu on top of the game. The better one. Needs borderless or windowed" },
          { value: "game", label: "Inside the game", title: "A plainer menu the game draws itself. Works in exclusive fullscreen" },
          { value: "off", label: "Off", title: "No menu while you play" },
        ]} />
      </div>
      {menu.style !== "off" && (
        <div className="live-menu-row">
          <HotkeyField label="Key that opens it" value={menu.key} bareF keep onChange={(key) => { if (key && key !== menu.key) set({ key }); }} />
          <Checkbox checked={menu.pad} onChange={(pad) => set({ pad })} label="Pressing both sticks in opens it too" />
        </div>
      )}
      <p className="hint">{MENU_HINT[menu.style](menu.key)} {blocked ? "Press F10 in the game after a change here." : "The game reloads once after a change here."}</p>
    </div>
  );
}

function LiveRow({ game, g, busy, run }: { game: GameId; g: LiveGroup; busy: string | null; run: (k: string, job: () => Promise<unknown>) => Promise<void> }) {
  const pick = (slot: number) => void run(`pick-${g.group}`, () => pickLive(game, g, slot));
  return (
    <div className="live-row">
      <div className="live-row-h">
        <CharLink game={game} name={g.character} portrait />
        <span className="grow" />
        <IconButton size="sm" icon="x" label={`Stop switching ${g.character} in game. The skin showing stays on, the others turn off`}
          disabled={!!busy} onClick={() => void run(`stop-${g.group}`, () => stopLive(game, g.mods.map((m) => m.modId), g.character))} />
      </div>
      <div className="live-chips" role="radiogroup" aria-label={`${g.character}'s skin`}>
        <button type="button" role="radio" aria-checked={g.active === 0} className={`live-chip${g.active === 0 ? " on" : ""}`}
          disabled={busy === `pick-${g.group}`} onClick={() => pick(0)}
          title={`None of these: ${g.character} wears the game's own look (or a mod that isn't live)`}>
          <span className="live-thumb"><Icon name="block" /></span>
          <span className="live-chip-t">None</span>
        </button>
        {g.mods.map((m) => <Chip key={m.modId} m={m} on={g.active === m.slot} busy={busy === `pick-${g.group}`} onPick={() => pick(m.slot)} />)}
      </div>
    </div>
  );
}

function Chip({ m, on, busy, onPick }: { m: LiveMod; on: boolean; busy: boolean; onPick: () => void }) {
  const src = fileUrl(m.preview);
  return (
    <button type="button" role="radio" aria-checked={on} className={`live-chip${on ? " on" : ""}${m.enabled ? "" : " is-off"}`} disabled={busy} onClick={onPick}
      title={on ? `${m.name} is showing` : m.enabled ? `Show ${m.name}` : `${m.name} is off. Picking it turns it on, and it shows after the game reloads`}>
      <span className="live-thumb">{src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <Icon name="mods" />}</span>
      <span className="live-chip-t">{m.name}</span>
      {on && <Icon name="check" className="live-chip-on" />}
    </button>
  );
}
