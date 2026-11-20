// Settings > AI helper: how much AI shows (off hides every AI element in the app), which chatbot the helper uses (its
// CLI on this PC when there is one, or Gemini with a free key, answering in the app, else its website), and the jobs it
// does, each one click away. With an answer in the app, the model and how long it thinks (the helper window shows the
// same choice). Owner: SETTINGS/AI area.
import { AI_SHOW_LABEL, CLI_NAME, aiCliPref, aiHideAdultPref, aiShowPref, askAi, botOrder, botTool, chatbotOf, chatbotPref, chatbotTip, chatbotUrlPref, cliPlan, foundCli, foundClis, installedChatbots, pickBot, useAiShow, useGeminiKey, type AiShow, type ChatbotId, type CliId } from "../../lib/ai";
import { useEffect, useState } from "react";
import { currentGame } from "../../lib/store";
import { Button, Chip, Panel, Segmented, TextField, Toggle } from "../../ui/kit";
import { SetRow } from "./parts";
import { toast } from "../../ui/toast";
import { t } from "../../lib/i18n";
import { GeminiKey } from "../ai/GeminiKey";
import { RunOptions } from "../ai/RunOptions";

export function AiSection() {
  const show = useAiShow();
  const saved = chatbotPref.use();
  const url = chatbotUrlPref.use();
  const hideAdult = aiHideAdultPref.use();
  const useCli = aiCliPref.use();
  const hasKey = useGeminiKey();
  const [draft, setDraft] = useState(url);
  const [installed, setInstalled] = useState<ChatbotId[]>([]);
  // null until the first look is done
  const [clis, setClis] = useState<CliId[] | null>(null);
  const [looking, setLooking] = useState(false);
  useEffect(() => { setDraft(url); }, [url]);
  // looked for again each time, so a CLI installed while gachamod runs shows up
  const look = () => { setLooking(true); void foundClis(true).then(setClis).finally(() => setLooking(false)); };
  useEffect(() => { if (show !== "off") { void installedChatbots().then(setInstalled); look(); } }, [show]);
  const game = currentGame();
  // chat.example.com is saved as https://chat.example.com; another scheme (ftp://) can't be opened, so it goes back
  const saveUrl = () => {
    let v = draft.trim();
    if (v && !v.includes("://")) v = `https://${v.replace(/^\/+/, "")}`;
    if (v === "" || /^https?:\/\//i.test(v)) { setDraft(v); void chatbotUrlPref.set(v); }
    else { setDraft(url); toast(t("A chatbot's web address starts with https://"), true); }
  };
  const found = clis ?? [];
  const bot = pickBot(saved, found, installed, hasKey);
  const info = chatbotOf(bot);
  const tool = botTool(info, found, hasKey, useCli);
  const order = botOrder(found, installed, hasKey);
  // the picked chatbot's CLI is on this PC, so asking it can be turned off
  const localCli = foundCli(info, found);

  return (
    <Panel title={t("AI helper")} icon="ai" id="ai">
      <div className="set-rows">
        <SetRow id="set-ai-show" label={t("Show AI buttons")} hint={show === "off" ? t("No AI button, menu item or hint anywhere") : show === "useful" ? t("Only where it saves work, like fixing toggles or renaming many mods") : t("Also small extras, like mod ideas")}>
          <Segmented<AiShow> value={show} onChange={(v) => void aiShowPref.set(v, t("AI buttons: {level}", { level: AI_SHOW_LABEL[v].toLowerCase() }))} label={t("Show AI buttons")}
            options={(["off", "useful", "all"] as AiShow[]).map((v) => ({ value: v, label: AI_SHOW_LABEL[v] }))} />
        </SetRow>
        {show !== "off" && (
          <div className="set-row set-row-col" id="set-ai-chatbot">
            <span><b>{t("Your chatbot")}</b><span className="hint">{tool === "gemini-api"
              ? t("Gemini answers in gachamod with your free key. Nothing to copy or paste")
              : tool
              ? t("{name} runs on this PC with {plan}, and the answer shows in gachamod. Nothing to copy or paste", { name: CLI_NAME[tool], plan: cliPlan(tool) })
              : clis === null && info?.clis && useCli
              ? t("Looking for {name} on this PC", { name: CLI_NAME[info.clis[0]!] })
              : t("The helper writes the prompt and opens the website. You paste the answer back. No account or key")}</span></span>
            <div className="set-ai-bots">
              {order.map((b) => (
                <Chip key={b.id} on={bot === b.id} onClick={() => void chatbotPref.set(b.id)} title={chatbotTip(b, installed.includes(b.id), botTool(b, found, hasKey, useCli))}>{b.name}</Chip>
              ))}
            </div>
            {bot === "other" && (
              <TextField label={t("Web address (optional)")} value={draft} placeholder="https://chat.example.com" mono
                onChange={setDraft} onBlur={saveUrl}
                hint={t("Leave empty to only copy the prompt. An address without https:// gets it added")} />
            )}
            {clis !== null && !tool && (info?.clis ? !localCli : found.length === 0) && (
              <div className="set-ai-cli">
                <span className="hint">{info?.clis
                  ? t("With {name} on this PC, gachamod asks it directly and the answer shows here.", { name: CLI_NAME[info.clis[0]!] })
                  : t("Claude, ChatGPT and Gemini can answer right here when Claude Code, Codex or Antigravity is on this PC.")}</span>
                <div className="row">
                  <Button size="sm" variant="ghost" icon="refresh" busy={looking} onClick={look}
                    title={t("Looks for Claude Code, Codex, Antigravity and Gemini CLI again")}>{t("Look again")}</Button>
                </div>
              </div>
            )}
          </div>
        )}
        {show !== "off" && localCli && info && (
          <SetRow id="set-ai-usecli" label={t("Ask {name} on this PC", { name: CLI_NAME[localCli] })}
            hint={useCli ? t("Turn it off to use the {name} website instead", { name: info.name }) : t("The {name} website opens instead, and you paste the answer back", { name: info.name })}>
            <Toggle checked={useCli} onChange={(v) => void aiCliPref.set(v)} ariaLabel={t("Ask {name} on this PC", { name: CLI_NAME[localCli] })} />
          </SetRow>
        )}
        {show !== "off" && tool && (
          <div className="set-row set-row-col" id="set-ai-model">
            <span><b>{t("Model and thinking")}</b><span className="hint">{t("For {name}. A stronger model or longer thinking gives better themes and uses your limit faster", { name: CLI_NAME[tool] })}</span></span>
            <RunOptions key={tool} tool={tool} />
          </div>
        )}
        {show !== "off" && (
          <div className="set-row set-row-col" id="set-ai-key">
            <span><b>{t("Free Gemini key")}</b></span>
            <GeminiKey />
          </div>
        )}
        {show !== "off" && (
          <SetRow id="set-ai-adult" label={t("Hide adult mods from the chatbot")}
            hint={hideAdult ? t("Adult mods are left out of prompts and explicit words in ini names are swapped out. Chatbots often refuse a whole request over one of them") : t("Every mod and name is sent as it is. Chatbots often refuse requests with explicit words in them")}>
            <Toggle checked={hideAdult} onChange={(v) => void aiHideAdultPref.set(v, v ? t("Adult mods hidden from the chatbot") : t("Adult mods sent to the chatbot"))} ariaLabel={t("Hide adult mods from the chatbot")} />
          </SetRow>
        )}
        {show !== "off" && (
          <div className="set-row set-row-col" id="set-ai-jobs">
            <span><b>{t("Ask it now")}</b></span>
            <div className="row set-ai-jobs">
              <Button size="sm" icon="palette" onClick={() => askAi({ kind: "theme", game: game?.id })}
                title={t("Describe a look, like navy and gold with sharp corners, and your chatbot writes the theme")}>{t("Make a theme")}</Button>
              {game && <Button size="sm" icon="edit" onClick={() => askAi({ kind: "mods", game: game.id, detail: "clean" })}
                title={t("Your chatbot turns names like ellen_v2_FINAL into Ellen - Maid Outfit. You see every change first")}>{t("Tidy mod names")}</Button>}
              {game && <Button size="sm" icon="characters" onClick={() => askAi({ kind: "mods", game: game.id, detail: "characters" })}
                title={t("Your chatbot works out which character each mod is for. You see every change first")}>{t("Set characters")}</Button>}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
