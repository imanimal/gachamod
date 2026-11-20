// Home: what people do most, in the fewest clicks. A stack of widgets the user can hide and reorder (Customise):
// Play with the profiles and quick actions, updates, new high-quality mods, picks for you, followed creators, your
// characters, recent installs and a small GameBanana browser. A widget with nothing to show is left out (in Customise
// it says so instead). Owner: HOME/PROFILES area.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { dialogs, errorText, fileUrl, type GameState, type ModEntry, type Profile } from "../../lib/api";
import { record } from "../../lib/history";
import { useCreators, useNsfw, type NsfwMode } from "../../lib/prefs";
import { useModSubs } from "../../lib/subscriptions";
import { surpriseMe } from "../../lib/recommend";
import { usePortraitBatch } from "../../lib/portraits";
import { charNoun, gameName } from "../../lib/games";
import { t, tn } from "../../lib/i18n";
import { emitApp, go, useGame } from "../../lib/store";
import { gameInfo } from "../../lib/gamebanana";
import { Badge, Button, IconButton, Skeleton, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { Portrait } from "../../ui/Portrait";
import { menuFor, menuHandler } from "../../ui/ContextMenu";
import { withoutKeys } from "../../lib/menuHints";
import { toast } from "../../ui/toast";
import { checkModUpdates, openModsFolder, rescan } from "../../shell/commands";
import { GbBrowser, AdultSwitch } from "../browse/GbBrowser";
import { GbStrip } from "../browse/GbStrip";
import { usePull } from "../browse/Pull";
import { rowKeys, useSideScroll } from "../browse/sideScroll";
import { ShowAll, useRowOpen } from "../../ui/ShowAll";
import { useMods } from "../library/data";
import { getUpdate } from "../library/actions";
import { useRoster } from "../characters/roster";
import { quickNewProfile, switchTo } from "../profiles/actions";
import { useProfiles, useSwitching } from "../profiles/data";
import { newProfileMenu } from "../profiles/menus";
import { ProfileThumb } from "../profiles/ProfileThumb";
import "../profiles/menus";
import { PlayButton } from "./PlayButton";
import { DEFAULT_LAYOUT, WIDGETS, homeLayoutPref, move, normalize, setHomeEditing, setShown, useHomeEditing, type HomeLayout, type WidgetId } from "./layout";
import "./commands";
import "./home.css";
import { LazyImg } from "../../ui/LazyImg";

export function Home() {
  const game = useGame();
  if (!game) return null;
  return <HomeFor key={game.id} game={game} />;
}

function HomeFor({ game }: { game: GameState }) {
  const layout = normalize(homeLayoutPref.use());
  const editing = useHomeEditing();
  const lib = useMods(game.id);
  const creators = useCreators();
  const following = Object.values(creators).some((c) => (c.sub || c.prio) && !c.blocked);
  const subs = useModSubs();
  const subscribed = Object.values(subs).some((s) => s.game === null || s.game === game.gamebananaId);
  const before = useRef<HomeLayout | null>(null);

  // leaving Home ends Customise; the layout so far stays, with one Undo for all of it
  useEffect(() => () => finish(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editing) return;
    if (!before.current) before.current = layout;
    // Esc ends Customise (not while typing in a field)
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      finish();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish() {
    const from = before.current;
    before.current = null;
    setHomeEditing(false);
    const to = normalize(homeLayoutPref.get());
    // Home shows the new layout: Ctrl+Z still puts the old one back
    if (from && JSON.stringify(from) !== JSON.stringify(to)) {
      record({ label: t("Changed what Home shows"), undo: () => homeLayoutPref.set(from), redo: () => homeLayoutPref.set(to) }, true);
    }
  }
  const put = (l: HomeLayout) => void homeLayoutPref.set(l);
  // the characters widget is named with the game's word ("Your resonators"), here and in Customise
  const noun = charNoun(game.id);
  const titleOf = (id: WidgetId) => id === "characters" ? t("Your {noun}", { noun: noun.toLowerCase() }) : WIDGETS[id].title;
  const tipOf = (id: WidgetId) => id === "characters" ? t("{noun} you have mods for", { noun }) : WIDGETS[id].tip;

  // right-click on a widget's header: hide it, with Undo
  const headerMenu = (id: WidgetId) => (e: MouseEvent) => {
    if (!(e.target as Element | null)?.closest?.("header")) return;
    menuHandler(() => [
      { label: t("Hide from Home"), icon: "hide", onClick: () => {
        const from = normalize(homeLayoutPref.get());
        const to = setShown(from, id, false);
        put(to);
        record({ label: t("Hid {widget} from Home", { widget: titleOf(id) }), undo: async () => homeLayoutPref.set(from), redo: async () => homeLayoutPref.set(to) });
      } },
      // customising already: the way out of it
      editing
        ? { label: t("Done"), icon: "check", title: t("Done (Esc)"), onClick: finish }
        : { label: t("Customise Home"), icon: "layout", onClick: () => setHomeEditing(true) },
    ])(e);
  };

  const body = (id: WidgetId) => {
    switch (id) {
      case "start": return <QuickBar game={game} mods={lib.mods} />;
      case "updates": return <Updates game={game} mods={lib.mods} editing={editing} />;
      case "subscribed": return subscribed ? <GbStrip game={game.id} title={WIDGETS.subscribed.title} query={{ subscribed: true }} />
        : editing ? <Nothing title={WIDGETS.subscribed.title}>{t("Click the bell on a mod's page and gachamod tells you when it updates. Those mods show here.")}</Nothing> : null;
      case "hq": return <GbStrip game={game.id} title={WIDGETS.hq.title} query={{ hq: true, sort: "new" }} />;
      case "foryou": return <GbStrip game={game.id} title={WIDGETS.foryou.title} query={{ sort: "foryou" }} />;
      case "followed": return following ? <GbStrip game={game.id} title={WIDGETS.followed.title} query={{ followed: true }} />
        : editing ? <Nothing title={WIDGETS.followed.title}>{t("Follow a creator (right-click their name) and their new mods show here.")}</Nothing> : null;
      case "characters": return <Characters game={game} mods={lib.mods} loaded={lib.loaded} editing={editing} />;
      case "recent": return <Recent game={game} mods={lib.mods} loaded={lib.loaded} editing={editing} />;
      case "browser": return <section className="home-w-browser" aria-label="GameBanana"><GbBrowser game={game.id} embedded onExpand={() => go("browse")} /></section>;
    }
  };

  const shown = layout.order.filter((id) => editing || !layout.hidden.includes(id));
  // no mods yet: the getting-started prompt (in Recently installed) goes right after Play
  if (!editing && lib.loaded && !lib.mods.length && shown.includes("recent")) {
    shown.splice(shown.indexOf("recent"), 1);
    shown.splice(shown.indexOf("start") + 1, 0, "recent");
  }
  return (
    <div className={`page home${editing ? " is-editing" : ""}`}>
      {editing && (
        <div className="home-edit-bar" role="toolbar" aria-label={t("Customise Home")}>
          <Icon name="layout" />
          <span className="home-edit-t">{t("Show, hide and move what Home shows. Alt+Up and Alt+Down move the focused one.")}</span>
          <span className="grow" />
          <Button size="sm" variant="ghost" icon="undo" onClick={() => put(DEFAULT_LAYOUT)} title={t("Every widget, in the order Home started with")}>{t("Reset")}</Button>
          <Button size="sm" variant="primary" icon="check" onClick={finish} title={t("Done (Esc)")}>{t("Done")}</Button>
        </div>
      )}
      {shown.map((id, i) => {
        const hidden = layout.hidden.includes(id);
        if (!editing) return <div key={id} className={`home-w home-w-${id}`} onContextMenu={headerMenu(id)}>{body(id)}</div>;
        const onKey = (e: KeyboardEvent) => {
          if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          e.preventDefault();
          put(move(layout, id, e.key === "ArrowUp" ? -1 : 1));
        };
        return (
          <div key={id} className={`home-w home-w-${id} is-edit${hidden ? " is-hidden" : ""}`} onKeyDown={onKey}>
            <div className="home-w-edit">
              <Icon name={WIDGETS[id].icon} />
              <span className="home-w-edit-t" title={tipOf(id)}>{titleOf(id)}</span>
              {hidden && <Badge tone="muted">{t("Hidden")}</Badge>}
              <span className="grow" />
              <IconButton size="sm" icon="up" label={t("Move {widget} up", { widget: titleOf(id) })} title={t("Move up (Alt+Up)")} disabled={i === 0} onClick={() => put(move(layout, id, -1))} />
              <IconButton size="sm" icon="down" label={t("Move {widget} down", { widget: titleOf(id) })} title={t("Move down (Alt+Down)")} disabled={i === shown.length - 1} onClick={() => put(move(layout, id, 1))} />
              <Button size="sm" variant={hidden ? "primary" : "secondary"} icon={hidden ? "eye" : "hide"} onClick={() => put(setShown(layout, id, hidden))}
                title={hidden ? t("Show it on Home") : t("Hide it from Home")}>{hidden ? t("Show") : t("Hide")}</Button>
            </div>
            {!hidden && <div className="home-w-body">{body(id)}</div>}
          </div>
        );
      })}
      {!editing && (
        <div className="home-foot">
          <Button size="sm" variant="ghost" icon="layout" onClick={() => setHomeEditing(true)} title={t("Show, hide and reorder what's on Home")}>{t("Customise Home")}</Button>
        </div>
      )}
    </div>
  );
}

/** What a widget says in Customise when it has nothing to show. */
function Nothing({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="home-section">
      <header className="home-section-h"><h3 className="sub-h">{title}</h3></header>
      <p className="hint home-nothing">{children}</p>
    </section>
  );
}

// ── Play, profiles and quick actions ──

function QuickBar({ game, mods }: { game: GameState; mods: ModEntry[] }) {
  const nsfw = useNsfw();
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerOk, setBannerOk] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const pull = usePull(game);

  useEffect(() => {
    let live = true;
    gameInfo(game.gamebananaId).then((g) => { if (live) setBanner(g?.banner ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [game.gamebananaId]);

  const on = mods.length ? mods.filter((m) => m.enabled).length : game.enabledCount;
  const total = mods.length || game.modCount;
  const importerUpdate = !!(game.importerLatest && game.importerVersion && game.importerLatest !== game.importerVersion);
  const status = game.viaXxmi
    ? t("{loader} via XXMI", { loader: `${game.importer}${game.importerVersion ? ` ${game.importerVersion}` : ""}` })
    : game.importerDir ? t("{loader} loader", { loader: game.importer ?? "" }) : game.gameDir ? t("No mod loader set") : t("Not set up yet");

  const job = (id: string, f: () => Promise<unknown>) => async () => {
    setBusy(id);
    try { await f(); } catch (e) { toast(errorText(e), true); } finally { setBusy(null); }
  };
  const importPack = async () => {
    const r = await dialogs.pickFiles({ title: t("Import a .gachamod"), extensions: ["gachamod"] });
    if (r?.[0]) emitApp({ type: "open-pack", path: r[0] });
  };

  return (
    <section className="home-quick" style={{ "--g-accent": game.accent } as CSSProperties} aria-label={t("Play and profiles")}>
      {banner && bannerOk && <LazyImg className="home-quick-img" src={banner} alt="" decoding="async" onError={() => setBannerOk(false)} />}
      <div className="home-quick-top">
        <div className="home-quick-game">
          <h1 className="home-quick-name">{gameName(game)}</h1>
          <p className="home-quick-status">
            <span>{status}</span>
            {total
              ? <button type="button" className="home-quick-count" onClick={() => go("library")} title={t("Open your mods (Ctrl+3)")}>{tn(total, "{on} of {n} mod on", "{on} of {n} mods on", { on })}</button>
              : <button type="button" className="home-quick-count" onClick={() => go("browse")} title={t("Find mods on GameBanana (Ctrl+2)")}>{t("No mods yet")}</button>}
            {importerUpdate && <Badge tone="info" icon="update" title={t("XXMI Launcher installs {loader} {version} when it next starts. Click for the settings", { loader: game.importer ?? "", version: game.importerLatest ?? "" })} onClick={() => go({ view: "settings", section: "xxmi" })}>{t("{version} available", { version: game.importerLatest ?? "" })}</Badge>}
          </p>
        </div>
        <PlayButton big />
      </div>
      <div className="home-quick-bar">
        <ProfileRow game={game} />
        <div className="home-quick-acts" role="toolbar" aria-label={t("Quick actions")}>
          <IconButton icon="refresh" label={t("Rescan")} title={t("Reads the Mods folder again, then checks every mod for updates on GameBanana")} disabled={!game.modsDir || busy === "scan"} onClick={() => void job("scan", () => rescan(game))()} />
          <IconButton icon="update" label={t("Check for updates")} title={t("Check your mods for updates on GameBanana")} disabled={busy === "upd"} onClick={() => void job("upd", () => checkModUpdates(game))()} />
          <IconButton icon="folder" label={t("Open the Mods folder")} title={game.modsDir ? t("Open the Mods folder ({path})", { path: game.modsDir }) : t("No Mods folder yet")} disabled={!game.modsDir} onClick={() => openModsFolder(game)} />
          <IconButton icon="import" label={t("Import .gachamod")} title={t("Add mods from a .gachamod file")} onClick={() => void job("imp", importPack)()} />
          {pull.on
            ? <IconButton icon="gem" label={pull.word} title={pull.tip} disabled={pull.busy} onClick={pull.run} />
            : <IconButton icon="dice" label={t("Surprise me")} title={t("Open a random mod you might like")} disabled={busy === "dice"} onClick={() => void job("dice", () => surpriseMe(game.id))()} />}
          <AdultSwitch value={nsfw} />
        </div>
      </div>
    </section>
  );
}

function ProfileRow({ game }: { game: GameState }) {
  const { list } = useProfiles(game.id);
  // a switch started anywhere (here, the sidebar, a menu, search) shows on its chip
  const sw = useSwitching();
  const busy = sw?.game === game.id ? sw.id : null;
  const row = useRef<HTMLDivElement>(null);
  const [all, toggleAll] = useRowOpen("home.profiles");
  const { left, right } = useSideScroll(row, [list?.length, all]);
  const pick = (p: Profile) => {
    if (p.active) { go({ view: "profiles", profile: p.id }); return; }
    if (!sw) void switchTo(game.id, p, list);
  };
  return (
    <div className={`home-profiles-wrap${all ? " is-all" : ""}`}>
    <div ref={row} className={`home-profiles${all ? " is-all" : ""}`} role="group" aria-label={t("Profiles")} onKeyDown={(e) => rowKeys(e, ".home-pchip")}>
      {list === null && <Skeleton className="home-pchip-skel" />}
      {(list ?? []).map((p) => (
        <button key={p.id} type="button" className={`home-pchip${p.active ? " on" : ""}`} aria-pressed={p.active}
          style={p.color ? ({ "--p-color": p.color } as CSSProperties) : undefined}
          title={busy === p.id ? t("Switching to {profile}", { profile: p.name })
            : p.active ? (p.hotkey ? t("{profile} is on ({key} in game). Click to see the mods", { profile: p.name, key: p.hotkey }) : t("{profile} is on. Click to see the mods", { profile: p.name }))
            : p.hotkey ? t("Switch to {profile} ({key} in game)", { profile: p.name, key: p.hotkey }) : t("Switch to {profile}", { profile: p.name })}
          onClick={() => void pick(p)} onContextMenu={menuHandler(() => withoutKeys(menuFor("profile", { game: game.id, id: p.id })))}>
          <ProfileThumb game={game.id} profileId={p.id} profile={p} size="mini" px={26} />
          <span className="home-pchip-t">{p.name}</span>
          {busy === p.id ? <span className="spin" aria-hidden="true" /> : p.active ? <Icon name="check" className="home-pchip-on" /> : null}
        </button>
      ))}
      <button type="button" className="home-pchip add" onClick={() => void quickNewProfile(game.id)} onContextMenu={menuHandler(() => newProfileMenu(game.id))}
        title={t("Save the mods on now as a new profile. Right-click for one with no mods, or to pick the name and icon first")} aria-label={t("New profile")}>
        <Icon name="plus" />
      </button>
    </div>
    <ShowAll open={all} onToggle={toggleAll} fits={!left && !right} label={t("Show every profile ({n})", { n: list?.length ?? 0 })} />
    </div>
  );
}

// ── a sideways row with its own header (updates, characters, recent installs) ──

/** The list item around a row's button. It keeps a box of its own so the row can measure it when paging. */
const ITEM: CSSProperties = { display: "flex", flex: "none" };

function Row({ id, title, count, all: allLabel, more, moreLabel, moreTip, children, deps }: {
  /** Names the row for remembering whether it shows everything. */
  id: string; title: string; count?: number;
  /** The tip on the button that shows everything: "Show every update (12)". */
  all: string;
  more?: () => void; moreLabel?: string; moreTip?: string; children: ReactNode; deps: unknown[];
}) {
  const row = useRef<HTMLDivElement>(null);
  const [all, toggleAll] = useRowOpen(`home.${id}`);
  const { left, right, page } = useSideScroll(row, [...deps, all]);
  return (
    <section className="home-section" aria-label={title}>
      <header className="home-section-h">
        <h3 className="sub-h">{title}{count !== undefined && <span className="home-n">{count}</span>}</h3>
        <span className="grow" />
        {(left || right) && <>
          <IconButton size="sm" icon="left" label={t("Scroll left")} disabled={!left} onClick={() => page(-1)} />
          <IconButton size="sm" icon="right" label={t("Scroll right")} disabled={!right} onClick={() => page(1)} />
        </>}
        <ShowAll open={all} onToggle={toggleAll} fits={!left && !right} label={allLabel} />
        {more && <Button size="sm" variant="ghost" iconRight="chevron" onClick={more} title={moreTip}>{moreLabel ?? t("See all")}</Button>}
      </header>
      <div ref={row} className={`home-row${all ? " is-all" : ""}`} role="list" onKeyDown={(e) => rowKeys(e, ".home-item")}>{children}</div>
    </section>
  );
}

function ModThumb({ src, adult, mode }: { src?: string | null; adult: boolean; mode: NsfwMode }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return (
    <span className={`home-tile-img${adult && mode === "blur" ? " nsfw-blur" : ""}`}>
      {src && !broken ? <LazyImg src={src} alt="" decoding="async" draggable={false} onError={() => setBroken(true)} /> : <Icon name="image" className="thumb-ph" />}
    </span>
  );
}

function Updates({ game, mods, editing }: { game: GameState; mods: ModEntry[]; editing: boolean }) {
  const nsfw = useNsfw();
  const [busy, setBusy] = useState(false);
  const list = mods.filter((m) => m.updateAvailable && m.source && !(m.nsfw && nsfw === "hide"));
  if (!list.length) return editing ? <Nothing title={WIDGETS.updates.title}>{t("Every mod is up to date. Mods with a newer version show here.")}</Nothing> : null;
  const all = async () => {
    setBusy(true);
    try { for (const m of list) await getUpdate(game.id, m); } finally { setBusy(false); }
  };
  return (
    <Row id="updates" title={WIDGETS.updates.title} count={list.length} all={t("Show every update ({n})", { n: list.length })} deps={[list.length]}
      more={() => go("library")} moreLabel={t("Open Mods")}>
      {list.map((m) => (
        <div key={m.id} role="listitem" className="home-tile" onContextMenu={menuHandler(() => withoutKeys(menuFor("mod", { game: game.id, mod: m }), ["Enter"]))}>
          <button type="button" className="home-item home-tile-main" onClick={() => go({ view: "library", modId: m.id })} title={t("{mod}. Click for details", { mod: m.name })}>
            <ModThumb src={fileUrl(m.preview)} adult={m.nsfw} mode={nsfw} />
            <span className="home-tile-name">{m.name}</span>
          </button>
          <Button size="sm" icon="downloads" className="home-tile-btn" onClick={() => void getUpdate(game.id, m)} title={t("Download the newest version")}>{t("Update")}</Button>
        </div>
      ))}
      {list.length > 1 && (
        <div role="listitem" style={ITEM}>
          <button type="button" className="home-item home-all" disabled={busy} onClick={() => void all()} title={t("Download every update listed here")}>
            <Icon name="downloads" /><span>{t("Update all {n}", { n: list.length })}</span>
          </button>
        </div>
      )}
    </Row>
  );
}

function Characters({ game, mods, loaded, editing }: { game: GameState; mods: ModEntry[]; loaded: boolean; editing: boolean }) {
  const roster = useRoster(game.id, mods);
  const withMods = (roster ?? []).filter((c) => c.mods.length > 0 && !c.hidden)
    .sort((a, b) => b.mods.length - a.mods.length || b.last - a.last).slice(0, 40);
  usePortraitBatch(game.id, withMods.map((c) => c.name));
  const noun = charNoun(game.id);
  const title = t("Your {noun}", { noun: noun.toLowerCase() });
  if (!loaded) return null;
  if (!withMods.length) return editing ? <Nothing title={title}>{t("{noun} you have mods for show here.", { noun })}</Nothing> : null;
  return (
    <Row id="chars" title={title} count={withMods.length} all={t("Show every {noun} ({n})", { noun: charNoun(game.id, true).toLowerCase(), n: withMods.length })} deps={[withMods.length]} more={() => go("characters")} moreLabel={t("All {noun}", { noun: noun.toLowerCase() })}>
      {withMods.map((c) => (
        <div key={c.name} role="listitem" style={ITEM}>
          <button type="button" className="home-item home-char" onClick={() => go({ view: "characters", character: c.name })}
            title={tn(c.mods.length, "{name}: {n} mod, {on} on. Click for their mods", "{name}: {n} mods, {on} on. Click for their mods", { name: c.name, on: c.on })}
            onContextMenu={menuHandler(() => withoutKeys(menuFor("character", { game: game.id, name: c.name })))}>
            <Portrait game={game.id} name={c.name} icon={c.icon} size={64} />
            <span className="home-char-t">{c.name}</span>
            <span className="home-char-n">{c.on ? t("{on} of {n} on", { on: c.on, n: c.mods.length }) : tn(c.mods.length, "{n} mod", "{n} mods")}</span>
          </button>
        </div>
      ))}
    </Row>
  );
}

function Recent({ game, mods, loaded, editing }: { game: GameState; mods: ModEntry[]; loaded: boolean; editing: boolean }) {
  const nsfw = useNsfw();
  const recent = [...mods].sort((a, b) => b.installedAt - a.installedAt).filter((m) => !(m.nsfw && nsfw === "hide")).slice(0, 16);
  if (!loaded) return null;
  if (!recent.length) {
    return editing ? <Nothing title={WIDGETS.recent.title}>{t("Mods you install show here.")}</Nothing> : mods.length ? null : (
      <section className="home-section home-first">
        <header className="home-section-h"><h3 className="sub-h">{t("No mods yet")}</h3></header>
        <p className="hint">{t("Install from Browse, or drop an archive anywhere on this window.")}</p>
        <span><Button variant="primary" icon="browse" onClick={() => go("browse")}>{t("Browse GameBanana")}</Button></span>
      </section>
    );
  }
  return (
    <Row id="recent" title={WIDGETS.recent.title} all={t("Show all {n} recent mods", { n: recent.length })} deps={[recent.length]} more={() => go("library")} moreLabel={t("All mods")}>
      {recent.map((m) => (
        <div key={m.id} role="listitem" style={ITEM}>
          <button type="button" className={`home-item home-tile${m.enabled ? "" : " off"}`} onClick={() => go({ view: "library", modId: m.id })}
            title={m.enabled ? m.name : t("{mod} (off)", { mod: m.name })} onContextMenu={menuHandler(() => withoutKeys(menuFor("mod", { game: game.id, mod: m }), ["Enter"]))}>
            <ModThumb src={fileUrl(m.preview)} adult={m.nsfw} mode={nsfw} />
            <span className="home-tile-name">{m.name}</span>
            <span className="hint home-tile-sub">{t("{character}, {when}", { character: m.character ?? t("No character"), when: timeAgo(m.installedAt) })}</span>
          </button>
        </div>
      ))}
    </Row>
  );
}
