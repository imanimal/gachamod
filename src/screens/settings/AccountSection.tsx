// Settings > GameBanana account: the same sign-in as the card at the top of the sidebar. Signed in, following a
// creator in the app follows them on GameBanana too and mods get a Like button. Owner: ACCOUNT area.
import { useState } from "react";
import { importFollowing, matchGbAdultPref, setMatchGbAdult, signIn, signOut, useAccount } from "../../lib/account";
import { Button, Panel, Toggle } from "../../ui/kit";
import { SetRow } from "./parts";

const TIP = "You sign in on GameBanana's own page in a separate window, so gachamod never sees your password. It keeps the session encrypted for your Windows account";
const MATCH_TIP = "Uses what you picked on GameBanana for skimpy attire, sexual themes and content, lewd poses, nudity and fetishes. "
  + "GameBanana's defaults change nothing here, and a choice you make here stays until you change yours there";

/** "Mods for adults" follows the content settings on GameBanana. Under Mods for adults and under the account, one state. */
export function MatchGbAdultRow({ id }: { id?: string }) {
  const acc = useAccount();
  const on = matchGbAdultPref.use();
  const rule = "Everything shown there shows here, everything hidden hides, and a mix blurs";
  return (
    <SetRow id={id} label="Match my GameBanana settings" tip={MATCH_TIP}
      hint={acc.user ? `${rule}. Checked when you sign in and when gachamod starts` : `After you sign in. ${rule}`}>
      <span className="row">
        {!acc.user && (
          <Button size="sm" icon="user" busy={acc.signing} onClick={() => void signIn()}
            title={acc.signing ? "Finish signing in on GameBanana's page" : "Opens GameBanana's sign-in page over gachamod"}>Sign in</Button>
        )}
        <Toggle checked={on} onChange={(v) => void setMatchGbAdult(v)} />
      </span>
    </SetRow>
  );
}

export function AccountSection() {
  const acc = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, job: () => Promise<unknown>) => { setBusy(key); try { await job(); } finally { setBusy(null); } };
  const u = acc.user;

  return (
    <Panel title="GameBanana account" icon="user" id="account">
      <div className="set-rows">
        {u && (
          <div className="set-row" id="set-gb-signin">
            <span className="row acct-user">
              {u.avatar && <img src={u.avatar} alt="" width={32} height={32} className="acct-av" referrerPolicy="no-referrer" />}
              <span><b>{u.name}</b><span className="hint">Signed in. Following a creator here follows them on GameBanana too</span></span>
            </span>
            <span className="row">
              <Button size="sm" icon="feed" busy={busy === "import"} disabled={!!busy} onClick={() => void run("import", importFollowing)}
                title="Follows here everyone you follow on GameBanana. Nothing changes on GameBanana">Follow who you follow there</Button>
              <Button size="sm" variant="ghost" icon="power" disabled={!!busy} onClick={() => void run("out", signOut)}
                title="Forgets the session on this PC. Your follows here stay">Sign out</Button>
            </span>
          </div>
        )}
        {u && <MatchGbAdultRow />}
        {!u && (
          <SetRow id="set-gb-signin" label="Sign in to GameBanana" tip={TIP}
            hint="Then following a creator here follows them on GameBanana too, and mods get a Like button">
            <Button size="sm" variant="primary" icon="user" busy={acc.signing} onClick={() => void signIn()}
              title={acc.signing ? "Finish signing in on GameBanana's page" : "Opens GameBanana's sign-in page over gachamod"}>Sign in</Button>
          </SetRow>
        )}
      </div>
    </Panel>
  );
}
