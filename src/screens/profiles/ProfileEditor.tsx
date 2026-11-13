// Editing a profile: name, description, icon (an emoji or a character portrait), colour and banner (a mod preview, a
// link to an image, or a picture on this PC). Owner: LIBRARY area.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { dialogs, errorText, library, profiles, type Character, type GameId, type ModEntry, type Profile } from "../../lib/api";
import { Button, Dialog, Tabs, TextField } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { Preview } from "../library/Preview";
import { profilesChanged } from "./data";
import { ProfileIcon } from "./ProfileIcon";

const EMOJIS = ["⭐", "🔥", "🌙", "☀️", "🌸", "🌊", "⚡", "❄️", "🍀", "🎀", "💎", "🗡️", "🛡️", "🎮", "🎧", "🎵", "📸", "🏖️", "🎃", "🎄",
  "🦈", "🐱", "🐰", "🦊", "🐺", "🐉", "🦋", "🍓", "🍜", "☕", "💜", "💙", "💚", "🧡", "🖤", "🤍", "👑", "🌈", "🚀", "🏆"];
const SWATCHES = 10;

type IconTab = "emoji" | "character";
type BannerTab = "mods" | "link" | "file";

export function ProfileEditor({ game, profile, chars, onClose }: { game: GameId; profile: Profile; chars: Character[]; onClose: () => void }) {
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description ?? "");
  const [icon, setIcon] = useState(profile.icon ?? "");
  const [color, setColor] = useState(profile.color ?? "");
  const [banner, setBanner] = useState(profile.banner ?? "");
  const [iconTab, setIconTab] = useState<IconTab>(profile.icon?.startsWith("char:") ? "character" : "emoji");
  const [bannerTab, setBannerTab] = useState<BannerTab>(profile.banner && /^https?:/.test(profile.banner) && !profile.banner.includes("/img/ss/mods/") ? "link" : "mods");
  const [link, setLink] = useState(profile.banner && /^https?:/.test(profile.banner) ? profile.banner : "");
  const [charSearch, setCharSearch] = useState("");
  const [mods, setMods] = useState<ModEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const swatchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    library.list(game).then((l) => { if (live) setMods(l.filter((m) => m.preview && !m.nsfw)); }).catch(() => {});
    return () => { live = false; };
  }, [game]);

  // the preset colours live in profiles.css as --swatch-1 ... --swatch-10
  const swatch = (n: number) => (swatchRef.current ? getComputedStyle(swatchRef.current).getPropertyValue(`--swatch-${n}`).trim() : "");

  const pickFile = async () => {
    try {
      const files = await dialogs.pickFiles({ title: "Pick a banner picture", extensions: ["png", "jpg", "jpeg", "webp", "gif"] });
      if (files?.[0]) setBanner(files[0]);
      else if (files === null && !("__TAURI_INTERNALS__" in window)) toast("Picking a file works in the app, not in the browser demo", true);
    } catch (e) { toast(errorText(e), true); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await profiles.update(profile.id, { name: name.trim() || profile.name, description, icon, color, banner });
      profilesChanged(game);
      onClose();
    } catch (e) { toast(errorText(e), true); }
    finally { setSaving(false); }
  };

  const q = charSearch.trim().toLowerCase();
  const portraits = chars.filter((c) => c.icon && (!q || c.name.toLowerCase().includes(q)));

  return (
    <Dialog title={`Edit ${profile.name}`} icon="edit" size="lg" className="profile-editor" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={saving} onClick={() => void save()}>Save</Button>
      </>}>
      <div className="profile-editor-top" style={color ? ({ "--p-color": color } as CSSProperties) : undefined}>
        <Preview className="profile-editor-banner" src={banner || null} icon="image" />
        <span className="profile-editor-stripe" />
        <ProfileIcon profile={{ icon, name: name || profile.name }} chars={chars} size={56} />
      </div>

      <div className="profile-editor-fields">
        <TextField label="Name" value={name} onChange={setName} placeholder="Weekend outfits" />
        <TextField label="Description" multiline rows={2} value={description} onChange={setDescription} placeholder="What this loadout is for" />
      </div>

      <section className="profile-editor-sec">
        <h3 className="sub-h">Icon</h3>
        <Tabs<IconTab> value={iconTab} onChange={setIconTab} tabs={[{ value: "emoji", label: "Emoji" }, { value: "character", label: "Character" }]} />
        {iconTab === "emoji" ? (
          <div className="emoji-grid" role="radiogroup" aria-label="Emoji">
            <button type="button" role="radio" aria-checked={!icon} className={`emoji-btn${!icon ? " on" : ""}`} title="No icon (the name's first letters)" onClick={() => setIcon("")}>Aa</button>
            {EMOJIS.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={icon === e} className={`emoji-btn${icon === e ? " on" : ""}`} onClick={() => setIcon(e)}>{e}</button>
            ))}
          </div>
        ) : (
          <>
            <TextField value={charSearch} onChange={setCharSearch} placeholder="Find a character" />
            {portraits.length ? (
              <div className="portrait-grid" role="radiogroup" aria-label="Character">
                {portraits.map((c) => {
                  const v = `char:${c.name}`;
                  return (
                    <button key={c.name} type="button" role="radio" aria-checked={icon === v} className={`portrait-btn${icon === v ? " on" : ""}`} title={c.name} onClick={() => setIcon(v)}>
                      <img src={c.icon!} alt={c.name} loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    </button>
                  );
                })}
              </div>
            ) : <p className="hint">No portraits yet. Open the Characters screen once to load them from GameBanana.</p>}
          </>
        )}
      </section>

      <section className="profile-editor-sec">
        <h3 className="sub-h">Colour</h3>
        <div ref={swatchRef} className="profile-swatches" role="radiogroup" aria-label="Colour">
          {Array.from({ length: SWATCHES }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" role="radio" className={`swatch swatch-${n}`} aria-label={`Colour ${n}`}
              aria-checked={!!color && color.toLowerCase() === swatch(n).toLowerCase()}
              onClick={() => setColor(swatch(n))} />
          ))}
          <label className="swatch swatch-custom" title="Any colour">
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#808080"} onChange={(e) => setColor(e.target.value)} aria-label="Any colour" />
          </label>
          {color && <Button size="sm" variant="ghost" onClick={() => setColor("")}>No colour</Button>}
        </div>
      </section>

      <section className="profile-editor-sec">
        <h3 className="sub-h">Banner</h3>
        <Tabs<BannerTab> value={bannerTab} onChange={setBannerTab}
          tabs={[{ value: "mods", label: "A mod's preview" }, { value: "link", label: "Link" }, { value: "file", label: "Picture on this PC" }]} />
        {bannerTab === "mods" && (mods.length ? (
          <div className="banner-grid" role="radiogroup" aria-label="Mod previews">
            {mods.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={banner === m.preview} className={`banner-btn${banner === m.preview ? " on" : ""}`}
                title={m.name} onClick={() => setBanner(m.preview ?? "")}>
                <Preview src={m.preview} className="banner-btn-img" />
              </button>
            ))}
          </div>
        ) : <p className="hint">No mod previews in this game yet.</p>)}
        {bannerTab === "link" && (
          <div className="banner-link">
            <TextField value={link} onChange={setLink} placeholder="https://images.gamebanana.com/img/ss/mods/..." hint="Any image link, like one from a GameBanana mod page"
              onBlur={() => { if (/^https:\/\//i.test(link.trim())) setBanner(link.trim()); }} />
            <Button onClick={() => { if (/^https:\/\//i.test(link.trim())) setBanner(link.trim()); else toast("That doesn't look like an https:// image link", true); }}>Use</Button>
          </div>
        )}
        {bannerTab === "file" && (
          <div className="banner-link">
            <Button icon="image" onClick={() => void pickFile()}>Pick a picture</Button>
            {banner && !/^https?:/.test(banner) && <span className="hint mono">{banner.split(/[\\/]/).pop()}</span>}
          </div>
        )}
        {banner && <Button size="sm" variant="ghost" className="banner-clear" onClick={() => setBanner("")}>No banner</Button>}
      </section>
    </Dialog>
  );
}
