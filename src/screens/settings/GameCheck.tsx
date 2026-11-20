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
import { t, tb, tn, tx } from "../../lib/i18n";
import { gameName } from "../../lib/games";

/** Where the check shows (once, in App). It checks the game picked in the sidebar when it opened. */
export function GameCheckHost() {
  const open = useGameCheckOpen();
  return open ? <Opened /> : null;
}

/** Closes the check and opens Tools, Switch skins in game, where the menu's settings are. */
function OpenInGameTools() {
  return (
    <Button size="sm" icon="swap" title={t("Closes the check and opens Tools, Switch skins in game")}
      onClick={() => { closeGameCheck(); go({ view: "tools", section: "ingame" }); }}>{t("Switch skins in game")}</Button>
  );
}

function Opened() {
  const now = useGame();
  const [game] = useState(now);
  if (!game) {
    return (
      <Dialog title={t("Check this game")} icon="check" onClose={closeGameCheck} footer={<Button onClick={closeGameCheck}>{t("Close")}</Button>}>
        <p>{t("Pick a game in the sidebar first, then open this again.")}</p>
      </Dialog>
    );
  }
  return <Check game={game} onClose={closeGameCheck} />;
}

const STEPS = ["start", "pick", "menu", "menuPick", "reload", "pad", "send"] as const;
type Step = typeof STEPS[number];
const TITLES: Record<Step, string> = {
  start: t("Before you start"), pick: t("Pick a skin from gachamod"), menu: t("Open the menu while you play"), menuPick: t("Pick a skin from the menu"),
  reload: t("Reload the game's mods"), pad: t("Open the menu with a controller"), send: t("Send the results"),
};

/** Run `job` now and every `ms` while `on`. */
function useEvery(ms: number, job: () => void, on: boolean) {
  const ref = useRef(job);
  ref.current = job;
  useEffect(() => {
    if (!on) return;
    ref.current();
    const timer = window.setInterval(() => ref.current(), ms);
    return () => window.clearInterval(timer);
  }, [ms, on]);
}

/** True once `ms` have passed since the component showed. */
function useAfter(ms: number) {
  const [done, setDone] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setDone(true), ms); return () => window.clearTimeout(timer); }, [ms]);
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
  const name = gameName(setup ?? game);
  const ready = !!setup?.running && !!group;

  const body = (): ReactNode => {
    if (!setup) return failed ? <p className="bad">{failed}</p> : <Waiting what={t("Reading {game}'s setup", { game: gameName(game) })} />;
    switch (at) {
      case "start": return <Start setup={setup} info={info} hasGroup={!!group} game={game} />;
      case "pick": return group ? <PickStep key="pick" game={game} setup={setup} group={group} groups={groups} onGroup={setGroupN} note={note} answer={answer} />
        : <p>{t("No character switches in game, so there's nothing to pick. Skip this step.")}</p>;
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
      toast(t("Thanks. The results were sent"));
      onClose();
    } catch (e) { toast(errorText(e), true); setSending(false); }
  };

  const skip = <Button variant="ghost" onClick={() => answer(`${STEP_KEY[at]}`, "skip")} title={t("Leave this one out and go on")}>{t("Skip this step")}</Button>;
  const footer = at === "start" ? <>
    <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
    <Button variant="ghost" onClick={() => setAt("send")} disabled={!setup} title={t("Skip the steps and send only what gachamod read about the game")}>{t("Send what was found")}</Button>
    <Button variant="primary" icon="play" onClick={next} disabled={!ready} data-t="gamecheck-start"
      title={ready ? t("Goes through the steps one at a time") : !setup?.running ? t("Start {game} first", { game: name }) : t("A character has to switch in game first")}>{t("Start the check")}</Button>
  </> : at === "send" ? <>
    <Button variant="ghost" onClick={back} disabled={sending}>{t("Back")}</Button>
    <Button variant="primary" icon="upload" busy={sending} disabled={sending || !setup} onClick={() => void send()} data-t="gamecheck-send"
      title={t("Sends the answers and what gachamod read to gachamod's developer")}>{t("Send")}</Button>
  </> : <>
    <Button variant="ghost" onClick={back}>{t("Back")}</Button>
    {skip}
  </>;

  return (
    <Dialog title={t("Check {game}", { game: name })} icon="check" size="lg" onClose={onClose} locked={sending ? t("Sending the results") : undefined} footer={footer}>
      <div className="check-game">
        <p className="hint check-at">{at === "start" || at === "send" ? TITLES[at] : t("Step {step} of {steps}: {title}", { step: i, steps: STEPS.length - 2, title: TITLES[at] })}</p>
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
  const keys = setup.foregroundCheck === "0" ? t("Read") : setup.foregroundCheck === "1" ? t("Ignored") : t("Not set");
  const loader = setup.loaderVersion ? `${setup.importer} ${setup.loaderVersion}` : setup.importer;
  const rows: Array<[string, string, string?]> = [
    [t("Loader"), setup.viaXxmi ? t("{loader} through XXMI Launcher", { loader }) : loader],
    [gameName(setup), !setup.running ? t("Not running") : setup.gameAdmin ? t("Running as administrator") : t("Running")],
    ["gachamod", setup.appAdmin ? t("Running as administrator") : t("Not running as administrator")],
    [t("Keys while the game isn't in front"), keys, t("d3dx.ini check_foreground_window. Ignored means the loader only reads keys while the game is the window in front")],
    [t("Window"), setup.windowMode ? tb(setup.windowMode) : t("Not known"), t("XXMI Launcher's window mode for this game")],
    [t("Characters that switch in game"), String(setup.liveGroups)],
  ];
  return (
    <dl className="check-facts">
      {rows.map(([k, v, tip]) => <div key={k} title={tip}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

function Start({ setup, info, hasGroup, game }: { setup: CheckSetup; info: LiveInfo | null; hasGroup: boolean; game: GameState }) {
  const [busy, setBusy] = useState(false);
  const name = gameName(setup);
  // checking a game where the drawn menu is a tester option is testing it: the button turns tester options on first
  const every = async () => {
    setBusy(true);
    try { if (info && !info.allowed && !(await setTester(true))) return; await setAll(game.id, true); } finally { setBusy(false); }
  };
  return <>
    <p>{t("This goes through switching skins in {game} while you play, then sends what worked to gachamod's developer. It takes about ten minutes, and every step can be skipped.", { game: name })}</p>
    <Facts setup={setup} />
    {!setup.running && (
      <div className="check-need">
        <Icon name="play" /><span>{t("Start {game} with mods. gachamod notices when it's running.", { game: name })}</span>
        <Button size="sm" variant="primary" icon="play" onClick={() => void play(game)} title={t("Starts {game} the way the Play button does", { game: name })}>{t("Start {game}", { game: name })}</Button>
      </div>
    )}
    {!hasGroup && info && (info.ready.length > 0 ? (
      <div className="check-need">
        <Icon name="swap" /><span>{t("No character switches in game yet. This keeps every character's skins loaded, so any one shows at once. Undo takes it back.")}</span>
        <Button size="sm" variant="primary" icon="swap" busy={busy} disabled={busy} onClick={() => void every()}
          title={t("The same as the switch in Tools, Switch skins in game. The game reloads once to start it")}>{t("Switch every character in game")}</Button>
      </div>
    ) : (
      <div className="check-need">
        <Icon name="info" /><span>{t("The steps need a character with two or more mods. You can still send what gachamod read.")}</span>
      </div>
    ))}
    {setup.running && setup.gameAdmin && !setup.appAdmin && (
      <div className="check-need">
        <Icon name="warn" /><span>{t("{game} runs as administrator and gachamod doesn't, so Windows keeps gachamod's keys away from it. That's worth checking too. Restart gachamod as administrator first if you'd rather check that way.", { game: name })}</span>
        <Button size="sm" onClick={restartAsAdmin} title={t("Closes gachamod and opens it again as administrator. Windows asks you first. Start the check again after")}>{t("Restart as administrator")}</Button>
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

const YES_NO: Array<[string, string]> = [["yes", t("Yes")], ["no", t("No")]];

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
  const name = gameName(setup);
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
    <p>{t("Get in game where {character} shows, then pick a skin below. gachamod brings {game} to the front and switches it.", { character: group.character, game: name })}</p>
    {groups.length > 1 && (
      <Select label={t("Character")} value={String(group.group)} onChange={(v) => { onGroup(Number(v)); setPicked(null); setSaved(null); }}
        options={groups.map((g) => ({ value: String(g.group), label: tn(g.mods.length, "{character} ({n} skin)", "{character} ({n} skins)", { character: g.character }) }))} />
    )}
    <div className="live-chips" role="radiogroup" aria-label={t("{character}'s skin", { character: group.character })}>
      {group.mods.map((m) => {
        const src = fileUrl(m.preview);
        const on = group.active === m.slot;
        return (
          <button key={m.modId} type="button" role="radio" aria-checked={on} className={`live-chip${on ? " on" : ""}`} disabled={busy || on} onClick={() => void pick(m.slot)}
            title={on ? t("{mod} is showing", { mod: m.name }) : t("Show {mod}", { mod: m.name })}>
            <span className="live-thumb">{src ? <LazyImg src={src} alt="" draggable={false} /> : <Icon name="mods" />}</span>
            <span className="live-chip-t">{m.name}</span>
            {on && <Icon name="check" className="live-chip-on" />}
          </button>
        );
      })}
    </div>
    {picked && !picked.send && setup.running && (
      <Seen ok={false}>{t("gachamod couldn't press keys in {game}, so press F10 in the game to load the pick.", { game: name })}</Seen>
    )}
    {saved === "wait" && <Waiting what={t("Waiting for {game} to save the pick", { game: name })} hold={t("The loader saves picks to d3dx_user.ini 5 to 15 seconds after they change. If the skin didn't change, there's nothing for it to save.")} />}
    {saved === "yes" && <Seen ok>{t("{game} saved the pick, so the game took it.", { game: name })}</Seen>}
    {saved === "no" && <Seen ok={false}>{t("{game} didn't save the pick within 45 seconds.", { game: name })}</Seen>}
    {picked && <Ask question={t("Did {character}'s look change in the game?", { character: group.character })} answers={YES_NO} onAnswer={done} />}
  </>;
}

function MenuStep({ setup, answer }: { setup: CheckSetup; answer: Answer }) {
  const [since] = useState(Date.now);
  const [heard, setHeard] = useState<string | null>(null);
  const off = setup.menuStyle === "off";
  useEvery(1000, () => { gameCheck.menu(setup.game, since).then((h) => { if (h) setHeard(h); }, () => {}); }, !heard && !off);
  if (off) {
    return <>
      <p>{t("The menu while you play is off for {game}. Turn it on in Tools, Switch skins in game, or skip this step.", { game: gameName(setup) })}</p>
      <OpenInGameTools />
    </>;
  }
  return <>
    <p>{tx("In the game, press {key}.", { key: <kbd className="kbd">{setup.menuKey}</kbd> })}</p>
    {heard ? <Seen ok>{heard === "window" ? t("The key worked: gachamod opened the menu over the game.") : t("The key worked: gachamod opened the menu the game draws, since the game runs in exclusive fullscreen.")}</Seen>
      : <Seen ok={false}>{setup.menuStyle === "game" ? t("The game takes this key itself, so gachamod doesn't see it.") : t("Waiting for the key press.")}</Seen>}
    <Ask question={t("What opened?")} onAnswer={(v) => answer("menu_opened", v, { menu_heard: heard ?? "none" })} answers={[
      ["window", t("gachamod's menu over the game"), t("A window with previews and search on top of the game")],
      ["drawn", t("A menu drawn in the game"), t("A plainer list the game draws itself")],
      ["nothing", t("Nothing")],
    ]} />
  </>;
}

function MenuPickStep({ game, info, answer }: { game: GameState; info: LiveInfo | null; answer: Answer }) {
  const [before] = useState(() => new Map((info?.groups ?? []).map((g) => [g.group, g.active])));
  const late = useAfter(60_000);
  const changed = info?.groups.find((g) => before.has(g.group) && before.get(g.group) !== g.active);
  useEvery(2000, () => { void reloadLive(game.id); }, !changed && !late);
  const shows = changed ? (changed.mods.find((m) => m.slot === changed.active)?.name ?? t("none of the skins")) : "";
  return <>
    <p>{t("In the menu, pick a different skin for a character, then close the menu.")}</p>
    {changed ? <Seen ok>{t("gachamod read the pick back from the game: {character} wears {mod}.", { character: changed.character, mod: shows })}</Seen>
      : late ? <Seen ok={false}>{t("gachamod hasn't read a pick back from the game in a minute.")}</Seen>
      : <Waiting what={t("Waiting for {game} to save the pick", { game: gameName(game) })} hold={t("The loader saves picks 5 to 15 seconds after they change, and gachamod reads them back from there.")} />}
    <Ask question={t("Did the look change in the game?")} answers={YES_NO} onAnswer={(v) => answer("menu_pick_changed", v, { menu_pick_read: changed ? "yes" : late ? "no" : "not seen" })} />
  </>;
}

function ReloadStep({ setup, answer, chosen }: { setup: CheckSetup; answer: Answer; chosen?: string | number | boolean }) {
  const key = setup.reloadKey?.match(/VK_(\w+)/i)?.[1]?.toUpperCase() ?? "F10";
  return <>
    <p>{tx("In the game, press {key} to reload mods. Wait for the game to catch up (it can stutter for a moment).", { key: <kbd className="kbd">{key}</kbd> })}</p>
    <Ask question={t("Does each character still wear the skin picked last?")} answers={YES_NO} chosen={chosen} onAnswer={(v) => answer("reload_kept", v)} />
  </>;
}

function PadStep({ setup, answer }: { setup: CheckSetup; answer: Answer }) {
  const [since] = useState(Date.now);
  const [heard, setHeard] = useState(false);
  const on = setup.menuPad && setup.menuStyle !== "off";
  useEvery(1000, () => { gameCheck.menu(setup.game, since).then((h) => { if (h) setHeard(true); }, () => {}); }, on && !heard);
  if (!on) return <>
    <p>{t("Opening the menu with a controller is off for {game}. Turn on \"Use a controller in the menu\" in Tools, Switch skins in game, or skip this step.", { game: gameName(setup) })}</p>
    <OpenInGameTools />
  </>;
  return <>
    <p>{t("With a controller, press both sticks in while you play.")}</p>
    {heard && <Seen ok>{t("gachamod saw both sticks pressed and opened the menu.")}</Seen>}
    <Ask question={t("Did the menu open?")} onAnswer={(v) => answer("pad_opened", v, { pad_heard: heard })} answers={[...YES_NO, ["no controller", t("No controller here")]]} />
  </>;
}

const ANSWER_TEXT: Record<string, string> = {
  yes: t("Yes"), no: t("No"), skip: t("Skipped"), window: t("gachamod's menu over the game"), drawn: t("A menu drawn in the game"), nothing: t("Nothing"), "no controller": t("No controller"),
};
const SUMMARY: Array<[string, string]> = [
  ["pick_changed", t("A pick from gachamod changed the skin")],
  ["menu_opened", t("The menu key opened")],
  ["menu_pick_changed", t("A pick from the menu changed the skin")],
  ["reload_kept", t("Skins stayed after a reload")],
  ["pad_opened", t("Both sticks opened the menu")],
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
    <TextField multiline rows={4} label={t("Anything else")} value={notes} onChange={setNotes}
      placeholder={t("For example: the menu showed on the other screen, or a skin needed two picks to change.")} />
    <TextField label={t("How to reach you (optional)")} value={contact} onChange={setContact} placeholder={t("A Discord name or an email, if you'd like an answer")} />
    <span title={t("d3d11_log.txt from the loader's folder and the end of gachamod.log. They name the mods the loader read. Your user folder's name is taken out first")}>
      <Checkbox checked={logs} onChange={setLogs} label={t("Attach the loader's log and gachamod's log")} />
    </span>
    <p className="hint">{setup
      ? t("Along with your answers goes what gachamod read about {game}: the loader and the version, the window mode, whether the game and gachamod run as administrator, and the menu's key.", { game: gameName(setup) })
      : t("Along with your answers goes what gachamod read about the game: the loader and the version, the window mode, whether the game and gachamod run as administrator, and the menu's key.")}</p>
  </>;
}
