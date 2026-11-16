// Check this game (Help menu, Settings > Feedback, privacy and logs): a player walks through switching skins while playing, one
// step at a time, and sends what worked to the developer. gachamod reads what it can by itself (the setup, whether the
// game saved a pick, whether gachamod opened the menu) and asks about the rest. gacha-core gamecheck.rs,
// docs/testing.md. Owner: SETTINGS/AI area.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Dialog, Select, TextField, Waiting } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { errorText, fileUrl, gameCheck, live, type CheckSetup, type CheckSteps, type GameState, type LiveGroup, type LiveInfo } from "../../lib/api";
import { closeGameCheck, useGameCheckOpen } from "../../lib/feedback";
import { restartAsAdmin } from "../../lib/elevation";
import { emitApp, go, useGame } from "../../lib/store";
import { reloadLive, setAll, setTester, useLive } from "../ingame/data";
import { play } from "../home/PlayButton";
import "../ingame/ingame.css";
import { LazyImg } from "../../ui/LazyImg";

/** Where the check shows (once, in App). It checks the game picked in the sidebar when it opened. */
export function GameCheckHost() {
  const open = useGameCheckOpen();
  return open ? <Opened /> : null;
}

/** Closes the check and opens Tools, Switch skins in game, where the menu's settings are. */
function OpenInGameTools() {
  return (
    <Button size="sm" icon="swap" title="Closes the check and opens Tools, Switch skins in game"
      onClick={() => { closeGameCheck(); go({ view: "tools", section: "ingame" }); }}>Switch skins in game</Button>
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

const STEPS = ["start", "pick", "menu", "menuPick", "reload", "pad", "send"] as const;
type Step = typeof STEPS[number];
const TITLES: Record<Step, string> = {
  start: "Before you start", pick: "Pick a skin from gachamod", menu: "Open the menu while you play", menuPick: "Pick a skin from the menu",
  reload: "Reload the game's mods", pad: "Open the menu with a controller", send: "Send the results",
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
  const [steps, setSteps] = useState<CheckSteps>({ check_version: 1 });
  const [setup, setSetup] = useState<CheckSetup | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [groupN, setGroupN] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const info = useLive(game.id);
  const note = (patch: CheckSteps) => setSteps((s) => ({ ...s, ...patch }));
  const i = STEPS.indexOf(at);
  const next = () => setAt(STEPS[Math.min(i + 1, STEPS.length - 1)]!);
  const back = () => setAt(STEPS[Math.max(i - 1, 0)]!);
  const answer = (key: string, value: string, extra: CheckSteps = {}) => { note({ ...extra, [key]: value }); next(); };

  useEvery(3000, () => { gameCheck.setup(game.id).then((s) => { setSetup(s); setFailed(null); }, (e) => setFailed(errorText(e))); }, at === "start" || at === "send");

  const groups = (info?.groups ?? []).filter((g) => g.mods.length >= 2);
  const group = groups.find((g) => g.group === groupN) ?? [...groups].sort((a, b) => b.mods.length - a.mods.length)[0] ?? null;
  const name = setup?.name ?? game.name;
  const ready = !!setup?.running && !!group;

  const body = (): ReactNode => {
    if (!setup) return failed ? <p className="bad">{failed}</p> : <Waiting what={`Reading ${game.name}'s setup`} />;
    switch (at) {
      case "start": return <Start setup={setup} info={info} hasGroup={!!group} game={game} />;
      case "pick": return group ? <PickStep key="pick" game={game} setup={setup} group={group} groups={groups} onGroup={setGroupN} note={note} answer={answer} />
        : <p>No character switches in game, so there's nothing to pick. Skip this step.</p>;
      case "menu": return <MenuStep key="menu" setup={setup} answer={answer} />;
      case "menuPick": return <MenuPickStep key="menuPick" game={game} info={info} answer={answer} />;
      case "reload": return <ReloadStep setup={setup} answer={answer} chosen={steps.reload_kept} />;
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
      title={ready ? "Goes through the steps one at a time" : !setup?.running ? `Start ${name} first` : "A character has to switch in game first"}>Start the check</Button>
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
      <div className="check-game">
        <p className="hint check-at">{at === "start" || at === "send" ? TITLES[at] : `Step ${i} of ${STEPS.length - 2}: ${TITLES[at]}`}</p>
        {at === "send" ? (
          <SendStep steps={steps} setup={setup} notes={notes} setNotes={setNotes} contact={contact} setContact={setContact} logs={logs} setLogs={setLogs} />
        ) : body()}
      </div>
    </Dialog>
  );
}

/** The key each step's answer goes under (also for Skip). */
const STEP_KEY: Record<Step, string> = { start: "start", pick: "pick_changed", menu: "menu_opened", menuPick: "menu_pick_changed", reload: "reload_kept", pad: "pad_opened", send: "send" };

// ── the steps ──

function Facts({ setup }: { setup: CheckSetup }) {
  const keys = setup.foregroundCheck === "0" ? "Read" : setup.foregroundCheck === "1" ? "Ignored" : "Not set";
  const rows: Array<[string, string, string?]> = [
    ["Loader", `${setup.importer}${setup.loaderVersion ? ` ${setup.loaderVersion}` : ""}${setup.viaXxmi ? " through XXMI Launcher" : ""}`],
    [setup.name, !setup.running ? "Not running" : setup.gameAdmin ? "Running as administrator" : "Running"],
    ["gachamod", setup.appAdmin ? "Running as administrator" : "Not running as administrator"],
    ["Keys while the game isn't in front", keys, "d3dx.ini check_foreground_window. Ignored means the loader only reads keys while the game is the window in front"],
    ["Window", setup.windowMode ?? "Not known", "XXMI Launcher's window mode for this game"],
    ["Characters that switch in game", String(setup.liveGroups)],
  ];
  return (
    <dl className="check-facts">
      {rows.map(([k, v, tip]) => <div key={k} title={tip}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

function Start({ setup, info, hasGroup, game }: { setup: CheckSetup; info: LiveInfo | null; hasGroup: boolean; game: GameState }) {
  const [busy, setBusy] = useState(false);
  // checking a game other than Zenless Zone Zero is testing it: the button turns tester options on first
  const every = async () => { setBusy(true); try { if (info && !info.allowed) await setTester(true); await setAll(game.id, true); } finally { setBusy(false); } };
  return <>
    <p>This goes through switching skins in {setup.name} while you play, then sends what worked to gachamod's developer.
      It takes about ten minutes, and every step can be skipped.</p>
    <Facts setup={setup} />
    {!setup.running && (
      <div className="check-need">
        <Icon name="play" /><span>Start {setup.name} with mods. gachamod notices when it's running.</span>
        <Button size="sm" variant="primary" icon="play" onClick={() => void play(game)} title={`Starts ${setup.name} the way the Play button does`}>Start {setup.name}</Button>
      </div>
    )}
    {!hasGroup && info && (info.ready.length > 0 ? (
      <div className="check-need">
        <Icon name="swap" /><span>No character switches in game yet. This keeps every character's skins loaded, so any one shows at once. Undo takes it back.</span>
        <Button size="sm" variant="primary" icon="swap" busy={busy} disabled={busy} onClick={() => void every()}
          title="The same as the switch in Tools, Switch skins in game. The game reloads once to start it">Switch every character in game</Button>
      </div>
    ) : (
      <div className="check-need">
        <Icon name="info" /><span>The steps need a character with two or more mods. You can still send what gachamod read.</span>
      </div>
    ))}
    {setup.running && setup.gameAdmin && !setup.appAdmin && (
      <div className="check-need">
        <Icon name="warn" /><span>{setup.name} runs as administrator and gachamod doesn't, so Windows keeps gachamod's keys away from it. That's worth checking too.
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

function PickStep({ game, setup, group, groups, onGroup, note, answer }:
  { game: GameState; setup: CheckSetup; group: LiveGroup; groups: LiveGroup[]; onGroup: (n: number) => void; note: (p: CheckSteps) => void; answer: Answer }) {
  const [picked, setPicked] = useState<{ slot: number; at: number; send: boolean } | null>(null);
  const [saved, setSaved] = useState<"wait" | "yes" | "no" | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (slot: number) => {
    setBusy(true);
    const at = Date.now();
    try {
      const p = await live.pick(game.id, group.group, slot);
      emitApp({ type: "library-refresh", game: game.id });
      void reloadLive(game.id);
      setPicked({ slot, at, send: p.send });
      setSaved("wait");
      note({ pick_sent: p.send, pick_reload: p.reload });
    } catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };
  useEvery(2000, () => {
    if (!picked) return;
    gameCheck.saved(game.id, group.group).then((s) => {
      if (s.value === picked.slot && (s.savedAt ?? 0) > picked.at) setSaved("yes");
      else if (Date.now() - picked.at > 45_000) setSaved("no");
    }, () => {});
  }, saved === "wait");
  const done = (v: string) => answer("pick_changed", v, { pick_saved: saved === "yes" ? "yes" : saved === "no" ? "no" : picked ? "not seen" : "no pick" });
  return <>
    <p>Get in game where {group.character} shows, then pick a skin below. gachamod brings {setup.name} to the front and switches it.</p>
    {groups.length > 1 && (
      <Select label="Character" value={String(group.group)} onChange={(v) => { onGroup(Number(v)); setPicked(null); setSaved(null); }}
        options={groups.map((g) => ({ value: String(g.group), label: `${g.character} (${g.mods.length} skins)` }))} />
    )}
    <div className="live-chips" role="radiogroup" aria-label={`${group.character}'s skin`}>
      {group.mods.map((m) => {
        const src = fileUrl(m.preview);
        const on = group.active === m.slot;
        return (
          <button key={m.modId} type="button" role="radio" aria-checked={on} className={`live-chip${on ? " on" : ""}`} disabled={busy || on} onClick={() => void pick(m.slot)}
            title={on ? `${m.name} is showing` : `Show ${m.name}`}>
            <span className="live-thumb">{src ? <LazyImg src={src} alt="" draggable={false} /> : <Icon name="mods" />}</span>
            <span className="live-chip-t">{m.name}</span>
            {on && <Icon name="check" className="live-chip-on" />}
          </button>
        );
      })}
    </div>
    {picked && !picked.send && setup.running && (
      <Seen ok={false}>gachamod couldn't press keys in {setup.name}, so press F10 in the game to load the pick.</Seen>
    )}
    {saved === "wait" && <Waiting what={`Waiting for ${setup.name} to save the pick`} hold="The loader saves picks to d3dx_user.ini 5 to 15 seconds after they change. If the skin didn't change, there's nothing for it to save." />}
    {saved === "yes" && <Seen ok>{setup.name} saved the pick, so the game took it.</Seen>}
    {saved === "no" && <Seen ok={false}>{setup.name} didn't save the pick within 45 seconds.</Seen>}
    {picked && <Ask question={`Did ${group.character}'s look change in the game?`} answers={YES_NO} onAnswer={done} />}
  </>;
}

function MenuStep({ setup, answer }: { setup: CheckSetup; answer: Answer }) {
  const [since] = useState(Date.now);
  const [heard, setHeard] = useState<string | null>(null);
  const off = setup.menuStyle === "off";
  useEvery(1000, () => { gameCheck.menu(setup.game, since).then((h) => { if (h) setHeard(h); }, () => {}); }, !heard && !off);
  if (off) {
    return <>
      <p>The menu while you play is off for {setup.name}. Turn it on in Tools, Switch skins in game, or skip this step.</p>
      <OpenInGameTools />
    </>;
  }
  return <>
    <p>In the game, press <kbd className="kbd">{setup.menuKey}</kbd>.</p>
    {heard ? <Seen ok>gachamod heard the key and opened {heard === "window" ? "its menu over the game" : "the menu the game draws, since the game runs in exclusive fullscreen"}.</Seen>
      : <Seen ok={false}>{setup.menuStyle === "game" ? "The game takes this key itself, so gachamod doesn't see it." : "gachamod hasn't heard the key yet."}</Seen>}
    <Ask question="What opened?" onAnswer={(v) => answer("menu_opened", v, { menu_heard: heard ?? "none" })} answers={[
      ["window", "gachamod's menu over the game", "A window with previews and search on top of the game"],
      ["drawn", "A menu drawn in the game", "A plainer list the game draws itself"],
      ["nothing", "Nothing"],
    ]} />
  </>;
}

function MenuPickStep({ game, info, answer }: { game: GameState; info: LiveInfo | null; answer: Answer }) {
  const [before] = useState(() => new Map((info?.groups ?? []).map((g) => [g.group, g.active])));
  const late = useAfter(60_000);
  const changed = info?.groups.find((g) => before.has(g.group) && before.get(g.group) !== g.active);
  useEvery(2000, () => { void reloadLive(game.id); }, !changed && !late);
  const shows = changed ? (changed.mods.find((m) => m.slot === changed.active)?.name ?? "none of its skins") : "";
  return <>
    <p>In the menu, pick a different skin for a character, then close the menu.</p>
    {changed ? <Seen ok>gachamod read the pick back from the game: {changed.character} wears {shows}.</Seen>
      : late ? <Seen ok={false}>gachamod hasn't read a pick back from the game in a minute.</Seen>
      : <Waiting what={`Waiting for ${game.name} to save the pick`} hold="The loader saves picks 5 to 15 seconds after they change, and gachamod reads them back from there." />}
    <Ask question="Did the look change in the game?" answers={YES_NO} onAnswer={(v) => answer("menu_pick_changed", v, { menu_pick_read: changed ? "yes" : late ? "no" : "not seen" })} />
  </>;
}

function ReloadStep({ setup, answer, chosen }: { setup: CheckSetup; answer: Answer; chosen?: string | number | boolean }) {
  const key = setup.reloadKey?.match(/VK_(\w+)/i)?.[1]?.toUpperCase() ?? "F10";
  return <>
    <p>In the game, press <kbd className="kbd">{key}</kbd> to reload its mods. Wait for the game to catch up (it can stutter for a moment).</p>
    <Ask question="Does each character still wear the skin picked last?" answers={YES_NO} chosen={chosen} onAnswer={(v) => answer("reload_kept", v)} />
  </>;
}

function PadStep({ setup, answer }: { setup: CheckSetup; answer: Answer }) {
  const [since] = useState(Date.now);
  const [heard, setHeard] = useState(false);
  const on = setup.menuPad && setup.menuStyle !== "off";
  useEvery(1000, () => { gameCheck.menu(setup.game, since).then((h) => { if (h) setHeard(true); }, () => {}); }, on && !heard);
  if (!on) return <>
    <p>Opening the menu with a controller is off for {setup.name}. Turn on "Pressing both sticks in opens it too" in Tools, Switch skins in game, or skip this step.</p>
    <OpenInGameTools />
  </>;
  return <>
    <p>With a controller, press both sticks in while you play.</p>
    {heard && <Seen ok>gachamod saw both sticks pressed and opened the menu.</Seen>}
    <Ask question="Did the menu open?" onAnswer={(v) => answer("pad_opened", v, { pad_heard: heard })} answers={[...YES_NO, ["no controller", "No controller here"]]} />
  </>;
}

const ANSWER_TEXT: Record<string, string> = {
  yes: "Yes", no: "No", skip: "Skipped", window: "gachamod's menu over the game", drawn: "A menu drawn in the game", nothing: "Nothing", "no controller": "No controller",
};
const SUMMARY: Array<[string, string]> = [
  ["pick_changed", "A pick from gachamod changed the skin"],
  ["menu_opened", "The menu key opened"],
  ["menu_pick_changed", "A pick from the menu changed the skin"],
  ["reload_kept", "Skins stayed after a reload"],
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
      placeholder="For example: the menu showed on the other screen, or a skin needed two picks to change." />
    <TextField label="How to reach you (optional)" value={contact} onChange={setContact} placeholder="A Discord name or an email, if you'd like an answer" />
    <span title="d3d11_log.txt from the loader's folder and the end of gachamod.log. They name the mods the loader read. Your user folder's name is taken out first">
      <Checkbox checked={logs} onChange={setLogs} label="Attach the loader's log and gachamod's log" />
    </span>
    <p className="hint">Along with your answers goes what gachamod read about {setup?.name ?? "the game"}: the loader and its version, the window
      mode, whether the game and gachamod run as administrator, and the menu's key.</p>
  </>;
}
