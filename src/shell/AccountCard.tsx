// The GameBanana account at the top of the sidebar. Signed out, a click opens GameBanana's sign-in page over the app
// (lib/account.ts); signed in, it shows the GameBanana name and picture and a click opens a short menu. Folded, it's
// just the picture. Reuses the old player card's classes so game themes still dress it. Owner: SHELL area.
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { importFollowing, signIn, signOut, useAccount } from "../lib/account";
import { go, useGame } from "../lib/store";
import { Icon } from "../ui/Icon";
import { openMenu, type MenuEntry } from "../ui/ContextMenu";

const below = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; };
const beside = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.right + 6, y: r.top }; };

function useAccountCard() {
  const acc = useAccount();
  const u = acc.user;
  const menu = (): MenuEntry[] => u
    ? [
        { header: u.name },
        { label: "Your GameBanana page", icon: "user", title: "Your mods and uploads, in Browse", onClick: () => go({ view: "browse", user: u.id }) },
        { label: "Follow who you follow there", icon: "feed", title: "Follows here everyone you follow on GameBanana", onClick: () => void importFollowing() },
        "-",
        { label: "Sign out", icon: "power", title: "Forgets the session on this PC. Your follows in gachamod stay", onClick: () => void signOut() },
      ]
    : [{ label: "Sign in to GameBanana", icon: "user", onClick: () => void signIn() }];
  const click = (e: ReactMouseEvent<HTMLElement>, side: boolean) => {
    if (!u) { void signIn(); return; }
    openMenu(side ? beside(e.currentTarget) : below(e.currentTarget), menu());
  };
  const ctx = (e: ReactMouseEvent) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }, menu()); };
  const tip = u ? `Signed in to GameBanana as ${u.name}. Click for more`
    : acc.signing ? "GameBanana's sign-in page is open. Click to bring it back"
    : "Sign in to GameBanana to follow creators and like mods from here";
  return { acc, u, click, ctx, tip };
}

function Picture({ src }: { src: string | null | undefined }) {
  return src ? <img src={src} alt="" draggable={false} referrerPolicy="no-referrer" /> : <Icon name="user" className="player-av-ph" />;
}

export function AccountCard() {
  const game = useGame();
  const { acc, u, click, ctx, tip } = useAccountCard();
  // short on purpose: the card is narrow in every theme, and the tip says the rest
  return (
    <button type="button" className="player-card acct-card" style={{ "--g-accent": game?.accent ?? "var(--accent)" } as CSSProperties}
      title={tip} onClick={(e) => click(e, false)} onContextMenu={ctx} aria-busy={acc.signing || undefined}>
      <span className="player-banner" aria-hidden="true" />
      <span className="player-av"><Picture src={u?.avatar} /></span>
      <span className="player-text">
        <span className="player-name">{u ? u.name : acc.signing ? "Signing in" : "Sign in"}</span>
        <span className="player-title">{acc.signing && <span className="spin" aria-hidden="true" />}GameBanana</span>
      </span>
    </button>
  );
}

/** The folded rail's version: the picture alone. */
export function MiniAccount() {
  const { u, click, ctx, tip } = useAccountCard();
  return (
    <button type="button" className="side-me" title={tip} aria-label={u ? `GameBanana: ${u.name}` : "Sign in to GameBanana"}
      onClick={(e) => click(e, true)} onContextMenu={ctx}>
      <Picture src={u?.avatar} />
    </button>
  );
}
