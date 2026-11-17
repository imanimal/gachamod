// Reading a chatbot's pasted answer: the errors a reply can have and the JSON in it. Kept apart from tasks.ts so it
// imports nothing from the app but lib/i18n, and can be tested on its own. Owner: SETTINGS/AI area.
import { t } from "../../lib/i18n";

export class ReplyError extends Error {}
/** The reply stops partway (the chatbot ran out of room): the next answer can be pasted after it. */
export class CutOff extends ReplyError {}

/** The JSON in a reply: the ```json block, else the outermost {...}. */
export function parseReply(text: string): unknown {
  const s = text.trim();
  if (!s) throw new ReplyError(t("Paste the chatbot's answer first."));
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(s);
  let body = fence?.[1]?.trim();
  if (!body) {
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) throw new ReplyError(t("There's no JSON in that answer. Copy the chatbot's whole reply, including the code box."));
    body = s.slice(a, b + 1);
  }
  try { return JSON.parse(body); } catch {
    throw new ReplyError(t("The code box isn't valid JSON (it may be cut off). Ask the chatbot to send the whole block again."));
  }
}
