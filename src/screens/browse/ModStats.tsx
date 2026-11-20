// The numbers under a GameBanana mod's gallery. The ones that name something you can do do it: the heart likes the
// mod, the bell subscribes (gachamod then tells you when it updates, lib/subscriptions.ts), the gift thanks its
// creator (a small box says what it costs first), downloads goes to the files and comments to the comments. Signed
// out, the heart and the gift start signing in; the bell works either way.
// Owner: BROWSE area.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { likeMod, modMe, signIn, thankMod, useAccount, useLiked, useThanked, type ModMe } from "../../lib/account";
import { noteGbSub, setModSub, useModSub } from "../../lib/subscriptions";
import type { GbMod } from "../../lib/gamebanana";
import { Button, Select, formatCount, timeAgo } from "../../ui/kit";
import { Icon, type IconName } from "../../ui/Icon";
import { Popover } from "../../ui/Popover";
import { t, tn } from "../../lib/i18n";

/** `act`: the like, subscribe and thanks buttons (mods, not tools). `nudge`: the mod has been in use a while without a
 *  like, so the heart beats now and then while signed in. */
export function ModStats({ mod, act, nudge, onFiles, onComments }: { mod: GbMod; act: boolean; nudge?: boolean; onFiles: () => void; onComments: () => void }) {
  const acc = useAccount();
  const signedIn = acc.available && !!acc.user;
  const liked = useLiked(mod.id);
  const sub = useModSub(mod.id);
  const subscribed = !!sub;
  // GameBanana's count only has the subscriptions made there
  const onGb = !!sub?.gb;
  const thanked = useThanked(mod.id);
  const [me, setMe] = useState<ModMe | null>(null);
  // GameBanana counted with whatever the member had done when the page was read; the counts move from there
  const [base, setBase] = useState(() => ({ liked, subscribed: onGb }));
  const [sent, setSent] = useState(0);
  const [busy, setBusy] = useState<"like" | "sub" | null>(null);
  const [thankAt, setThankAt] = useState<HTMLElement | null>(null);
  const clicked = useRef(false);
  // the remembered state loads a moment after opening: follow it until GameBanana answers or the member clicks
  useEffect(() => { if (!clicked.current && !me) setBase({ liked, subscribed: onGb }); }, [liked, onGb, me]);

  useEffect(() => {
    if (!act || !signedIn) return;
    let live = true;
    void modMe(mod.id).then((m) => {
      if (!live || !m) return;
      setMe(m);
      setBase((b) => ({ liked: m.liked ?? b.liked, subscribed: m.subscribed ?? b.subscribed }));
      if (m.subscribed !== null && !clicked.current) void noteGbSub(mod, m.subscribed);
    });
    return () => { live = false; };
  }, [mod.id, act, signedIn]);

  const likes = Math.max(0, mod.likes + Number(liked) - Number(base.liked));
  const subs = Math.max(0, (mod.subscribers ?? 0) + Number(onGb) - Number(base.subscribed));
  const thanks = (mod.thanks ?? 0) + sent;
  const creator = mod.submitter?.name ?? t("the creator");
  const own = me?.own ?? (!!acc.user && mod.submitter?.id === acc.user.id);

  const toggle = (what: "like" | "sub") => {
    if (!signedIn && what === "like") { void signIn(); return; }
    clicked.current = true;
    setBusy(what);
    const job = what === "like" ? likeMod(mod.id, mod.name, !liked) : setModSub(mod, !subscribed);
    // a short pause before the same button sends again
    void job.finally(() => window.setTimeout(() => setBusy(null), 400));
  };

  return (
    <div className="gb-stats">
      {act && !own ? (
        <>
          <Stat icon="heart" on={liked} pressed={signedIn ? liked : undefined} disabled={busy === "like"} onClick={() => toggle("like")}
            className={nudge && signedIn && !liked ? "nudge" : undefined}
            title={!signedIn ? tn(likes, "{n} like. Sign in to GameBanana to like it", "{n} likes. Sign in to GameBanana to like it")
              : liked ? tn(likes, "{n} like, yours included. Click to take back your like", "{n} likes, yours included. Click to take back your like")
              : tn(likes, "{n} like. Click to like it", "{n} likes. Click to like it")}>
            {formatCount(likes)}
          </Stat>
          <Stat icon="bell" on={subscribed} pressed={subscribed} disabled={busy === "sub"} onClick={() => toggle("sub")}
            title={subscribed ? tn(subs, "{n} subscriber. You're subscribed, so gachamod tells you when it updates. Click to unsubscribe", "{n} subscribers. You're subscribed, so gachamod tells you when it updates. Click to unsubscribe")
              : tn(subs, "{n} subscriber. Click to subscribe, and gachamod tells you when it updates", "{n} subscribers. Click to subscribe, and gachamod tells you when it updates")}>
            {formatCount(subs)}
          </Stat>
          <Stat icon="gift" on={thanked} onClick={(el) => { if (!signedIn) void signIn(); else setThankAt((a) => (a ? null : el)); }}
            title={!signedIn ? tn(thanks, "{n} thank. Sign in to GameBanana to thank {creator}", "{n} thanks. Sign in to GameBanana to thank {creator}", { creator })
              : thanked ? tn(thanks, "{n} thank, yours included. Click to thank {creator} again", "{n} thanks, yours included. Click to thank {creator} again", { creator })
              : tn(thanks, "{n} thank. Click to thank {creator} with GameBanana points", "{n} thanks. Click to thank {creator} with GameBanana points", { creator })}>
            {formatCount(thanks)}
          </Stat>
        </>
      ) : (
        <>
          <span className="gb-stat" title={tn(mod.likes, "{n} like", "{n} likes")}><Icon name="heart" />{formatCount(mod.likes)}</span>
          {act && <span className="gb-stat" title={tn(subs, "{n} subscriber. It's your mod", "{n} subscribers. It's your mod")}><Icon name="bell" />{formatCount(subs)}</span>}
          {act && <span className="gb-stat" title={tn(thanks, "{n} thank. It's your mod", "{n} thanks. It's your mod")}><Icon name="gift" />{formatCount(thanks)}</span>}
        </>
      )}
      <span className="gb-stat" title={tn(mod.views, "{n} view", "{n} views")}><Icon name="eye" />{formatCount(mod.views)}</span>
      {mod.downloads !== null && (
        <Stat icon="downloads" title={tn(mod.downloads, "{n} download. Click to go to the files", "{n} downloads. Click to go to the files")} onClick={onFiles}>{formatCount(mod.downloads)}</Stat>
      )}
      {(mod.comments ?? 0) > 0 && <Stat icon="feed" title={t("Go to the comments")} onClick={onComments}>{tn(mod.comments ?? 0, "{n} comment", "{n} comments")}</Stat>}
      <span className="gb-stat" title={t("Added {added}, updated {updated}", { added: new Date(mod.added * 1000).toLocaleString(), updated: new Date(mod.updated * 1000).toLocaleString() })}><Icon name="clock" />{timeAgo(mod.updated)}</span>
      {thankAt && (
        <ThankBox anchor={thankAt} mod={mod} creator={creator} me={me} again={thanked} onClose={() => setThankAt(null)}
          onSent={(points, free) => {
            setThankAt(null);
            setSent((n) => n + 1);
            setMe((m) => m && { ...m, freeThank: false, points: m.points === null || free ? m.points : Math.max(0, m.points - points) });
          }} />
      )}
    </div>
  );
}

function Stat({ icon, title, on, pressed, disabled, className, onClick, children }: {
  icon: IconName; title: string; on?: boolean; pressed?: boolean; disabled?: boolean; className?: string; onClick: (el: HTMLElement) => void; children: ReactNode;
}) {
  return (
    <button type="button" className={`gb-stat gb-stat-btn${on ? " on" : ""}${className ? ` ${className}` : ""}`} title={title} aria-pressed={pressed} disabled={disabled}
      onClick={(e) => onClick(e.currentTarget)}>
      <Icon name={icon} className={on && (icon === "heart" || icon === "bell") ? "fill" : ""} />{children}
    </button>
  );
}

/** The amounts GameBanana's own page offers. */
const AMOUNTS = ["5", "10", "25", "50", "100", "250", "500", "1000"].map((v) => ({ value: v, label: tn(Number(v), "{n} point", "{n} points") }));

/** What a thanks costs, and the one button that sends it. GameBanana's first thanks of the day is free (it sends 10
 *  of its own points); after that the member picks how many of theirs to give. */
function ThankBox({ anchor, mod, creator, me, again, onClose, onSent }: {
  anchor: HTMLElement; mod: GbMod; creator: string; me: ModMe | null; again: boolean; onClose: () => void; onSent: (points: number, free: boolean) => void;
}) {
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const free = me?.freeThank === true;
  const points = free ? 10 : Number(amount);
  const short = !free && me?.points != null && me.points < points;
  // keyboard and controller land on the button (the box is placed a frame after it opens)
  useEffect(() => { const timer = window.setTimeout(() => box.current?.querySelector<HTMLElement>(".btn-primary")?.focus({ preventScroll: true }), 30); return () => window.clearTimeout(timer); }, []);

  return (
    <Popover anchor={anchor} onClose={onClose} label={t("Thank {creator}", { creator })} width="19em" align="start">
      <div ref={box} className="gb-thank">
        <p>{again ? t("You thanked {creator} for this before. Another thanks gives them more points.", { creator }) : t("A thanks gives {creator} points on GameBanana. It can't be taken back.", { creator })}</p>
        {free
          ? <p className="hint">{t("Your first thanks today is free: GameBanana gives the 10 points.")}</p>
          : <Select label={t("Points to give")} value={amount} options={AMOUNTS} onChange={setAmount}
              hint={me?.points != null ? t("You have {points} points", { points: formatCount(me.points) }) : undefined} />}
        <Button variant="primary" icon="gift" busy={busy} disabled={short}
          title={short ? t("You have {points} points. Pick fewer", { points: me?.points ?? 0 }) : undefined}
          onClick={() => {
            setBusy(true);
            void thankMod(mod.id, points, free).then((ok) => { setBusy(false); if (ok) onSent(points, free); });
          }}>
          {free ? t("Thank for free") : tn(points, "Thank for {n} point", "Thank for {n} points")}
        </Button>
      </div>
    </Popover>
  );
}
