// The numbers under a GameBanana mod's gallery. The ones that name something you can do on GameBanana do it: the
// heart likes the mod, the bell subscribes to it, the gift thanks its creator (a small box says what it costs first),
// downloads goes to the files and comments to the comments. Signed out, those three start signing in.
// Owner: BROWSE area.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { likeMod, modMe, signIn, subscribeMod, thankMod, useAccount, useLiked, useSubscribed, useThanked, type ModMe } from "../../lib/account";
import type { GbMod } from "../../lib/gamebanana";
import { Button, Select, formatCount, plural, timeAgo } from "../../ui/kit";
import { Icon, type IconName } from "../../ui/Icon";
import { Popover } from "../../ui/Popover";

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
  const creator = mod.submitter?.name ?? "the creator";
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
            title={!signedIn ? `${plural(likes, "like")}. Sign in to GameBanana to like it`
              : liked ? `${plural(likes, "like")}, yours included. Click to take back your like`
              : `${plural(likes, "like")}. Click to like it on GameBanana. Nobody is notified`}>
            {formatCount(likes)}
          </Stat>
          <Stat icon="bell" on={subscribed} pressed={signedIn ? subscribed : undefined} disabled={busy === "sub"} onClick={() => toggle("sub")}
            title={!signedIn ? `${plural(subs, "subscriber")}. Sign in to GameBanana to subscribe`
              : subscribed ? `${plural(subs, "subscriber")}, you included. Click to unsubscribe`
              : `${plural(subs, "subscriber")}. Click to subscribe on GameBanana, which tells you there when it updates`}>
            {formatCount(subs)}
          </Stat>
          <Stat icon="gift" on={thanked} onClick={(el) => { if (!signedIn) void signIn(); else setThankAt((a) => (a ? null : el)); }}
            title={!signedIn ? `${plural(thanks, "thank")}. Sign in to GameBanana to thank ${creator}`
              : thanked ? `${plural(thanks, "thank")}, yours included. Click to thank ${creator} again`
              : `${plural(thanks, "thank")}. Click to thank ${creator} with GameBanana points`}>
            {formatCount(thanks)}
          </Stat>
        </>
      ) : (
        <>
          <span className="gb-stat" title={plural(mod.likes, "like")}><Icon name="heart" />{formatCount(mod.likes)}</span>
          {act && <span className="gb-stat" title={`${plural(subs, "subscriber")}. It's your mod`}><Icon name="bell" />{formatCount(subs)}</span>}
          {act && <span className="gb-stat" title={`${plural(thanks, "thank")}. It's your mod`}><Icon name="gift" />{formatCount(thanks)}</span>}
        </>
      )}
      <span className="gb-stat" title={plural(mod.views, "view")}><Icon name="eye" />{formatCount(mod.views)}</span>
      {mod.downloads !== null && (
        <Stat icon="downloads" title={`${plural(mod.downloads, "download")}. Click to go to the files`} onClick={onFiles}>{formatCount(mod.downloads)}</Stat>
      )}
      {(mod.comments ?? 0) > 0 && <Stat icon="feed" title="Go to the comments" onClick={onComments}>{plural(mod.comments ?? 0, "comment")}</Stat>}
      <span className="gb-stat" title={`Added ${new Date(mod.added * 1000).toLocaleString()}, updated ${new Date(mod.updated * 1000).toLocaleString()}`}><Icon name="clock" />{timeAgo(mod.updated)}</span>
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
const AMOUNTS = ["5", "10", "25", "50", "100", "250", "500", "1000"].map((v) => ({ value: v, label: `${v} points` }));

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
  useEffect(() => { const t = window.setTimeout(() => box.current?.querySelector<HTMLElement>(".btn-primary")?.focus({ preventScroll: true }), 30); return () => window.clearTimeout(t); }, []);

  return (
    <Popover anchor={anchor} onClose={onClose} label={`Thank ${creator}`} width="19em" align="start">
      <div ref={box} className="gb-thank">
        <p>{again ? `You thanked ${creator} for this before. Another thanks gives them more points.` : `A thanks gives ${creator} points on GameBanana. It can't be taken back.`}</p>
        {free
          ? <p className="hint">Your first thanks today is free: GameBanana gives the 10 points.</p>
          : <Select label="Points to give" value={amount} options={AMOUNTS} onChange={setAmount}
              hint={me?.points != null ? `You have ${formatCount(me.points)} points` : undefined} />}
        <Button variant="primary" icon="gift" busy={busy} disabled={short}
          title={short ? `You have ${me?.points ?? 0} points. Pick fewer` : undefined}
          onClick={() => {
            setBusy(true);
            void thankMod(mod.id, mod.name, creator, points, free).then((ok) => { setBusy(false); if (ok) onSent(points, free); });
          }}>
          {free ? "Thank for free" : `Thank for ${points} points`}
        </Button>
      </div>
    </Popover>
  );
}
