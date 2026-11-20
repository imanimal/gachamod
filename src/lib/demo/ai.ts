// Demo handlers for the AI helper's commands. Owner: SETTINGS/AI area.
import { demoEmit, registerDemo } from "../tauri";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (message: string) => { throw { kind: "invalid", message }; };
// the free Gemini key: the browser keeps no secret, so it's only remembered until the page reloads
let hasKey = false;

export function registerAiDemo() {
  registerDemo({
    // pretend the ChatGPT app and Claude Code are installed, so both kinds of chatbot show in the browser
    ai_chatbots_installed: () => ["chatgpt"],
    ai_clis: () => ["claude"],
    // the browser can't run a chatbot: write a few words, then fail the way a signed-out CLI or a busy Google does
    ai_run: async (a) => {
      const id = String(a.id);
      demoEmit("ai-chunk", { id, delta: "", reset: true });
      for (const w of ["Which ", "files ", "matter here?"]) { await wait(250); demoEmit("ai-think", { id, delta: w }); }
      for (const [on, round] of [["base.css", 1], ["kit.css", 1], ["screen.html", 2]] as const) { await wait(300); demoEmit("ai-status", { id, kind: "read", on, round }); }
      for (const w of ["Reading ", "the ", "request..."]) { await wait(300); demoEmit("ai-chunk", { id, delta: w, reset: false }); }
      await wait(600);
      const usage = { model: a.tool === "gemini-api" ? "gemini-flash-latest" : "claude-sonnet-demo", input: 48200, cached: 41000, output: 900, thinking: 300, context: 24500, window: 200000, turns: 3 };
      if (a.tool === "gemini-api") return { text: "Reading the request...", problem: "busy", error: "The model is overloaded. Please try again later.", resetsAt: null, usage };
      return { text: "Reading the request...", problem: "signin", error: "Not signed in · Please run /login", resetsAt: null, usage };
    },
    ai_cancel: () => null,
    ai_cli_sign_in: () => null,
    ai_key_status: () => hasKey,
    // any key-shaped text is accepted after a short check, like Google would
    ai_key_set: async (a) => {
      const key = String(a.key ?? "").trim();
      if (!/^[A-Za-z0-9_-]{20,200}$/.test(key)) fail("That doesn't look like a Gemini key. Copy the whole key from Google AI Studio.");
      await wait(700);
      hasKey = true;
      return null;
    },
    ai_key_remove: () => { hasKey = false; return null; },
    // every mod is one small ini in the browser
    ai_mod_files: (a) => (a.ids as string[]).map((id) => ({
      id, more: 0,
      files: [{ path: "mod.ini", size: 2048 }, { path: "Body.buf", size: 81920 }],
      texts: [{ path: "mod.ini", text: "[TextureOverrideBody]\nhash = 1a2b3c4d\nvb1 = ResourceBody\n", cut: false, sections: ["TextureOverrideBody"] }],
    })),
  });
}
