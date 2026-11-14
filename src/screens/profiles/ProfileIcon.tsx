// A profile's icon: a picture from the user's PC ("img:<path>"), a line icon in the profile's colour ("icon:<name>"),
// an emoji, a character portrait ("char:<Name>"), a layers glyph for the "Default" profile, or the name's initials (in the profile's colour when it
// has one). profileFace() is the choice itself, shared with ProfileThumb so the sidebar's mini thumbnails show the
// same picture. Owner: LIBRARY area (the default-icon logic: SHELL).
import type { CSSProperties } from "react";
import { fileUrl, type Character, type Profile } from "../../lib/api";
import { onColor } from "../../lib/theme";
import { Icon, type IconName } from "../../ui/Icon";
import { ICONS } from "../../ui/icons";
import { Avatar } from "../../ui/kit";

/** The line icons a profile can use, in the order the picker shows them. */
export const PROFILE_GLYPHS: IconName[] = [
  "star", "heart", "flame", "zap", "sparkle", "crown", "gem", "trophy", "shield", "sword", "moon", "sun", "cloud", "snow",
  "drop", "leaf", "umbrella", "music", "camera", "gamepad", "shirt", "dice", "flag", "rocket", "coffee", "cat", "ghost", "wand",
];

export type ProfileFace =
  | { kind: "img"; src: string | null }
  | { kind: "char"; name: string; src: string | null }
  | { kind: "glyph"; name: IconName }
  | { kind: "emoji"; text: string }
  | { kind: "default" }
  | { kind: "initials"; name: string };

type Who = Pick<Profile, "icon" | "name"> & { color?: string | null };

/** What a profile shows when it has no picture of its own mods. */
export function profileFace(profile: Pick<Profile, "icon" | "name">, chars: Character[]): ProfileFace {
  const icon = profile.icon?.trim();
  if (icon?.startsWith("img:")) return { kind: "img", src: fileUrl(icon.slice(4)) ?? null };
  if (icon?.startsWith("char:")) {
    const name = icon.slice(5);
    const c = chars.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return { kind: "char", name, src: c?.icon ?? null };
  }
  if (icon?.startsWith("icon:")) {
    const name = icon.slice(5);
    if (name in ICONS) return { kind: "glyph", name: name as IconName };
  }
  if (icon) return { kind: "emoji", text: icon };
  if (/^default$/i.test(profile.name.trim()) || !profile.name.trim()) return { kind: "default" };
  return { kind: "initials", name: profile.name };
}

/** Fill and ink for a profile's colour, or nothing when it has none. */
function paint(color: string | null | undefined): CSSProperties {
  const c = color?.trim();
  return c && /^#[0-9a-f]{6}$/i.test(c) ? { background: c, color: onColor(c) } : {};
}

export function ProfileIcon({ profile, chars, size = 32, className }: { profile: Who; chars: Character[]; size?: number; className?: string }) {
  const face = profileFace(profile, chars);
  const cls = (k: string) => `avatar profile-icon ${k}${className ? ` ${className}` : ""}`;
  const box = { width: size, height: size };
  if (face.kind === "img") return <Avatar className={`profile-icon is-img${className ? ` ${className}` : ""}`} src={face.src} name={profile.name} size={size} />;
  if (face.kind === "char") return <Avatar className={`profile-icon is-char${className ? ` ${className}` : ""}`} src={face.src} name={face.name} size={size} />;
  if (face.kind === "glyph") {
    return <span className={cls("is-glyph")} style={{ ...box, ...paint(profile.color) }} aria-hidden="true"><Icon name={face.name} /></span>;
  }
  if (face.kind === "emoji") {
    return <span className={cls("is-emoji")} style={{ ...box, fontSize: Math.round(size * 0.56) }} aria-hidden="true">{face.text}</span>;
  }
  if (face.kind === "default") {
    return <span className={cls("is-default")} style={{ ...box, ...paint(profile.color) }} title={profile.name} aria-hidden="true"><Icon name="layers" /></span>;
  }
  if (profile.color && paint(profile.color).background) {
    const initials = face.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
    return <span className={cls("is-initials")} style={{ ...box, ...paint(profile.color), fontSize: size * 0.38 }} title={face.name}><span className="avatar-t">{initials}</span></span>;
  }
  return <Avatar className={`profile-icon${className ? ` ${className}` : ""}`} name={face.name} size={size} />;
}
