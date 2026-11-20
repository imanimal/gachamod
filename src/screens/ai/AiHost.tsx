// The AI helper, opened by lib/ai.ts askAi() and mounted once by the app shell. Three steps in one window: say what
// you want (and see exactly what gets shared), get the answer, apply it with Undo. When the picked chatbot's CLI is on
// this PC (Claude Code for Claude), or Gemini has a free key, the helper asks it and the answer streams in; with a
// website it copies the prompt, opens the site and the user pastes the answer back. Also the one-time suggestion card
// after setup. Under the answer, what the run did: the files it read (some at the same time), its thinking, the model
// and the tokens it used. Hidden completely while AI is off. Owner: SETTINGS/AI area.
import { useEffect, useMemo, useRef, useState } from "react";
import { errorText, settings, shell } from "../../lib/api";
import { CLI_NAME, aiCliPref, aiIntroPref, aiRunPref, aiShowPref, askCli, botOrder, botTool, chatbotLink, chatbotOf, chatbotPref, chatbotTip, cliProblem, cliSignIn, foundCli, foundClis, installedChatbots, pickBot, runOpts, runOptsText, useAiShow, useGeminiKey, type AiTask, type AppTool, type ChatbotId, type CliId, type CliReply, type CliStatus, type CliUsage } from "../../lib/ai";
import { seconds } from "../../lib/activity";
import { RunOptions } from "./RunOptions";
import { placeFor } from "../../lib/places";
import { GeminiKey } from "./GeminiKey";
import { onApp } from "../../lib/store";
import { Badge, Button, Chip, Dialog, TextField, Waiting, formatCount } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { Icon } from "../../ui/Icon";
import { CutOff, ReplyError, TASKS, parseReply, type Built, type Preview } from "./tasks";
import { english, t, tn } from "../../lib/i18n";
import "./ai.css";

export function AiHost() {
  const show = useAiShow();
  const [task, setTask] = useState<{ n: number; task: AiTask } | null>(null);
  useEffect(() => onApp((e) => {
    if (e.type === "ai" && aiShowPref.get() !== "off") setTask((cur) => ({ n: (cur?.n ?? 0) + 1, task: e.task }));
  }), []);
  if (show === "off") return null;
  return (
    <>
      {task && <Helper key={task.n} task={task.task} onClose={() => setTask(null)} />}
      <AiIntro />
    </>
  );
}

// ── chatbot choice: ones whose CLI is on this PC first, then ones with an app on this PC, then the rest ──

function useInstalled(): ChatbotId[] {
  const [list, setList] = useState<ChatbotId[]>([]);
  useEffect(() => { let live = true; void installedChatbots().then((l) => { if (live) setList(l); }); return () => { live = false; }; }, []);
  return list;
}

function useClis(): CliId[] {
  const [list, setList] = useState<CliId[]>([]);
  useEffect(() => { let live = true; void foundClis().then((l) => { if (live) setList(l); }); return () => { live = false; }; }, []);
  return list;
}

function BotPicker({ value, onPick }: { value: ChatbotId | ""; onPick: (id: ChatbotId) => void }) {
  const installed = useInstalled();
  const clis = useClis();
  const useCli = aiCliPref.use();
  const hasKey = useGeminiKey();
  return (
    <div className="ai-bots" role="radiogroup" aria-label={t("Your chatbot")}>
      {botOrder(clis, installed, hasKey).map((b) => (
        <Chip key={b.id} on={value === b.id} onClick={() => onPick(b.id)}
          title={chatbotTip(b, installed.includes(b.id), botTool(b, clis, hasKey, useCli))}>
          {b.name}{(installed.includes(b.id) || !!foundCli(b, clis)) && <span className="ai-bot-here">{t("on this PC")}</span>}
        </Chip>
      ))}
    </div>
  );
}

// ── the helper window ──

/** What was typed for each task, kept for the rest of the session so closing the helper (Esc, Close) loses nothing.
 *  Keyed by the whole task, so an answer never lands on another game's or other mods' request. Cleared on Apply. */
type Draft = { goal: string; text: string; reply: string; sent: boolean };
const drafts = new Map<string, Draft>();

/** What a CLI is doing, for the wait line: "Claude Code is reading kit.css". */
function statusText(s: CliStatus | "think" | null, name: string): string {
  if (s === "think") return t("{name} is thinking", { name });
  if (s?.kind === "read" && s.on) return t("{name} is reading {file}", { name, file: s.on });
  if (s?.kind === "find") return t("{name} is looking through the files", { name });
  if (s?.kind === "search" && s.on) return t("{name} is searching the files for {text}", { name, text: s.on.slice(0, 40) });
  return t("{name} is writing the answer", { name });
}

function Helper({ task, onClose }: { task: AiTask; onClose: () => void }) {
  const def = TASKS[task.kind] ?? TASKS.custom!;
  const key = useMemo(() => JSON.stringify(task), [task]);
  const [kept] = useState(() => drafts.get(key));
  const [goal, setGoal] = useState(() => kept?.goal ?? (def.goals?.some((g) => g.id === task.detail) ? task.detail! : def.defaultGoal ?? ""));
  const [text, setText] = useState(() => kept?.text ?? (task.kind === "theme" || task.kind === "custom" ? task.detail ?? "" : ""));
  const [built, setBuilt] = useState<Built | null>(null);
  const [buildErr, setBuildErr] = useState<string | null>(null);
  const saved = chatbotPref.use();
  const installed = useInstalled();
  const clis = useClis();
  const useCli = aiCliPref.use();
  const hasKey = useGeminiKey();
  // nothing picked yet: a chatbot that answers here or has an app on this PC, saved once it's used
  const bot = pickBot(saved, clis, installed, hasKey);
  const botInfo = chatbotOf(bot);
  // what answers in the window; undefined means the website
  const tool = botTool(botInfo, clis, hasKey, useCli);
  const cliName = tool ? CLI_NAME[tool] : "";
  const [reply, setReply] = useState(kept?.reply ?? "");
  const [sent, setSent] = useState(kept?.sent ?? false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);
  // a CLI writing its answer: `stop` ends it, and closing the window does too
  const [asking, setAsking] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const [failed, setFailed] = useState<CliReply | null>(null);
  // what a CLI is doing before it writes (reading a file, thinking), cleared once words come
  const [now, setNow] = useState<CliStatus | "think" | null>(null);
  // what the last run did: each tool call, its thinking, what it used and how long it took
  const [steps, setSteps] = useState<CliStatus[]>([]);
  const [thinking, setThinking] = useState("");
  const [usage, setUsage] = useState<CliUsage | null>(null);
  const [took, setTook] = useState<number | null>(null);
  const opts = runOpts(tool ?? "claude", aiRunPref.use());
  useEffect(() => () => stop.current?.(), []);
  const replyBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (done) drafts.delete(key);
    else drafts.set(key, { goal, text, reply, sent });
  }, [key, goal, text, reply, sent, done]);
  // the newest words stay in view while they come in
  useEffect(() => {
    const box = asking ? replyBox.current?.querySelector("textarea") : null;
    if (box) box.scrollTop = box.scrollHeight;
  }, [reply, asking]);

  const showText = !!def.text && (!def.text.forGoal || def.text.forGoal === goal);
  // an example picked at random, and a new one each time the box is emptied again
  const examples = def.text?.examples ?? [];
  const pickExample = (not?: string) => { const pool = examples.filter((x) => x !== not); return pool[Math.floor(Math.random() * pool.length)] ?? not ?? ""; };
  const [example, setExample] = useState(() => pickExample());
  const hadText = useRef(!!text);
  useEffect(() => {
    if (text && !hadText.current) hadText.current = true;
    else if (!text && hadText.current) { hadText.current = false; setExample((x) => pickExample(x)); }
  }, [text]);
  const needText = showText && def.text!.required && !text.trim();

  // build the prompt as the input changes (it also tells what gets shared before anything is copied). An answer that
  // comes back here gets the longer prompt with reference files; a pasted one stays short.
  const rich = !!tool;
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      def.build(task, { goal, text, rich }).then((b) => { if (live) { setBuilt(b); setBuildErr(null); } })
        .catch((e) => { if (live) { setBuilt(null); setBuildErr(errorText(e)); } });
    }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [def, task, goal, text, rich]);

  const read = useMemo((): { preview?: Preview; error?: string; cut?: boolean } => {
    if (!reply.trim() || !built || asking) return {};
    try { const preview = built.read((built.parse ?? parseReply)(reply)); return { preview, cut: !!preview.cut }; }
    catch (e) { return { error: e instanceof ReplyError ? e.message : errorText(e), cut: e instanceof CutOff }; }
  }, [reply, built, asking]);

  // a CLI on this PC or Gemini's key: the answer streams into the reply box, then reads like a pasted one
  const ask = async () => {
    if (!built || needText || !tool || stop.current) return;
    if (!saved && bot) void chatbotPref.set(bot);
    setFailed(null);
    setReply("");
    setNow(null);
    setSteps([]);
    setThinking("");
    setUsage(null);
    setTook(null);
    setSent(true);
    const started = Date.now();
    const run = askCli(tool, built.prompt, (words) => { setReply(words); if (words) setNow(null); }, {
      files: built.files,
      onStatus: (s) => { setNow(s); setSteps((l) => [...l, s]); },
      onThink: (x) => { setThinking(x); setNow("think"); },
    });
    stop.current = run.stop;
    setAsking(true);
    try {
      const r = await run.done;
      setReply(r.text);
      setUsage(r.usage ?? null);
      if (r.problem && r.problem !== "stopped") setFailed(r);
    } catch (e) {
      setFailed({ text: "", problem: "failed", error: errorText(e), resetsAt: null });
    } finally {
      stop.current = null;
      setAsking(false);
      setNow(null);
      setTook(Date.now() - started);
    }
  };

  const send = async (open: boolean) => {
    if (!built || needText) return;
    if (!saved && bot) void chatbotPref.set(bot);
    let copied = true;
    try { await navigator.clipboard.writeText(built.prompt); } catch { copied = false; }
    const link = open && bot ? chatbotLink(bot, built.prompt) : null;
    if (link) { try { await shell.openUrl(link.url); } catch (e) { toast(errorText(e), true); } }
    const name = botInfo?.id === "other" || !botInfo ? t("your chatbot") : botInfo.name;
    // a chatbot opened with the prompt in its box says it all by itself
    if (!copied && !link?.prefilled) toast(t("Couldn't copy the prompt. Open \"See the prompt\" and copy it from there"), true);
    else if (!link?.prefilled) toast(t("Prompt copied. Paste it in {name}, then copy the whole answer", { name }));
    setSent(true);
    window.setTimeout(() => replyBox.current?.querySelector("textarea")?.focus(), 60);
  };

  // an answer that was cut off gets the next one after it (closing its open code block first)
  const pasteReply = async () => {
    let add: string;
    try { add = await navigator.clipboard.readText(); } catch { toast(t("Couldn't read the clipboard. Paste with Ctrl+V"), true); return; }
    setReply((r) => {
      if (!read.cut || !r.trim() || r.includes(add.trim())) return add;
      const open = (r.match(/^\s*```/gm) ?? []).length % 2 === 1;
      return `${r.trimEnd()}${open ? "\n```" : ""}\n\n${add}`;
    });
  };

  const apply = async () => {
    const p = read.preview;
    if (!p?.apply) return;
    setBusy(true);
    try { setDone(await p.apply()); } catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };

  // Ctrl+Enter: ask (or copy and open), or apply once an answer is in
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (done) onClose();
      else if (asking) return;
      else if (read.preview?.apply) void apply();
      else if (tool) void ask();
      else void send(true);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const openLabel = !bot || bot === "other" ? t("Copy the prompt") : t("Copy and open {name}", { name: botInfo?.name ?? "" });

  if (done) {
    return (
      <Dialog title={def.title(task)} icon="ai" size="lg" className="ai-help" onClose={onClose}
        footer={<>
          <Button variant="ghost" icon="copy" onClick={() => { void navigator.clipboard.writeText(done.join("\n")).then(() => toast(t("Copied the list"))); }} title={t("Copy what changed as text")}>{t("Copy the list")}</Button>
          <Button variant="primary" autoFocus onClick={onClose}>{t("Done")}</Button>
        </>}>
        <p><Icon name="check" /> {tn(done.length, "{n} change made. Ctrl+Z undoes all of it.", "{n} changes made. Ctrl+Z undoes all of it.")}</p>
        <ul className="ai-done selectable">{done.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </Dialog>
    );
  }

  const p = read.preview;
  return (
    <Dialog title={def.title(task)} icon="ai" size="lg" className="ai-help" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Close")}</Button>
        {asking
          ? <Button variant="secondary" icon="x" onClick={() => stop.current?.()} title={t("Stops {name} now", { name: cliName })}>{t("Stop")}</Button>
          : p?.apply
          ? <Button variant="primary" icon="check" busy={busy} onClick={() => void apply()} title={t("Apply these changes (Ctrl+Enter). Undo puts them back")}>{t("Apply")}</Button>
          : tool
          ? <Button variant={sent ? "secondary" : "primary"} icon="ai" disabled={!built || needText} onClick={() => void ask()}
              title={tool === "gemini-api" ? t("Sends the prompt to Gemini with your free key (Ctrl+Enter)") : t("Sends the prompt to {name} on this PC (Ctrl+Enter)", { name: cliName })}>
              {sent ? t("Ask again") : t("Ask {name}", { name: cliName })}</Button>
          : <Button variant={sent ? "secondary" : "primary"} icon={bot && bot !== "other" ? "external" : "copy"} disabled={!built || needText}
              onClick={() => void send(true)} title={t("Copies the prompt and opens your chatbot (Ctrl+Enter)")}>{sent ? t("Copy again") : openLabel}</Button>}
      </>}>
      <section className="ai-step">
        <h3 className="ai-step-h"><span className="ai-n">1</span>{t("What to ask")}</h3>
        {def.goals && (
          <div className="ai-goals" role="radiogroup" aria-label={t("What to ask")}>
            {def.goals.map((g) => <Chip key={g.id} on={goal === g.id} onClick={() => setGoal(g.id)} title={g.title}>{g.label}</Chip>)}
          </div>
        )}
        {showText && <TextField label={def.text!.label} value={text} onChange={setText} suggest={example} multiline rows={2} autoFocus />}
        <div className="ai-bot-row">
          <span className="field-l">{t("Your chatbot")}</span>
          <BotPicker value={bot} onPick={(id) => void chatbotPref.set(id)} />
          {tool && (
            <details className="ai-more">
              <summary title={t("Pick the model and how long it thinks. Settings, AI helper has the same choice")}>
                {t("Model and thinking")} <span className="hint">{runOptsText(tool, opts)}</span>
              </summary>
              <RunOptions key={tool} tool={tool} />
            </details>
          )}
          {def.note && <span className="hint">{def.note}</span>}
          {!tool && !hasKey && (
            <details className="ai-key-offer">
              <summary>{t("Get answers here instead of pasting")}</summary>
              <GeminiKey />
            </details>
          )}
        </div>
        {buildErr ? <BuildError text={buildErr} onGo={onClose} /> : built && (
          <div className="ai-shares">
            <span className="hint">{tool ? t("Sent to {name} when you ask:", { name: cliName }) : t("Shared when you paste the prompt:")}</span>
            <ul>{built.shares.map((s) => <li key={s}>{s}</li>)}</ul>
            <details className="ai-prompt">
              <summary>{t("See the prompt")}</summary>
              <pre className="selectable">{built.prompt}</pre>
            </details>
          </div>
        )}
      </section>

      <section className={`ai-step${sent || reply ? "" : " dim"}`} ref={replyBox}>
        <h3 className="ai-step-h"><span className="ai-n">2</span>{tool ? t("The answer") : t("Paste the answer")}</h3>
        {asking && tool && <Waiting what={statusText(now, cliName)}
          hold={built?.files?.length
            ? t("Reading the files and writing a long answer, like a whole theme, can take several minutes. Stop ends it.")
            : t("Long answers, like hundreds of mod names or a whole theme, take a minute or two. Stop ends it.")} />}
        <TextField value={reply} onChange={setReply} multiline rows={4} mono
          placeholder={tool ? t("The answer shows here as it's written") : t("The chatbot's whole reply, with the code blocks")} />
        {!tool && (
          <div className="row">
            {read.cut
              ? <Button size="sm" icon="paste" onClick={() => void pasteReply()} title={t("Adds the chatbot's next answer after this one")}>{t("Paste the rest")}</Button>
              : <Button size="sm" icon="paste" onClick={() => void pasteReply()} title={t("Paste the chatbot's answer from the clipboard")}>{t("Paste")}</Button>}
            {reply && <Button size="sm" variant="ghost" icon="x" onClick={() => setReply("")}>{t("Clear")}</Button>}
          </div>
        )}
        {tool && (asking || steps.length > 0 || !!thinking || !!usage) && <RunDetails steps={steps} thinking={thinking} usage={usage} took={took} asking={asking} />}
        {failed && tool && <CliFailure r={failed} name={cliName} tool={tool} onGo={onClose} />}
        {read.error && !failed && <p className="ai-err" role="alert">{read.error}</p>}
      </section>

      {p && <PreviewView p={p} />}
    </Dialog>
  );
}

/** Tool calls by round: calls in one round were made at the same time. */
function byRound(steps: CliStatus[]): CliStatus[][] {
  const out: CliStatus[][] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (last && last[0]!.round === s.round && s.round > 0) last.push(s);
    else out.push([s]);
  }
  return out;
}

/** One round in words: "Read kit.css, base.css; searched for --accent". */
function roundText(r: CliStatus[]): string {
  const of = (k: CliStatus["kind"]) => r.filter((s) => s.kind === k).map((s) => s.on).filter(Boolean);
  const parts = [
    of("read").length ? t("read {files}", { files: of("read").join(", ") }) : "",
    of("find").length ? t("looked for {files}", { files: of("find").join(", ") }) : "",
    of("search").length ? t("searched for {text}", { text: of("search").join(", ") }) : "",
    of("work").length ? t("used {tools}", { tools: of("work").join(", ") }) : "",
  ].filter(Boolean).join("; ");
  return parts.charAt(0).toLocaleUpperCase() + parts.slice(1);
}

/** Whether the run details were open last time, kept for the session. */
let detailsOpen = false;

/** What a run did and used: a one-line summary that opens to the model, tokens, each step and its thinking. Each tool
 *  reports different things, so a line shows only when its tool said it. */
function RunDetails({ steps, thinking, usage, took, asking }: { steps: CliStatus[]; thinking: string; usage: CliUsage | null; took: number | null; asking: boolean }) {
  const [open, setOpen] = useState(detailsOpen);
  const think = useRef<HTMLPreElement>(null);
  // the newest thoughts stay in view while they come in
  useEffect(() => { if (asking && think.current) think.current.scrollTop = think.current.scrollHeight; }, [thinking, asking]);
  const rounds = byRound(steps);
  const reads = new Set(steps.filter((s) => s.kind === "read").map((s) => s.on)).size;
  const looks = steps.filter((s) => s.kind === "find" || s.kind === "search").length;
  const together = rounds.some((r) => r.length > 1);
  const tokens = (usage?.input ?? 0) + (usage?.output ?? 0);
  const n = (x: number) => formatCount(x);
  const summary = [
    reads > 0 && (together ? t("Read {n} files, some at the same time", { n: reads }) : tn(reads, "Read {n} file", "Read {n} files")),
    looks > 0 && tn(looks, "{n} search", "{n} searches"),
    !!thinking && t("Thought it through"),
    tokens > 0 && t("{n} tokens", { n: n(tokens) }),
    took !== null && seconds(Math.max(1, Math.round(took / 1000))),
  ].filter((x): x is string => !!x);
  const pct = usage?.context && usage.window ? Math.max(1, Math.round((usage.context / usage.window) * 100)) : null;
  return (
    <details className="ai-run" open={open} onToggle={(e) => { detailsOpen = e.currentTarget.open; setOpen(detailsOpen); }}>
      <summary title={t("What the chatbot did: the files it read, the thinking and the tokens it used")}>
        {summary.length ? summary.join(", ") : t("What it's doing")}
      </summary>
      {(usage || took !== null) && (
        <dl className="ai-run-facts">
          {usage?.model && <><dt>{t("Model")}</dt><dd className="selectable">{usage.model}</dd></>}
          {usage?.context != null && (
            <><dt title={t("The most the model held in mind at once: the prompt, the files it read and the answer")}>{t("Context")}</dt>
              <dd>{usage.window ? t("{used} of {max} tokens ({pct}%)", { used: n(usage.context), max: n(usage.window), pct: pct! }) : t("{n} tokens", { n: n(usage.context) })}</dd></>
          )}
          {usage?.input != null && (
            <><dt>{t("Read")}</dt>
              <dd>{usage.cached ? t("{n} tokens, {cached} of them from the cache", { n: n(usage.input), cached: n(usage.cached) }) : t("{n} tokens", { n: n(usage.input) })}</dd></>
          )}
          {usage?.output != null && (
            <><dt>{t("Wrote")}</dt>
              <dd>{usage.thinking ? t("{n} tokens, {thinking} of them thinking", { n: n(usage.output), thinking: n(usage.thinking) }) : t("{n} tokens", { n: n(usage.output) })}</dd></>
          )}
          {usage?.turns != null && <><dt title={t("Each round, the model reads what came back and decides what to do next")}>{t("Rounds")}</dt><dd>{usage.turns}</dd></>}
          {took !== null && <><dt>{t("Time")}</dt><dd>{seconds(Math.max(1, Math.round(took / 1000)))}</dd></>}
        </dl>
      )}
      {rounds.length > 0 && (
        <>
          <span className="field-l">{t("Steps")}</span>
          <ol className="ai-run-steps selectable">
            {rounds.map((r, i) => (
              <li key={i}>{r.length > 1 && <span className="ai-run-once" title={t("The model asked for these together and they ran at the same time")}>{t("{n} at once", { n: r.length })}</span>}{roundText(r)}</li>
            ))}
          </ol>
        </>
      )}
      {thinking && (
        <>
          <span className="field-l">{t("Thinking")}</span>
          <pre className="ai-think selectable" ref={think}>{thinking}</pre>
        </>
      )}
    </details>
  );
}

/** Why a CLI or Gemini didn't answer, with the button that fixes it when there is one. */
function CliFailure({ r, name, tool, onGo }: { r: CliReply; name: string; tool: AppTool; onGo: () => void }) {
  const { text, hint } = cliProblem(r, name, tool);
  const place = hint ? placeFor(hint) : null;
  return (
    <div className="ai-err" role="alert">
      <p>{text}</p>
      {hint && <p className="hint">{hint}</p>}
      {r.problem === "signin" && tool !== "gemini-api" && (
        <Button size="sm" icon="external" onClick={() => void cliSignIn(tool as CliId).catch((e) => toast(errorText(e), true))}
          title={t("Opens {name} in a separate window to sign in", { name })}>{t("Sign in")}</Button>
      )}
      {r.problem === "node" && <Button size="sm" icon="external" onClick={() => void shell.openUrl("https://nodejs.org/")}>{t("Get Node.js")}</Button>}
      {r.problem === "key" && <GeminiKey />}
      {place && <Button size="sm" onClick={() => { onGo(); place.run(); }}>{place.label}</Button>}
    </div>
  );
}

/** Why the prompt can't be made, with a button when it names a setting (lib/places.ts). */
function BuildError({ text, onGo }: { text: string; onGo: () => void }) {
  const place = placeFor(text);
  return (
    <div className="ai-err" role="alert">
      <p>{text}</p>
      {place && <Button size="sm" onClick={() => { onGo(); place.run(); }}>{place.label}</Button>}
    </div>
  );
}

function PreviewView({ p }: { p: Preview }) {
  return (
    <section className="ai-step ai-preview">
      <h3 className="ai-step-h"><span className="ai-n">3</span>{p.summary}</h3>
      {p.cut && <div className="note t-warn" role="status"><Icon name="warn" /><span>{p.cut}</span></div>}
      {p.text.length > 0 && <div className="ai-text selectable">{p.text.map((line, i) => <p key={i}>{line}</p>)}</div>}
      {p.rows.length > 0 && (
        <div className="ai-rows">
          {p.rows.map((r, i) => (
            <div key={i} className="ai-row">
              <b>{r.title}</b>
              {r.note && <span className="hint">{r.note}</span>}
              {r.lines.map((l, j) => (
                <div key={j} className="ai-line">
                  <span className="ai-line-l">{l.label}</span>
                  {l.before !== undefined && <span className="ai-before">{l.before || t("None")}</span>}
                  {l.before !== undefined && <Icon name="right" />}
                  <span className="ai-after selectable">{l.after}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {p.links.length > 0 && (
        <div className="ai-links">
          {p.links.map((l, i) => <Button key={i} size="sm" icon={english(l.label).startsWith("Open") ? "folder" : "browse"} onClick={l.run} title={l.hint}>{l.label}</Button>)}
        </div>
      )}
      {p.skipped.length > 0 && (
        <details className="ai-skipped">
          <summary><Badge tone="warn">{t("{n} skipped", { n: p.skipped.length })}</Badge> {p.skipped.length === 1 ? t("A part of the answer that can't be used. Click to see them") : t("Parts of the answer that can't be used. Click to see them")}</summary>
          <ul>{p.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

// ── the one-time suggestion, from the start after setup ──

function AiIntro() {
  const intro = aiIntroPref.use();
  const bot = chatbotPref.use();
  const clis = useClis();
  const hasKey = useGeminiKey();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    let timer = 0;
    // 10 seconds after start, and not in the session that did the first setup (that one has Browse to find): setup
    // was already done when this start began
    void Promise.all([aiIntroPref.ready, chatbotPref.ready, settings.get("onboarded").catch(() => null)]).then(([, , ob]) => {
      if (live && ob === "1") timer = window.setTimeout(() => { if (live) setReady(true); }, 10000);
    });
    return () => { live = false; window.clearTimeout(timer); };
  }, []);
  if (!ready || intro === "done" || bot) return null;

  const pick = (id: ChatbotId) => {
    void chatbotPref.set(id);
    void aiIntroPref.set("done");
    const b = chatbotOf(id);
    const tool = botTool(b, clis, hasKey);
    toast(tool ? t("AI buttons now ask {name} and show the answer here", { name: CLI_NAME[tool] })
      : b && b.id !== "other" ? t("AI buttons now open {name} with the prompt ready", { name: b.name }) : t("AI buttons now open your chatbot with the prompt ready"));
  };
  return (
    <aside className="ai-intro" aria-label={t("Use your chatbot with gachamod")}>
      <div className="ai-intro-h">
        <Icon name="ai" />
        <b>{t("Use a chatbot you already have")}</b>
      </div>
      <p className="hint">{t("gachamod writes the prompt, opens the chatbot and applies the answer with Undo. No account or key. It can:")}</p>
      <ul>
        <li>{t("Make a theme from \"navy and gold, sharp corners\"")}</li>
        <li>{t("Tidy 200 messy mod names at once")}</li>
        <li>{t("Make a mod's toggles work only while the character is on screen")}</li>
      </ul>
      <span className="field-l">{t("Which one do you use?")}</span>
      <BotPicker value="" onPick={pick} />
      <div className="row ai-intro-a">
        <Button size="sm" variant="ghost" onClick={() => void aiIntroPref.set("done")} title={t("Hide this for good. Settings, AI helper has it")}>{t("No thanks")}</Button>
        <Button size="sm" variant="ghost" onClick={() => { void aiShowPref.set("off", t("Turned the AI helper off"), true); void aiIntroPref.set("done"); }}
          title={t("Hides every AI button and menu item. Turn it back on in Settings")}>{t("Turn AI off")}</Button>
      </div>
    </aside>
  );
}
