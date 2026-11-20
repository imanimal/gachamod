// Tools > Switch skins in game: pick a character's skin while playing and it changes at once, without a reload
// (gacha-core live.rs, docs/ingame.md). One switch turns it on or off for every character; on by default in Zenless
// Zone Zero and Genshin Impact. Every game has it with the menu over the game; the menu the game draws is a tester
// option outside those two, Star Rail and Honkai Impact 3rd (live.rs drawn_menu_open). Owner: INGAME area.
import { useState } from "react";
import { fileUrl, type GameId, type LiveGroup, type LiveMod, type MenuSettings } from "../../lib/api";
import { Badge, Button, Checkbox, IconButton, Panel, Segmented, Skeleton, Toggle } from "../../ui/kit";
import { KeyClashNote } from "./KeyClash";
import { MenuKeyFields } from "./MenuKeyFields";
import { Icon } from "../../ui/Icon";
import { CharLink } from "../../ui/Links";
import { makeLive, patchMenu, pickLive, reloadLive, setAll, setTester, stopLive, useLive, useLiveError } from "./data";
import "./ingame.css";
import { LazyImg } from "../../ui/LazyImg";
import { go, reloadKeyOf, useGames } from "../../lib/store";
import { openGameCheck } from "../../lib/feedback";
import { AdminRow } from "../settings/Feedback";
import { menuHandler } from "../../ui/ContextMenu";
import { gameName } from "../../lib/games";
import { t, tn } from "../../lib/i18n";


export function InGamePanel({ game }: { game: GameId }) {
  const info = useLive(game);
  const name = gameName(useGames().find((g) => g.id === game)) || t("this game");
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, job: () => Promise<unknown>) => { setBusy(key); try { await job(); } finally { setBusy(null); } };
  const error = useLiveError(game);

  if (error) {
    return (
      <Panel title={t("Switch skins in game")} icon="swap">
        <p className="hint row"><span>{t("Couldn't read the game's skins: {error}", { error })}</span>
          <Button size="sm" icon="refresh" busy={busy === "retry"} onClick={() => void run("retry", () => reloadLive(game))} title={t("Read the game's skins again")}>{t("Try again")}</Button></p>
      </Panel>
    );
  }

  // one switch: on, every character's skins stay loaded and the menu key works; off, none of it shows
  const on = !!info?.all;
  return (
    <Panel title={t("Switch skins in game")} icon="swap" count={info?.groups.length || undefined}>
      {info && (
        <div className="live-all">
          <Toggle checked={on} disabled={!!busy} onChange={(v) => void run("all", () => setAll(game, v))} label={t("Pick skins with {key} while you play", { key: info.menu.key })}
            hint={on ? t("Every character's mods stay loaded, so the skin you pick shows at once, without pressing {key}. New mods join by themselves. With many mods the game takes longer to load them.", { key: reloadKeyOf(game) })
              : t("Off: {key} does nothing in the game, and each character shows one skin until you change it in Mods.", { key: info.menu.key })} />
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
          <h3 className="live-h">{info.groups.length ? t("More characters with several skins") : t("Characters with several skins")}</h3>
          <div className="live-ready">
            {info.ready.map((r) => {
              const live = info.groups.some((g) => g.character.toLowerCase() === r.character.toLowerCase());
              return (
                <div key={r.character} className="live-ready-row">
                  <CharLink game={game} name={r.character} portrait />
                  <span className="hint">{live ? tn(r.mods.length, "{n} new mod", "{n} new mods") : tn(r.mods.length, "{n} mod", "{n} mods")}</span>
                  <span className="grow" />
                  <Button size="sm" variant={live ? "secondary" : "primary"} icon="swap" busy={busy === `add-${r.character}`} disabled={!!busy}
                    title={live ? t("Add {mods} to {character}'s live skins", { mods: r.mods.map((m) => m.name).join(", "), character: r.character })
                      : t("Every {character} mod stays loaded and you pick which one shows. The game reloads once to start", { character: r.character })}
                    onClick={() => void run(`add-${r.character}`, () => makeLive(game, r.mods.map((m) => m.modId), `${r.character}`))}>
                    {live ? t("Add to live skins") : t("Switch in game")}
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {on && info && !info.groups.length && !info.ready.length && (
        <p className="muted">{t("None of your mods has a character yet, so there's nothing to switch. Mods without a character always stay as they are.")}</p>
      )}
    </Panel>
  );
}

/** `drawn`: the game has the menu it draws itself (live.rs `allowed`). */
const MENU_HINT: Record<MenuSettings["style"], (key: string, drawn: boolean) => string> = {
  window: (key, drawn) => drawn
    ? t("Press {key} while you play and gachamod's menu opens over the game, with previews, search and every character. In exclusive fullscreen, or when gachamod misses the key, {key} opens the plainer menu the game draws.", { key })
    : t("Press {key} while you play and gachamod's menu opens over the game, with previews, search and every character. It needs borderless or windowed mode.", { key }),
  game: (key) => t("Press {key} while you play and the game draws a plain menu itself. Use this when you play in exclusive fullscreen. Borderless or windowed gets the better menu with Over the game.", { key }),
};

/** The game runs as administrator and gachamod doesn't: what that costs, and the setting that fixes it (restart now,
 *  or always, the same row as in Settings). */
function Blocked({ game, menu, drawn }: { game: GameId; menu: MenuSettings; drawn: boolean }) {
  return (
    <>
      <div className="live-blocked" role="status">
        <Icon name="warn" />
        <p>
          {drawn
            ? t("This game runs as administrator and gachamod doesn't, so Windows keeps gachamod's keys away from it. {key} opens the plainer menu the game draws, not gachamod's menu over the game. After a change here, press {reload} in the game to load it. Running gachamod as administrator fixes both.", { key: menu.key, reload: reloadKeyOf(game) })
            : t("This game runs as administrator and gachamod doesn't, so Windows keeps gachamod's keys away from it. {key} can't open gachamod's menu over the game. After a change here, press {reload} in the game to load it. Running gachamod as administrator fixes both.", { key: menu.key, reload: reloadKeyOf(game) })}
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
  return (
    <div className="live-menu">
      {drawn && (
        <div className="live-menu-row">
          <span className="live-menu-l">{t("Menu while you play")}</span>
          <Segmented label={t("Menu while you play")} size="sm" value={menu.style} onChange={(style) => set({ style })} options={[
            { value: "window", label: t("Over the game"), title: t("gachamod's menu on top of the game. Better, but needs borderless or windowed") },
            { value: "game", label: t("Inside the game"), title: checked ? t("A plainer menu the game draws itself. Works in exclusive fullscreen")
              : t("A plainer menu the game draws itself. Works in exclusive fullscreen. A tester option in {game}", { game: name }) },
          ]} />
          {!checked && <Badge tone="info" onClick={openGameCheck}
            title={t("In {game} the menu the game draws is a tester option. Click to check this game and send what works", { game: name })}>{t("Tester option")}</Badge>}
        </div>
      )}
      <MenuKeyFields game={game} menu={menu} />
      {drawn && <Checkbox checked={menu.fastSave} onChange={(fastSave) => set({ fastSave })} label={t("Show skins picked in the game right away")}
        title={t("The game saves the values every second instead of every minute (settings_auto_save_interval in d3dx.ini), so a skin picked in the game's menu shows here at once. Starts after the game reloads mods")} />}
      <p className="hint">{MENU_HINT[menu.style](menu.key, drawn)} {blocked ? t("Press {key} in the game after a change here.", { key: reloadKeyOf(game) }) : t("The game reloads once after a change here.")}</p>
      {!drawn && (
        <p className="hint row"><span>{t("For exclusive fullscreen, tester options add the menu the game draws.")}</span>
          <Button size="sm" variant="ghost" icon="settings" onClick={() => void setTester(true)}
            title={t("Turns on tester options. It asks first and says what they risk")}>{t("Tester options")}</Button></p>
      )}
      <p className="hint live-keys">{t("The menu's Keys tab lists the toggle keys of the mods showing now. Click a key there to rebind it.")}
        <Button size="sm" variant="ghost" icon="keyboard" onClick={() => go({ view: "tools", section: "keylist" })} title={t("Opens Key list in game: the key, where it shows and which mods it lists")}>{t("Key list settings")}</Button></p>
    </div>
  );
}

function LiveRow({ game, g, busy, run }: { game: GameId; g: LiveGroup; busy: string | null; run: (k: string, job: () => Promise<unknown>) => Promise<void> }) {
  const pick = (slot: number) => void run(`pick-${g.group}`, () => pickLive(game, g, slot));
  return (
    <div className="live-row">
      <div className="live-row-h">
        <CharLink game={game} name={g.character} portrait />
        {g.waiting && <span className="hint" title={t("gachamod couldn't send the pick to the game, so the game shows it at the next reload")}>
          {t("Shows after the game reloads mods ({key})", { key: reloadKeyOf(game) })}</span>}
        <span className="grow" />
        <IconButton size="sm" icon="x" label={t("Stop switching {name} in game. The skin showing stays on, the others turn off", { name: g.character })}
          disabled={!!busy} onClick={() => void run(`stop-${g.group}`, () => stopLive(game, g.mods.map((m) => m.modId), g.character))} />
      </div>
      <div className="live-chips" role="radiogroup" aria-label={t("{name}'s skin", { name: g.character })}>
        <button type="button" role="radio" aria-checked={g.active === 0} className={`live-chip${g.active === 0 ? " on" : ""}`}
          disabled={busy === `pick-${g.group}`} onClick={() => pick(0)}
          title={t("None of these: vanilla {name} (or a mod that isn't live)", { name: g.character })}>
          <span className="live-thumb"><Icon name="block" /></span>
          <span className="live-chip-t">{t("None")}</span>
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
    { label: t("Show in game"), icon: "check", disabled: on || busy, onClick: onPick },
    { label: t("View in Mods"), icon: "mods", onClick: () => go({ view: "library", modId: m.modId }) },
    { label: t("Stop switching this skin"), icon: "x", disabled: busy, title: t("Takes it out of the menu while you play"), onClick: onStop },
  ]);
  return (
    <button type="button" role="radio" aria-checked={on} className={`live-chip${on ? " on" : ""}${m.enabled ? "" : " is-off"}`} disabled={busy} onClick={onPick}
      onContextMenu={menu}
      title={on ? t("{name} is showing", { name: m.name }) : m.enabled ? t("Show {name}", { name: m.name }) : t("{name} is off. Picking it turns it on, and it shows after the game reloads", { name: m.name })}>
      <span className="live-thumb">{src ? <LazyImg src={src} alt="" draggable={false} /> : <Icon name="mods" />}</span>
      <span className="live-chip-t">{m.name}</span>
      {on && <Icon name="check" className="live-chip-on" />}
    </button>
  );
}
