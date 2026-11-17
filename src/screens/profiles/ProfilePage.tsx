// One profile's page: its mods as cards, where each card's switch puts the mod in the profile or takes it out. Two
// tabs: the mods in it, and every mod to add from. On the profile in use the switch turns the mod on or off (the same
// thing); on another profile only its list changes and no files move until you switch to it. A mod taken out stays on
// screen until you leave the tab, so a slip is one click to put back. Route: { view: "profiles", profile, tab?:
// "every", modId? }. Keys: arrows move, Enter opens the details, Space adds or takes out. Owner: HOME/PROFILES area.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { errorText, library, profiles, type GameId, type ModEntry, type Profile } from "../../lib/api";
import { record } from "../../lib/history";
import { portraitNow, usePortraitBatch, usePortraitsVersion } from "../../lib/portraits";
import { useNsfw } from "../../lib/prefs";
import { closeRoute, patchRoute, useRoute } from "../../lib/store";
import { menuFor, menuHandler, openMenu, type MenuEntry } from "../../ui/ContextMenu";
import { withoutKeys } from "../../lib/menuHints";
import { Badge, Button, Empty, IconButton, SearchField, Skeleton, Tabs, timeAgo, Waiting } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { getUpdate, modsName, openDetails, setOn, setParent } from "../library/actions";
import { anchorFor, askOverlap, overlappingAll } from "../library/overlap";
import { liveCharacterOf } from "../ingame/data";
import { useMods } from "../library/data";
import { moveInGrid } from "../library/gridNav";
import { ModCard } from "../library/ModCard";
import { ModDrawerHost } from "../library/ModDrawer";
import type { EditFocus } from "./actions";
import { profilesChanged, type useCharacters } from "./data";
import { ProfileIcon } from "./ProfileIcon";
import "../characters/characters.css";

const byCharThenName = (a: ModEntry, b: ModEntry) =>
  (a.character ?? "￿").localeCompare(b.character ?? "￿") || a.name.localeCompare(b.name);

/** Put mods in another profile (not the one in use) and take others out, as one step. Only its list changes. */
async function setMembers(game: GameId, id: number, ins: string[], outs: string[]) {
  if (outs.length) await profiles.setMods(id, outs, false);
  if (ins.length) await profiles.setMods(id, ins, true);
  profilesChanged(game);
}

export function ProfilePage({ game, p, chars, busy, onSwitch, onEdit }: {
  game: GameId; p: Profile; chars: ReturnType<typeof useCharacters>; busy: boolean;
  onSwitch: () => void; onEdit: (focus?: EditFocus) => void;
}) {
  const route = useRoute();
  const tab = route.tab === "every" ? "every" : "in";
  const { mods, loaded } = useMods(game);
  const nsfw = useNsfw();
  usePortraitsVersion();
  const [query, setQuery] = useState("");
  const [members, setMembersState] = useState<Set<string> | null>(null);
  // mods taken out during this visit to the tab stay on screen
  const [kept, setKept] = useState<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setKept(new Set()); }, [p.id, tab]);

  // the profile in use holds exactly the mods that are on; another one keeps its own list
  const stamp = `${p.updatedAt}:${p.modCount}`;
  useEffect(() => {
    if (p.active) return;
    let live = true;
    profiles.members(p.id).then((ids) => { if (live) setMembersState(new Set(ids)); })
      .catch((e) => { if (live) { setMembersState(new Set()); toast(errorText(e), true); } });
    return () => { live = false; };
  }, [p.id, p.active, stamp]);

  const inIds = useMemo(() => (p.active ? new Set(mods.filter((m) => m.enabled).map((m) => m.id)) : members), [p.active, mods, members]);
  const ready = loaded && !!inIds;
  const isIn = useCallback((m: ModEntry) => !!inIds?.has(m.id), [inIds]);

  const visible = useMemo(() => (nsfw === "hide" ? mods.filter((m) => !m.nsfw) : mods), [mods, nsfw]);
  const inCount = useMemo(() => visible.filter(isIn).length, [visible, isIn]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = visible.filter((m) => (tab === "every" || isIn(m) || kept.has(m.id))
      && (!q || m.name.toLowerCase().includes(q) || m.character?.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q))));
    // the card's switch shows whether it's in this profile
    return list.sort(byCharThenName).map((m) => (m.enabled === isIn(m) ? m : { ...m, enabled: isIn(m) }));
  }, [visible, tab, isIn, kept, query]);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  usePortraitBatch(game, useMemo(() => [...new Set(shown.filter((m) => !m.preview && m.character).map((m) => m.character!))], [shown]));

  // ── changes, each with Undo ──

  /** `keep` (Shift): the character's other mods stay in without asking. */
  const setIn = useCallback(async (list: ModEntry[], on: boolean, keep = false) => {
    const ids = list.filter((m) => isIn(m) !== on).map((m) => m.id);
    if (!ids.length) return;
    if (!on) setKept((k) => new Set([...k, ...ids]));
    if (p.active) {
      // the profile in use: a normal switch, which asks about the character's other mods
      if (await setOn(game, mods.filter((m) => ids.includes(m.id)), on, mods, anchorFor(ids[0]!), keep)) profilesChanged(game);
      return;
    }
    const before = inIds ?? new Set<string>();
    const ins = on ? [...ids] : [];
    const outs = on ? [] : [...ids];
    const notes: string[] = [];
    if (on && !keep) {
      // the same rule as turning mods on ("Another skin already on"), with this profile's mods as the ones on
      const asIn = mods.map((m) => (m.enabled === before.has(m.id) ? m : { ...m, enabled: before.has(m.id) }));
      const going = asIn.filter((m) => ids.includes(m.id));
      const c = await askOverlap(game, going, asIn, anchorFor(ids[0]!));
      if (!c) return;
      if (c.parent && going.length === 1 && !(await setParent(game, mods.find((m) => m.id === going[0]!.id)!, c.parent, mods))) return;
      if (c.turnOffOthers) {
        // only the ones that change the same parts come out: a hair recolour stays next to an outfit
        const near = overlappingAll(going, asIn).filter((o) => !liveCharacterOf(game, o.id));
        const same = near.length ? await library.overlapping(game, ids, near.map((o) => o.id)).catch(() => near.map((o) => o.id)) : [];
        for (const o of near) if (same.includes(o.id)) { outs.push(o.id); notes.push(`took out ${o.name}`); }
        if (outs.length) setKept((k) => new Set([...k, ...outs]));
      }
    }
    const next = new Set(before);
    for (const id of outs) next.delete(id);
    for (const id of ins) next.add(id);
    setMembersState(next);
    const named = mods.filter((m) => (on ? ins : outs).includes(m.id) && ids.includes(m.id));
    const label = `${on ? "Added" : "Took"} ${modsName(named.length ? named : list)} ${on ? "to" : "out of"} ${p.name}${notes.length ? `, ${notes.join(", ")}` : ""}`;
    try {
      await setMembers(game, p.id, ins, outs);
      record({ label, undo: () => setMembers(game, p.id, outs, ins), redo: () => setMembers(game, p.id, ins, outs) });
    } catch (e) {
      setMembersState(before);
      toast(errorText(e), true);
    }
  }, [game, p, mods, inIds, isIn]);

  const itemsFor = useCallback((m: ModEntry): MenuEntry[] => {
    const inIt = isIn(m);
    return [
      { label: inIt ? `Take out of ${p.name}` : `Add to ${p.name}`, icon: inIt ? "minus" : "plus", keys: "Space", onClick: () => void setIn([m], !inIt) },
      "-",
      ...withoutKeys(menuFor("mod", { game, mod: mods.find((x) => x.id === m.id) ?? m }).filter((e) => !(e && typeof e === "object" && "keys" in e && e.keys === "Space")), ["Enter"]),
    ];
  }, [game, mods, p.name, isIn, setIn]);

  const onOpen = useCallback((m: ModEntry, _e: MouseEvent) => openDetails(m), []);
  const onToggle = useCallback((m: ModEntry, on: boolean, keep: boolean) => void setIn([m], on, keep), [setIn]);
  const onMenu = useCallback((m: ModEntry, el: HTMLElement) => openMenu(el, itemsFor(m)), [itemsFor]);
  const onUpdate = useCallback((m: ModEntry) => void getUpdate(game, m), [game]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (moveInGrid(e, gridRef.current, ".mod-card-hit")) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>(".mod-card-hit") && (e.target as HTMLElement).closest<HTMLElement>(".mod-card")?.dataset.mod;
    const m = id ? shownRef.current.find((x) => x.id === id) : undefined;
    if (m && e.key === " " && !e.ctrlKey) { e.preventDefault(); void setIn([m], !m.enabled); }
  };
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>(".mod-card")?.dataset.mod;
    const m = id ? shownRef.current.find((x) => x.id === id) : undefined;
    if (!m) return;
    e.preventDefault();
    openMenu({ x: e.clientX, y: e.clientY }, itemsFor(m));
  };

  const tipFor = (m: ModEntry) => `${m.name}. Enter opens the details, Space ${m.enabled ? `takes it out of ${p.name}` : `adds it to ${p.name}`}`;
  const portraitOf = (m: ModEntry) => (m.preview || !m.character ? null : portraitNow(game, m.character, null));
  const total = visible.length;

  return (
    <>
      <header className="char-hero profile-hero" onContextMenu={menuHandler(() => withoutKeys(menuFor("profile", { game, id: p.id })))}>
        <button type="button" className="profile-hero-pic" onClick={() => onEdit("icon")} title="Change the icon and colour">
          <ProfileIcon profile={p} chars={chars} size={88} />
        </button>
        <div className="char-hero-t">
          <button type="button" className="char-hero-back" onClick={() => closeRoute(["profile", "tab", "modId"])} title="Back to all profiles (Alt+Left)">
            Profiles
          </button>
          <h1 className="char-hero-name" title={p.name}>{p.name}</h1>
          <span className="hint">
            {inCount === 1 ? "1 mod" : `${inCount} mods`}{p.updatedAt ? `, changed ${timeAgo(p.updatedAt)}` : ""}
            {p.description ? `. ${p.description}` : ""}
          </span>
          <div className="char-hero-a">
            <Tabs value={tab} onChange={(v) => patchRoute({ tab: v === "every" ? "every" : undefined, modId: undefined })}
              tabs={[{ value: "in", label: "In this profile", icon: "profiles", count: ready ? inCount : undefined },
                { value: "every", label: "Add mods", icon: "plus", count: ready ? total - inCount : undefined }]} />
          </div>
        </div>
        <div className="char-hero-nav">
          {p.active
            ? <Badge tone="accent" icon="check" title="The profile in use. Turning mods on or off anywhere saves here">On now</Badge>
            : <Button variant="primary" icon="swap" busy={busy} onClick={onSwitch} title={`Turns mods on and off to match ${p.name}`}>Switch to it</Button>}
          <IconButton icon="edit" label="Edit" title="Edit the name, icon, colour, banner and hotkey" onClick={() => onEdit()} />
          <IconButton icon="more" label="More" title="More (right-click the header works too)" onClick={(e) => openMenu(e.currentTarget, withoutKeys(menuFor("profile", { game, id: p.id })))} />
        </div>
      </header>

      <div className="profile-page-bar">
        <SearchField value={query} onChange={setQuery} placeholder={tab === "every" ? "Search every mod" : `Search ${p.name}`} />
        <span className="hint">
          {p.active ? "It's the profile in use, so a switch here turns the mod on or off right away."
            : `Switches here only change ${p.name}'s list. Mods turn on and off when you switch to it.`}
        </span>
      </div>

      {!ready ? (
        <Waiting what={`Reading the mods in ${p.name}`}>
          <div className="mod-grid is-loading" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="mod-card-skel" />)}</div>
        </Waiting>
      ) : !shown.length ? (
        query ? <Empty icon="search" title="Nothing matches">No mod {tab === "every" ? "" : `in ${p.name} `}has "{query.trim()}" in its name, character or tags.</Empty>
        : tab === "every" ? <Empty icon="mods" title="No mods installed yet">Mods you install show up here to add to {p.name}.</Empty>
        : <Empty icon="profiles" title={`Nothing in ${p.name} yet`}
            actions={<Button variant="primary" icon="plus" onClick={() => patchRoute({ tab: "every" })}>Add mods</Button>}>
            {p.active ? "Mods you turn on while it's in use are saved here." : "Add mods to it here, or switch to it and turn mods on."}
          </Empty>
      ) : (
        <div ref={gridRef} className="mod-grid cards" onKeyDown={onKey} onContextMenu={onContextMenu}
          onKeyUp={(e) => { if (e.key === " " && (e.target as HTMLElement).closest(".mod-card-hit")) e.preventDefault(); }}>
          {shown.map((m, i) => (
            <ModCard key={m.id} game={game} mod={m} index={i} row={false} selected={false} nsfw={nsfw} showCharacter
              portrait={portraitOf(m)} tip={tipFor(m)} onOpen={onOpen} onToggle={onToggle} onMenu={onMenu} onUpdate={onUpdate} />
          ))}
        </div>
      )}

      <ModDrawerHost game={game} mods={mods} loaded={loaded} />
    </>
  );
}
