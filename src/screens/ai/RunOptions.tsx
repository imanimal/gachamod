// The model and thinking level for the chatbot that answers in the app. The helper window and Settings > AI helper
// show the same choice (lib/ai.ts aiRunPref). Mount it with key={tool} so a typed model name starts fresh per tool.
// Owner: SETTINGS/AI area.
import { useState } from "react";
import { CLI_NAME, EFFORTS, EFFORT_LABEL, EFFORT_TIP, MODELS, aiRunPref, runOpts, setRunOpts, typesModel, type AppTool } from "../../lib/ai";
import { Segmented, TextField } from "../../ui/kit";
import { t } from "../../lib/i18n";

/** The "Other model" choice, which no model can be named. */
const OTHER = "\u0000other";
const EXAMPLE: Partial<Record<AppTool, string>> = { claude: "claude-opus-5-5", codex: "gpt-5", gemini: "gemini-2.5-pro", "gemini-api": "gemini-2.5-flash" };

export function RunOptions({ tool }: { tool: AppTool }) {
  const o = runOpts(tool, aiRunPref.use());
  const name = CLI_NAME[tool];
  const models = MODELS[tool];
  const listed = models.some((m) => m.value === o.model);
  // the box for a typed name stays open while it's typed in, even before anything is saved
  const [typing, setTyping] = useState(!listed);
  const [draft, setDraft] = useState(listed ? "" : o.model);
  const canType = typesModel(tool);
  const efforts = EFFORTS[tool];
  const saveDraft = () => { const v = draft.trim(); if (v && v !== o.model) void setRunOpts(tool, { model: v }); };

  return (
    <div className="ai-opts">
      <div className="ai-opt">
        <span className="field-l">{t("Model")}</span>
        {models.length > 1 || canType ? (
          <Segmented<string> size="sm" label={t("Model")} value={typing ? OTHER : o.model}
            onChange={(v) => {
              if (v === OTHER) { setTyping(true); return; }
              setTyping(false);
              void setRunOpts(tool, { model: v });
            }}
            options={[
              ...models.map((m) => ({ value: m.value, label: m.label, title: m.title })),
              ...(canType ? [{ value: OTHER, label: t("Other model"), title: t("Type the name of a model {name} has", { name }) }] : []),
            ]} />
        ) : <span className="hint">{models[0]?.title}</span>}
        {typing && (
          <TextField label={t("Model name")} value={draft} onChange={setDraft} onBlur={saveDraft} mono placeholder={EXAMPLE[tool]}
            hint={t("Spelled the way {name} names it. A name it doesn't know makes the request fail", { name })} />
        )}
      </div>
      <div className="ai-opt">
        <span className="field-l">{t("Thinking")}</span>
        {efforts.length ? (
          <Segmented<string> size="sm" label={t("Thinking")} value={o.effort} onChange={(v) => void setRunOpts(tool, { effort: v })}
            options={["", ...efforts].map((e) => ({ value: e, label: EFFORT_LABEL[e]!, title: EFFORT_TIP[e] }))} />
        ) : <span className="hint">{t("{name} has no setting for how long it thinks", { name })}</span>}
      </div>
    </div>
  );
}
