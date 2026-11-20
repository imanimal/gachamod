// Settings, "Feedback, privacy and logs": feedback to the developer, the usage counts and crash reports switches, the
// log folder. Also the row for starting as administrator. The form opens from Settings, the search ("Send feedback") and a screen that hit an error.
// Owner: SETTINGS/AI area.
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Button, Checkbox, Dialog, Panel, Segmented, TextField, Toggle } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { admin, errorText, rendering, report, shell, type AdminState, type FeedbackKind, type RenderState, type ReportState } from "../../lib/api";
import { renderLogPref } from "../../lib/renderWatch";
import { restartAsAdmin } from "../../lib/elevation";
import { closeFeedback, openFeedback, openGameCheck, useFeedbackStart, type FeedbackStart as Start } from "../../lib/feedback";
import { currentGame, currentRoute } from "../../lib/store";
import { SetRow } from "./parts";
import { setTester, useTester } from "../ingame/data";
import { consolePref } from "../../dev/console/setting";
import { t } from "../../lib/i18n";

// ── the form ──

export { openFeedback };

/** Where the form shows (once, in App). */
export function FeedbackHost() {
  const s = useFeedbackStart();
  return s ? <FeedbackDialog start={s} onClose={closeFeedback} /> : null;
}

const PLACEHOLDER: Record<FeedbackKind, string> = {
  problem: t("What happened, and what did you expect? For example: a skin didn't change after I picked it in the game's menu."),
  idea: t("What would you like gachamod to do?"),
  other: t("Anything you'd like the developer to know."),
};

/** What was typed into the form, kept for the rest of the session so closing it (Esc, Cancel) loses nothing. Cleared on send. */
const draft = { kind: null as FeedbackKind | null, text: "", contact: "" };

function FeedbackDialog({ start: s, onClose }: { start: Start; onClose: () => void }) {
  const keep = !s.text && !!draft.text.trim();
  const [kind, setKind] = useState<FeedbackKind>(keep && draft.kind ? draft.kind : s.kind);
  const [text, setText] = useState(keep ? draft.text : s.text);
  const [contact, setContact] = useState(draft.contact);
  const [logs, setLogs] = useState((keep && draft.kind ? draft.kind : s.kind) === "problem");
  const [busy, setBusy] = useState(false);
  useEffect(() => { draft.kind = kind; draft.text = text; draft.contact = contact; }, [kind, text, contact]);
  const pick = (k: FeedbackKind) => { setKind(k); setLogs(k === "problem"); };
  const send = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      await report.feedback({ kind, text, contact: contact.trim() || undefined, logs, screen: currentRoute().view, game: currentGame()?.id });
      toast(t("Thanks. Your feedback was sent"));
      draft.kind = null; draft.text = "";
      onClose();
    } catch (e) { toast(errorText(e), true); setBusy(false); }
  };
  const keys = (e: KeyboardEvent) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } };
  return (
    <Dialog title={t("Send feedback")} icon="help" onClose={onClose} locked={busy ? t("Sending your feedback") : undefined} footer={<>
      <Button variant="ghost" onClick={onClose} disabled={busy}>{t("Cancel")}</Button>
      <Button variant="primary" icon="upload" busy={busy} disabled={busy || !text.trim()} onClick={() => void send()} data-t="feedback-send"
        title={t("Sends it to gachamod's developer (Ctrl+Enter)")}>{t("Send")}</Button>
    </>}>
      <div className="feedback" onKeyDown={keys}>
        <Segmented label={t("What it is")} value={kind} onChange={pick} options={[
          { value: "problem", label: t("Something's wrong") }, { value: "idea", label: t("An idea") }, { value: "other", label: t("Something else") },
        ]} />
        <TextField multiline rows={6} autoFocus label={t("Message")} value={text} onChange={setText} placeholder={PLACEHOLDER[kind]} />
        <TextField label={t("How to reach you (optional)")} value={contact} onChange={setContact} placeholder={t("A Discord name or an email, if you'd like an answer")} />
        <span title={t("The end of gachamod.log and of the rendering log: what the app did, the errors it hit, your graphics card and screens. Your user folder's name is taken out first")}>
          <Checkbox checked={logs} onChange={setLogs} label={t("Attach gachamod's logs")} />
        </span>
      </div>
    </Dialog>
  );
}

// ── settings ──

// The three panels of Settings, "Feedback, privacy and logs": the form and testing, what gets sent, and the log files.

/** What gets sent and where the logs are, read once and shared by the panels that show it. */
let reportNow: ReportState | null = null;
let reportAsked = false;
const reportSubs = new Set<() => void>();
const setReport = (s: ReportState) => { reportNow = s; reportSubs.forEach((f) => f()); };
function useReport(): ReportState | null {
  useEffect(() => { if (!reportAsked) { reportAsked = true; report.state().then(setReport).catch(() => { reportAsked = false; }); } }, []);
  return useSyncExternalStore((f) => { reportSubs.add(f); return () => { reportSubs.delete(f); }; }, () => reportNow);
}

/** Feedback and testing: the form, Check this game and the tester options. */
export function FeedbackSection() {
  return (
    <Panel title={t("Feedback and testing")} icon="help" id="feedback">
      <div className="set-rows">
        <SetRow id="set-feedback" label={t("Send feedback")} hint={t("Tell the developer about a problem or an idea. It goes straight from here, no account needed")}>
          <Button size="sm" icon="help" onClick={() => openFeedback()} data-t="feedback-open" title={t("Opens a short form")}>{t("Send feedback")}</Button>
        </SetRow>
        <SetRow id="set-gamecheck" label={t("Check this game")} hint={t("Walks through switching skins while you play, one step at a time, then sends what worked. About ten minutes with the game open")}>
          <Button size="sm" icon="check" onClick={openGameCheck} data-t="gamecheck-open" title={t("Checks the game picked in the sidebar")}>{t("Check this game")}</Button>
        </SetRow>
        <TesterRow />
      </div>
    </Panel>
  );
}

const TELEMETRY_DOC = "https://github.com/imanimal/gachamod/blob/main/docs/telemetry.md";

/** Usage counts and crash reports: what gachamod sends by itself, each with a switch. */
export function PrivacySection() {
  const st = useReport();
  const set = (p: { usage?: boolean; crashes?: boolean }) => {
    report.set(p).then(setReport).catch((e) => toast(errorText(e), true));
  };
  return (
    <Panel title={t("Usage counts and crash reports")} icon="eye" id="privacy">
      <div className="set-rows">
        <SetRow id="set-usage" label={t("Usage counts")} hint={t("Sends anonymous counts of which screens and buttons get used, so the developer knows what to work on. No mod names, file paths or account details")}
          tip={t("Each count has a random id for this install, the app version, the game's short name and whether the mouse, keyboard or a controller was used. The list of counts names every one")}>
          <span className="set-admin">
            <Button size="sm" variant="ghost" icon="external" onClick={() => shell.openUrl(TELEMETRY_DOC).catch((e) => toast(errorText(e), true))}
              title={t("Opens docs/telemetry.md in gachamod's source, which lists every count")}>{t("List of counts")}</Button>
            <Toggle checked={st?.usage ?? true} disabled={!st} onChange={(v) => set({ usage: v })} />
          </span>
        </SetRow>
        <SetRow id="set-crashes" label={t("Crash reports")} hint={t("When gachamod crashes or its window goes black, sends what went wrong and the end of its log, with your user folder's name taken out")}>
          <Toggle checked={st?.crashes ?? true} disabled={!st} onChange={(v) => set({ crashes: v })} />
        </SetRow>
      </div>
    </Panel>
  );
}

/** Log files: gachamod.log's folder and the rendering log. */
export function LogsSection() {
  const st = useReport();
  return (
    <Panel title={t("Log files")} icon="file" id="logs">
      <div className="set-rows">
        <SetRow id="set-logs" label={t("Logs")} hint={t("gachamod.log lists what the app did and the errors it hit. Crash files sit next to it")}>
          <Button size="sm" icon="folder" disabled={!st?.logsDir} title={st?.logsDir ?? undefined}
            onClick={() => { if (st?.logsDir) shell.openPath(st.logsDir).catch((e) => toast(errorText(e), true)); }}>{t("Open logs folder")}</Button>
        </SetRow>
        <RenderLogRow id="set-render-log" />
        <ConsoleRow />
      </div>
    </Panel>
  );
}

function ConsoleRow() {
  const on = consolePref.use();
  return (
    <SetRow id="set-console" label={t("Developer console")} hint={t("Shift+` (the key left of 1) opens a panel with everything gachamod logs as it happens, and a line for commands. Useful when tracking down a problem")}>
      <Toggle checked={on} onChange={(v) => void consolePref.set(v, v ? t("Turned on the developer console") : t("Turned off the developer console"))} />
    </SetRow>
  );
}

const RENDER_TIP = t("Each problem gets an incident file with your graphics card, driver, screens and what the window showed. Attach gachamod's logs when you send feedback to include the newest one. If the window is black, press Win+R and open {folder}",
  { folder: String.raw`%APPDATA%\app.gachamod.desktop\logs\rendering` });

/** Settings, under Log files and under Appearance (with Hardware acceleration): the rendering log and its folder. Both copies share the setting.
 *  `id` goes on one copy, the one a route scrolls to. */
export function RenderLogRow({ id }: { id?: string }) {
  const on = renderLogPref.use();
  const [st, setSt] = useState<RenderState | null>(null);
  useEffect(() => { rendering.state().then(setSt).catch(() => {}); }, []);
  return (
    <SetRow id={id} label={t("Rendering log")} tip={RENDER_TIP} hint={t("Writes graphics errors and GPU process restarts to a log file")}>
      <span className="set-admin">
        <Button size="sm" icon="folder" disabled={!st?.dir} title={st?.dir ?? undefined}
          onClick={() => { if (st?.dir) shell.openPath(st.dir).catch((e) => toast(errorText(e), true)); }}>{t("Open folder")}</Button>
        <Toggle checked={on} ariaLabel={t("Rendering log")} onChange={(v) => void renderLogPref.set(v)} />
      </span>
    </SetRow>
  );
}

/** Tester options: the menu the game draws, in the games that don't have it already (live.rs drawn_menu_open).
 *  Switching in game with the menu over the game works in every game without them. */
function TesterRow() {
  const on = useTester();
  return (
    <SetRow id="set-tester" label={t("Tester options")}
      hint={t("Adds the skin menu the game draws itself to Wuthering Waves, Endfield and the other games. Zenless Zone Zero, Genshin Impact, Star Rail and Honkai Impact 3rd always have it. Unlike gachamod's menu over the game, it opens in exclusive fullscreen. Try it, then use Check this game above to tell the developer if it worked")}>
      <Toggle checked={on} onChange={(v) => void setTester(v)} />
    </SetRow>
  );
}

const ADMIN_TIP = t("Zenless Zone Zero and some other games run as administrator, and Windows keeps keys from programs that don't away from them. As administrator, gachamod switches skins without F10, its hotkeys work while you play and its menu opens over the game. Windows asks for permission each time gachamod starts, and dragging files in from Explorer doesn't work while it runs this way");

// the row shows on two pages (Games and mod loaders, In-game profile hotkeys), so its state is shared and both copies agree
let adminNow: AdminState | null = null;
let adminAsked = false;
const adminSubs = new Set<() => void>();
const setAdmin = (s: AdminState) => { adminNow = s; adminSubs.forEach((f) => f()); };
function useAdmin(): AdminState | null {
  useEffect(() => { if (!adminAsked) { adminAsked = true; admin.state().then(setAdmin).catch(() => { adminAsked = false; }); } }, []);
  return useSyncExternalStore((f) => { adminSubs.add(f); return () => { adminSubs.delete(f); }; }, () => adminNow);
}

/** Settings, under Launch options (Run as administrator) and In-game profile hotkeys: start as administrator every time, or once now. `id` goes on one copy,
 *  the one a route scrolls to. */
export function AdminRow({ id }: { id?: string }) {
  const st = useAdmin();
  const always = (on: boolean) => {
    // the row's own Restart as administrator button is right beside the switch, so no toast offers it again
    admin.setAlways(on).then(setAdmin).catch((e) => toast(errorText(e), true));
  };
  if (!st) return null;
  return (
    <div className="set-rows">
      <SetRow id={id} label={t("Run as administrator")} tip={ADMIN_TIP}
        hint={st.elevated ? t("gachamod runs as administrator now, so it can send keys to games that do too") : t("Lets gachamod send keys to games that run as administrator, like Zenless Zone Zero")}>
        <span className="set-admin">
          {!st.elevated && <Button size="sm" onClick={restartAsAdmin} data-t="admin-restart" title={t("Closes gachamod and opens it again as administrator. Windows asks you first")}>{t("Restart as administrator")}</Button>}
          <Toggle checked={st.always} onChange={always} label={t("Always")} />
        </span>
      </SetRow>
    </div>
  );
}
