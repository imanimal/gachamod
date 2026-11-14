// Installed mods as a grid or list, used by Mods and by each character's page. Click opens the details; Ctrl+click,
// Shift+click and Shift+arrows select; a bar at the bottom acts on the selection. Keys: arrows move, Enter opens,
// Space turns on or off, Ctrl+Space selects, Ctrl+A selects all, F2 renames, Delete moves to the trash, Esc clears
// the selection. On a controller, X (or the right stick pressed in) opens the focused mod's menu, which can select
// too. Every change records Undo. Owner: LIBRARY area.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type MouseEvent, type ReactNode, type SetStateAction } from "react";
import { errorText, type GameId, type ModEntry } from "../../lib/api";
import { aiShown, askAi, useAiShow } from "../../lib/ai";
import { useModHealth } from "../../lib/fixes";
import { usePortraitBatch, usePortraitsVersion, portraitNow } from "../../lib/portraits";
import { useNsfw } from "../../lib/prefs";
import { menuFor, openMenu, type MenuEntry } from "../../ui/ContextMenu";
import { Button, IconButton, Skeleton } from "../../ui/kit";
import { toast } from "../../ui/toast";
import {
  exportMods, fixForUpdate, getUpdate, keysOnlyOnScreen, onlyOnScreenFn, openDetails, setFavourite, trashMods, warmProfiles,
} from "./actions";
import { toggleMods } from "./data";
import { askLib } from "./LibDialogs";
import { noteLibrary, profileItems } from "./menus";
import { ModCard } from "./ModCard";

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

export function ModGrid({ game, mods, all, setMods, view = "grid", loading, icons, showCharacter = true, empty }: ModGridProps) {
  const nsfw = useNsfw();
  const health = useModHealth(game);
  const aiShow = useAiShow();
  usePortraitsVersion();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => (nsfw === "hide" ? mods.filter((m) => !m.nsfw) : mods), [mods, nsfw]);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const allRef = useRef(all);
  allRef.current = all;

  useEffect(() => { noteLibrary(game, all, health); }, [game, all, health]);
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

  const picked = useMemo(() => shown.filter((m) => selected.has(m.id)), [shown, selected]);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  // ── actions ──

  const toggle = useCallback(async (list: ModEntry[], on: boolean) => {
    const prior = allRef.current;
    const ids = list.filter((m) => m.enabled !== on).map((m) => m.id);
    if (!ids.length) return;
    const want = new Set(ids);
    const before = new Map(prior.map((m) => [m.id, m.enabled]));
    setMods?.((l) => l.map((m) => (want.has(m.id) ? { ...m, enabled: on } : m)));
    try {
      const ch = await toggleMods(game, ids, on, prior);
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

  /** The mod's menu with Select on top (the selection lives here, not in the registered menu). */
  const itemsFor = useCallback((m: ModEntry): MenuEntry[] => {
    const sel = pickedRef.current;
    const inSel = sel.some((x) => x.id === m.id);
    return [
      { label: inSel ? "Unselect" : "Select", icon: "select", keys: "Ctrl+Space", onClick: () => flip(m.id) },
      sel.length > 0 && { label: "Clear the selection", icon: "x", keys: "Esc", onClick: () => setSelected(new Set()) },
      "-",
      ...menuFor("mod", { game, mod: m, selection: inSel && sel.length > 1 ? sel : undefined }),
    ];
  }, [game]);

  const onMenu = useCallback((m: ModEntry, el: HTMLElement) => openMenu(el, itemsFor(m)), [itemsFor]);
  const onToggleCard = useCallback((m: ModEntry, on: boolean) => void toggle([m], on), [toggle]);
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
    if (!hit || !gridRef.current) return;
    const idx = Number(hit.dataset.idx ?? -1);
    const m = shown[idx];
    if (!m) return;
    const items = [...gridRef.current.querySelectorAll<HTMLElement>(".mod-card-hit")];
    let cols = 1;
    if (view === "grid") { const top = items[0]?.getBoundingClientRect().top; cols = Math.max(1, items.filter((x) => Math.abs(x.getBoundingClientRect().top - (top ?? 0)) < 2).length); }
    const move = (to: number) => {
      e.preventDefault();
      const t = Math.max(0, Math.min(items.length - 1, to));
      items[t]?.focus();
      const target = shown[t];
      if (e.shiftKey && target) { if (!anchor.current) anchor.current = m.id; selectRange(target.id, false); }
    };
    const k = e.key;
    if (k === "ArrowRight") move(idx + 1);
    else if (k === "ArrowLeft") move(idx - 1);
    else if (k === "ArrowDown") move(idx + cols);
    else if (k === "ArrowUp") move(idx - cols);
    else if (k === "Home") move(0);
    else if (k === "End") move(items.length - 1);
    else if (k === " " && (e.ctrlKey || e.metaKey)) { e.preventDefault(); flip(m.id); }
    else if (k === " ") { e.preventDefault(); void toggle(selected.has(m.id) && picked.length > 1 ? picked : [m], !m.enabled); }
    else if (k === "F2") { e.preventDefault(); askLib({ kind: "rename", game, mod: m }); }
    else if (k === "Delete") { e.preventDefault(); void trash(selected.has(m.id) ? picked : [m]); }
    else if (k.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setSelected(new Set(shown.map((x) => x.id))); }
    else if (k === "Escape" && selected.size) { e.preventDefault(); e.stopPropagation(); setSelected(new Set()); }
  };

  // Delete and Esc with a selection work from anywhere on the screen (not while typing or with a window open)
  useEffect(() => {
    if (!selected.size) return;
    const h = (e: globalThis.KeyboardEvent) => {
      if ((e.key !== "Delete" && e.key !== "Escape") || document.querySelector(".overlay, .ctx")) return;
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (t?.closest?.(".mod-grid")) return;
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
      <div className="mod-grid is-loading" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="mod-card-skel" />)}
      </div>
    );
  }
  if (!shown.length) return <>{empty}</>;

  const broken = picked.filter((m) => health.get(m.id)?.status === "broken");
  const allFav = picked.length > 0 && picked.every((m) => m.favorite);
  const onScreen = onlyOnScreenFn();
  return (
    <div className="mod-grid-wrap">
      <div ref={gridRef} className={`mod-grid ${view === "list" ? "is-list" : "cards"}`} onKeyDown={onKey} onContextMenu={onContextMenu}
        onKeyUp={(e) => { if (e.key === " " && (e.target as HTMLElement).closest(".mod-card-hit")) e.preventDefault(); }}>
        {shown.map((m, i) => (
          <ModCard key={m.id} game={game} mod={m} index={i} row={view === "list"} selected={selected.has(m.id)} nsfw={nsfw}
            showCharacter={showCharacter} health={health.get(m.id)} portrait={portraitOf(m)}
            onOpen={onOpen} onToggle={onToggleCard} onMenu={onMenu} onUpdate={onUpdate} />
        ))}
      </div>

      {picked.length > 0 && (
        <div className="floatbar mod-bulk" role="toolbar" aria-label="Selected mods">
          <span className="floatbar-n">{picked.length} selected</span>
          <Button size="sm" icon="power" onClick={() => void toggle(picked, true)}>Turn on</Button>
          <Button size="sm" icon="power" variant="ghost" onClick={() => void toggle(picked, false)}>Turn off</Button>
          <Button size="sm" variant="ghost" icon="profiles" iconRight="down" title="Add them to a profile, or take them out"
            onClick={(e) => openMenu(e.currentTarget, profileItems(game, picked))}>Profile</Button>
          <Button size="sm" variant="ghost" icon="characters" onClick={() => askLib({ kind: "character", game, mods: picked })} title="Set which character these mods are for">Character</Button>
          <Button size="sm" variant="ghost" icon="tag" onClick={() => askLib({ kind: "tags", game, mods: picked })} title="Add or remove tags on these mods">Tags</Button>
          <IconButton size="sm" icon="star" on={allFav} label={allFav ? "Remove from favourites" : "Add to favourites"} onClick={() => void setFavourite(game, picked, !allFav)} />
          {broken.length > 0 && (
            <Button size="sm" variant="ghost" icon="wand" title="A game update broke these and a fix is known" onClick={() => void fixForUpdate(game, broken)}>
              Fix {broken.length === picked.length ? "" : `${broken.length} `}for the update
            </Button>
          )}
          {onScreen && picked.some((m) => m.hasKeys) && (
            <IconButton size="sm" icon="keyboard" label="Toggles only while on screen: their toggles only work while their character is on screen"
              onClick={() => void keysOnlyOnScreen(game, picked.filter((m) => m.hasKeys))} />
          )}
          {aiShown("useful", aiShow) && (
            <IconButton size="sm" icon="ai" label="Ask the AI helper (rename, tag or sort these)" onClick={() => askAi({ kind: "mods", game, modIds: picked.map((m) => m.id) })} />
          )}
          <IconButton size="sm" icon="share" label="Share as .gachamod" onClick={() => exportMods(game, picked)} />
          <IconButton size="sm" icon="more" label="More actions" onClick={(e) => openMenu(e.currentTarget, menuFor("mod", { game, mod: picked[0]!, selection: picked }))} />
          <Button size="sm" variant="danger" icon="trash" title="Move to trash (Delete). Undo puts them back" onClick={() => void trash(picked)}>Trash</Button>
          <IconButton size="sm" icon="x" label="Clear the selection (Esc)" onClick={() => setSelected(new Set())} />
        </div>
      )}
    </div>
  );
}

