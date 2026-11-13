// Demo backend for running the UI in a plain browser (npm run dev, no Tauri): every command has a handler answering
// with believable data from demo/db.ts. Each area keeps its handlers in its own file and registers them here.
// GameBanana calls are real even in the demo (the API allows CORS). Owner: skeleton.
import { inTauri, registerDemo } from "../tauri";
import { demoDb } from "./db";
import { registerLibraryDemo } from "./library";
import { registerModtoolsDemo } from "./modtools";
import { registerOnlineDemo } from "./online";
import { registerSystemDemo } from "./system";

export function installDemo() {
  if (inTauri()) return;
  registerDemo({
    app_info: () => ({ name: "gachamod", version: "0.1.0-demo" }),
    startup_opened: () => [],
    settings_get: ({ key }) => demoDb.settings.get(String(key)) ?? null,
    settings_set: ({ key, value }) => { demoDb.settings.set(String(key), String(value)); },
    open_path: () => undefined,
    reveal_path: () => undefined,
    open_url: ({ url }) => { window.open(String(url), "_blank", "noopener"); },
  });
  registerSystemDemo();
  registerLibraryDemo();
  registerModtoolsDemo();
  registerOnlineDemo();
}
