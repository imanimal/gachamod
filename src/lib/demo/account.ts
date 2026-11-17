// Demo handlers for GameBanana sign-in (lib/account.ts): "signing in" takes a moment and signs in a made-up member, so
// the account card and Like buttons can be tried in the browser. Nothing reaches GameBanana. Owner: ACCOUNT area.
import { demoEmit, registerDemo } from "../tauri";
import { demoDb, demoWait } from "./db";

const ME = { id: 1, name: "Player", avatar: null };
let user: typeof ME | null = null;
// the made-up member's GameBanana points, and the free thanks they get once a day
let myPoints = 240;
let freeThank = true;
const state = () => ({ available: demoDb.settings.get("account.gbSignIn") !== "0", user });

export function registerAccountDemo() {
  registerDemo({
    gb_account: () => state(),
    gb_sign_in: () => { void demoWait(1500).then(() => { user = ME; demoEmit("gb-account", state()); }); },
    gb_sign_out: () => { user = null; return state(); },
    gb_follow: () => undefined,
    gb_like: () => undefined,
    gb_subscribe: () => undefined,
    gb_thank: ({ points }) => {
      if (!freeThank) myPoints -= Number(points);
      freeThank = false;
    },
    gb_mod_me: () => ({ liked: null, subscribed: null, thanked: null, own: false, points: myPoints, freeThank }),
    gb_following: () => [],
    // the made-up member hides every adult rating on GameBanana
    gb_content_settings: () => (user ? { mode: "hide", untouched: false } : null),
  });
}
