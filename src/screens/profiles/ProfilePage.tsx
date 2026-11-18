// One profile's page: its mods as cards, where each card's switch puts the mod in the profile or takes it out. Two
// tabs: the mods in it, and every mod to add from. On the profile in use the switch turns the mod on or off (the same
// thing); on another profile only its list changes and no files move until you switch to it. A mod taken out stays on
// screen until you leave the tab, so a slip is one click to put back. Route: { view: "profiles", profile, tab?:
// "every", modId? }. Keys: arrows move, Enter opens the details, Space adds or takes out. Owner: HOME/PROFILES area.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { errorText, library, profiles, type GameId, type ModEntry, type Profile } from "../../lib/api";
import { record } from "../../lib/history";
import { t, tn } from "../../lib/i18n";
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
      && (!q || m.name.toLowerCase().includes(q) || m.character?.toLowerCase().includes(q) || m.tags.some((tag) => tag.toLowerCase().includes(q))));
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
        for (const o of near) if (same.includes(o.id)) { outs.push(o.id); notes.push(t("took out {name}", { name: o.name })); }
        if (outs.length) setKept((k) => new Set([...k, ...outs]));
      }
    }
    const next = new Set(before);
    for (const id of outs) next.delete(id);
    for (const id of ins) next.add(id);
    setMembersState(next);
    const named = mods.filter((m) => (on ? ins : outs).includes(m.id) && ids.includes(m.id));
    const what = modsName(named.length ? named : list);
    const base = on ? t("Added {mods} to {profile}", { mods: what, profile: p.name }) : t("Took {mods} out of {profile}", { mods: what, profile: p.name });
    const label = notes.length ? t("{label}, {notes}", { label: base, notes: notes.join(", ") }) : base;
    // the card's switch shows the mod going in or out: the toast is for the character's other mods it took out
    const brief = notes.length ? tn(notes.length, "Took {n} other mod for this character out of the profile", "Took {n} other mods for this character out of the profile") : undefined;
    try {
      await setMembers(game, p.id, ins, outs);
      record({ label, brief, undo: () => setMembers(game, p.id, outs, ins), redo: () => setMembers(game, p.id, ins, outs) }, !brief);
    } catch (e) {
      setMembersState(before);
      toast(errorText(e), true);
    }
  }, [game, p, mods, inIds, isIn]);

  const itemsFor = useCallback((m: ModEntry): MenuEntry[] => {
    const inIt = isIn(m);
    return [
      { label: inIt ? t("Take out of {name}", { name: p.name }) : t("Add to {name}", { name: p.name }), icon: inIt ? "minus" : "plus", keys: "Space", onClick: () => void setIn([m], !inIt) },
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

  const tipFor = (m: ModEntry) => (m.enabled ? t("{mod}. Enter opens the details, Space takes it out of {profile}", { mod: m.name, profile: p.name })
    : t("{mod}. Enter opens the details, Space adds it to {profile}", { mod: m.name, profile: p.name }));
  const portraitOf = (m: ModEntry) => (m.preview || !m.character ? null : portraitNow(game, m.character, null));
  const total = visible.length;

  return (
    <>
      <header className="char-hero profile-hero" onContextMenu={menuHandler(() => withoutKeys(menuFor("profile", { game, id: p.id })))}>
        <button type="button" className="profile-hero-pic" onClick={() => onEdit("icon")} title={t("Change the icon and colour")}>
          <ProfileIcon profile={p} chars={chars} size={88} />
        </button>
        <div className="char-hero-t">
          <button type="button" className="char-hero-back" onClick={() => closeRoute(["profile", "tab", "modId"])} title={t("Back to all profiles (Alt+Left)")}>
            {t("Profiles")}
          </button>
          <h1 className="char-hero-name" title={p.name}>{p.name}</h1>
          <span className="hint">
            {p.updatedAt ? tn(inCount, "{n} mod, changed {when}", "{n} mods, changed {when}", { when: timeAgo(p.updatedAt) }) : tn(inCount, "{n} mod", "{n} mods")}
            {p.description ? `. ${p.description}` : ""}
          </span>
          <div className="char-hero-a">
            <Tabs value={tab} onChange={(v) => patchRoute({ tab: v === "every" ? "every" : undefined, modId: undefined })}
              tabs={[{ value: "in", label: t("In this profile"), icon: "profiles", count: ready ? inCount : undefined },
                { value: "every", label: t("Add mods"), icon: "plus", count: ready ? total - inCount : undefined }]} />
          </div>
        </div>
        <div className="char-hero-nav">
          {p.active
            ? <Badge tone="accent" icon="check" title={t("The profile in use. Turning mods on or off anywhere saves here")}>{t("On now")}</Badge>
            : <Button variant="primary" icon="swap" busy={busy} onClick={onSwitch} title={t("Turns mods on and off to match {name}", { name: p.name })}>{t("Switch to it")}</Button>}
          <IconButton icon="edit" label={t("Edit")} title={t("Edit the name, icon, colour, banner and hotkey")} onClick={() => onEdit()} />
          <IconButton icon="more" label={t("More")} title={t("More (right-click the header works too)")} onClick={(e) => openMenu(e.currentTarget, withoutKeys(menuFor("profile", { game, id: p.id })))} />
        </div>
      </header>

      <div className="profile-page-bar">
        <SearchField value={query} onChange={setQuery} placeholder={tab === "every" ? t("Search every mod") : t("Search {name}", { name: p.name })} />
        <span className="hint">
          {p.active ? t("It's the profile in use, so a switch here turns the mod on or off right away.")
            : t("Switches here only change {name}'s list. Mods turn on and off when you switch to it.", { name: p.name })}
        </span>
      </div>

      {!ready ? (
        <Waiting what={t("Reading the mods in {name}", { name: p.name })}>
          <div className="mod-grid is-loading" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="mod-card-skel" />)}</div>
        </Waiting>
      ) : !shown.length ? (
        query ? <Empty icon="search" title={t("Nothing matches")}>{tab === "every"
            ? t("No mod has \"{q}\" in its name, character or tags.", { q: query.trim() })
            : t("No mod in {name} has \"{q}\" in its name, character or tags.", { name: p.name, q: query.trim() })}</Empty>
        : tab === "every" ? <Empty icon="mods" title={t("No mods installed yet")}>{t("Mods you install show up here to add to {name}.", { name: p.name })}</Empty>
        : <Empty icon="profiles" title={t("Nothing in {name} yet", { name: p.name })}
            actions={<Button variant="primary" icon="plus" onClick={() => patchRoute({ tab: "every" })}>{t("Add mods")}</Button>}>
            {p.active ? t("Mods you turn on while it's in use are saved here.") : t("Add mods to it here, or switch to it and turn mods on.")}
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
