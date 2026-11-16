// Reading a chatbot's pasted answer: the errors a reply can have and the JSON in it. Kept apart from tasks.ts so it
// has no app imports and can be tested on its own. Owner: SETTINGS/AI area.

export class ReplyError extends Error {}
/** The reply stops partway (the chatbot ran out of room): the next answer can be pasted after it. */
export class CutOff extends ReplyError {}

/** The JSON in a reply: the ```json block, else the outermost {...}. */
export function parseReply(text: string): unknown {
  const t = text.trim();
  if (!t) throw new ReplyError("Paste the chatbot's answer first.");
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(t);
  let body = fence?.[1]?.trim();
  if (!body) {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b <= a) throw new ReplyError("There's no JSON in that answer. Copy the chatbot's whole reply, including the code box.");
    body = t.slice(a, b + 1);
  }
  try { return JSON.parse(body); } catch {
    throw new ReplyError("The code box isn't valid JSON (it may be cut off). Ask the chatbot to send the whole block again.");
  }
}
