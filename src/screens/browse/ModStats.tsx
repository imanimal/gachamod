// The numbers under a GameBanana mod's gallery. The ones that name something you can do on GameBanana do it: the
// heart likes the mod, the bell subscribes to it, the gift thanks its creator (a small box says what it costs first),
// downloads goes to the files and comments to the comments. Signed out, those three start signing in.
// Owner: BROWSE area.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { likeMod, modMe, signIn, subscribeMod, thankMod, useAccount, useLiked, useSubscribed, useThanked, type ModMe } from "../../lib/account";
import type { GbMod } from "../../lib/gamebanana";
import { Button, Select, formatCount, timeAgo } from "../../ui/kit";
import { Icon, type IconName } from "../../ui/Icon";
import { Popover } from "../../ui/Popover";
import { t, tn } from "../../lib/i18n";

/** `act`: the like, subscribe and thanks buttons (mods, not tools). */
export function ModStats({ mod, act, onFiles, onComments }: { mod: GbMod; act: boolean; onFiles: () => void; onComments: () => void }) {
  const acc = useAccount();
  const signedIn = acc.available && !!acc.user;
  const liked = useLiked(mod.id);
  const subscribed = useSubscribed(mod.id);
  const thanked = useThanked(mod.id);
  const [me, setMe] = useState<ModMe | null>(null);
  // GameBanana counted with whatever the member had done when the page was read; the counts move from there
  const [base, setBase] = useState(() => ({ liked, subscribed }));
  const [sent, setSent] = useState(0);
  const [busy, setBusy] = useState<"like" | "sub" | null>(null);
  const [thankAt, setThankAt] = useState<HTMLElement | null>(null);
  const clicked = useRef(false);
  // the remembered state loads a moment after opening: follow it until GameBanana answers or the member clicks
  useEffect(() => { if (!clicked.current && !me) setBase({ liked, subscribed }); }, [liked, subscribed, me]);

  useEffect(() => {
    if (!act || !signedIn) return;
    let live = true;
    void modMe(mod.id).then((m) => {
      if (!live || !m) return;
      setMe(m);
      setBase((b) => ({ liked: m.liked ?? b.liked, subscribed: m.subscribed ?? b.subscribed }));
    });
    return () => { live = false; };
  }, [mod.id, act, signedIn]);

  const likes = Math.max(0, mod.likes + Number(liked) - Number(base.liked));
  const subs = Math.max(0, (mod.subscribers ?? 0) + Number(subscribed) - Number(base.subscribed));
  const thanks = (mod.thanks ?? 0) + sent;
  const creator = mod.submitter?.name ?? t("the creator");
  const own = me?.own ?? (!!acc.user && mod.submitter?.id === acc.user.id);

  const toggle = (what: "like" | "sub") => {
    if (!signedIn) { void signIn(); return; }
    clicked.current = true;
    setBusy(what);
    const job = what === "like" ? likeMod(mod.id, mod.name, !liked) : subscribeMod(mod.id, mod.name, !subscribed);
    // a short pause before the same button sends again
    void job.finally(() => window.setTimeout(() => setBusy(null), 400));
  };

  return (
    <div className="gb-stats">
      {act && !own ? (
        <>
          <Stat icon="heart" on={liked} pressed={signedIn ? liked : undefined} disabled={busy === "like"} onClick={() => toggle("like")}
            title={!signedIn ? tn(likes, "{n} like. Sign in to GameBanana to like it", "{n} likes. Sign in to GameBanana to like it")
              : liked ? tn(likes, "{n} like, yours included. Click to take back your like", "{n} likes, yours included. Click to take back your like")
              : tn(likes, "{n} like. Click to like it on GameBanana. Nobody is notified", "{n} likes. Click to like it on GameBanana. Nobody is notified")}>
            {formatCount(likes)}
          </Stat>
          <Stat icon="bell" on={subscribed} pressed={signedIn ? subscribed : undefined} disabled={busy === "sub"} onClick={() => toggle("sub")}
            title={!signedIn ? tn(subs, "{n} subscriber. Sign in to GameBanana to subscribe", "{n} subscribers. Sign in to GameBanana to subscribe")
              : subscribed ? tn(subs, "{n} subscriber, you included. Click to unsubscribe", "{n} subscribers, you included. Click to unsubscribe")
              : tn(subs, "{n} subscriber. Click to subscribe on GameBanana, which tells you there when it updates", "{n} subscribers. Click to subscribe on GameBanana, which tells you there when it updates")}>
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

function Stat({ icon, title, on, pressed, disabled, onClick, children }: {
  icon: IconName; title: string; on?: boolean; pressed?: boolean; disabled?: boolean; onClick: (el: HTMLElement) => void; children: ReactNode;
}) {
  return (
    <button type="button" className={`gb-stat gb-stat-btn${on ? " on" : ""}`} title={title} aria-pressed={pressed} disabled={disabled}
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
            void thankMod(mod.id, mod.name, creator, points, free).then((ok) => { setBusy(false); if (ok) onSent(points, free); });
          }}>
          {free ? t("Thank for free") : tn(points, "Thank for {n} point", "Thank for {n} points")}
        </Button>
      </div>
    </Popover>
  );
}
