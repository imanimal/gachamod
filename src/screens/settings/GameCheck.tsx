// Check this game (Help menu, Settings > Feedback and data): a player walks through the menu over the game while
// playing, one step at a time, and sends what worked to the developer. gachamod reads what it can by itself (the setup,
// whether it opened the menu, whether a pick from it went through) and asks about the rest. gacha-core gamecheck.rs,
// docs/testing.md. Owner: SETTINGS/AI area.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Dialog, TextField, Waiting } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { errorText, gameCheck, type CheckSetup, type CheckSteps, type GameState } from "../../lib/api";
import { closeGameCheck, useGameCheckOpen } from "../../lib/feedback";
import { restartAsAdmin } from "../../lib/elevation";
import { go, useGame } from "../../lib/store";
import { play } from "../home/PlayButton";

/** Where the check shows (once, in App). It checks the game picked in the sidebar when it opened. */
export function GameCheckHost() {
  const open = useGameCheckOpen();
  return open ? <Opened /> : null;
}

/** Closes the check and opens Tools, Menu while playing, where the menu's settings are. */
function OpenInGameTools() {
  return (
    <Button size="sm" icon="gamepad" title="Closes the check and opens Tools, Menu while playing"
      onClick={() => { closeGameCheck(); go({ view: "tools", section: "ingame" }); }}>Menu settings</Button>
  );
}

function Opened() {
  const now = useGame();
  const [game] = useState(now);
  if (!game) {
    return (
      <Dialog title="Check this game" icon="check" onClose={closeGameCheck} footer={<Button onClick={closeGameCheck}>Close</Button>}>
        <p>Pick a game in the sidebar first, then open this again.</p>
      </Dialog>
    );
  }
  return <Check game={game} onClose={closeGameCheck} />;
}

const STEPS = ["start", "menu", "menuPick", "pad", "send"] as const;
type Step = typeof STEPS[number];
const TITLES: Record<Step, string> = {
  start: "Before you start", menu: "Open the menu while you play", menuPick: "Pick a skin from the menu",
  pad: "Open the menu with a controller", send: "Send the results",
};

/** Run `job` now and every `ms` while `on`. */
function useEvery(ms: number, job: () => void, on: boolean) {
  const ref = useRef(job);
  ref.current = job;
  useEffect(() => {
    if (!on) return;
    ref.current();
    const t = window.setInterval(() => ref.current(), ms);
    return () => window.clearInterval(t);
  }, [ms, on]);
}

/** True once `ms` have passed since the component showed. */
function useAfter(ms: number) {
  const [done, setDone] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setDone(true), ms); return () => window.clearTimeout(t); }, [ms]);
  return done;
}

function Check({ game, onClose }: { game: GameState; onClose: () => void }) {
  const [at, setAt] = useState<Step>("start");
  const [steps, setSteps] = useState<CheckSteps>({ check_version: 2 });
  const [setup, setSetup] = useState<CheckSetup | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const note = (patch: CheckSteps) => setSteps((s) => ({ ...s, ...patch }));
  const i = STEPS.indexOf(at);
  const next = () => setAt(STEPS[Math.min(i + 1, STEPS.length - 1)]!);
  const back = () => setAt(STEPS[Math.max(i - 1, 0)]!);
  const answer = (key: string, value: string, extra: CheckSteps = {}) => { note({ ...extra, [key]: value }); next(); };

  useEvery(3000, () => { gameCheck.setup(game.id).then((s) => { setSetup(s); setFailed(null); }, (e) => setFailed(errorText(e))); }, at === "start" || at === "send");

  const name = setup?.name ?? game.name;
  const ready = !!setup?.running && setup.menuStyle !== "off";

  const body = (): ReactNode => {
    if (!setup) return failed ? <p className="bad">{failed}</p> : <Waiting what={`Reading ${game.name}'s setup`} />;
    switch (at) {
      case "start": return <Start setup={setup} game={game} />;
      case "menu": return <MenuStep key="menu" setup={setup} answer={answer} />;
      case "menuPick": return <MenuPickStep key="menuPick" setup={setup} answer={answer} />;
      case "pad": return <PadStep key="pad" setup={setup} answer={answer} />;
      case "send": return null;
    }
  };

  const [notes, setNotes] = useState("");
  const [contact, setContact] = useState("");
  const [logs, setLogs] = useState(true);
  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      await gameCheck.send({ game: game.id, steps, notes: notes.trim() || undefined, contact: contact.trim() || undefined, logs });
      toast("Thanks. The results were sent");
      onClose();
    } catch (e) { toast(errorText(e), true); setSending(false); }
  };

  const skip = <Button variant="ghost" onClick={() => answer(`${STEP_KEY[at]}`, "skip")} title="Leave this one out and go on">Skip this step</Button>;
  const footer = at === "start" ? <>
    <Button variant="ghost" onClick={onClose}>Cancel</Button>
    <Button variant="ghost" onClick={() => setAt("send")} disabled={!setup} title="Skip the steps and send only what gachamod read about the game">Send what was found</Button>
    <Button variant="primary" icon="play" onClick={next} disabled={!ready} data-t="gamecheck-start"
      title={ready ? "Goes through the steps one at a time" : !setup?.running ? `Start ${name} first` : "Turn the menu while playing on first"}>Start the check</Button>
  </> : at === "send" ? <>
    <Button variant="ghost" onClick={back} disabled={sending}>Back</Button>
    <Button variant="primary" icon="upload" busy={sending} disabled={sending || !setup} onClick={() => void send()} data-t="gamecheck-send"
      title="Sends the answers and what gachamod read to gachamod's developer">Send</Button>
  </> : <>
    <Button variant="ghost" onClick={back}>Back</Button>
    {skip}
  </>;

  return (
    <Dialog title={`Check ${name}`} icon="check" size="lg" onClose={onClose} locked={sending ? "Sending the results" : undefined} footer={footer}>
      <div className="check">
        <p className="hint check-at">{at === "start" || at === "send" ? TITLES[at] : `Step ${i} of ${STEPS.length - 2}: ${TITLES[at]}`}</p>
        {at === "send" ? (
          <SendStep steps={steps} setup={setup} notes={notes} setNotes={setNotes} contact={contact} setContact={setContact} logs={logs} setLogs={setLogs} />
        ) : body()}
      </div>
    </Dialog>
  );
}

/** The key each step's answer goes under (also for Skip). */
const STEP_KEY: Record<Step, string> = { start: "start", menu: "menu_opened", menuPick: "menu_pick_changed", pad: "pad_opened", send: "send" };

// ── the steps ──

function Facts({ setup }: { setup: CheckSetup }) {
  const keys = setup.foregroundCheck === "0" ? "Read" : setup.foregroundCheck === "1" ? "Ignored" : "Not set";
  const rows: Array<[string, string, string?]> = [
    ["Loader", `${setup.importer}${setup.loaderVersion ? ` ${setup.loaderVersion}` : ""}${setup.viaXxmi ? " through XXMI Launcher" : ""}`],
    [setup.name, !setup.running ? "Not running" : setup.gameAdmin ? "Running as administrator" : "Running"],
    ["gachamod", setup.appAdmin ? "Running as administrator" : "Not running as administrator"],
    ["Keys while the game isn't in front", keys, "d3dx.ini check_foreground_window. Ignored means the loader only reads keys while the game is the window in front"],
    ["Window", setup.windowMode ?? "Not known", "XXMI Launcher's window mode for this game"],
    ["Menu while playing", setup.menuStyle === "off" ? "Off" : `On, ${setup.menuKey}${setup.menuPad ? " or both sticks" : ""}`],
  ];
  return (
    <dl className="check-facts">
      {rows.map(([k, v, tip]) => <div key={k} title={tip}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

function Start({ setup, game }: { setup: CheckSetup; game: GameState }) {
  return <>
    <p>This goes through the menu over {setup.name} while you play, then sends what worked to gachamod's developer.
      It takes about five minutes, and every step can be skipped.</p>
    <Facts setup={setup} />
    {!setup.running && (
      <div className="check-need">
        <Icon name="play" /><span>Start {setup.name} with mods. gachamod notices when it's running.</span>
        <Button size="sm" variant="primary" icon="play" onClick={() => void play(game)} title={`Starts ${setup.name} the way the Play button does`}>Start {setup.name}</Button>
      </div>
    )}
    {setup.menuStyle === "off" && (
      <div className="check-need">
        <Icon name="gamepad" /><span>The menu while playing is off for {setup.name}. Turn it on to check it.</span>
        <OpenInGameTools />
      </div>
    )}
    {setup.running && setup.gameAdmin && !setup.appAdmin && (
      <div className="check-need">
        <Icon name="warn" /><span>{setup.name} runs as administrator and gachamod doesn't, so Windows keeps the menu key away from gachamod. That's worth checking too.
          Restart gachamod as administrator first if you'd rather check that way.</span>
        <Button size="sm" onClick={restartAsAdmin} title="Closes gachamod and opens it again as administrator. Windows asks you first. Start the check again after">Restart as administrator</Button>
      </div>
    )}
  </>;
}

/** A question and its answers; the chosen one stays marked when you come back to it. */
function Ask({ question, answers, chosen, onAnswer }: { question: string; answers: Array<[string, string, string?]>; chosen?: string | number | boolean; onAnswer: (v: string) => void }) {
  return (
    <div className="check-ask" role="group" aria-label={question}>
      <span className="check-q">{question}</span>
      {answers.map(([v, label, tip]) => (
        <Button key={v} variant={chosen === v ? "primary" : "secondary"} onClick={() => onAnswer(v)} title={tip}>{label}</Button>
      ))}
    </div>
  );
}

const YES_NO: Array<[string, string]> = [["yes", "Yes"], ["no", "No"]];

/** What gachamod saw by itself, next to the player's answer. */
function Seen({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <p className={`check-seen${ok ? " ok" : ""}`}><Icon name={ok ? "check" : "info"} /><span>{children}</span></p>;
}

type Answer = (key: string, value: string, extra?: CheckSteps) => void;

function MenuStep({ setup, answer }: { setup: CheckSetup; answer: Answer }) {
  const [since] = useState(Date.now);
  const [heard, setHeard] = useState<string | null>(null);
  useEvery(1000, () => { gameCheck.menu(setup.game, since).then((h) => { if (h) setHeard(h); }, () => {}); }, !heard);
  return <>
    <p>In the game, press <kbd className="kbd">{setup.menuKey}</kbd>.</p>
    {heard === "fullscreen" ? <Seen ok={false}>gachamod heard the key, but {setup.name} runs in exclusive fullscreen, so nothing can show over it.</Seen>
      : heard ? <Seen ok>gachamod heard the key and opened its menu over the game.</Seen>
      : <Seen ok={false}>gachamod hasn't heard the key yet.</Seen>}
    <Ask question="Did gachamod's menu open over the game?" answers={YES_NO} onAnswer={(v) => answer("menu_opened", v, { menu_heard: heard ?? "none" })} />
  </>;
}

function MenuPickStep({ setup, answer }: { setup: CheckSetup; answer: Answer }) {
  const [since] = useState(Date.now);
  const [picked, setPicked] = useState(false);
  const late = useAfter(90_000);
  useEvery(1000, () => { gameCheck.menu(setup.game, since).then((h) => { if (h === "picked") setPicked(true); }, () => {}); }, !picked && !late);
  return <>
    <p>In the menu, pick another skin for a character. The menu closes and {setup.name} reloads its mods, which can take a few seconds.</p>
    {picked ? <Seen ok>gachamod turned the skin on. The game reloads as it comes back to the front.</Seen>
      : late ? <Seen ok={false}>gachamod hasn't seen a pick from the menu.</Seen>
      : <Waiting what="Waiting for a pick from the menu" hold="Open the menu in the game and pick a skin. If the menu didn't open, skip this step." />}
    <Ask question="Did the look change after the reload?" answers={YES_NO} onAnswer={(v) => answer("menu_pick_changed", v, { menu_pick_seen: picked })} />
  </>;
}

function PadStep({ setup, answer }: { setup: CheckSetup; answer: Answer }) {
  const [since] = useState(Date.now);
  const [heard, setHeard] = useState(false);
  const on = setup.menuPad && setup.menuStyle !== "off";
  useEvery(1000, () => { gameCheck.menu(setup.game, since).then((h) => { if (h) setHeard(true); }, () => {}); }, on && !heard);
  if (!on) return <>
    <p>Opening the menu with a controller is off for {setup.name}. Turn on "Pressing both sticks in opens it too" in Tools, Menu while playing, or skip this step.</p>
    <OpenInGameTools />
  </>;
  return <>
    <p>With a controller, press both sticks in while you play.</p>
    {heard && <Seen ok>gachamod saw both sticks pressed and opened the menu.</Seen>}
    <Ask question="Did the menu open?" onAnswer={(v) => answer("pad_opened", v, { pad_heard: heard })} answers={[...YES_NO, ["no controller", "No controller here"]]} />
  </>;
}

const ANSWER_TEXT: Record<string, string> = {
  yes: "Yes", no: "No", skip: "Skipped", "no controller": "No controller",
};
const SUMMARY: Array<[string, string]> = [
  ["menu_opened", "The menu key opened the menu"],
  ["menu_pick_changed", "A pick from the menu changed the look"],
  ["pad_opened", "Both sticks opened the menu"],
];

function SendStep({ steps, setup, notes, setNotes, contact, setContact, logs, setLogs }:
  { steps: CheckSteps; setup: CheckSetup | null; notes: string; setNotes: (v: string) => void; contact: string; setContact: (v: string) => void; logs: boolean; setLogs: (v: boolean) => void }) {
  const answered = SUMMARY.filter(([k]) => steps[k] !== undefined);
  return <>
    {answered.length > 0 && (
      <dl className="check-facts">
        {answered.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{ANSWER_TEXT[String(steps[k])] ?? String(steps[k])}</dd></div>)}
      </dl>
    )}
    <TextField multiline rows={4} label="Anything else" value={notes} onChange={setNotes}
      placeholder="For example: the menu showed on the other screen, or the game didn't reload after a pick." />
    <TextField label="How to reach you (optional)" value={contact} onChange={setContact} placeholder="A Discord name or an email, if you'd like an answer" />
    <span title="d3d11_log.txt from the loader's folder and the end of gachamod.log. They name the mods the loader read. Your user folder's name is taken out first">
      <Checkbox checked={logs} onChange={setLogs} label="Attach the loader's log and gachamod's log" />
    </span>
    <p className="hint">Along with your answers goes what gachamod read about {setup?.name ?? "the game"}: the loader and its version, the window
      mode, whether the game and gachamod run as administrator, and the menu's key.</p>
  </>;
}
