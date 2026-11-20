// Editing a profile, and setting up a new one (the same window with "Start with" added and Create instead of Save).
// The banner and the icon at the top are the controls: click either to change it right there (a picker opens beside
// it). The icon picker has the colour too, since a line icon is drawn in it. Below: name, description and the
// in-game hotkey. Enter in a one-line field saves. Saving can be undone. Owner: HOME/PROFILES area.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { dialogs, errorText, hotkeys, library, type Character, type GameId, type ModEntry, type Profile } from "../../lib/api";
import { charNoun } from "../../lib/games";
import { t, tb, tn } from "../../lib/i18n";
import { go } from "../../lib/store";
import { onColor as inkOn } from "../../lib/theme";
import { Icon } from "../../ui/Icon";
import { Button, Dialog, Segmented, Tabs, TextField, Waiting } from "../../ui/kit";
import { Popover } from "../../ui/Popover";
import { toast } from "../../ui/toast";
import { Preview } from "../library/Preview";
import { closeNewProfile, makeProfile, patchProfile, useNewProfileRequest, type NewStart } from "./actions";
import { knownProfiles, useCharacters } from "./data";
import { HotkeyField } from "./HotkeyField";
import { PROFILE_GLYPHS, ProfileIcon } from "./ProfileIcon";
import { LazyImg } from "../../ui/LazyImg";

const EMOJIS = ["⭐", "🔥", "🌙", "☀️", "🌸", "🌊", "⚡", "❄️", "🍀", "🎀", "💎", "🗡️", "🛡️", "🎮", "🎧", "🎵", "📸", "🏖️", "🎃", "🎄",
  "🦈", "🐱", "🐰", "🦊", "🐺", "🐉", "🦋", "🍓", "🍜", "☕", "💜", "💙", "💚", "🧡", "🖤", "🤍", "👑", "🌈", "🚀", "🏆"];
/** Preset profile colours. */
export const PROFILE_COLORS = ["#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#84cc16", "#eab308", "#f97316", "#ef4444", "#ec4899", "#64748b"];

type IconTab = "picture" | "icons" | "emoji" | "character";
type BannerTab = "file" | "mods" | "link";
type Open = "icon" | "banner" | null;

const tabOf = (icon: string): IconTab => (!icon || icon.startsWith("img:") ? "picture" : icon.startsWith("char:") ? "character"
  : icon.startsWith("icon:") ? "icons" : "emoji");
const PICTURE_TYPES = ["png", "jpg", "jpeg", "webp", "gif"];

/** A picture from the user's PC: its path in the app, or (in the browser demo, which can't see paths) its data. Null
 *  when they cancel. */
async function pickPicture(title: string): Promise<string | null> {
  if ("__TAURI_INTERNALS__" in window) return (await dialogs.pickFiles({ title, extensions: PICTURE_TYPES }))?.[0] ?? null;
  return new Promise((done) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = PICTURE_TYPES.map((x) => `.${x}`).join(",");
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) { done(null); return; }
      const r = new FileReader();
      r.onload = () => done(typeof r.result === "string" ? r.result : null);
      r.onerror = () => done(null);
      r.readAsDataURL(f);
    };
    input.click();
  });
}
const pictureName = (v: string) => (v.startsWith("data:") ? t("Picked picture") : v.split(/[\\/]/).pop() ?? v);

/** The name a new profile gets unless one is typed: "New profile", or "New profile (2)" when that is taken (the
 *  backend numbers names the same way). */
function freeName(game: GameId, base: string) {
  const names = new Set((knownProfiles(game) ?? []).map((p) => p.name.toLowerCase()));
  let cand = base;
  for (let n = 2; names.has(cand.toLowerCase()); n++) cand = `${base} (${n})`;
  return cand;
}
const baseName = (s: NewStart) => (s === "empty" ? t("No mods") : t("New profile"));

/** The new-profile window, for whichever screen asked (the sidebar, Home, Profiles, search). Lives in App. */
export function NewProfileHost() {
  const req = useNewProfileRequest();
  const chars = useCharacters(req?.game);
  if (!req) return null;
  return <ProfileEditor key={req.n} game={req.game} profile={null} start={req.start} chars={chars} onClose={closeNewProfile} />;
}

/** Edits `profile`, or with `profile` null sets up a new one that starts as `start` says. */
export function ProfileEditor({ game, profile, chars, onClose, focus, start: startAt = "now" }:
  { game: GameId; profile: Profile | null; chars: Character[]; onClose: () => void; focus?: "name" | "hotkey" | "icon" | "banner"; start?: NewStart }) {
  const making = !profile;
  const [start, setStart] = useState<NewStart>(startAt);
  const [name, setName] = useState(() => profile?.name ?? freeName(game, baseName(startAt)));
  const named = useRef(false);
  const [description, setDescription] = useState(profile?.description ?? "");
  const [icon, setIcon] = useState(profile?.icon ?? "");
  const [color, setColor] = useState(profile?.color ?? "");
  const [banner, setBanner] = useState(profile?.banner ?? "");
  const [hotkey, setHotkey] = useState(profile?.hotkey ?? "");
  const [taken, setTaken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Open>(null);
  const keyRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const iconBtn = useRef<HTMLButtonElement>(null);
  const bannerBtn = useRef<HTMLButtonElement>(null);
  const shownName = name.trim() || (profile?.name ?? baseName(start));
  const onNow = making ? knownProfiles(game)?.find((p) => p.active)?.modCount : undefined;
  // another profile with this combo loses it on save (one press, one profile), so the field says so first
  const holder = hotkey && hotkey !== (profile?.hotkey ?? "") ? knownProfiles(game)?.find((p) => p.id !== profile?.id && p.hotkey === hotkey) : undefined;

  // "Set a hotkey" from a menu opens here with the hotkey field listening; "Change icon" opens the icon picker.
  // A new profile, and Rename from a profile's page, open with the name selected, so typing replaces it and Enter saves.
  useEffect(() => {
    if (!focus && !making) return;
    const timer = window.setTimeout(() => {
      if (focus === "hotkey") keyRef.current?.querySelector("input")?.focus();
      else if (focus && focus !== "name") setOpen(focus);
      else { const i = fieldsRef.current?.querySelector("input"); i?.focus(); i?.select(); }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [focus, making]);

  const pickStart = (s: NewStart) => {
    setStart(s);
    if (!named.current) setName(freeName(game, baseName(s)));
  };

  const create = async () => {
    const extra = Object.fromEntries(Object.entries({ description, icon, color, banner, hotkey }).filter(([, v]) => v.trim()));
    const p = await makeProfile(game, start, shownName, extra);
    if (!p) return;
    // made already, so a combo another app holds is a note, not a reason to stay open
    if (hotkey) {
      const clash = (await hotkeys.sync().catch(() => [])).find((x) => x.combo === hotkey);
      if (clash) toast(clash.reason, true);
    }
    onClose();
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (!profile) { await create(); return; }
      const patch = { name: shownName, description, icon, color, banner, hotkey };
      const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== ((profile as unknown as Record<string, string | null>)[k] ?? "")));
      if (!Object.keys(changed).length) { onClose(); return; }
      if (!(await patchProfile(game, profile, changed, t("Changed {name}", { name: patch.name })))) return;
      // another app holding the combo keeps the editor open with the field marked
      const list = hotkey !== (profile.hotkey ?? "") ? await hotkeys.sync().catch(() => []) : [];
      const clash = hotkey ? list.find((x) => x.combo === hotkey) : undefined;
      if (clash) { setTaken(tb(clash.reason)); toast(clash.reason, true); return; }
      onClose();
    } catch (e) { toast(errorText(e), true); }
    finally { setSaving(false); }
  };

  const toggle = (what: Exclude<Open, null>) => setOpen((o) => (o === what ? null : what));
  // Enter in the name saves; the description takes new lines and the hotkey field keeps its keys
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); void save(); }
  };

  return (
    <Dialog title={profile ? t("Edit {name}", { name: profile.name }) : t("New profile")} icon={profile ? "edit" : "plus"} className="profile-editor" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        <Button variant="primary" busy={saving} onClick={() => void save()} title={making ? t("Make the profile (Enter)") : t("Save (Enter)")}>{making ? t("Create") : t("Save")}</Button>
      </>}>
      <div className="profile-editor-top" style={color ? ({ "--p-color": color } as CSSProperties) : undefined}>
        <button ref={bannerBtn} type="button" className={`pe-banner${open === "banner" ? " on" : ""}`} onClick={() => toggle("banner")}
          title={banner ? t("Change the banner") : t("Add a banner")} aria-expanded={open === "banner"} aria-haspopup="dialog">
          <Preview className="profile-editor-banner" src={banner || null} icon="image" />
          <span className="pe-hint"><Icon name="image" />{banner ? t("Change banner") : t("Add a banner")}</span>
        </button>
        <button ref={iconBtn} type="button" className={`pe-icon${open === "icon" ? " on" : ""}`} onClick={() => toggle("icon")}
          title={t("Change the icon and colour")} aria-expanded={open === "icon"} aria-haspopup="dialog">
          <ProfileIcon profile={{ icon, name: shownName, color }} chars={chars} size={64} />
          <span className="pe-icon-edit" aria-hidden="true"><Icon name="edit" /></span>
        </button>
      </div>

      <div className="profile-editor-fields" ref={fieldsRef} onKeyDown={onFieldKey}>
        <TextField label={t("Name")} value={name} onChange={(v) => { named.current = true; setName(v); }} placeholder={profile?.name ?? baseName(start)} />
        {making && (
          <div className="field">
            <span className="field-l">{t("Start with")}</span>
            <Segmented<NewStart> label={t("Start with")} value={start} onChange={pickStart} options={[
              { value: "now", label: t("The mods on now"), title: t("Saves which mods are on now and their options") },
              { value: "empty", label: t("No mods"), title: t("Every mod off, for playing without mods") },
            ]} />
            <span className="hint">{start !== "now" ? t("Switching to it turns every mod off, like a clean game.")
              : onNow === undefined ? t("Saves the mods on now and their options.")
              : tn(onNow, "Saves {n} mod on now, with the options.", "Saves {n} mods on now and their options.")}</span>
          </div>
        )}
        <TextField label={t("Description")} multiline rows={2} value={description} onChange={setDescription} placeholder={t("What this loadout is for")} />
        <div ref={keyRef}><HotkeyField label={t("In-game hotkey")} value={hotkey} onChange={(v) => { setHotkey(v); setTaken(null); }} taken={taken}
          hint={holder ? (making ? t("{name} uses {key}. Creating moves it here", { name: holder.name, key: hotkey }) : t("{name} uses {key}. Saving moves it here", { name: holder.name, key: hotkey }))
            : t("Switches to this profile while the game runs and reloads mods, like Ctrl+Alt+1")} /></div>
      </div>

      {open === "icon" && (
        <Popover anchor={iconBtn.current} onClose={() => setOpen(null)} width="25rem" label={t("Icon and colour")} align="start">
          <IconPicker game={game} icon={icon} color={color} name={shownName} chars={chars} onIcon={setIcon} onColor={setColor} />
        </Popover>
      )}
      {open === "banner" && (
        <Popover anchor={bannerBtn.current} onClose={() => setOpen(null)} width="32rem" label={t("Banner")} align="start">
          <BannerPicker game={game} banner={banner} onPick={(b) => { setBanner(b); setOpen(null); }} />
        </Popover>
      )}
    </Dialog>
  );
}

/** Moves keyboard and controller focus into a picker when it opens: the picked item, else the first one. */
function useFocusIn(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>("[aria-checked='true'], button, input");
      el?.focus({ preventScroll: true });
    }, 30);
    return () => window.clearTimeout(timer);
  }, [ref]);
}

function IconPicker({ game, icon, color, name, chars, onIcon, onColor }:
  { game: GameId; icon: string; color: string; name: string; chars: Character[]; onIcon: (v: string) => void; onColor: (v: string) => void }) {
  const [tab, setTab] = useState<IconTab>(() => tabOf(icon));
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useFocusIn(box);
  const query = q.trim().toLowerCase();
  const portraits = chars.filter((c) => c.icon && (!query || c.name.toLowerCase().includes(query)));
  const picture = icon.startsWith("img:") ? icon.slice(4) : "";
  const pick = async () => {
    try { const v = await pickPicture(t("Pick a picture for the icon")); if (v) onIcon(`img:${v}`); } catch (e) { toast(errorText(e), true); }
  };
  const fill = /^#[0-9a-f]{6}$/i.test(color) ? ({ "--pe-c": color, "--pe-on": inkOn(color) } as CSSProperties) : undefined;

  return (
    <div className="pe-pick" ref={box}>
      <div className="pe-colors" role="radiogroup" aria-label={t("Colour")}>
        <button type="button" role="radio" aria-checked={!color} className={`pe-nocolor${!color ? " on" : ""}`} onClick={() => onColor("")} title={t("No colour")}>
          <Icon name="block" />
        </button>
        {PROFILE_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color.toLowerCase() === c} className={`swatch${color.toLowerCase() === c ? " on" : ""}`}
            style={{ "--c": c } as CSSProperties} aria-label={c} title={c} onClick={() => onColor(c)} />
        ))}
        <label className={`swatch pe-anycolor${color && !PROFILE_COLORS.includes(color.toLowerCase()) ? " on" : ""}`} title={t("Any colour")}
          style={color && !PROFILE_COLORS.includes(color.toLowerCase()) ? ({ "--c": color } as CSSProperties) : undefined}>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#808080"} onChange={(e) => onColor(e.target.value)} aria-label={t("Any colour")} />
        </label>
      </div>
      <Tabs<IconTab> value={tab} onChange={setTab} tabs={[{ value: "picture", label: t("From this PC") }, { value: "icons", label: t("Icons") },
        { value: "emoji", label: t("Emoji") }, { value: "character", label: charNoun(game, true) }]} />
      {tab === "picture" && (
        <div className="pe-file">
          {picture && <ProfileIcon profile={{ icon, name, color }} chars={chars} size={56} />}
          <span className="pe-file-t">
            <Button icon="image" variant={picture ? "secondary" : "primary"} onClick={() => void pick()}>{picture ? t("Pick another picture") : t("Pick a picture")}</Button>
            <span className="hint">{picture ? pictureName(picture) : t("PNG, JPG, WebP or GIF. A square one fits best.")}</span>
          </span>
          {picture && <Button size="sm" variant="ghost" icon="x" onClick={() => onIcon("")} title={t("Use the name's first letters instead")}>{t("Remove")}</Button>}
        </div>
      )}
      {tab === "icons" && (
        <div className="pe-grid" role="radiogroup" aria-label={t("Icon")} style={fill}>
          <button type="button" role="radio" aria-checked={!icon} className={`pe-tile pe-initials${!icon ? " on" : ""}`} title={/^default$/i.test(name.trim()) ? t("No icon: the layers mark") : t("No icon: the name's first letters")} onClick={() => onIcon("")}>Aa</button>
          {PROFILE_GLYPHS.map((g) => {
            const v = `icon:${g}`;
            return (
              <button key={g} type="button" role="radio" aria-checked={icon === v} className={`pe-tile${icon === v ? " on" : ""}`} title={g.charAt(0).toUpperCase() + g.slice(1)} onClick={() => onIcon(v)}>
                <Icon name={g} />
              </button>
            );
          })}
        </div>
      )}
      {tab === "emoji" && (
        <div className="pe-grid" role="radiogroup" aria-label={t("Emoji")}>
          {EMOJIS.map((e) => (
            <button key={e} type="button" role="radio" aria-checked={icon === e} className={`pe-tile pe-emoji${icon === e ? " on" : ""}`} onClick={() => onIcon(e)}>{e}</button>
          ))}
        </div>
      )}
      {tab === "character" && (
        <>
          <TextField value={q} onChange={setQ} placeholder={t("Search {nouns}", { nouns: charNoun(game).toLowerCase() })} />
          {portraits.length ? (
            <div className="pe-grid pe-portraits" role="radiogroup" aria-label={charNoun(game, true)}>
              {portraits.map((c) => {
                const v = `char:${c.name}`;
                return (
                  <button key={c.name} type="button" role="radio" aria-checked={icon === v} className={`pe-tile pe-portrait${icon === v ? " on" : ""}`} title={c.name} onClick={() => onIcon(v)}>
                    <LazyImg src={c.icon!} alt={c.name} decoding="async" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                  </button>
                );
              })}
            </div>
          ) : query ? <p className="hint">{t("No {noun} by that name.", { noun: charNoun(game, true).toLowerCase() })}</p> : (
            <div className="banner-link">
              <span className="hint">{t("No portraits yet. Opening {page} once loads them.", { page: charNoun(game) })}</span>
              <Button size="sm" icon="characters" onClick={() => go({ view: "characters" })}
                title={t("Goes to {page}, which loads the portraits", { page: charNoun(game) })}>{t("Open {page}", { page: charNoun(game) })}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BannerPicker({ game, banner, onPick }: { game: GameId; banner: string; onPick: (b: string) => void }) {
  const [tab, setTab] = useState<BannerTab>(!banner ? "file" : /^https?:/.test(banner) ? (banner.includes("/img/ss/mods/") ? "mods" : "link") : "file");
  const touched = useRef(false);
  const [link, setLink] = useState(banner && /^https?:/.test(banner) ? banner : "");
  const [mods, setMods] = useState<ModEntry[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useFocusIn(box);
  useEffect(() => {
    let live = true;
    library.list(game).then((l) => {
      if (!live) return;
      const withPics = l.filter((m) => m.preview && !m.nsfw);
      setMods(withPics);
      // a banner taken from a mod's preview opens on that tab
      if (!touched.current && banner && withPics.some((m) => m.preview === banner)) setTab("mods");
    }).catch(() => { if (live) setMods([]); });
    return () => { live = false; };
  }, [game]); // eslint-disable-line react-hooks/exhaustive-deps

  const useLink = () => {
    if (/^https:\/\//i.test(link.trim())) onPick(link.trim());
    else toast(t("That doesn't look like an https:// image link"), true);
  };
  const pickFile = async () => {
    try { const v = await pickPicture(t("Pick a banner picture")); if (v) onPick(v); } catch (e) { toast(errorText(e), true); }
  };

  return (
    <div className="pe-pick" ref={box}>
      <div className="pe-pick-h">
        <Tabs<BannerTab> value={tab} onChange={(v) => { touched.current = true; setTab(v); }}
          tabs={[{ value: "file", label: t("From this PC") }, { value: "mods", label: t("A mod's preview") }, { value: "link", label: t("Link") }]} />
        {banner && <Button size="sm" variant="ghost" icon="x" onClick={() => onPick("")}>{t("No banner")}</Button>}
      </div>
      {tab === "mods" && (mods === null ? <Waiting what={t("Reading your mods")} /> : mods.length ? (
        <div className="pe-banners" role="radiogroup" aria-label={t("Mod previews")}>
          {mods.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={banner === m.preview} className={`pe-banner-tile${banner === m.preview ? " on" : ""}`}
              title={m.name} onClick={() => onPick(m.preview ?? "")}>
              <Preview src={m.preview} thumb={m.thumb} className="pe-banner-img" />
            </button>
          ))}
        </div>
      ) : <p className="hint">{t("No mod previews in this game yet.")}</p>)}
      {tab === "link" && (
        <div className="banner-link">
          <TextField value={link} onChange={setLink} placeholder="https://images.gamebanana.com/img/ss/mods/..." hint={t("Any image link, like one from a GameBanana mod page")} />
          <Button onClick={useLink}>{t("Use")}</Button>
        </div>
      )}
      {tab === "file" && (
        <div className="banner-link">
          <Button icon="image" variant={banner ? "secondary" : "primary"} onClick={() => void pickFile()}>{banner ? t("Pick another picture") : t("Pick a picture")}</Button>
          <span className="hint">{banner && !/^https?:/.test(banner) ? pictureName(banner) : t("PNG, JPG, WebP or GIF. A wide one fits best.")}</span>
        </div>
      )}
    </div>
  );
}
