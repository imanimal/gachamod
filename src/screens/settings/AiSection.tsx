// Settings > AI helper: how much AI shows (off hides every AI element in the app), which chatbot the helper opens,
// and the jobs it does, each one click away. Owner: SETTINGS/AI area.
import { AI_SHOW_LABEL, CHATBOTS, aiHideAdultPref, aiShowPref, askAi, chatbotPref, chatbotTip, chatbotUrlPref, installedChatbots, useAiShow, type AiShow, type ChatbotId } from "../../lib/ai";
import { useEffect, useState } from "react";
import { currentGame } from "../../lib/store";
import { Button, Chip, Panel, Segmented, TextField, Toggle } from "../../ui/kit";
import { SetRow } from "./parts";
import { toast } from "../../ui/toast";

export function AiSection() {
  const show = useAiShow();
  const bot = chatbotPref.use();
  const url = chatbotUrlPref.use();
  const hideAdult = aiHideAdultPref.use();
  const [draft, setDraft] = useState(url);
  const [installed, setInstalled] = useState<ChatbotId[]>([]);
  useEffect(() => { setDraft(url); }, [url]);
  useEffect(() => { if (show !== "off") void installedChatbots().then(setInstalled); }, [show]);
  const game = currentGame();
  // chat.example.com is saved as https://chat.example.com; another scheme (ftp://) can't be opened, so it goes back
  const saveUrl = () => {
    let v = draft.trim();
    if (v && !v.includes("://")) v = `https://${v.replace(/^\/+/, "")}`;
    if (v === "" || /^https?:\/\//i.test(v)) { setDraft(v); void chatbotUrlPref.set(v); }
    else { setDraft(url); toast("A chatbot's web address starts with https://", true); }
  };
  const order = [...CHATBOTS].sort((a, b) => Number(installed.includes(b.id)) - Number(installed.includes(a.id)));

  return (
    <Panel title="AI helper" icon="ai" id="ai">
      <div className="set-rows">
        <SetRow id="set-ai-show" label="Show AI buttons" hint={show === "off" ? "No AI button, menu item or hint anywhere" : show === "useful" ? "Only where it saves work, like fixing toggles or renaming many mods" : "Also small extras, like mod ideas"}>
          <Segmented<AiShow> value={show} onChange={(v) => void aiShowPref.set(v, `AI buttons: ${AI_SHOW_LABEL[v].toLowerCase()}`)} label="Show AI buttons"
            options={(["off", "useful", "all"] as AiShow[]).map((v) => ({ value: v, label: AI_SHOW_LABEL[v] }))} />
        </SetRow>
        {show !== "off" && (
          <div className="set-row set-row-col" id="set-ai-chatbot">
            <span><b>Your chatbot</b><span className="hint">The helper writes the prompt and opens it. You paste the answer back. No account or key</span></span>
            <div className="set-ai-bots">
              {order.map((b) => (
                <Chip key={b.id} on={(bot || installed[0]) === b.id} onClick={() => void chatbotPref.set(b.id)} title={chatbotTip(b, installed.includes(b.id))}>{b.name}</Chip>
              ))}
            </div>
            {bot === "other" && (
              <TextField label="Its web address (optional)" value={draft} placeholder="https://chat.example.com" mono
                onChange={setDraft} onBlur={saveUrl}
                hint="Leave empty to only copy the prompt. An address without https:// gets it added" />
            )}
          </div>
        )}
        {show !== "off" && (
          <SetRow id="set-ai-adult" label="Hide adult mods from the chatbot"
            hint={hideAdult ? "Adult mods are left out of prompts and explicit words in ini names are swapped out. Chatbots often refuse a whole request over one of them" : "Every mod and name is sent as it is. Chatbots often refuse requests with explicit words in them"}>
            <Toggle checked={hideAdult} onChange={(v) => void aiHideAdultPref.set(v, v ? "Adult mods hidden from the chatbot" : "Adult mods sent to the chatbot")} ariaLabel="Hide adult mods from the chatbot" />
          </SetRow>
        )}
        {show !== "off" && (
          <div className="set-row set-row-col" id="set-ai-jobs">
            <span><b>Ask it now</b></span>
            <div className="row set-ai-jobs">
              <Button size="sm" icon="palette" onClick={() => askAi({ kind: "theme", game: game?.id })}
                title="Describe a look, like navy and gold with sharp corners, and your chatbot writes the theme">Make a theme</Button>
              {game && <Button size="sm" icon="edit" onClick={() => askAi({ kind: "mods", game: game.id, detail: "clean" })}
                title="Your chatbot turns names like ellen_v2_FINAL into Ellen - Maid Outfit. You see every change first">Tidy mod names</Button>}
              {game && <Button size="sm" icon="characters" onClick={() => askAi({ kind: "mods", game: game.id, detail: "characters" })}
                title="Your chatbot works out which character each mod is for. You see every change first">Set characters</Button>}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
