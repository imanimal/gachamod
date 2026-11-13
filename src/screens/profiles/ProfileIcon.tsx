// A profile's icon: an emoji, a character portrait ("char:<Name>") or the name's initials. Owner: LIBRARY area.
import type { Character, Profile } from "../../lib/api";
import { Avatar } from "../../ui/kit";

export function ProfileIcon({ profile, chars, size = 32 }: { profile: Pick<Profile, "icon" | "name">; chars: Character[]; size?: number }) {
  const icon = profile.icon?.trim();
  if (icon?.startsWith("char:")) {
    const name = icon.slice(5);
    const c = chars.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return <Avatar className="profile-icon is-char" src={c?.icon} name={name} size={size} />;
  }
  if (icon) {
    return <span className="avatar profile-icon is-emoji" style={{ width: size, height: size, fontSize: size * 0.6 }} aria-hidden="true">{icon}</span>;
  }
  return <Avatar className="profile-icon" name={profile.name} size={size} />;
}
