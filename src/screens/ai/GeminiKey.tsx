// The free Gemini key, so Gemini answers in the app for people without a chat CLI: a link to Google AI Studio, where
// Create API key makes one, and a field to paste it. The backend checks it with Google and keeps it encrypted; this
// side only knows whether one is saved. Shown in Settings > AI helper and in the helper window, one shared state.
// Owner: SETTINGS/AI area.
import { useState } from "react";
import { errorText, shell } from "../../lib/api";
import { GEMINI_KEY_URL, chatbotPref, removeGeminiKey, saveGeminiKey, useGeminiKey } from "../../lib/ai";
import { Button, TextField } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { t } from "../../lib/i18n";

export function GeminiKey() {
  const saved = useGeminiKey();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveGeminiKey(draft);
      setDraft("");
      // pasting a key means wanting Gemini to answer here
      void chatbotPref.set("gemini");
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if (saved) {
    return (
      <div className="ai-key">
        <span className="hint">{t("A free Gemini key is saved, so Gemini answers here in gachamod.")}</span>
        <div className="row">
          <Button size="sm" variant="ghost" icon="trash" onClick={() => void removeGeminiKey().catch((e) => toast(errorText(e), true))}
            title={t("Forgets the key. Gemini opens its website again")}>{t("Remove key")}</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="ai-key">
      <span className="hint">{t("Gemini can answer here with a free key from Google AI Studio. Click Create API key there, copy the key and paste it below. Free keys have a daily limit, and Google may use what you send to improve its models.")}</span>
      {/* Enter in the field saves: a form with one field submits on Enter */}
      <form className="row ai-key-row" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Button size="sm" icon="external" onClick={() => void shell.openUrl(GEMINI_KEY_URL)}
          title={t("Opens Google AI Studio. Sign in with any Google account and click Create API key")}>{t("Get a free key")}</Button>
        <TextField type="password" value={draft} onChange={setDraft} placeholder={t("Paste the key")} mono />
        <Button size="sm" type="submit" busy={busy} disabled={!draft.trim()} title={t("Checks the key with Google and saves it (Enter)")}>{t("Save key")}</Button>
      </form>
      {error && <p className="ai-err" role="alert">{error}</p>}
    </div>
  );
}
