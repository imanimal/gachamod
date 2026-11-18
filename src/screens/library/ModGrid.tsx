// Installed mods as a grid or list, used by Mods and by each character's page. Click opens the details; Ctrl+click,
// Shift+click and Shift+arrows select; a bar at the bottom acts on the selection. Keys: arrows move, Enter opens,
// Space turns on or off (Shift+Space or Shift+click on the switch keeps the character's other mods on), Ctrl+Space selects, Ctrl+A selects all, F2 renames, Delete moves to the trash, Esc clears
// the selection. On a controller, X (or the right stick pressed in) opens the focused mod's menu, which can select
// too. Every change records Undo. Owner: LIBRARY area.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type MouseEvent, type ReactNode, type SetStateAction } from "react";
import { errorText, type GameId, type ModEntry } from "../../lib/api";
import { aiShown, askAi, useAiShow } from "../../lib/ai";
import { useModHealth } from "../../lib/fixes";
import { holdOn, settleHolds, useHolds } from "../../lib/holds";
import { usePortraitBatch, usePortraitsVersion, portraitNow } from "../../lib/portraits";
import { useNsfw } from "../../lib/prefs";
import { useTrashDays } from "../settings/automatic";
import { menuFor, openMenu, type MenuEntry } from "../../ui/ContextMenu";
import { Button, IconButton, Skeleton, Waiting, behindLayer } from "../../ui/kit";
import { toast } from "../../ui/toast";
import {
  fixForUpdate, getUpdate, keysOnlyOnScreen, onlyOnScreenFn, openDetails, setFavourite, setParent, trashMods, warmProfiles,
} from "./actions";
import { anchorFor, askOverlap } from "./overlap";
import { toggleMods } from "./data";
import { askLib } from "./LibDialogs";
import { getUpdates, isBroken, noteLibrary, profileItems } from "./menus";
import { ModCard } from "./ModCard";
import { t } from "../../lib/i18n";
import { useModsFormat } from "../../lib/theme";

export interface ModGridProps {
  game: GameId;
  /** The mods to show, in order. */
  mods: ModEntry[];
  /** Every mod of the game (their states before a change, for Undo). */
  all: ModEntry[];
  /** The list's setter, for instant on/off before the backend answers. */
  setMods?: Dispatch<SetStateAction<ModEntry[]>>;
  view?: "grid" | "list";
  loading?: boolean;
  /** Character icons from GameBanana by lowercased name, the fallback for cards without a picture. */
  icons?: Map<string, string | null>;
  showCharacter?: boolean;
  /** Shown when there is nothing to show. */
  empty?: ReactNode;
}

/** Cards drawn at first and added each time the end of the grid comes near. */
const BATCH = 60;

/** The nearest box above `el` that scrolls up and down (`.view`), or null for the window. */
function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

export function ModGrid({ game, mods, all, setMods, view: asked = "grid", loading, icons, showCharacter = true, empty }: ModGridProps) {
  // the Compact list layout (Settings, Appearance) shows every grid as dense rows, whatever the page asked for
  const dense = useModsFormat() === "rows";
  const view = dense ? "list" : asked;
  const nsfw = useNsfw();
  const health = useModHealth(game);
  const holds = useHolds(game);
  const aiShow = useAiShow();
  const trashDays = useTrashDays();
  usePortraitsVersion();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => (nsfw === "hide" ? mods.filter((m) => !m.nsfw) : mods), [mods, nsfw]);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const allRef = useRef(all);
  allRef.current = all;
  // sub-mod cards name their parent
  const names = useMemo(() => new Map(all.map((m) => [m.id, m.name])), [all]);

  useEffect(() => { noteLibrary(game, all, health); }, [game, all, health]);
  // a mod waiting for an update that got one shows its warnings again
  useEffect(() => { void settleHolds(game, all); }, [game, all]);
  useEffect(() => { warmProfiles(game); }, [game]);
  const chars = useMemo(() => [...new Set(shown.filter((m) => !m.preview && m.character).map((m) => m.character!))], [shown]);
  usePortraitBatch(game, chars);

  // the selection only holds mods that are showing
  useEffect(() => {
    setSelected((s) => {
      if (!s.size) return s;
      const ids = new Set(shown.map((m) => m.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [shown]);

  // cards are drawn in batches: the first ones at once, more as the end comes near
  const [limit, setLimit] = useState(BATCH);
  useEffect(() => { setLimit(BATCH); }, [game]);
  const more = shown.length > limit;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!more || !el) return;
    if (typeof IntersectionObserver === "undefined") { setLimit(Infinity); return; }
    // observed again after each batch, so a tall window keeps filling until the end is out of reach
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setLimit((l) => l + BATCH); },
      { root: scroller(el), rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit, loading]);

  const picked = useMemo(() => shown.filter((m) => selected.has(m.id)), [shown, selected]);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  // ── actions ──

  /** `keep`: the character's other mods stay on, without asking (Shift). */
  const toggle = useCallback(async (list: ModEntry[], on: boolean, keep = false) => {
    const prior = allRef.current;
    const ids = list.filter((m) => m.enabled !== on).map((m) => m.id);
    if (!ids.length) return;
    // mods on while their character has others on: ask first (overlap.ts), unless Shift said to keep them
    let turnOffOthers: boolean | undefined;
    if (on && keep) turnOffOthers = false;
    else if (on) {
      const going = list.filter((m) => ids.includes(m.id));
      const c = await askOverlap(game, going, prior, anchorFor(going[0]!.id));
      if (!c) return;
      if (c.parent && going.length === 1 && !(await setParent(game, going[0]!, c.parent, prior))) return;
      turnOffOthers = c.turnOffOthers;
    }
    const want = new Set(ids);
    const before = new Map(prior.map((m) => [m.id, m.enabled]));
    setMods?.((l) => l.map((m) => (want.has(m.id) ? { ...m, enabled: on } : m)));
    try {
      const ch = await toggleMods(game, ids, on, prior, turnOffOthers);
      // mods the one-skin rule skipped go back to how they were
      const done = new Set(ch.changed.map((m) => m.id));
      setMods?.((l) => l.map((m) => (want.has(m.id) && !done.has(m.id) && m.enabled !== before.get(m.id) ? { ...m, enabled: before.get(m.id)! } : m)));
    } catch (e) {
      setMods?.((l) => l.map((m) => (want.has(m.id) ? { ...m, enabled: before.get(m.id) ?? m.enabled } : m)));
      toast(errorText(e), true);
    }
  }, [game, setMods]);

  const trash = useCallback(async (list: ModEntry[]) => {
    await trashMods(game, list);
    setSelected(new Set());
  }, [game]);

  /** Delete from the keyboard: then focus goes to the next card that stays (the one before at the end), so the
   *  arrows and Delete keep working. */
  const trashFromKey = async (list: ModEntry[], at: number) => {
    const going = new Set(list.map((m) => m.id));
    const order = shownRef.current;
    const next = order.slice(at + 1).find((m) => !going.has(m.id)) ?? order.slice(0, at).reverse().find((m) => !going.has(m.id));
    await trash(list);
    let tries = 0;
    const land = () => {
      const grid = gridRef.current;
      if (!grid) return;
      const active = document.activeElement;
      // something else took focus (a dialog, a click), or the card is still there because the removal was cancelled
      if (active && active !== document.body && !grid.contains(active)) return;
      const hitOf = (id: string) => grid.querySelector<HTMLElement>(`.mod-card[data-mod="${CSS.escape(id)}"] .mod-card-hit`);
      const stillThere = [...going].some((id) => hitOf(id));
      if (stillThere && tries++ < 30) { requestAnimationFrame(land); return; }
      if (active && grid.contains(active)) return;
      const back = order[at];
      const el = stillThere ? (back ? hitOf(back.id) : null) : next ? hitOf(next.id) : null;
      (el ?? grid.querySelector<HTMLElement>(".mod-card-hit"))?.focus();
    };
    requestAnimationFrame(land);
  };

  const selectRange = (toId: string, add: boolean) => {
    const ids = shownRef.current.map((x) => x.id);
    const a = anchor.current ? ids.indexOf(anchor.current) : -1, b = ids.indexOf(toId);
    if (a < 0 || b < 0) return false;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelected((s) => new Set([...(add ? s : []), ...ids.slice(lo, hi + 1)]));
    return true;
  };
  const flip = (id: string) => {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    anchor.current = id;
  };

  const onOpen = useCallback((m: ModEntry, e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) { flip(m.id); return; }
    if (e.shiftKey && selectRange(m.id, true)) return;
    anchor.current = m.id;
    openDetails(m);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** The mod's menu with the selection items after its first group (Turn on, Details), since the selection lives
   *  here, not in the registered menu. */
  const itemsFor = useCallback((m: ModEntry): MenuEntry[] => {
    const sel = pickedRef.current;
    const inSel = sel.some((x) => x.id === m.id);
    const every = shownRef.current;
    const selecting: MenuEntry[] = [
      { label: inSel ? t("Unselect") : t("Select"), icon: "select", keys: "Ctrl+Space", onClick: () => flip(m.id) },
      every.length > 1 && sel.length < every.length && { label: t("Select all shown"), icon: "select", keys: "Ctrl+A", onClick: () => setSelected(new Set(shownRef.current.map((x) => x.id))) },
      sel.length > 0 && { label: t("Clear the selection"), icon: "x", keys: "Esc", onClick: () => setSelected(new Set()) },
    ];
    const rest = menuFor("mod", { game, mod: m, selection: inSel && sel.length > 1 ? sel : undefined });
    const cut = rest.indexOf("-");
    return cut < 0 ? [...rest, "-", ...selecting] : [...rest.slice(0, cut), "-", ...selecting, ...rest.slice(cut)];
  }, [game]);

  const onMenu = useCallback((m: ModEntry, el: HTMLElement) => openMenu(el, itemsFor(m)), [itemsFor]);
  const onToggleCard = useCallback((m: ModEntry, on: boolean, keep: boolean) => void toggle([m], on, keep), [toggle]);
  const onUpdate = useCallback((m: ModEntry) => void getUpdate(game, m), [game]);

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>(".mod-card")?.dataset.mod;
    const m = id ? shownRef.current.find((x) => x.id === id) : undefined;
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : (e.target as Element), itemsFor(m));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>(".mod-card-hit");
    if (!hit || !gridRef.current || behindLayer(hit)) return;
    const idx = Number(hit.dataset.idx ?? -1);
    const m = shown[idx];
    if (!m) return;
    const items = [...gridRef.current.querySelectorAll<HTMLElement>(".mod-card-hit")];
    // cards per row, measured only for the keys that need it and only along the first row
    let cols = 1;
    if (view === "grid" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const top = items[0]?.getBoundingClientRect().top ?? 0;
      const end = items.findIndex((x) => Math.abs(x.getBoundingClientRect().top - top) >= 2);
      cols = Math.max(1, end < 0 ? items.length : end);
    }
    const move = (to: number) => {
      e.preventDefault();
      const at = Math.max(0, Math.min(shown.length - 1, to));
      if (at < items.length) items[at]?.focus();
      else {
        // past the cards drawn so far: draw up to it, then focus it
        setLimit((l) => Math.max(l, at + 1 + BATCH / 2));
        requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`.mod-card-hit[data-idx="${at}"]`)?.focus());
      }
      const target = shown[at];
      if (e.shiftKey && target) { if (!anchor.current) anchor.current = m.id; selectRange(target.id, false); }
    };
    const k = e.key;
    if (k === "ArrowRight") move(idx + 1);
    else if (k === "ArrowLeft") move(idx - 1);
    else if (k === "ArrowDown") move(idx + cols);
    else if (k === "ArrowUp") move(idx - cols);
    else if (k === "Home") move(0);
    else if (k === "End") move(shown.length - 1);
    else if (k === " " && (e.ctrlKey || e.metaKey)) { e.preventDefault(); flip(m.id); }
    else if (k === " ") {
      // the same rule as the menu's Turn on/off: all on turns them off, otherwise on
      e.preventDefault();
      const list = selected.has(m.id) && picked.length > 1 ? picked : [m];
      void toggle(list, !list.every((x) => x.enabled), e.shiftKey);
    }
    else if (k === "F2") { e.preventDefault(); askLib({ kind: "rename", game, mod: m }); }
    else if (k === "Delete") { e.preventDefault(); void trashFromKey(selected.has(m.id) ? picked : [m], idx); }
    else if (k.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setSelected(new Set(shown.map((x) => x.id))); }
    else if (k === "Escape" && selected.size) { e.preventDefault(); e.stopPropagation(); setSelected(new Set()); }
  };

  // Delete and Esc with a selection work from anywhere on the screen (not while typing or with a window open)
  useEffect(() => {
    if (!selected.size) return;
    const h = (e: globalThis.KeyboardEvent) => {
      if ((e.key !== "Delete" && e.key !== "Escape") || document.querySelector(".overlay, .ctx")) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (el?.closest?.(".mod-grid")) return;
      e.preventDefault();
      if (e.key === "Escape") setSelected(new Set());
      else void trash(pickedRef.current);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected, trash]);

  const portraitOf = (m: ModEntry) => (m.preview || !m.character ? null : portraitNow(game, m.character, icons?.get(m.character.toLowerCase()) ?? null));

  if (loading) {
    return (
      <Waiting what={t("Reading your mods")}>
        <div className={`mod-grid is-loading${view === "list" ? " is-list" : ""}${dense ? " is-dense" : ""}`}>
          {Array.from({ length: view === "list" ? 10 : 8 }, (_, i) => <Skeleton key={i} className="mod-card-skel" />)}
        </div>
      </Waiting>
    );
  }
  if (!shown.length) return <>{empty}</>;

  const broken = picked.filter((m) => isBroken(health.get(m.id)));
  const due = picked.filter((m) => m.updateAvailable && m.source);
  const allFav = picked.length > 0 && picked.every((m) => m.favorite);
  const onScreen = onlyOnScreenFn();
  return (
    <div className="mod-grid-wrap">
      <div ref={gridRef} className={`mod-grid ${view === "list" ? "is-list" : "cards"}${dense ? " is-dense" : ""}`} onKeyDown={onKey} onContextMenu={onContextMenu}
        onKeyUp={(e) => { if (e.key === " " && (e.target as HTMLElement).closest(".mod-card-hit")) e.preventDefault(); }}>
        {(more ? shown.slice(0, limit) : shown).map((m, i) => (
          <ModCard key={m.id} game={game} mod={m} index={i} row={view === "list"} selected={selected.has(m.id)} nsfw={nsfw}
            showCharacter={showCharacter} health={health.get(m.id)} portrait={portraitOf(m)}
            parentName={m.parent ? names.get(m.parent) : undefined} held={holdOn(holds, m)?.kind ?? null}
            onOpen={onOpen} onToggle={onToggleCard} onMenu={onMenu} onUpdate={onUpdate} />
        ))}
      </div>
      {more && <div ref={sentinel} className="mod-grid-more" style={{ height: 1 }} aria-hidden="true" />}

      {picked.length > 0 && (
        <div className="floatbar mod-bulk" role="toolbar" aria-label={t("Selected mods")}>
          <span className="floatbar-n">{t("{n} selected", { n: picked.length })}</span>
          <Button size="sm" icon="power" onClick={() => void toggle(picked, true)}>{t("Turn on")}</Button>
          <Button size="sm" icon="power" variant="ghost" onClick={() => void toggle(picked, false)}>{t("Turn off")}</Button>
          <Button size="sm" variant="ghost" icon="profiles" iconRight="down" title={t("Add them to a profile, or take them out")}
            onClick={(e) => openMenu(e.currentTarget, profileItems(game, picked))}>{t("Profile")}</Button>
          <Button size="sm" variant="ghost" icon="characters" onClick={() => askLib({ kind: "character", game, mods: picked })} title={t("Set which character these mods are for")}>{t("Character")}</Button>
          <Button size="sm" variant="ghost" icon="tag" onClick={() => askLib({ kind: "tags", game, mods: picked })} title={t("Add or remove tags on these mods")}>{t("Tags")}</Button>
          <IconButton size="sm" icon="star" on={allFav} label={allFav ? t("Remove from favourites") : t("Add to favourites")} onClick={() => void setFavourite(game, picked, !allFav)} />
          {broken.length > 0 && (
            <Button size="sm" variant="ghost" icon="wand" title={t("A game update broke these. Swaps their outdated hashes, or runs the fixer they need. A backup is kept and Undo puts them back")} onClick={() => void fixForUpdate(game, broken)}>
              {broken.length === picked.length ? t("Attempt fix") : t("Attempt fix on {n}", { n: broken.length })}
            </Button>
          )}
          {due.length > 0 && (
            <Button size="sm" variant="ghost" icon="downloads" title={due.length === 1 ? t("Download the newest version of {mod}", { mod: due[0]!.name }) : t("Download the newest version of each")}
              onClick={() => void getUpdates(game, due)}>{due.length === picked.length ? t("Update") : t("Update {n}", { n: due.length })}</Button>
          )}
          {onScreen && picked.some((m) => m.hasKeys) && (
            <IconButton size="sm" icon="keyboard" label={t("Toggles only while on screen: their toggles only work while their character is on screen")}
              onClick={() => void keysOnlyOnScreen(game, picked.filter((m) => m.hasKeys))} />
          )}
          {/* sharing is in the menu already; the AI helper joins it, so the bar fits a small window */}
          <IconButton size="sm" icon="more" label={t("More actions")} onClick={(e) => openMenu(e.currentTarget, [
            ...menuFor("mod", { game, mod: picked[0]!, selection: picked }),
            aiShown("useful", aiShow) && "-",
            aiShown("useful", aiShow) && { label: t("Ask the AI helper"), icon: "ai", title: t("Rename, tag or sort these"), onClick: () => askAi({ kind: "mods", game, modIds: picked.map((m) => m.id) }) },
          ])} />
          {trashDays > 0
            ? <Button size="sm" variant="danger" icon="trash" title={t("Move to trash (Delete). Undo puts them back")} onClick={() => void trash(picked)}>{t("Trash")}</Button>
            : <Button size="sm" variant="danger" icon="trash" title={t("Delete their files (Delete). Undo downloads the ones from GameBanana again; the rest are asked about first")} onClick={() => void trash(picked)}>{t("Delete")}</Button>}
          <IconButton size="sm" icon="x" label={t("Clear the selection (Esc)")} onClick={() => setSelected(new Set())} />
        </div>
      )}
    </div>
  );
}

