// Settings > GameBanana account: the same sign-in as the card at the top of the sidebar. Signed in, following a
// creator in the app follows them on GameBanana too and mods get a Like button. Owner: ACCOUNT area.
import { useState } from "react";
import { importFollowing, matchGbAdultPref, setMatchGbAdult, signIn, signOut, useAccount } from "../../lib/account";
import { Button, Panel, Toggle } from "../../ui/kit";
import { SetRow } from "./parts";
import { remindPref, setRemind } from "../../lib/creatorReminders";
import { t } from "../../lib/i18n";

const TIP = t("You sign in on GameBanana's site in a separate window, so gachamod never sees your password. It keeps the session encrypted for your Windows account");
const MATCH_TIP = t("Uses what you picked on GameBanana for skimpy attire, sexual themes and content, lewd poses, nudity and fetishes. GameBanana's defaults change nothing here, and a choice you make here stays until you change yours there");

/** "Mods for adults" follows the content settings on GameBanana. Under Mods for adults and under the account, one state. */
export function MatchGbAdultRow({ id }: { id?: string }) {
  const acc = useAccount();
  const on = matchGbAdultPref.use();
  return (
    <SetRow id={id} label={t("Match my GameBanana settings")} tip={MATCH_TIP}
      hint={acc.user ? t("Everything shown there shows here, everything hidden hides, and a mix blurs. Checked when you sign in and when gachamod starts") : t("After you sign in. Everything shown there shows here, everything hidden hides, and a mix blurs")}>
      <span className="row">
        {!acc.user && (
          <Button size="sm" icon="user" busy={acc.signing} onClick={() => void signIn()}
            title={acc.signing ? t("Finish signing in on GameBanana's page") : t("Opens GameBanana's sign-in page over gachamod")}>{t("Sign in")}</Button>
        )}
        <Toggle checked={on} onChange={(v) => void setMatchGbAdult(v)} />
      </span>
    </SetRow>
  );
}

/** Now and then, a toast naming a creator whose mods you use, to like and follow them (lib/creatorReminders.ts). */
function RemindRow({ signedIn }: { signedIn: boolean }) {
  const on = remindPref.use();
  const what = t("Now and then a short message names a creator whose mods you use and don't follow yet, with a button to like and follow. At most once every few days, never while a game runs");
  return (
    <SetRow id="set-gb-remind" label={t("Remind me to like and follow creators")} hint={signedIn ? what : t("While you're signed in. {text}", { text: what })}>
      <Toggle checked={on} onChange={setRemind} />
    </SetRow>
  );
}

export function AccountSection() {
  const acc = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, job: () => Promise<unknown>) => { setBusy(key); try { await job(); } finally { setBusy(null); } };
  const u = acc.user;

  return (
    <Panel title={t("GameBanana account")} icon="user" id="account">
      <div className="set-rows">
        {u && (
          <div className="set-row" id="set-gb-signin">
            <span className="row acct-user">
              {u.avatar && <img src={u.avatar} alt="" width={32} height={32} className="acct-av" referrerPolicy="no-referrer" />}
              <span><b>{u.name}</b><span className="hint">{t("Signed in. Following a creator here follows them on GameBanana too")}</span></span>
            </span>
            <span className="row">
              <Button size="sm" icon="feed" busy={busy === "import"} disabled={!!busy} onClick={() => void run("import", importFollowing)}
                title={t("Follows here everyone you follow on GameBanana. Nothing changes on GameBanana")}>{t("Import GameBanana follows")}</Button>
              <Button size="sm" variant="ghost" icon="power" disabled={!!busy} onClick={() => void run("out", signOut)}
                title={t("Forgets the session on this PC. Your follows here stay")}>{t("Sign out")}</Button>
            </span>
          </div>
        )}
        {u && <MatchGbAdultRow />}
        <RemindRow signedIn={!!u} />
        {!u && (
          <SetRow id="set-gb-signin" label={t("Sign in to GameBanana")} tip={TIP}
            hint={t("Then following a creator here follows them on GameBanana too, and mods get a Like button")}>
            <Button size="sm" variant="primary" icon="user" busy={acc.signing} onClick={() => void signIn()}
              title={acc.signing ? t("Finish signing in on GameBanana's page") : t("Opens GameBanana's sign-in page over gachamod")}>{t("Sign in")}</Button>
          </SetRow>
        )}
      </div>
    </Panel>
  );
}
