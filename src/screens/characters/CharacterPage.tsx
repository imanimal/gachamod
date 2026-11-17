// One character's page: a big portrait, previous and next ([ and ] keys), a scrolling row of the others to hop to,
// and two tabs: Installed (their mods, in the shared mod grid) and Online (GameBanana, only this character). The
// route holds it: { view: "characters", character, tab?: "online", modId? }. Back returns to the roster where it was
// scrolled. O marks the character as owned or not. Owner: LIBRARY area.
import { reveal, rowKeys, useSideScroll } from "../browse/sideScroll";
import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { errorText, type GameId, type ModEntry } from "../../lib/api";
import { characterTabs, useExtensions } from "../../lib/extensions";
import { charNoun } from "../../lib/games";
import { closeRoute, patchRoute, replaceRoute, useGame, useRoute } from "../../lib/store";
import { menuFor, menuHandler } from "../../ui/ContextMenu";
import { Button, Empty, IconButton, Tabs } from "../../ui/kit";
import { Portrait } from "../../ui/Portrait";
import { ShowAll, useRowOpen } from "../../ui/ShowAll";
import { toast } from "../../ui/toast";
import { GbBrowser } from "../browse/GbBrowser";
import { ExtensionFrame, NeedsNote } from "../extensions/ExtensionFrame";
import { changeStates } from "../library/data";
import { ModGrid } from "../library/ModGrid";
import { moveInGrid } from "../library/gridNav";
import { useModsFormat } from "../../lib/theme";
import { toggleOwned } from "./owned";
import type { RosterChar } from "./roster";
import { t, tn } from "../../lib/i18n";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function CharacterPage({ game, name, roster, order, mods, setMods, loaded }: {
  game: GameId; name: string; roster: RosterChar[] | null; order: RosterChar[]; mods: ModEntry[];
  setMods: Dispatch<SetStateAction<ModEntry[]>>; loaded: boolean;
}) {
  const route = useRoute();
  const gameState = useGame();
  const extTabs = characterTabs(useExtensions(), game);
  const extTab = extTabs.find((e) => `ext:${e.id}` === route.tab);
  const tab = route.tab === "online" ? "online" : extTab ? route.tab! : "installed";
  const stripRef = useRef<HTMLDivElement>(null);
  const one = charNoun(game, true), many = charNoun(game);
  // the Character list and Three panes layouts (Settings, Appearance) put the strip down the left as a list
  const format = useModsFormat();
  const side = format === "chars" || format === "panes";

  const c = roster?.find((x) => same(x.name, name));
  const own = useMemo(() => {
    const list = c?.mods ?? mods.filter((m) => m.character && same(m.character, name));
    return [...list].sort((a, b) => b.installedAt - a.installedAt || a.name.localeCompare(b.name));
  }, [c, mods, name]);
  const on = own.filter((m) => m.enabled);

  // the strip and previous/next follow the roster as you set it up; a character outside it still gets a place
  const strip = useMemo(() => (order.some((x) => same(x.name, name)) || !c ? order : [c, ...order]), [order, c, name]);
  const at = strip.findIndex((x) => same(x.name, name));
  const prev = strip.length > 1 ? strip[(at <= 0 ? strip.length : at) - 1] : undefined;
  const next = strip.length > 1 ? strip[(at + 1) % strip.length] : undefined;

  const hop = (to: RosterChar | undefined) => {
    if (!to) return;
    replaceRoute({ view: "characters", character: to.name, tab: route.tab });
    document.querySelector(".app .view")?.scrollTo({ top: 0 });
    document.querySelector(".characters .lib-main")?.scrollTo({ top: 0 });
  };
  const hopRef = useRef(hop);
  hopRef.current = hop;
  const sides = useRef({ prev, next });
  sides.current = { prev, next };
  const display = c?.name ?? name;
  const ownedRef = useRef(() => {});
  ownedRef.current = () => void toggleOwned(game, display);

  // [ and ] hop and O marks as owned, unless typing or a window is open
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((key !== "[" && key !== "]" && key !== "o") || e.ctrlKey || e.altKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (document.querySelector(".overlay, .ctx, .popover")) return;
      e.preventDefault();
      if (key === "o") ownedRef.current();
      else hopRef.current(key === "[" ? sides.current.prev : sides.current.next);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // the strip scrolls sideways with the mouse wheel, like the other rows of chips
  const [stripAll, toggleStripAll] = useRowOpen("character.strip");
  const stripEdges = useSideScroll(stripRef, [strip.length, stripAll]);

  // keep the current one in view in the strip
  useEffect(() => {
    const row = stripRef.current, on = row?.querySelector<HTMLElement>(".pchip.on");
    if (row && on) { if (side) on.scrollIntoView({ block: "nearest" }); else reveal(row, on, "center"); }
  }, [name, strip.length, side]);

  const defaultOutfit = async () => {
    try { await changeStates(game, t("{name} is back in the default outfit", { name }), [], on.map((m) => m.id), mods); }
    catch (e) { toast(errorText(e), true); }
  };

  const owned = !!c?.owned;
  const content = (
    extTab && gameState
      ? <div className="char-ext"><NeedsNote ext={extTab} /><ExtensionFrame ext={extTab} slot="characterTab" game={gameState} character={{ name: display, owned }} /></div>
      : tab === "online"
      ? <GbBrowser game={game} character={display} />
      : <ModGrid game={game} mods={own} all={mods} setMods={setMods} loading={!loaded && !own.length} showCharacter={false}
          empty={(
            <Empty icon="mods" title={t("No mods for {name} yet", { name: display })}
              actions={<Button variant="primary" icon="browse" onClick={() => patchRoute({ tab: "online" })} title={t("Look for {name} mods on GameBanana", { name: display })}>{t("Find mods online")}</Button>}>
              {t("Mods you install for {name} show up here.", { name: display })}
            </Empty>
          )} />
  );
  return (
    <>
      <header className="char-hero" onContextMenu={menuHandler(() => menuFor("character", { game, name: display }))}>
        <Portrait game={game} name={display} icon={c?.icon} size="7.5rem" ring className="char-hero-pic" />
        <div className="char-hero-t">
          <button type="button" className="char-hero-back" onClick={() => closeRoute(["character", "tab", "modId"])} title={t("Back to all {noun} (Alt+Left)", { noun: many.toLowerCase() })}>
            {many}
          </button>
          <h1 className="char-hero-name">{display}</h1>
          <span className="hint">
            {!own.length ? t("No mods installed yet") : on.length ? tn(own.length, "{n} mod, {on} on", "{n} mods, {on} on", { on: on.length }) : tn(own.length, "{n} mod, default outfit", "{n} mods, default outfit")}
          </span>
          <div className="char-hero-a">
            <Tabs value={tab} onChange={(v) => patchRoute({ tab: v === "installed" ? undefined : v, modId: undefined })}
              tabs={[{ value: "installed", label: t("Installed"), icon: "mods", count: own.length }, { value: "online", label: t("Online"), icon: "browse" },
                ...extTabs.map((e) => ({ value: `ext:${e.id}`, label: e.manifest!.characterTab!.title, icon: "puzzle" as const, title: t("From the {name} extension", { name: e.manifest!.name }) }))]} />
            {on.length > 0 && <Button size="sm" variant="ghost" icon="undo" onClick={() => void defaultOutfit()} title={t("Turns off every mod for {name}", { name: display })}>{t("Default outfit")}</Button>}
            <Button size="sm" variant="ghost" icon={owned ? "check" : "plus"} className={owned ? "char-owned on" : "char-owned"} aria-pressed={owned}
              onClick={() => void toggleOwned(game, display)}
              title={owned ? t("You own {name}. Click to mark as not owned (O)", { name: display }) : t("Mark {name} as owned, for the Owned filter on {page} (O)", { name: display, page: many })}>
              {owned ? t("Owned") : t("Mark as owned")}
            </Button>
          </div>
        </div>
        <div className="char-hero-nav">
          <IconButton icon="left" label={prev ? t("Previous: {name} ([)", { name: prev.name }) : t("Previous {noun} ([)", { noun: one.toLowerCase() })} disabled={!prev} onClick={() => hop(prev)} />
          <IconButton icon="right" label={next ? t("Next: {name} (])", { name: next.name }) : t("Next {noun} (])", { noun: one.toLowerCase() })} disabled={!next} onClick={() => hop(next)} />
        </div>
      </header>

      {strip.length > 1 && (
        <div className={`char-strip-wrap${stripAll ? " is-all" : ""}`}>
        <div ref={stripRef} className={`pchips char-strip${stripAll ? " is-all" : ""}`} role="list" aria-label={many} onKeyDown={(e) => (side ? moveInGrid(e, stripRef.current, ".pchip") : rowKeys(e, ".pchip"))}>
          {strip.map((x) => (
            <div key={x.name} role="listitem" className="char-strip-item">
            <button type="button" className={`pchip${same(x.name, name) ? " on" : ""}`} title={x.name}
              aria-current={same(x.name, name) ? "page" : undefined} onClick={() => hop(x)}
              onContextMenu={menuHandler(() => menuFor("character", { game, name: x.name }))}>
              <span className="pchip-img"><Portrait game={game} name={x.name} icon={x.icon} size="3rem" /></span>
              <span className="pchip-t">{x.name}</span>
              {x.mods.length > 0 && <span className="pchip-n">{x.mods.length}</span>}
            </button>
            </div>
          ))}
        </div>
        {!side && <ShowAll open={stripAll} onToggle={toggleStripAll} fits={!stripEdges.left && !stripEdges.right} label={t("Show every {noun} ({n})", { noun: one.toLowerCase(), n: strip.length })} />}
        </div>
      )}

      {side ? <div className="lib-main">{content}</div> : content}
    </>
  );
}
