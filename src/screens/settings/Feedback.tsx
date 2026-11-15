// Feedback to the developer, the usage counts and crash reports switches, the log folder, and starting as
// administrator. The form opens from Settings, the search ("Send feedback") and a screen that hit an error.
// Owner: SETTINGS/AI area.
import { useEffect, useState, type KeyboardEvent } from "react";
import { Button, Checkbox, Dialog, Panel, Segmented, TextField, Toggle } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { admin, errorText, report, shell, type AdminState, type FeedbackKind, type ReportState } from "../../lib/api";
import { restartAsAdmin } from "../../lib/elevation";
import { closeFeedback, openFeedback, openGameCheck, useFeedbackStart, type FeedbackStart as Start } from "../../lib/feedback";
import { currentGame, currentRoute } from "../../lib/store";
import { posthog } from "../../lib/posthog";
import { SetRow } from "./parts";

// ── the form ──

export { openFeedback };

/** Where the form shows (once, in App). */
export function FeedbackHost() {
  const s = useFeedbackStart();
  return s ? <FeedbackDialog start={s} onClose={closeFeedback} /> : null;
}

const PLACEHOLDER: Record<FeedbackKind, string> = {
  problem: "What happened, and what did you expect? For example: a skin didn't change after I picked it in the game's menu.",
  idea: "What would you like gachamod to do?",
  other: "Anything you'd like the developer to know.",
};

function FeedbackDialog({ start: s, onClose }: { start: Start; onClose: () => void }) {
  const [kind, setKind] = useState<FeedbackKind>(s.kind);
  const [text, setText] = useState(s.text);
  const [contact, setContact] = useState("");
  const [logs, setLogs] = useState(s.kind === "problem");
  const [busy, setBusy] = useState(false);
  const pick = (k: FeedbackKind) => { setKind(k); setLogs(k === "problem"); };
  const send = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      const screen = currentRoute().view;
      const game = currentGame()?.id;
      await report.feedback({ kind, text, contact: contact.trim() || undefined, logs, screen, game });
      posthog?.capture("feedback_submitted", { feedback_kind: kind, attached_logs: logs, screen, game_id: game });
      toast("Thanks. Your feedback was sent");
      onClose();
    } catch (e) { toast(errorText(e), true); setBusy(false); }
  };
  const keys = (e: KeyboardEvent) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } };
  return (
    <Dialog title="Send feedback" icon="help" onClose={onClose} locked={busy ? "Sending your feedback" : undefined} footer={<>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="primary" icon="upload" busy={busy} disabled={busy || !text.trim()} onClick={() => void send()} data-t="feedback-send"
        title="Sends it to gachamod's developer (Ctrl+Enter)">Send</Button>
    </>}>
      <div className="feedback" onKeyDown={keys}>
        <Segmented label="What it is" value={kind} onChange={pick} options={[
          { value: "problem", label: "Something's wrong" }, { value: "idea", label: "An idea" }, { value: "other", label: "Something else" },
        ]} />
        <TextField multiline rows={6} autoFocus label="Message" value={text} onChange={setText} placeholder={PLACEHOLDER[kind]} />
        <TextField label="How to reach you (optional)" value={contact} onChange={setContact} placeholder="A Discord name or an email, if you'd like an answer" />
        <span title="The last part of gachamod.log: what the app did and the errors it hit. Your user folder's name is taken out first">
          <Checkbox checked={logs} onChange={setLogs} label="Attach the end of gachamod's log" />
        </span>
      </div>
    </Dialog>
  );
}

// ── settings ──

/** Settings, "Feedback and data": the form, what gets sent and the log folder. */
export function FeedbackSection() {
  const [st, setSt] = useState<ReportState | null>(null);
  useEffect(() => { report.state().then(setSt).catch(() => {}); }, []);
  const set = (p: { usage?: boolean; crashes?: boolean }) => {
    report.set(p).then(setSt).catch((e) => toast(errorText(e), true));
  };
  return (
    <Panel title="Feedback and data" icon="help" id="feedback">
      <div className="set-rows">
        <SetRow id="set-feedback" label="Send feedback" hint="Tell the developer about a problem or an idea. It goes straight from here, no account needed">
          <Button size="sm" icon="help" onClick={() => openFeedback()} data-t="feedback-open" title="Opens a short form">Send feedback</Button>
        </SetRow>
        <SetRow id="set-gamecheck" label="Check this game" hint="Walks through switching skins while you play, one step at a time, then sends what worked. About ten minutes with the game open">
          <Button size="sm" icon="check" onClick={openGameCheck} data-t="gamecheck-open" title="Checks the game picked in the sidebar">Check this game</Button>
        </SetRow>
        <SetRow id="set-usage" label="Usage counts" hint="Sends anonymous counts of which screens and buttons get used, so the developer knows what to work on. No mod names, file paths or account details"
          tip="Each count has a random id for this install, the app version, the game's short name and whether the mouse, keyboard or a controller was used. docs/telemetry.md in gachamod's source lists every one">
          <Toggle checked={st?.usage ?? true} disabled={!st} onChange={(v) => set({ usage: v })} />
        </SetRow>
        <SetRow id="set-crashes" label="Crash reports" hint="When gachamod crashes, sends what went wrong and the end of its log, with your user folder's name taken out">
          <Toggle checked={st?.crashes ?? true} disabled={!st} onChange={(v) => set({ crashes: v })} />
        </SetRow>
        <SetRow id="set-logs" label="Logs" hint="gachamod.log lists what the app did and the errors it hit. Crash files sit next to it">
          <Button size="sm" icon="folder" disabled={!st?.logsDir} title={st?.logsDir ?? undefined}
            onClick={() => { if (st?.logsDir) shell.openPath(st.logsDir).catch((e) => toast(errorText(e), true)); }}>Open logs folder</Button>
        </SetRow>
      </div>
    </Panel>
  );
}

const ADMIN_TIP = "Zenless Zone Zero and some other games run as administrator, and Windows keeps keys from programs that don't away from them. "
  + "As administrator, gachamod switches skins without F10, its hotkeys work while you play and its menu opens over the game. "
  + "Windows asks for permission each time gachamod starts, and dragging files in from Explorer doesn't work while it runs this way";

/** Settings, under Games: start as administrator every time, or once now. */
export function AdminRow() {
  const [st, setSt] = useState<AdminState | null>(null);
  useEffect(() => { admin.state().then(setSt).catch(() => {}); }, []);
  const always = (on: boolean) => {
    admin.setAlways(on).then((s) => {
      setSt(s);
      if (on && !s.elevated) toast("gachamod starts as administrator from now on", false, { label: "Restart now", run: restartAsAdmin });
    }).catch((e) => toast(errorText(e), true));
  };
  if (!st) return null;
  return (
    <div className="set-rows">
      <SetRow id="set-admin" label="Run as administrator" tip={ADMIN_TIP}
        hint={st.elevated ? "gachamod runs as administrator now, so it can send keys to games that do too" : "Lets gachamod send keys to games that run as administrator, like Zenless Zone Zero"}>
        <span className="set-admin">
          {!st.elevated && <Button size="sm" onClick={restartAsAdmin} data-t="admin-restart" title="Closes gachamod and opens it again as administrator. Windows asks you first">Restart as administrator</Button>}
          <Toggle checked={st.always} onChange={always} label="Always" />
        </span>
      </SetRow>
    </div>
  );
}
