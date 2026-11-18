// The profile box on a creator's page: online or offline in their own words, when they joined and the answers on
// their GameBanana profile ("Cat or Dog": "Cat"). It wears their GameBanana hover card style (Cooltip) when they
// have one and Settings, Creators shows name styles. Owner: BROWSE area.
import type { CSSProperties } from "react";
import type { GbCardStyle, GbMember } from "../../lib/gamebanana";
import { onColor, readableOn } from "../../lib/theme";
import { t } from "../../lib/i18n";

/** GameBanana's hover card is black at 90% when the member didn't pick a background colour. */
const GB_CARD_BG = "#000000e6";

/** Class names and CSS variables for a box in `card` style. The text colour is moved until it reads on the card's
 *  background, and the app's text tokens follow it inside the box. */
export function cardStyleProps(card: GbCardStyle): { className: string; style: CSSProperties } {
  const fill = card.background ?? GB_CARD_BG;
  const base = fill.slice(0, 7);
  const text = readableOn(card.color ?? onColor(base), base, 4.5);
  const vars: Record<string, string> = {
    "--ct-bg": fill,
    "--ct-c": text,
    "--text": text,
    "--text-2": `color-mix(in srgb, ${text} 82%, ${base})`,
    "--text-3": `color-mix(in srgb, ${text} 66%, ${base})`,
  };
  if (card.image) vars["--ct-img"] = `url("${card.image}")`;
  if (card.font) vars["--sh-font"] = card.font;
  if (card.borderWidth > 0 && card.borderStyle) vars["--ct-border"] = `${card.borderWidth}px ${card.borderStyle} ${card.borderColor ?? "currentColor"}`;
  const classes = ["gb-creator-card", "has-card", "gb-name"];
  if (card.effect) {
    classes.push(`fx-${card.effect}`);
    if (card.effectColor) vars["--sh-ec"] = card.effectColor;
  }
  return { className: classes.join(" "), style: vars as CSSProperties };
}

export function CreatorCard({ member, styled }: { member: GbMember; styled: boolean }) {
  const own = styled && member.card ? cardStyleProps(member.card) : null;
  const status = member.online === null ? null : member.status ?? (member.online ? t("Online") : t("Offline"));
  if (!status && !member.joined && !member.about.length) return null;
  return (
    <section className={own?.className ?? "gb-creator-card"} style={own?.style} aria-label={t("Profile on GameBanana")}>
      {(status || member.joined) && (
        <p className="gb-creator-card-h">
          {status && (
            <span className={`gb-creator-status${member.online ? " is-on" : ""}`}
              title={member.online ? t("Online on GameBanana now") : t("Not online on GameBanana now")}>{status}</span>
          )}
          {member.joined && <span className="gb-creator-joined">{t("Joined {date}", { date: new Date(member.joined * 1000).toLocaleDateString() })}</span>}
        </p>
      )}
      {member.about.length > 0 && (
        <dl className="gb-creator-about">
          {member.about.map((b) => (
            <div key={b.q}><dt>{b.q}</dt><dd>{b.a}</dd></div>
          ))}
        </dl>
      )}
    </section>
  );
}
