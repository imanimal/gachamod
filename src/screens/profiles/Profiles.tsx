// Profiles: saved loadouts for the current game (which mods are on and their options). Switch, edit, duplicate,
// save what is on now, export, delete. Owner: LIBRARY area (docs/spec.md, "Profiles").
import { useRef, useState, type CSSProperties } from "react";
import { errorText, profiles, type Profile } from "../../lib/api";
import { emitApp, useGame } from "../../lib/store";
import { Badge, Button, Confirm, Empty, IconButton, Menu, PageHeader, Skeleton, timeAgo } from "../../ui/kit";
import { Popover } from "../../ui/Popover";
import { toast } from "../../ui/toast";
import { moveInGrid } from "../library/gridNav";
import { Preview } from "../library/Preview";
import { profilesChanged, switchProfile, useCharacters, useProfiles } from "./data";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileIcon } from "./ProfileIcon";
import "../library/library.css";
import "./profiles.css";

export function Profiles() {
  const game = useGame()!;
  const gid = game.id;
  const { list } = useProfiles(gid);
  const chars = useCharacters(gid);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [menu, setMenu] = useState<{ p: Profile; anchor: HTMLElement } | null>(null);
  const [ask, setAsk] = useState<{ kind: "delete" | "capture"; p: Profile } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const active = list?.find((p) => p.active) ?? null;

  const run = async (id: number | null, job: () => Promise<unknown>) => {
    setBusy(id);
    try { await job(); } catch (e) { toast(errorText(e), true); } finally { setBusy(null); }
  };

  const create = () => run(-1, async () => {
    const p = await profiles.create(gid, "New profile", null);
    profilesChanged(gid);
    setEditing(p);
  });
  const duplicate = (p: Profile) => run(p.id, async () => {
    const c = await profiles.create(gid, `${p.name} copy`, p.id);
    profilesChanged(gid);
    toast(`Made ${c.name}`);
  });
  const capture = (p: Profile) => run(p.id, async () => {
    await profiles.capture(p.id);
    profilesChanged(gid);
    toast(`Saved what is on now into ${p.name}`);
  });
  const remove = (p: Profile) => run(p.id, async () => {
    await profiles.remove(p.id);
    profilesChanged(gid);
    toast(p.active ? `Deleted ${p.name}. The next profile is active now, with the same mods on` : `Deleted ${p.name}`);
  });

  return (
    <div className="page profiles">
      <PageHeader title="Profiles" icon="profiles"
        sub="A profile remembers which mods are on and their options. Switching turns mods on and off to match."
        actions={<Button variant="primary" icon="plus" busy={busy === -1} onClick={() => void create()} title="Starts from what is on now">New profile</Button>} />

      {list === null ? (
        <div className="profile-grid">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="profile-card-skel" />)}</div>
      ) : !list.length ? (
        <Empty icon="profiles" title="No profiles yet" actions={<Button variant="primary" icon="plus" onClick={() => void create()}>New profile</Button>}>
          A profile keeps a set of mods to switch to in one click, like "Story mode" with no mods at all.
        </Empty>
      ) : (
        <div ref={gridRef} className="profile-grid" onKeyDown={(e) => moveInGrid(e, gridRef.current, ".profile-card-main")}>
          {list.map((p) => (
            <article key={p.id} className={`card profile-card${p.active ? " is-active sel" : ""}`} style={p.color ? ({ "--p-color": p.color } as CSSProperties) : undefined}>
              <button type="button" className="profile-card-main" disabled={busy === p.id}
                title={p.active ? `${p.name} is active` : `Switch to ${p.name}`}
                onClick={() => { if (!p.active) void run(p.id, () => switchProfile(gid, p, active)); }}>
                <Preview className="profile-card-banner" src={p.banner} icon="profiles" />
                <span className="profile-card-stripe" />
                <span className="profile-card-head">
                  <ProfileIcon profile={p} chars={chars} size={44} />
                  <span className="profile-card-t">
                    <span className="profile-card-name">{p.name}</span>
                    <span className="profile-card-sub">{p.modCount === 1 ? "1 mod on" : `${p.modCount} mods on`}{p.updatedAt ? ` · changed ${timeAgo(p.updatedAt)}` : ""}</span>
                  </span>
                  {p.active && <Badge tone="accent" icon="check">Active</Badge>}
                </span>
                {p.description && <span className="profile-card-desc">{p.description}</span>}
              </button>
              <span className="profile-card-a">
                {p.active
                  ? <span className="hint">Changes to your mods save here</span>
                  : <Button size="sm" variant="primary" icon="swap" busy={busy === p.id} onClick={() => void run(p.id, () => switchProfile(gid, p, active))}>Switch to</Button>}
                <span className="grow" />
                <IconButton icon="edit" size="sm" label="Edit" onClick={() => setEditing(p)} />
                <IconButton icon="more" size="sm" label="More actions" onClick={(e) => setMenu({ p, anchor: e.currentTarget })} />
              </span>
            </article>
          ))}
        </div>
      )}

      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width="17em" label={`${menu.p.name} actions`}>
          <Menu items={[
            { label: "Edit", icon: "edit", onClick: () => { setEditing(menu.p); setMenu(null); } },
            { label: "Duplicate", icon: "copy", onClick: () => { void duplicate(menu.p); setMenu(null); } },
            { label: "Save what is on now", icon: "pin", disabled: menu.p.active, hint: menu.p.active ? "The active profile already follows your changes" : "Replaces this profile's mods with the ones on now",
              onClick: () => { setAsk({ kind: "capture", p: menu.p }); setMenu(null); } },
            { label: "Export as .gachamod", icon: "export", onClick: () => { emitApp({ type: "export-profile", game: gid, profileId: menu.p.id }); setMenu(null); } },
            "-",
            { label: "Delete", icon: "trash", danger: true, disabled: (list?.length ?? 0) <= 1, hint: (list?.length ?? 0) <= 1 ? "The only profile can't be deleted" : undefined,
              onClick: () => { setAsk({ kind: "delete", p: menu.p }); setMenu(null); } },
          ]} />
        </Popover>
      )}

      {ask?.kind === "delete" && (
        <Confirm danger yes="Delete" title={`Delete ${ask.p.name}?`} onYes={() => remove(ask.p)} onClose={() => setAsk(null)}>
          Your mods stay installed. Only this profile's list of which mods are on, and its saved options, go away.
        </Confirm>
      )}
      {ask?.kind === "capture" && (
        <Confirm yes="Save" title={`Save what is on now into ${ask.p.name}?`} onYes={() => capture(ask.p)} onClose={() => setAsk(null)}>
          {ask.p.name} will turn on the mods that are on right now, with their current options. Its old list is replaced.
        </Confirm>
      )}
      {editing && <ProfileEditor game={gid} profile={editing} chars={chars} onClose={() => setEditing(null)} />}
    </div>
  );
}
