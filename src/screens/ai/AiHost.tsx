// The AI helper, opened by lib/ai.ts askAi() and mounted once by the app shell. Three steps in one window: say what
// you want (and see exactly what gets shared), copy the prompt and open your chatbot, paste its answer back and
// apply it with Undo. Also the one-time suggestion card after setup. Hidden completely while AI is off.
// Owner: SETTINGS/AI area.
import { useEffect, useMemo, useRef, useState } from "react";
import { errorText, settings, shell } from "../../lib/api";
import { CHATBOTS, aiIntroPref, aiShowPref, chatbotLink, chatbotOf, chatbotPref, chatbotTip, installedChatbots, useAiShow, type AiTask, type ChatbotId } from "../../lib/ai";
import { placeFor } from "../../lib/places";
import { onApp } from "../../lib/store";
import { Badge, Button, Chip, Dialog, TextField } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { Icon } from "../../ui/Icon";
import { CutOff, ReplyError, TASKS, parseReply, type Built, type Preview } from "./tasks";
import "./ai.css";

export function AiHost() {
  const show = useAiShow();
  const [task, setTask] = useState<{ n: number; task: AiTask } | null>(null);
  useEffect(() => onApp((e) => {
    if (e.type === "ai" && aiShowPref.get() !== "off") setTask((t) => ({ n: (t?.n ?? 0) + 1, task: e.task }));
  }), []);
  if (show === "off") return null;
  return (
    <>
      {task && <Helper key={task.n} task={task.task} onClose={() => setTask(null)} />}
      <AiIntro />
    </>
  );
}

// ── chatbot choice, installed apps first ──

function useInstalled(): ChatbotId[] {
  const [list, setList] = useState<ChatbotId[]>([]);
  useEffect(() => { let live = true; void installedChatbots().then((l) => { if (live) setList(l); }); return () => { live = false; }; }, []);
  return list;
}

function BotPicker({ value, onPick }: { value: ChatbotId | ""; onPick: (id: ChatbotId) => void }) {
  const installed = useInstalled();
  const order = [...CHATBOTS].sort((a, b) => Number(installed.includes(b.id)) - Number(installed.includes(a.id)));
  return (
    <div className="ai-bots" role="radiogroup" aria-label="Your chatbot">
      {order.map((b) => (
        <Chip key={b.id} on={value === b.id} onClick={() => onPick(b.id)}
          title={chatbotTip(b, installed.includes(b.id))}>
          {b.name}{installed.includes(b.id) && <span className="ai-bot-here">on this PC</span>}
        </Chip>
      ))}
    </div>
  );
}

// ── the helper window ──

function Helper({ task, onClose }: { task: AiTask; onClose: () => void }) {
  const def = TASKS[task.kind] ?? TASKS.custom!;
  const [goal, setGoal] = useState(() => (def.goals?.some((g) => g.id === task.detail) ? task.detail! : def.defaultGoal ?? ""));
  const [text, setText] = useState(() => (task.kind === "theme" || task.kind === "custom" ? task.detail ?? "" : ""));
  const [built, setBuilt] = useState<Built | null>(null);
  const [buildErr, setBuildErr] = useState<string | null>(null);
  const bot = chatbotPref.use();
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);
  const replyBox = useRef<HTMLDivElement>(null);

  const showText = !!def.text && (!def.text.forGoal || def.text.forGoal === goal);
  const needText = showText && def.text!.required && !text.trim();
  const botInfo = chatbotOf(bot);

  // build the prompt as the input changes (it also tells what gets shared before anything is copied)
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      def.build(task, { goal, text }).then((b) => { if (live) { setBuilt(b); setBuildErr(null); } })
        .catch((e) => { if (live) { setBuilt(null); setBuildErr(errorText(e)); } });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [def, task, goal, text]);

  const read = useMemo((): { preview?: Preview; error?: string; cut?: boolean } => {
    if (!reply.trim() || !built) return {};
    try { const preview = built.read((built.parse ?? parseReply)(reply)); return { preview, cut: !!preview.cut }; }
    catch (e) { return { error: e instanceof ReplyError ? e.message : errorText(e), cut: e instanceof CutOff }; }
  }, [reply, built]);

  const send = async (open: boolean) => {
    if (!built || needText) return;
    let copied = true;
    try { await navigator.clipboard.writeText(built.prompt); } catch { copied = false; }
    const link = open && bot ? chatbotLink(bot, built.prompt) : null;
    if (link) { try { await shell.openUrl(link.url); } catch (e) { toast(errorText(e), true); } }
    const name = botInfo?.id === "other" || !botInfo ? "your chatbot" : botInfo.name;
    if (!copied && !link?.prefilled) toast("Couldn't copy the prompt. Open \"See the prompt\" and copy it from there", true);
    else toast(link?.prefilled ? `Opened ${name} with the prompt in the box. Send it, then copy the whole answer` : `Prompt copied. Paste it in ${name}, then copy the whole answer`);
    setSent(true);
    window.setTimeout(() => replyBox.current?.querySelector("textarea")?.focus(), 60);
  };

  // an answer that was cut off gets the next one after it (closing its open code block first)
  const pasteReply = async () => {
    let add: string;
    try { add = await navigator.clipboard.readText(); } catch { toast("Couldn't read the clipboard. Paste with Ctrl+V", true); return; }
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

  // Ctrl+Enter: copy and open, or apply once an answer is in
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (done) onClose();
      else if (read.preview?.apply) void apply();
      else void send(true);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const openLabel = !bot ? "Copy the prompt" : bot === "other" ? "Copy the prompt" : `Copy and open ${botInfo?.name}`;

  if (done) {
    return (
      <Dialog title={def.title(task)} icon="ai" size="lg" className="ai-help" onClose={onClose}
        footer={<>
          <Button variant="ghost" icon="copy" onClick={() => { void navigator.clipboard.writeText(done.join("\n")).then(() => toast("Copied the list")); }} title="Copy what changed as text">Copy the list</Button>
          <Button variant="primary" autoFocus onClick={onClose}>Done</Button>
        </>}>
        <p><Icon name="check" /> {done.length === 1 ? "1 change made" : `${done.length} changes made`}. Ctrl+Z undoes all of it.</p>
        <ul className="ai-done selectable">{done.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </Dialog>
    );
  }

  const p = read.preview;
  return (
    <Dialog title={def.title(task)} icon="ai" size="lg" className="ai-help" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {p?.apply
          ? <Button variant="primary" icon="check" busy={busy} onClick={() => void apply()} title="Apply these changes (Ctrl+Enter). Undo puts them back">Apply</Button>
          : <Button variant={sent ? "secondary" : "primary"} icon={bot && bot !== "other" ? "external" : "copy"} disabled={!built || needText}
              onClick={() => void send(true)} title="Copies the prompt and opens your chatbot (Ctrl+Enter)">{sent ? "Copy again" : openLabel}</Button>}
      </>}>
      <section className="ai-step">
        <h3 className="ai-step-h"><span className="ai-n">1</span>What to ask</h3>
        {def.goals && (
          <div className="ai-goals" role="radiogroup" aria-label="What to ask">
            {def.goals.map((g) => <Chip key={g.id} on={goal === g.id} onClick={() => setGoal(g.id)} title={g.title}>{g.label}</Chip>)}
          </div>
        )}
        {showText && <TextField label={def.text!.label} value={text} onChange={setText} placeholder={def.text!.placeholder} multiline rows={2} autoFocus />}
        <div className="ai-bot-row">
          <span className="field-l">Your chatbot</span>
          <BotPicker value={bot} onPick={(id) => void chatbotPref.set(id)} />
          {def.note && <span className="hint">{def.note}</span>}
        </div>
        {buildErr ? <BuildError text={buildErr} onGo={onClose} /> : built && (
          <div className="ai-shares">
            <span className="hint">Shared when you paste the prompt:</span>
            <ul>{built.shares.map((s) => <li key={s}>{s}</li>)}</ul>
            <details className="ai-prompt">
              <summary>See the prompt</summary>
              <pre className="selectable">{built.prompt}</pre>
            </details>
          </div>
        )}
      </section>

      <section className={`ai-step${sent || reply ? "" : " dim"}`} ref={replyBox}>
        <h3 className="ai-step-h"><span className="ai-n">2</span>Paste the answer</h3>
        <TextField value={reply} onChange={setReply} multiline rows={4} mono placeholder="The chatbot's whole reply, with its code blocks" />
        <div className="row">
          {read.cut
            ? <Button size="sm" icon="paste" onClick={() => void pasteReply()} title="Adds the chatbot's next answer after this one">Paste the rest</Button>
            : <Button size="sm" icon="paste" onClick={() => void pasteReply()} title="Paste the chatbot's answer from the clipboard">Paste</Button>}
          {reply && <Button size="sm" variant="ghost" icon="x" onClick={() => setReply("")}>Clear</Button>}
        </div>
        {read.error && <p className="ai-err" role="alert">{read.error}</p>}
      </section>

      {p && <PreviewView p={p} />}
    </Dialog>
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
      {p.text.length > 0 && <div className="ai-text selectable">{p.text.map((t, i) => <p key={i}>{t}</p>)}</div>}
      {p.rows.length > 0 && (
        <div className="ai-rows">
          {p.rows.map((r, i) => (
            <div key={i} className="ai-row">
              <b>{r.title}</b>
              {r.note && <span className="hint">{r.note}</span>}
              {r.lines.map((l, j) => (
                <div key={j} className="ai-line">
                  <span className="ai-line-l">{l.label}</span>
                  {l.before !== undefined && <span className="ai-before">{l.before || "None"}</span>}
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
          {p.links.map((l, i) => <Button key={i} size="sm" icon={l.label.startsWith("Open") ? "folder" : "browse"} onClick={l.run} title={l.hint}>{l.label}</Button>)}
        </div>
      )}
      {p.skipped.length > 0 && (
        <details className="ai-skipped">
          <summary><Badge tone="warn">{p.skipped.length} skipped</Badge> {p.skipped.length === 1 ? "A part of the answer that can't be used" : "Parts of the answer that can't be used"}. Click to see them</summary>
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
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    let t = 0;
    // 10 seconds after start, and not in the session that did the first setup (that one has Browse to find): setup
    // was already done when this start began
    void Promise.all([aiIntroPref.ready, chatbotPref.ready, settings.get("onboarded").catch(() => null)]).then(([, , ob]) => {
      if (live && ob === "1") t = window.setTimeout(() => { if (live) setReady(true); }, 10000);
    });
    return () => { live = false; window.clearTimeout(t); };
  }, []);
  if (!ready || intro === "done" || bot) return null;

  const pick = (id: ChatbotId) => {
    void chatbotPref.set(id);
    void aiIntroPref.set("done");
    toast(`${chatbotOf(id)?.name ?? "Your chatbot"} it is. AI buttons open it with the prompt ready`);
  };
  return (
    <aside className="ai-intro" aria-label="Use your chatbot with gachamod">
      <div className="ai-intro-h">
        <Icon name="ai" />
        <b>Use a chatbot you already have</b>
      </div>
      <p className="hint">gachamod writes the prompt, opens the chatbot and applies its answer with Undo. No account or key. It can:</p>
      <ul>
        <li>Make a theme from "navy and gold, sharp corners"</li>
        <li>Tidy 200 messy mod names at once</li>
        <li>Make a mod's toggles work only while its character is on screen</li>
      </ul>
      <span className="field-l">Which one do you use?</span>
      <BotPicker value="" onPick={pick} />
      <div className="row ai-intro-a">
        <Button size="sm" variant="ghost" onClick={() => void aiIntroPref.set("done")} title="Hide this for good. Settings, AI helper has it">No thanks</Button>
        <Button size="sm" variant="ghost" onClick={() => { void aiShowPref.set("off", "Turned the AI helper off"); void aiIntroPref.set("done"); }}
          title="Hides every AI button and menu item. Turn it back on in Settings">Turn AI off</Button>
      </div>
    </aside>
  );
}
