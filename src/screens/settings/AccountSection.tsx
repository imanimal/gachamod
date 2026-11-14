// Settings > GameBanana account: sign in on GameBanana's own page, then following creators and liking mods in the app
// reach the real account. Starts turned off: it hasn't been tried with a real account yet. Owner: ACCOUNT area.
import { useState } from "react";
import { importFollowing, setSignInOn, signIn, signOut, useAccount } from "../../lib/account";
import { inTauri } from "../../lib/tauri";
import { Button, Panel, Toggle } from "../../ui/kit";
import { SetRow, useSetting } from "./parts";

export function AccountSection() {
  const acc = useAccount();
  const [on, setOn] = useSetting("account.gbSignIn", "0");
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, job: () => Promise<unknown>) => { setBusy(key); try { await job(); } finally { setBusy(null); } };
  const enabled = inTauri() ? acc.available : on === "1";

  return (
    <Panel title="GameBanana account" icon="user" id="account">
      <div className="set-rows">
        <SetRow id="set-gb-signin" label="Sign in to GameBanana"
          tip="You sign in on GameBanana's own page in a separate window, so gachamod never sees your password. It keeps the session encrypted for your Windows account"
          hint={enabled ? "Following a creator here follows them on GameBanana too, and mods get a Like button" : "Off. It hasn't been tried with a real account yet, so it may not work"}>
          <Toggle checked={enabled} label="Sign in to GameBanana"
            onChange={(v) => { if (inTauri()) void setSignInOn(v); else setOn(v ? "1" : "0"); }} />
        </SetRow>
        {enabled && !inTauri() && <p className="hint">Signing in works in the app, not in the browser demo.</p>}
        {enabled && inTauri() && (acc.user ? (
          <div className="set-row" id="set-gb-user">
            <span className="row acct-user">
              {acc.user.avatar && <img src={acc.user.avatar} alt="" width={32} height={32} className="acct-av" />}
              <span><b>{acc.user.name}</b><span className="hint">Signed in</span></span>
            </span>
            <span className="row">
              <Button size="sm" icon="feed" busy={busy === "import"} disabled={!!busy} onClick={() => void run("import", importFollowing)}
                title="Follow here everyone you follow on GameBanana. Nothing changes on GameBanana">Import who I follow</Button>
              <Button size="sm" variant="ghost" icon="power" disabled={!!busy} onClick={() => void run("out", signOut)}
                title="Forget the session on this PC. Your follows here stay">Sign out</Button>
            </span>
          </div>
        ) : (
          <div className="set-row">
            <span className="hint">Not signed in.</span>
            <Button size="sm" variant="primary" icon="user" busy={busy === "in"} disabled={!!busy} onClick={() => void run("in", signIn)}
              title="Opens GameBanana's sign-in page in its own window">Sign in</Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
