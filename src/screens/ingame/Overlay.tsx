// The menu shown over a running game (src-tauri overlay.rs): its own window, opened with the menu key or by pressing
// both sticks of a controller. It has four tabs.
// My mods: characters down the left with their pictures and a search above them, the picked character's skins and
// other mods on the right, and any mod's details. Picking a skin shows it in the game, and the menu closes or stays
// open by its "Close after picking" setting along the bottom. A mod that doesn't switch in game turns on alone (the
// character's other mods go off); Shift+click, Shift+Enter or "Turn on with others" in its right-click menu keeps
// the others on.
// Keys: the toggle keys of the mods showing now, each one a button that rebinds it (OverlayKeys.tsx). The key list's
// own key (F8) opens the menu here.
// Browse: the app's own GameBanana browser (browse/GbBrowser.tsx), whole: every sort and filter, the character row,
// more mods as the list scrolls, a mod's page with its files, and creators' pages.
// Downloads: the app's Downloads screen.
// The window has pages of its own (lib/store.ts), so the app's parts work here as they are: a tab is a view, a mod's
// page is a route. A page only the app has (Settings, Tools) opens in gachamod's own window.
// In a browser, #overlay shows it with the demo data. Owner: INGAME area.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { app as appApi, errorText, fileUrl, library, skinMenu, type GameId, type GameState, type LiveGroup, type LiveInfo, type ModEntry } from "../../lib/api";
import { installGamepad, moveFocus } from "../../lib/gamepad";
import { installUndoKeys } from "../../lib/history";
import { t, tb, tn } from "../../lib/i18n";
import "../../lib/places";
import { pref, useNsfw } from "../../lib/prefs";
import { back, consumeRoute, currentGame, currentRoute, go, onApp, refreshGames, reloadKeyOf, replaceRoute, setGame, useBadges, useGameId, useGames, useRoute, type Route, type View } from "../../lib/store";
import { held, listen } from "../../lib/tauri";
import { applyGameTheme } from "../../lib/theme";
import { ContextMenuHost, menuForFocus, menuHandler, menuIsOpen, type MenuEntry } from "../../ui/ContextMenu";
import { ErrorBoundary } from "../../ui/ErrorBoundary";
import { Icon } from "../../ui/Icon";
import { Badge, Button, Checkbox, IconButton, SearchField, Segmented, Waiting, formatBytes, timeAgo } from "../../ui/kit";
import { LazyImg } from "../../ui/LazyImg";
import { Portrait } from "../../ui/Portrait";
import { Toasts, toast } from "../../ui/toast";
import { installLatest } from "../browse/actions";
import { CreatorPage } from "../browse/CreatorPage";
import { GbBrowser } from "../browse/GbBrowser";
import { OnlineOverlays } from "../browse/OnlineOverlays";
import { openGbMod, openWithFilters } from "../browse/state";
import { Downloads } from "../downloads/Downloads";
import { boundAction, isNewSkin, markShown, newSkinTip, reloadLive, useLive } from "./data";
import { useKeyList } from "./KeyListParts";
import { KeysTab } from "./OverlayKeys";
import "./overlay.css";

// Keys has no page of its own in the app: it shows over whatever page the menu is on, until another tab or page opens
type Tab = "mine" | "keys" | "browse" | "downloads";
const TABS: Tab[] = ["mine", "keys", "browse", "downloads"];
const VIEW_OF: Record<Exclude<Tab, "keys">, View> = { mine: "library", browse: "browse", downloads: "downloads" };
/** The tab a page shows in, or null for a page only the app's own window has. */
const tabOf = (r: Route): Tab | null => (r.view === "library" ? "mine" : r.view === "browse" ? "browse" : r.view === "downloads" ? "downloads" : null);
/** Mods with no character sit under this name, last in the list. */
const OTHER = t("Other mods");

// the settings along the bottom of the menu
/** A skin that shows at once closes the menu and leaves the game in front. */
const closePref = pref<boolean>("overlay.closeAfterPick", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));
/** How much the menu's background covers the game, in percent. */
const COVER = ["100", "85", "70"] as const;
type Cover = (typeof COVER)[number];
const coverPref = pref<Cover>("overlay.background", "85", (r) => COVER.find((c) => c === r), (v) => v);

const recentKey = (game: GameId) => `overlay.recent.${game}`;
function recent(game: GameId): string[] {
  try { return (JSON.parse(localStorage.getItem(recentKey(game)) ?? "[]") as unknown[]).filter((x): x is string => typeof x === "string"); } catch { return []; }
}
function touch(game: GameId, character: string) {
  try { localStorage.setItem(recentKey(game), JSON.stringify([character, ...recent(game).filter((c) => c !== character)].slice(0, 40))); } catch { /* the order just isn't kept */ }
}

export function Overlay() {
  const [game, setMenuGame] = useState<GameId | null>(null);
  const [opened, setOpened] = useState(0);
  /** The tab the menu was opened on: the key list's own key opens it on Keys. */
  const [openTab, setOpenTab] = useState<"keys" | null>(null);
  const games = useGames();
  const current = useGameId();
  const state = games.find((g) => g.id === game) ?? null;

  useEffect(() => {
    // the window is see-through (overlay.rs); in a browser the demo draws a plain backdrop where the game would be
    document.documentElement.classList.add("ov-window");
    if (!("__TAURI_INTERNALS__" in window)) document.documentElement.classList.add("ov-demo");
    void refreshGames();
    void skinMenu.game().then((g) => { if (g) setMenuGame(g); });
    const offs = [
      held(listen<{ game: GameId; tab?: "keys" }>("overlay-open", (p) => {
        setMenuGame(p.game); setOpenTab(p.tab === "keys" ? "keys" : null); void reloadLive(p.game); setOpened((n) => n + 1);
      })),
      // the game saved a change in who is on screen while the menu shows (overlay.rs on_screen_changed)
      held(listen<{ game: GameId }>("overlay-here", (p) => void reloadLive(p.game))),
      // what the backend says ("Installed X for Y"). The app's own window turns a new mod on (library/afterInstall.ts);
      // here the message shows with the way to the mod
      held(appApi.onToast((p) => {
        const o = p.open;
        toast(p.text, !!p.bad, o && o.game === currentGame()?.id ? { label: t("Open"), run: () => go({ view: "library", modId: o.modId }) } : undefined);
      })),
      installUndoKeys(),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  useEffect(() => { applyGameTheme(state); }, [state?.id, state?.theme, state?.accent]); // eslint-disable-line react-hooks/exhaustive-deps
  // the browser, a mod's page and Downloads read the app-wide current game: here it is the game the menu is open for
  useEffect(() => { if (game && current !== game && games.some((g) => g.id === game)) setGame(game); }, [game, current, games]);
  // the AI helper is in the app's own window
  useEffect(() => onApp((e) => { if (e.type === "ai" && game) skinMenu.openInApp(game, null, e.task).catch((err) => toast(errorText(err), true)); }), [game]);

  if (!game) return <div className="ov"><div className="ov-wait"><Waiting what={t("Finding the game this menu is for")} /></div></div>;
  return (
    <>
      <Menu key={game} game={game} state={state} opened={opened} openTab={openTab} />
      {games.length > 0 && <ErrorBoundary where={t("Online")} quiet><OnlineOverlays /></ErrorBoundary>}
      <ContextMenuHost />
      <Toasts />
    </>
  );
}

/** One character in the list: the skins that switch in game (if any) and the rest of its mods. `here`: on screen in
 *  the game when the menu opened. */
interface Who { name: string; group: LiveGroup | null; mods: ModEntry[]; showing: string | null; here: boolean }

/** Who the game says is on screen. `here`: the characters on screen, the one that came on screen last first. `lead`:
 *  the characters the list starts with: those, or with nobody on screen (a menu or a loading screen in the game) the
 *  character seen last. */
interface Seen { here: string[]; lead: string[] }
function onScreenNames(info: LiveInfo | null): Seen {
  if (!info?.running) return { here: [], lead: [] };
  const name = (n: number) => info.groups.find((g) => g.group === n)?.character;
  const here = (info.onScreen ?? []).map(name).filter((c): c is string => !!c);
  const last = info.lastSeen != null ? name(info.lastSeen) : undefined;
  return { here, lead: here.length ? here : last ? [last] : [] };
}

/** The game's installed mods (null while reading), read again each time the menu opens and when the library changes. */
function useMods(game: GameId, opened: number): [ModEntry[] | null, () => Promise<void>] {
  const [mods, setMods] = useState<ModEntry[] | null>(null);
  const live = useRef(true);
  const load = useCallback(
    () => library.list(game).then((l) => { if (live.current) setMods(l); }).catch(() => { if (live.current) setMods((m) => m ?? []); }),
    [game]);
  useEffect(() => {
    live.current = true;
    void load();
    const off = held(library.onChanged((p) => { if (p.game === game) void load(); }));
    return () => { live.current = false; off(); };
  }, [game, opened, load]);
  return [mods, load];
}

function Menu({ game, state, opened, openTab }: { game: GameId; state: GameState | null; opened: number; openTab: "keys" | null }) {
  const info = useLive(game);
  const [mods, reloadMods] = useMods(game, opened);
  const kl = useKeyList(game, opened);
  const keysOn = kl.list?.settings.on ?? true;
  const tabList = keysOn ? TABS : TABS.filter((x) => x !== "keys");
  const tabsRef = useRef(tabList);
  tabsRef.current = tabList;
  // the menu's keys as the player picked them (Tools, Switch skins in game, Menu keys)
  const bindsRef = useRef(info?.menu.binds);
  bindsRef.current = info?.menu.binds;
  const route = useRoute();
  /** The page Keys was picked on: Keys shows while that page does, so any page opened after it leaves Keys. */
  const [keysAt, setKeysAt] = useState<Route | null>(null);
  const tab: Tab = keysOn && keysAt === route ? "keys" : tabOf(route) ?? "mine";
  const tabRef = useRef(tab);
  tabRef.current = tab;
  /** How many downloads are running or waiting, or failed when none are, for the tab's name (OnlineOverlays counts). */
  const dl = useBadges().downloads;
  const downloading = dl?.tone === "run" ? dl.count ?? 0 : 0;
  const failed = dl?.tone === "bad" ? dl.count ?? 0 : 0;
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  /** The focused tile can turn on next to the others (Shift+Enter), for the hint along the bottom. */
  const [shiftOk, setShiftOk] = useState(false);
  /** Said along the bottom while a new skin has the pointer or the focus. */
  const [hint, setHint] = useState<string | null>(null);
  const closeAfter = closePref.use();
  const cover = coverPref.use();
  const [detail, setDetail] = useState<{ mod: ModEntry } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => void skinMenu.hide(game), [game]);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  /** The Keys tab's search when a mod's Toggles tag opened it. */
  const [keysQ, setKeysQ] = useState("");
  const setTab = useCallback((next: Tab) => {
    setDetail(null);
    setKeysQ("");
    if (next === "keys") { setKeysAt(currentRoute()); return; }
    setKeysAt(null);
    go({ view: VIEW_OF[next] });
  }, []);
  const openKeySettings = useCallback(() => {
    skinMenu.openInApp(game, { view: "tools", section: "keylist" }).catch((e) => toast(errorText(e), true));
  }, [game]);
  /** A mod's Toggles tag: its keys on the Keys tab, or the key list's settings while the key list is off. */
  const keysOf = (m: ModEntry) => {
    if (!keysOn) { openKeySettings(); return; }
    setTab("keys");
    setKeysQ(m.name);
  };
  /** Esc, B and the Back button: out of a mod's details, back from a creator's page to the mods, else close the menu. */
  const leave = useCallback(() => {
    const r = currentRoute();
    if (detailRef.current) setDetail(null);
    else if (r.view === "browse" && r.user) { if (!back()) go({ view: "browse" }); }
    else close();
  }, [close]);

  /** The tile the menu put the focus on by itself. While the focus is still there, the player hasn't moved in the menu. */
  const autoFocus = useRef<HTMLElement | null>(null);
  const putFocus = (el: HTMLElement | null | undefined) => { el?.focus(); autoFocus.current = el ?? null; };
  /** The player hasn't picked a character, opened a mod, typed or moved the focus since the menu opened. */
  const untouched = () => {
    const a = document.activeElement;
    return selRef.current === null && !detailRef.current && (!a || a === document.body || a === autoFocus.current);
  };
  // Who is on screen each time the menu opens: first what is known, then the game's answer that comes in a moment
  // later, and the answers after it (the game saves who is on screen about a second after a swap) until the player
  // moves in the menu. After that it stays, so characters don't move in the list under the player, with one
  // exception: the player swapped characters in the game, so one character the game wasn't on before is alone on
  // screen. Then the menu goes to them, unless a pick is on its way, a mod's details are open or a search is typed.
  const [seenNow, setSeenNow] = useState<Seen>({ here: [], lead: [] });
  const hereAt = useRef<{ opened: number; info: LiveInfo | null }>({ opened: -1, info: null });
  /** The character the game was last sure of: alone on screen, or seen last with nobody on screen as the menu opened. */
  const sure = useRef<string | null>(null);
  useEffect(() => {
    const h = hereAt.current;
    const next = onScreenNames(info);
    const take = () => setSeenNow((was) => (was.here.join("\n") === next.here.join("\n") && was.lead.join("\n") === next.lead.join("\n") ? was : next));
    const alone = next.here.length === 1 ? next.here[0]! : null;
    if (h.opened !== opened) {
      hereAt.current = { opened, info };
      autoFocus.current = null;
      sure.current = alone ?? (next.here.length ? null : next.lead[0] ?? null);
      take();
      return;
    }
    if (!info || info === h.info) return;
    const swapped = alone !== null && sure.current !== null && alone !== sure.current;
    if (alone) sure.current = alone;
    if (untouched()) { h.info = info; take(); return; }
    if (!swapped || busy || detail || q.trim()) return;
    h.info = info;
    take();
    setSel(null);
    // the focus goes along, onto the new character's skin that shows
    window.setTimeout(() => putFocus(root.current?.querySelector<HTMLElement>(".ov-pane .ov-tile.on, .ov-pane .ov-tile")), 80);
  }, [opened, info]); // eslint-disable-line react-hooks/exhaustive-deps
  const { here, lead } = seenNow;
  const hereKey = `${here.join("\n")}|${lead.join("\n")}`;

  const everyone = useMemo<Who[]>(() => {
    if (!info || !mods) return [];
    const byId = new Map(mods.map((m) => [m.id, m]));
    const live = new Set(info.groups.flatMap((g) => g.mods.map((m) => m.modId)));
    const names = new Map<string, Who>();
    const at = (name: string) => { let w = names.get(name); if (!w) { w = { name, group: null, mods: [], showing: null, here: here.includes(name) }; names.set(name, w); } return w; };
    for (const g of info.groups) {
      const w = at(g.character);
      w.group = g;
      w.showing = g.mods.find((m) => m.slot === g.active)?.name ?? null;
    }
    for (const m of mods) if (!live.has(m.id)) at(m.character ?? OTHER).mods.push(m);
    for (const w of names.values()) {
      w.mods.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
      w.showing ??= w.mods.find((m) => m.enabled && byId.has(m.id))?.name ?? null;
    }
    const order = recent(game);
    const rank = (w: Who) => { const i = order.indexOf(w.name); return i < 0 ? order.length : i; };
    // the characters on screen first (or the one seen last), then the ones played last
    const seen = (w: Who) => { const i = lead.indexOf(w.name); return i < 0 ? lead.length : i; };
    return [...names.values()].sort((a, b) => Number(a.name === OTHER) - Number(b.name === OTHER) || seen(a) - seen(b) || rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [info, mods, game, opened, hereKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The characters on screen (or the one seen last), then the others as they were played last, for the Keys tab (read
   *  again each time the menu opens). */
  const order = useMemo(() => [...lead, ...recent(game)], [game, opened, hereKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selRef = useRef(sel);
  selRef.current = sel;
  const words = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!words) return everyone;
    const hit = (s: string) => s.toLowerCase().includes(words);
    return everyone.filter((w) => hit(w.name) || w.mods.some((m) => hit(m.name)) || w.group?.mods.some((m) => hit(m.name)));
  }, [everyone, words]);
  const who = shown.find((w) => w.name === sel) ?? shown[0] ?? null;
  const loading = info === null || mods === null;

  // each time it opens: My mods (or Keys when its own key opened it), no search or details left over, on the character
  // played last, on the skin that is showing
  useEffect(() => {
    setQ("");
    setNote(null);
    setHint(null);
    setDetail(null);
    setSel(null);
    go({ view: "library" });
    setKeysAt(openTab === "keys" ? currentRoute() : null);
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  // a tile that goes away (another character, tab or a mod's details) sends no mouseleave or blur
  useEffect(() => setHint(null), [tab, who?.name, detail]);

  // Pages the app's parts ask for (a card's Installed tag, a character's name, a toast's button). A mod of the
  // library opens its details here. A character opens their skins, or their mods on GameBanana when there are none.
  // A page only the app has opens in gachamod's own window.
  useEffect(() => {
    if (route.view === "library" && typeof route.modId === "string") {
      if (loading) return;
      const id = route.modId;
      const m = mods.find((x) => x.id === id);
      const w = m && everyone.find((x) => x.mods.some((y) => y.id === id) || x.group?.mods.some((y) => y.modId === id));
      if (m) { setQ(""); setSel(w?.name ?? null); setDetail({ mod: m }); }
      consumeRoute(["modId"]);
      return;
    }
    if (route.view === "characters") {
      if (loading) return;
      const name = route.character;
      const w = name ? everyone.find((x) => x.name.toLowerCase() === name.toLowerCase()) : null;
      if (w) { setQ(""); setDetail(null); setSel(w.name); replaceRoute({ view: "library" }); }
      else if (name) { openWithFilters(game, { character: name }); replaceRoute({ view: "browse" }); }
      else replaceRoute({ view: "library" });
      return;
    }
    if (tabOf(route)) return;
    skinMenu.openInApp(game, route).catch((e) => toast(errorText(e), true));
    if (!back()) replaceRoute({ view: "library" });
  }, [route, loading, mods, everyone, game]);
  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => putFocus(root.current?.querySelector<HTMLElement>(".ov-tile.on") ?? root.current?.querySelector<HTMLElement>(".ov-tile, .ov-who")), 80);
    return () => window.clearTimeout(timer);
  }, [opened, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  // Browse and Downloads: the focus goes to the first card or row once one shows (the tile that had it is gone), unless
  // the player put it somewhere meanwhile
  const pageKey = tab === "browse" ? `browse:${route.user ?? ""}` : tab;
  useEffect(() => {
    if (tab !== "browse" && tab !== "downloads") return;
    const sel = tab === "browse" ? ".ov-page .gb-card" : ".ov-page .dl-item button, .ov-page button";
    let n = 0;
    const timer = window.setInterval(() => {
      const a = document.activeElement;
      const free = !a || a === document.body || !root.current?.contains(a);
      const el = free ? root.current?.querySelector<HTMLElement>(sel) : null;
      if (el) el.focus({ preventScroll: true });
      if (!free || el || ++n > 40) window.clearInterval(timer);
    }, 80);
    return () => window.clearInterval(timer);
  }, [pageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // the game's answer came in after the menu opened: the focus follows to the character on screen, unless the player
  // moved in the menu meanwhile
  useEffect(() => {
    if (loading || hereKey === "|" || !untouched()) return;
    const timer = window.setTimeout(() => {
      if (untouched()) putFocus(root.current?.querySelector<HTMLElement>(".ov-pane .ov-tile.on, .ov-pane .ov-tile"));
    }, 80);
    return () => window.clearTimeout(timer);
  }, [hereKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // a mod's page, a window or a popover that is open (they close themselves on Esc)
    const layer = () => !!document.querySelector(".lightbox, .overlay, .popover");
    /** The search of the tab showing: the characters' in My mods, GameBanana's in Browse. */
    const search = () => {
      const field = [...(root.current?.querySelectorAll<HTMLInputElement>('input[type="search"]') ?? [])].find((el) => el.offsetParent !== null);
      field?.focus();
      return !!field;
    };
    const turn = (d: 1 | -1) => { const ts = tabsRef.current; setTab(ts[(ts.indexOf(tabRef.current) + d + ts.length) % ts.length]!); };
    const details = () => (document.activeElement?.closest(".ov-cell")?.querySelector<HTMLElement>(".ov-more") ?? null)?.click();
    const onKey = (e: KeyboardEvent) => {
      // a right-click menu that is open takes the keys
      if (menuIsOpen()) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      const open = layer();
      if (e.key === "Escape") { if (!open && !(typing && (e.target as HTMLInputElement).value)) leave(); return; }
      // a key something handled already: a card's I (install), a row of characters' arrows
      if (e.defaultPrevented) return;
      // Shift+F10 and the Menu key: the focused tile's or card's right-click menu
      if (!typing && ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu")) {
        e.preventDefault();
        document.documentElement.classList.add("kbd");
        menuForFocus();
        return;
      }
      // a key the player picked for the menu does here what it does in the menu the game draws
      const bound = typing || open ? null : boundAction(e, bindsRef.current);
      if (bound) {
        e.preventDefault();
        if (bound === "up") moveFocus(0, -1);
        else if (bound === "down") moveFocus(0, 1);
        else if (bound === "show") (document.activeElement as HTMLElement | null)?.click();
        else if (bound === "close") close();
        else if (bound === "keys") { if (tabsRef.current.includes("keys")) setTab("keys"); }
        else if (detailRef.current || currentRoute().user) leave();
        else {
          // back to the characters: the picked one in the rail, on My mods
          const rail = () => root.current?.querySelector<HTMLElement>(".ov-rail .ov-who.on") ?? root.current?.querySelector<HTMLElement>(".ov-rail .ov-who");
          if (tabRef.current === "mine" && rail()) rail()!.focus();
          else { setTab("mine"); window.setTimeout(() => rail()?.focus(), 80); }
        }
        return;
      }
      if (e.altKey && !e.ctrlKey && e.key === "ArrowLeft" && !typing) { e.preventDefault(); back(); return; }
      const dir: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      const d = dir[e.key];
      if (d && !e.altKey && !(typing && d[0] !== 0)) { e.preventDefault(); moveFocus(d[0], d[1]); return; }
      if (typing || open || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "Tab") { e.preventDefault(); turn(e.shiftKey ? -1 : 1); return; }
      if ((e.key === "i" || e.key === "I") && tabRef.current === "mine") { e.preventDefault(); details(); return; }
      // "/" and plain typing go to the search field
      if (e.key === "/" || (e.key.length === 1 && e.key !== " ")) {
        if (search() && e.key === "/") e.preventDefault();
      }
    };
    // the mouse's back button: out of what is open, never out of the menu
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3) return;
      e.preventDefault();
      if (layer()) (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else if (detailRef.current || currentRoute().user) leave();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    const offPad = installGamepad({ nextView: turn, play: menuForFocus, menu: menuForFocus, back: leave, palette: search });
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mouseup", onMouse); offPad(); };
  }, [game, leave, close, setTab]);

  const say = (text: string, bad = false) => setNote({ text, bad });

  const pick = async (w: Who, slot: number) => {
    if (busy || !w.group) return;
    setBusy(`${w.name}-${slot}`);
    setNote(null);
    const skin = w.group.mods.find((m) => m.slot === slot);
    const fresh = !!info && !!skin && isNewSkin(game, info, w.group, skin.modId);
    try {
      // also the one the app thinks shows: the game may show another, picked in its own menu. With "Close after
      // picking" the menu closes, unless the keys didn't reach the game
      const p = await skinMenu.pick(game, w.group.group, slot, closeAfter);
      if (p.send && skin) markShown(game, skin.modId);
      touch(game, w.name);
      await reloadLive(game);
      const name = slot === 0 ? t("Vanilla {name}", { name: w.name }) : skin?.name ?? t("That skin");
      if (p.reload) say(t("{name} was off. It shows after the game reloads.", { name }));
      else if (p.note) say(t("{note}.", { note: tb(p.note) }), true);
      else say(!p.send ? t("{name} shows the next time the game starts.", { name })
        : fresh ? t("{name} is showing. {tip}", { name, tip: newSkinTip(w.name) }) : t("{name} is showing.", { name }));
    } catch (e) { say(errorText(e), true); } finally { setBusy(null); }
  };

  /** Turn a mod that doesn't switch in game on or off. Turning one on turns the character's other mods off, unless
   *  `keep` (Shift) keeps them on. */
  const turn = async (m: ModEntry, on: boolean, keep = false) => {
    if (busy) return;
    setBusy(m.id);
    setNote(null);
    try {
      const ch = await library.setEnabled(game, [m.id], on, on && m.character ? !keep : undefined);
      touch(game, m.character ?? OTHER);
      await reloadMods();
      setDetail((d) => (d && "mod" in d && d.mod.id === m.id ? { mod: { ...m, enabled: on } } : d));
      const off = ch.changed.filter((x) => x.id !== m.id && !x.enabled).length;
      const p = { name: m.name, character: m.character ?? "" };
      const what = !on ? t("{name} is off.", p) : keep && m.character ? t("{name} is on, next to {character}'s other mods.", p)
        : off ? tn(off, "{name} is on, and another mod of {character} went off.", "{name} is on, and {n} other mods of {character} went off.", p)
        : t("{name} is on.", p);
      say(t("{what} The game shows it after it reloads mods ({key}).", { what, key: reloadKeyOf(game) }));
      // back in the game, the app presses the reload key itself
      if (closeAfter) close();
    } catch (e) { say(errorText(e), true); } finally { setBusy(null); }
  };

  /** Shift on a live skin that isn't showing: it leaves in-game switching and goes on next to the one showing. */
  const beside = async (m: ModEntry, shown: string) => {
    if (busy) return;
    setBusy(m.id);
    setNote(null);
    try {
      const ch = await library.setEnabled(game, [m.id], true, false);
      touch(game, m.character ?? OTHER);
      await Promise.all([reloadLive(game), reloadMods()]);
      const key = reloadKeyOf(game);
      say(ch.notes[0] ? t("{note} ({key}).", { note: tb(ch.notes[0]), key })
        : t("{name} is on next to {shown}. The game shows it after it reloads mods ({key}).", { name: m.name, shown, key }));
      if (closeAfter) close();
    } catch (e) { say(errorText(e), true); } finally { setBusy(null); }
  };

  /** Right-click menu of a mod tile (also the controller's menu button and Shift+F10). */
  const modMenu = (m: ModEntry): MenuEntry[] => [
    !m.enabled && { label: m.character ? t("Turn on alone") : t("Turn on"), icon: "power", keys: "Enter",
      title: m.character ? t("Turns it on and {character}'s other mods off", { character: m.character }) : undefined, onClick: () => void turn(m, true) },
    !m.enabled && !!m.character && { label: t("Turn on with others"), icon: "layers", keys: "Shift+Enter",
      title: t("Turns it on and keeps {character}'s other mods on, for mods that go together like a hair recolour and an outfit", { character: m.character }),
      onClick: () => void turn(m, true, true) },
    m.enabled && { label: t("Turn off"), icon: "block", keys: "Enter", onClick: () => void turn(m, false) },
    { label: t("Details"), icon: "info", keys: "I", onClick: () => setDetail({ mod: m }) },
    m.hasKeys && { label: t("Show keys"), icon: "keyboard", onClick: () => keysOf(m) },
  ];

  const modOf = (id: string) => mods?.find((m) => m.id === id) ?? null;
  /** Right-click menu of a live skin. */
  const skinMenuOf = (w: Who, slot: number, full: ModEntry | null): MenuEntry[] => [
    { label: t("Show in game"), icon: "play", keys: "Enter", onClick: () => void pick(w, slot) },
    !!full && !!w.showing && w.group?.active !== slot && { label: t("Show next to {name}", { name: w.showing }), icon: "layers", keys: "Shift+Enter",
      title: t("Turns it on next to {name} instead of replacing it. It stops switching in game, and the game shows it after it reloads mods", { name: w.showing }),
      onClick: () => void beside(full!, w.showing!) },
    full && { label: t("Details"), icon: "info", keys: "I", onClick: () => setDetail({ mod: full }) },
    !!full?.hasKeys && { label: t("Show keys"), icon: "keyboard", onClick: () => keysOf(full!) },
  ];
  const key = info?.menu.key ?? t("the menu key");
  /** Enter in the character search: on to the found character's skins. After the key is done, so the same Enter
   *  doesn't also press the tile it lands on. */
  const toSkins = () => window.setTimeout(() =>
    (root.current?.querySelector<HTMLElement>(".ov-pane .ov-tile.on") ?? root.current?.querySelector<HTMLElement>(".ov-pane .ov-tile, .ov-rail .ov-who"))?.focus(), 0);
  const tipFor = (character: string, fresh: boolean) => (on: boolean) => setHint(on && fresh ? newSkinTip(character) : null);
  const listKey = kl.list?.settings.key;
  /** The keys for what has the focus, along the bottom: [keys, what they do, a longer tip]. */
  const tabsChip: [string, string, string] = ["Tab", t("Tabs"), keysOn ? t("Tab or the bumpers switch between My mods, Keys, Browse and Downloads")
    : t("Tab or the bumpers switch between My mods, Browse and Downloads")];
  const escChip: [string, string, string] = ["Esc", tab === "browse" && route.user ? t("Back") : t("Close"),
    tab === "browse" && route.user ? t("Esc or B goes back to the mods")
      : tab === "keys" && listKey ? t("Esc, B or {key} or {list} closes the menu", { key, list: listKey }) : t("Esc, B or {key} closes the menu", { key })];
  const menuChip: [string, string, string] = ["Menu", t("More"), t("Right-click, Shift+F10, the Menu key or the controller's menu button shows more")];
  const chips: Array<[string, string, string]> = tab === "keys" ? [["Enter", t("Rebind"), t("A click, Enter or A on a key rebinds it")], tabsChip, escChip]
    : tab === "mine" ? [["Enter", t("Pick"), t("Enter or A picks")],
      ...(shiftOk ? [["Shift+Enter", t("With others"), t("Shift+click or Shift+Enter turns it on next to the others")] as [string, string, string]] : []),
      ["I", t("Details"), t("I shows the details")], menuChip, tabsChip, escChip]
    : tab === "browse" ? [["Enter", t("Open"), t("Enter or A opens a mod's page with the files")], ["I", t("Install"), t("I or X installs the mod in focus")], menuChip, tabsChip, escChip]
    : [tabsChip, escChip];
  const footText = hint ?? note?.text ?? (
    <span className="ov-kh-all">
      {chips.map(([k, what, tip]) => <span key={k} className="ov-kh" title={tip}><kbd>{k}</kbd>{what}</span>)}
    </span>
  );

  return (
    <div className="ov" ref={root} key={opened} onFocus={(e) => setShiftOk(!!(e.target as HTMLElement).closest("[data-shift]"))} style={{ "--ov-cover": `${cover}%` } as React.CSSProperties}>
      <header className="ov-top">
        <Segmented size="sm" label={t("What to show")} value={tab} onChange={setTab}
          options={[
            { value: "mine", label: t("My mods"), icon: "mods", title: t("Your characters, their skins and their other mods (Tab switches)") },
            ...(keysOn ? [{ value: "keys" as const, label: t("Keys"), icon: "keyboard" as const,
              title: listKey ? t("The toggle keys of the mods showing now. {key} opens the menu on this tab (Tab switches)", { key: listKey })
                : t("The toggle keys of the mods showing now (Tab switches)") }] : []),
            { value: "browse", label: t("Browse"), icon: "browse", title: t("Every mod for this game on GameBanana, with every sort and filter (Tab switches)") },
            { value: "downloads", label: downloading ? t("Downloads ({n})", { n: downloading }) : failed ? t("Downloads ({n} failed)", { n: failed }) : t("Downloads"), icon: "downloads",
              title: downloading ? tn(downloading, "{n} download running or waiting (Tab switches)", "{n} downloads running or waiting (Tab switches)")
                : failed ? tn(failed, "{n} download failed. Retry is on this tab (Tab switches)", "{n} downloads failed. Retry is on this tab (Tab switches)")
                : t("What is downloading and what was installed (Tab switches)") },
          ]} />
        {tab === "browse" && route.user !== undefined && <Button size="sm" variant="ghost" icon="left" onClick={leave} title={t("Back to the mods (Esc)")}>{t("Back")}</Button>}
        <span className="grow" />
        <IconButton icon="expand" label={t("Open in gachamod")} title={t("Open this page in the main gachamod window. The menu closes")}
          onClick={() => { if (tab === "keys") openKeySettings(); else skinMenu.openInApp(game, route).catch((e) => toast(errorText(e), true)); }} />
        <IconButton icon="x" label={t("Close")} title={t("Close (Esc or {key})", { key })} onClick={close} />
      </header>

      <div className="ov-body">
        {tab === "mine" ? (
          loading ? <div className="ov-wait"><Waiting what={t("Reading your mods")} /></div>
          : (<>
            <div className="ov-side">
              <SearchField className="ov-find" value={q} onChange={setQ} placeholder={t("Find a character")} onEnter={toSkins} />
              {!shown.length ? <p className="muted ov-none">{words ? t("No character or skin has that name.") : t("No mods yet. Find some in Browse.")}</p> : (
            <nav className="ov-rail" aria-label={t("Characters")}>
              {shown.map((w, i) => (
                <button key={w.name} type="button" className={`ov-who${w === who ? " on" : ""}`} style={{ "--i": Math.min(i, 14) } as React.CSSProperties}
                  aria-current={w === who} onClick={() => setSel(w.name)} onFocus={() => setSel(w.name)}
                  title={whoTip(w)}>
                  {w.name === OTHER ? <span className="ov-who-i"><Icon name="mods" /></span> : <Portrait game={game} name={w.name} size={38} />}
                  <span className="ov-who-t">
                    <span className="ov-who-n">{w.name}{w.here && <span className="ov-who-here">{t("On screen")}</span>}</span>
                    <span className="ov-who-s">{w.showing ?? (w.name === OTHER ? tn(w.mods.length, "{n} mod", "{n} mods") : t("Vanilla"))}</span>
                  </span>
                  <span className="ov-who-c">{(w.group?.mods.length ?? 0) + w.mods.length}</span>
                </button>
              ))}
            </nav>
              )}
            </div>
            {who && (
              <main className="ov-pane ov-scroll" key={who.name}>
                <div className="ov-hero">
                  {who.name === OTHER ? <span className="ov-who-i big"><Icon name="mods" /></span> : <Portrait game={game} name={who.name} size={64} />}
                  <div className="ov-hero-t">
                    <h1>{who.name}</h1>
                    <span className="muted">{who.showing ? t("{name} is showing", { name: who.showing }) : who.name === OTHER ? t("Mods that aren't for one character") : t("Vanilla")}</span>
                  </div>
                </div>
                {who.group && (
                  <section>
                    <h2 className="ov-h" title={t("These switch at once, without reloading the game")}>{t("Skins")}</h2>
                    <div className="ov-grid" role="radiogroup" aria-label={t("{name}'s skin", { name: who.name })}>
                      {!words && (
                        <Tile i={0} on={who.group.active === 0} busy={busy === `${who.name}-0`} name={t("None")} icon="block"
                          title={t("Vanilla {name}: none of these skins", { name: who.name })} onPick={() => void pick(who, 0)} menu={() => skinMenuOf(who, 0, null)} />
                      )}
                      {who.group.mods.filter((m) => !words || who.name.toLowerCase().includes(words) || m.name.toLowerCase().includes(words)).map((m, i) => {
                        const full = modOf(m.modId);
                        const fresh = !!info && isNewSkin(game, info, who.group!, m.modId);
                        return (
                          <Tile key={m.modId} i={i + 1} on={who.group!.active === m.slot} busy={busy === `${who.name}-${m.slot}`} name={m.name} src={fileUrl(m.preview)} blur={full?.nsfw}
                            fresh={fresh} onHint={tipFor(who.name, fresh)} shift={!!full && !!who.showing && who.group!.active !== m.slot}
                            title={who.group!.active === m.slot ? t("{name} is showing", { name: m.name }) : !m.enabled ? t("{name} is off. Picking it turns it on, and it shows after the game reloads", { name: m.name })
                              : who.showing && full ? t("Show {name}. Shift+click or Shift+Enter shows it next to {showing} instead, and it stops switching in game", { name: m.name, showing: who.showing })
                              : t("Show {name}", { name: m.name })}
                            onPick={(shift) => void (shift && full && who.showing && who.group!.active !== m.slot ? beside(full, who.showing) : pick(who, m.slot))} onMore={full ? () => setDetail({ mod: full }) : undefined} menu={() => skinMenuOf(who, m.slot, full)} />
                        );
                      })}
                    </div>
                  </section>
                )}
                {who.mods.length > 0 && (
                  <section>
                    <h2 className="ov-h" title={who.name === OTHER ? t("Turning one on or off shows after the game reloads mods ({key}).", { key: reloadKeyOf(game) })
                      : t("Turning one on or off shows after the game reloads mods ({key}). Turning one on turns {name}'s other mods off. Shift+click keeps them on", { key: reloadKeyOf(game), name: who.name })}>
                      {who.group ? t("Other mods") : t("Mods")}</h2>
                    <div className="ov-grid">
                      {who.mods.filter((m) => !words || who.name.toLowerCase().includes(words) || m.name.toLowerCase().includes(words)).map((m, i) => (
                        <Tile key={m.id} i={i} on={m.enabled} check shift={!m.enabled && !!m.character} busy={busy === m.id} name={m.name} src={fileUrl(m.preview)} blur={m.nsfw}
                          title={m.enabled ? t("{name} is on. Click to turn it off", { name: m.name })
                            : m.character ? t("Turn on {name} and {character}'s other mods off. Shift+click keeps them on", { name: m.name, character: m.character })
                            : t("{name} is off. Click to turn it on", { name: m.name })}
                          onPick={(shift) => void turn(m, !m.enabled, shift)} onMore={() => setDetail({ mod: m })} menu={() => modMenu(m)} />
                      ))}
                    </div>
                  </section>
                )}
              </main>
            )}
          </>)
        ) : tab === "keys" ? (
          <KeysTab key={keysQ} query={keysQ} game={game} list={kl.list} error={kl.error} order={order} onRetry={() => void kl.reload()} onMine={() => setTab("mine")} onSettings={openKeySettings} onSay={say} />
        ) : tab === "browse" ? (
          // the app's own browser and creator pages, scrolling inside the menu
          <div className="ov-page ov-scroll" key={route.user ?? "mods"}>
            {!state ? <div className="ov-wait"><Waiting what={t("Reading your games")} /></div>
              : !state.gamebananaId ? <p className="muted ov-empty">{t("This game has no page on GameBanana.")}</p>
              : route.user ? <CreatorPage key={route.user} id={route.user} game={state} />
              : <div className="page gb-browse"><GbBrowser game={game} /></div>}
          </div>
        ) : (
          <div className="ov-page ov-scroll"><Downloads /></div>
        )}

        {detail && tab === "mine" && (
          <aside className="ov-detail" aria-label={t("Details")}>
            <IconButton icon="x" label={t("Back")} title={t("Back (Esc)")} className="ov-detail-x" onClick={() => setDetail(null)} />
            <ModDetail game={game} m={detail.mod} group={everyone.find((w) => w.group?.mods.some((x) => x.modId === detail.mod.id)) ?? null} busy={!!busy}
              onShow={(w, slot) => void pick(w, slot)} onTurn={(on) => void turn(detail.mod, on)} onKeys={() => keysOf(detail.mod)} />
          </aside>
        )}
      </div>

      <footer className="ov-foot">
        <span className={`ov-say${hint ? " said" : note?.bad ? " bad" : note ? " said" : ""}`} role="status">{footText}</span>
        <div className="ov-quick">
          <Checkbox checked={closeAfter} onChange={(v) => void closePref.set(v)} label={t("Close after picking")}
            title={t("Picking a skin or turning a mod on or off closes the menu and puts you back in the game. Off, the menu stays open and the cursor stays where it was")} />
          <span className="ov-quick-l">{t("Background")}</span>
          <Segmented<Cover> size="sm" label={t("Background")} value={cover} onChange={(v) => void coverPref.set(v)} options={[
            { value: "100", label: t("Solid"), title: t("The game doesn't show through the menu") },
            { value: "85", label: t("{n}%", { n: 85 }), title: t("The game shows through the menu a little") },
            { value: "70", label: t("{n}%", { n: 70 }), title: t("The game shows through the menu more") },
          ]} />
        </div>
      </footer>
    </div>
  );
}

/** A character's tip in the list: its mods, the one showing and whether it's on screen. */
function whoTip(w: Who): string {
  const n = (w.group?.mods.length ?? 0) + w.mods.length;
  const count = tn(n, "{n} mod", "{n} mods");
  const tip = w.showing ? t("{name}: {count}, {showing} is showing", { name: w.name, count, showing: w.showing }) : t("{name}: {count}", { name: w.name, count });
  return w.here ? t("{tip}. On screen in the game now", { tip }) : tip;
}

/** `onPick` gets whether Shift was held. `menu`: its right-click menu. `fresh`: a skin not shown in game yet, marked
 *  New; `onHint` hears when it has the pointer or the focus, so the menu can say what to do if it looks wrong. */
function Tile({ i, on, check, busy, name, src, icon = "mods", blur, fresh, shift, title, onPick, onMore, onHint, menu }: {
  i: number; on: boolean; check?: boolean;
  /** Shift+Enter does something different here (turns it on next to the others). */
  shift?: boolean; busy?: boolean; name: string; src?: string; icon?: "mods" | "block"; blur?: boolean; fresh?: boolean; title: string;
  onPick: (shift: boolean) => void; onMore?: () => void; onHint?: (on: boolean) => void; menu?: () => MenuEntry[];
}) {
  const nsfw = useNsfw();
  return (
    <div className="ov-cell" style={{ "--i": Math.min(i, 16) } as React.CSSProperties} onContextMenu={menu ? menuHandler(menu) : undefined}>
      <button type="button" role={check ? "checkbox" : "radio"} aria-checked={on} data-shift={shift || undefined} className={`ov-tile${on ? " on" : ""}${busy ? " busy" : ""}`}
        onClick={(e) => onPick(e.shiftKey)} title={title}
        onFocus={() => onHint?.(true)} onBlur={() => onHint?.(false)} onMouseEnter={() => onHint?.(true)} onMouseLeave={() => onHint?.(false)}
        onKeyDown={(e) => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); onPick(true); } }}>
        <span className={`ov-pic${blur && nsfw !== "show" ? " blur" : ""}`}>{src ? <LazyImg src={src} alt="" draggable={false} /> : <Icon name={icon} />}</span>
        <span className="ov-label"><span className="ov-t">{name}</span>{fresh && <span className="ov-new">{t("New")}</span>}{on && <span className="ov-check"><Icon name="check" /></span>}</span>
      </button>
      {onMore && <IconButton size="sm" icon="info" label={t("Details of {name}", { name })} title={t("Details (I)")} className="ov-more" onClick={onMore} />}
    </div>
  );
}

function ModDetail({ game, m, group, busy, onShow, onTurn, onKeys }: {
  game: GameId; m: ModEntry; group: Who | null; busy: boolean; onShow: (w: Who, slot: number) => void; onTurn: (on: boolean) => void;
  /** Its keys on the Keys tab. */
  onKeys: () => void;
}) {
  const nsfw = useNsfw();
  const src = fileUrl(m.preview);
  const slot = group?.group?.mods.find((x) => x.modId === m.id)?.slot ?? 0;
  const showing = !!group?.group && group.group.active === slot;
  const facts = [m.source?.submitter && t("By {name}", { name: m.source.submitter }), m.version && t("Version {version}", { version: m.version }), formatBytes(m.sizeBytes),
    m.installedAt ? t("Installed {when}", { when: timeAgo(m.installedAt) }) : null].filter(Boolean);
  return (
    <>
      <div className={`ov-detail-pic${m.nsfw && nsfw !== "show" ? " blur" : ""}`}>{src ? <img src={src} alt="" draggable={false} /> : <Icon name="mods" />}</div>
      <div className="ov-detail-t">
        <h1>{m.name}</h1>
        <div className="ov-detail-who">
          {m.character && <><Portrait game={game} name={m.character} size={22} /><span>{m.character}</span></>}
          {showing ? <Badge tone="ok" icon="check">{t("Showing")}</Badge> : m.enabled ? <Badge tone="ok">{t("On")}</Badge> : <Badge>{t("Off")}</Badge>}
          {m.updateAvailable && (m.source?.modId
            ? <Badge tone="accent" icon="update" title={t("GameBanana has a newer file. Click to update. Options, tags and on/off state stay")}
                onClick={() => void installLatest(game, m.source!.modId, m.id)}>{t("Update")}</Badge>
            : <Badge tone="accent">{t("Update")}</Badge>)}
          {m.hasKeys && <Badge title={t("It has keys that change parts of it while you play. Click to see them")} onClick={onKeys}>{t("Toggles")}</Badge>}
        </div>
        <p className="muted">{facts.join(", ")}</p>
        {m.tags.length > 0 && <p className="ov-tags">{m.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</p>}
        {m.notes && <p className="ov-notes">{m.notes}</p>}
        <div className="ov-detail-a">
          {group?.group
            ? <Button variant="primary" icon="play" disabled={busy || showing} onClick={() => onShow(group, slot)}
                title={showing ? t("This is the skin showing now") : t("Shows it in the game now")}>{showing ? t("Showing") : t("Show in game")}</Button>
            : <Button variant="primary" icon={m.enabled ? "block" : "check"} disabled={busy} onClick={() => onTurn(!m.enabled)}
                title={t("The game shows the change after it reloads mods ({key})", { key: reloadKeyOf(game) })}>{m.enabled ? t("Turn off") : t("Turn on")}</Button>}
          {!!m.source?.modId && <Button icon="browse" onClick={() => openGbMod(m.source!.modId)}
            title={t("The mod's page on GameBanana: pictures, description, files and comments")}>{t("GameBanana page")}</Button>}
        </div>
      </div>
    </>
  );
}

