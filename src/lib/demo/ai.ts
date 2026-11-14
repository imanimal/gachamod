// Demo handlers for the AI helper's command. Owner: SETTINGS/AI area.
import { registerDemo } from "../tauri";

export function registerAiDemo() {
  registerDemo({
    // pretend the ChatGPT app is installed, so the "On this PC" order shows in the browser
    ai_chatbots_installed: () => ["chatgpt"],
  });
}
