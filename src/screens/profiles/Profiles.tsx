// Profiles: saved loadouts for the current game (which mods are on and their options). A card is a mural of the
// profile's mods; clicking it opens the profile's page (its mods, to add or take out), and its Switch button switches.
// Make one from the mods on now or empty, duplicate, rename (F2), edit, set a
// hotkey, delete (Del) with Undo. Right-click shows the same menu as everywhere else. Owner: HOME/PROFILES area.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { GameId, Profile } from "../../lib/api";
import { go, useGame, useRoute } from "../../lib/store";
import { Badge, Button, Empty, IconButton, PageHeader, Skeleton, timeAgo } from "../../ui/kit";
import { menuFor, menuHandler, openMenu } from "../../ui/ContextMenu";
import { moveInGrid } from "../library/gridNav";
import { Preview } from "../library/Preview";
import { deleteProfile, renameProfile, startNewProfile, switchTo, takeEditRequest, useEditRequest, type EditFocus } from "./actions";
import { useCharacters, useProfiles } from "./data";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileIcon } from "./ProfileIcon";
import { ProfilePage } from "./ProfilePage";
import { ProfileThumb } from "./ProfileThumb";
import "./menus";
import "../library/library.css";
import "./profiles.css";

export function Profiles() {
  const game = useGame()!;
  const gid = game.id;
  const { list } = useProfiles(gid);
  const chars = useCharacters(gid);
  const [editing, setEditing] = useState<{ p: Profile; focus?: "hotkey" | "icon" | "banner" } | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const request = useEditRequest();
  const route = useRoute();
  const page = route.profile !== undefined && list ? list.find((p) => p.id === route.profile) ?? null : undefined;

  // a menu elsewhere asked to edit or rename one
  useEffect(() => {
    if (!request || !list) return;
    const r = takeEditRequest();
    const p = r && list.find((x) => x.id === r.id);
    if (!r || !p) return;
    open(p, r.focus);
  }, [request, list]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (p: Profile, focus: EditFocus = "all") => {
    if (focus === "rename") setRenaming(p.id);
    else setEditing({ p, focus: focus === "all" ? undefined : focus });
  };

  const run = async (id: number, job: () => Promise<unknown>) => {
    setBusy(id);
    try { await job(); } finally { setBusy(null); }
  };
  const pick = (p: Profile) => { if (!p.active && busy === null) void run(p.id, () => switchTo(gid, p, list)); };

  const editor = editing && <ProfileEditor game={gid} profile={editing.p} chars={chars} focus={editing.focus} onClose={() => setEditing(null)} />;

  if (route.profile !== undefined) {
    return (
      <div className="page profiles">
        {page === undefined ? <Skeleton className="char-hero-skel" />
          : page === null ? (
            <Empty icon="profiles" title="That profile is gone" actions={<Button variant="primary" onClick={() => go("profiles")}>All profiles</Button>}>
              It was deleted. Undo (Ctrl+Z) brings it back.
            </Empty>
          ) : <ProfilePage game={gid} p={page} chars={chars} busy={busy === page.id} onSwitch={() => pick(page)} onEdit={(f) => open(page, f)} />}
        {editor}
      </div>
    );
  }

  const onCardKey = (e: KeyboardEvent, p: Profile) => {
    if (moveInGrid(e, gridRef.current, ".profile-card-main")) return;
    if (e.key === "F2") { e.preventDefault(); setRenaming(p.id); }
    else if (e.key === "Delete") { e.preventDefault(); void deleteProfile(gid, p, list); }
  };

  return (
    <div className="page profiles">
      <PageHeader title="Profiles" icon="profiles"
        sub="A profile remembers which mods are on and their options. Switching turns mods on and off to match."
        actions={<>
          <Button icon="plus" onClick={() => startNewProfile(gid, "empty")} title="A profile with every mod off, for playing without mods">Empty profile</Button>
          <Button variant="primary" icon="plus" onClick={() => startNewProfile(gid)} title="Saves the mods on now as a new profile">New profile</Button>
        </>} />

      {list === null ? (
        <div className="profile-grid">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="profile-card-skel" />)}</div>
      ) : !list.length ? (
        <Empty icon="profiles" title="No profiles yet" actions={<Button variant="primary" icon="plus" onClick={() => startNewProfile(gid)}>New profile</Button>}>
          A profile keeps a set of mods to switch to in one click, like "Story mode" with no mods at all.
        </Empty>
      ) : (
        <div ref={gridRef} className="profile-grid">
          {list.map((p) => (
            <ProfileCard key={p.id} game={gid} p={p} chars={chars} busy={busy === p.id} renaming={renaming === p.id}
              onPick={() => pick(p)} onOpen={() => go({ view: "profiles", profile: p.id })} onKey={(e) => onCardKey(e, p)}
              onRenamed={() => setRenaming(null)} onEdit={(f) => open(p, f)} />
          ))}
        </div>
      )}

      {editor}
    </div>
  );
}

function ProfileCard({ game, p, chars, busy, renaming, onPick, onOpen, onKey, onRenamed, onEdit }: {
  game: GameId; p: Profile; chars: ReturnType<typeof useCharacters>; busy: boolean; renaming: boolean;
  onPick: () => void; onOpen: () => void; onKey: (e: KeyboardEvent) => void; onRenamed: () => void; onEdit: (focus?: EditFocus) => void;
}) {
  const [name, setName] = useState(p.name);
  const mainRef = useRef<HTMLButtonElement>(null);
  const ended = useRef(false);
  useEffect(() => { if (renaming) { setName(p.name); ended.current = false; } }, [renaming, p.name]);
  const menu = () => menuFor("profile", { game, id: p.id });

  const finish = (save: boolean) => {
    // Enter or Esc ends it; the blur that follows must not save again
    if (ended.current) return;
    ended.current = true;
    if (save) void renameProfile(game, p, name);
    onRenamed();
    window.setTimeout(() => mainRef.current?.focus(), 0);
  };

  const body = (
    <>
      {p.banner
        ? <Preview className="profile-card-banner" src={p.banner} icon="profiles" />
        : <ProfileThumb game={game} profileId={p.id} profile={p} size="card" className="profile-card-banner" />}
      <span className="profile-card-head">
        <ProfileIcon profile={p} chars={chars} size={44} />
        <span className="profile-card-t">
          {renaming
            ? <input className="profile-rename" value={name} autoFocus aria-label="Profile name" maxLength={60}
                onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} onBlur={() => finish(true)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); }} />
            : <span className="profile-card-name" title={p.name}>{p.name}</span>}
          <span className="profile-card-sub">{p.modCount === 1 ? "1 mod on" : `${p.modCount} mods on`}{p.updatedAt ? `, changed ${timeAgo(p.updatedAt)}` : ""}</span>
        </span>
        {p.active && <Badge tone="accent" icon="check" title="The profile in use. Turning mods on or off saves here">On now</Badge>}
      </span>
      {p.description && <span className="profile-card-desc">{p.description}</span>}
    </>
  );

  return (
    <article className={`card profile-card${p.active ? " is-active sel" : ""}`} style={p.color ? ({ "--p-color": p.color } as CSSProperties) : undefined}
      onContextMenu={menuHandler(menu)}>
      {renaming
        ? <div className="profile-card-main">{body}</div>
        : <button ref={mainRef} type="button" className="profile-card-main" onClick={onOpen} onKeyDown={onKey}
            title={`See and change the mods in ${p.name}. F2 renames, Del deletes, right-click for more`}>
            {body}
          </button>}
      <span className="profile-card-a">
        {busy ? <span className="hint">Switching</span>
          : p.hotkey ? <kbd className="kbd" title="Switches to this profile while the game runs">{p.hotkey}</kbd>
          : <button type="button" className="link-btn hint" onClick={() => onEdit("hotkey")} title="A key combo that switches to it in game, like Ctrl+Alt+1">No hotkey</button>}
        <span className="grow" />
        {!p.active && <Button size="sm" icon="swap" disabled={busy} onClick={onPick} title={`Turns mods on and off to match ${p.name}`}>Switch</Button>}
        <IconButton icon="edit" size="sm" label="Edit" title="Edit the name, icon, colour, banner and hotkey" onClick={() => onEdit()} />
        <IconButton icon="more" size="sm" label="More" title="More (right-click the card works too)" onClick={(e) => openMenu(e.currentTarget, menu())} />
      </span>
    </article>
  );
}
