// The profile switcher in the sidebar, under the player card: the active profile's icon and name; a menu lists the
// game's profiles with their colours. Enter or Space opens it, arrows move, Escape closes. Owner: LIBRARY area.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { errorText } from "../../lib/api";
import { go, useGame } from "../../lib/store";
import { Icon } from "../../ui/Icon";
import { Popover } from "../../ui/Popover";
import { toast } from "../../ui/toast";
import { switchProfile, useCharacters, useProfiles } from "./data";
import { ProfileIcon } from "./ProfileIcon";
import "./profiles.css";

export function ProfileSwitch() {
  const game = useGame();
  const gid = game?.id;
  const { list } = useProfiles(gid);
  const chars = useCharacters(gid);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = list?.find((p) => p.active) ?? null;

  // close on a game switch; focus the active profile when the menu opens
  useEffect(() => { setOpen(false); }, [gid]);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => (menuRef.current?.querySelector<HTMLElement>(".pswitch-item.on") ?? menuRef.current?.querySelector<HTMLElement>("button"))?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const close = () => { setOpen(false); btn.current?.focus(); };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      items[(at + d + items.length) % items.length]?.focus();
    } else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  const pick = async (id: number) => {
    const to = list?.find((p) => p.id === id);
    close();
    if (!gid || !to || to.active) return;
    setBusy(true);
    try { await switchProfile(gid, to, active); }
    catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };

  if (!gid) return null;
  return (
    <div className="pswitch">
      <button ref={btn} type="button" className={`pswitch-btn${open ? " on" : ""}`} aria-haspopup="menu" aria-expanded={open} disabled={busy || !list}
        title={active ? `Profile: ${active.name}. Click to switch` : "Profiles"}
        style={active?.color ? ({ "--p-color": active.color } as CSSProperties) : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}>
        {active ? <ProfileIcon profile={active} chars={chars} size={26} /> : <span className="pswitch-ph" />}
        <span className="pswitch-name">{active?.name ?? "Profiles"}</span>
        {busy ? <span className="spin" aria-hidden="true" /> : <Icon name="chevron" className="pswitch-chev" />}
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={close} width="15rem" label="Profiles">
          <div ref={menuRef} className="menu pswitch-menu" role="menu" onKeyDown={onKey}>
            {(list ?? []).map((p) => (
              <button key={p.id} type="button" role="menuitemradio" aria-checked={p.active} className={`menu-i pswitch-item${p.active ? " on" : ""}`}
                style={p.color ? ({ "--p-color": p.color } as CSSProperties) : undefined}
                title={p.description ?? (p.active ? "Active" : `Switch to ${p.name}`)} onClick={() => void pick(p.id)}>
                <span className="pswitch-dot" aria-hidden="true" />
                <ProfileIcon profile={p} chars={chars} size={22} />
                <span className="pswitch-item-name">{p.name}</span>
                {p.active && <Icon name="check" className="pswitch-check" />}
              </button>
            ))}
            <hr />
            <button type="button" role="menuitem" className="menu-i" onClick={() => { setOpen(false); go("profiles"); }}>
              <Icon name="profiles" /><span>Manage profiles</span>
            </button>
          </div>
        </Popover>
      )}
    </div>
  );
}
