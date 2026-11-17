import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./styles/base.css";
import "./styles/kit.css";
import "./styles/shell.css";
import "./styles/themes/default.css";
import "./styles/fun.css";
import { installIdle } from "./lib/idle";
import { installTips } from "./lib/keys";
import { installTelemetry } from "./lib/telemetry";
import { installRenderWatch } from "./lib/renderWatch";
import { inTauri, isMenuWindow } from "./lib/tauri";
import { loadAllThemeCss, loadThemeCss } from "./lib/theme";
import { startSplash } from "./splash/splash";

const root = () => document.getElementById("root")!;
/** The game theme index.html picked before the first paint loads (lib/theme.ts) before the app draws, so its first
 *  frame isn't in Default. Two seconds at most. */
const themeReady = () => Promise.race([
  loadThemeCss(document.documentElement.dataset.theme ?? "default"),
  new Promise<void>((res) => setTimeout(res, 2000)),
]);

async function boot() {
  // outside Tauri (npm run dev in a browser) the demo backend answers every call; a Tauri release build leaves it out
  if (!(import.meta.env.PROD && import.meta.env.TAURI_ENV_PLATFORM) && !inTauri()) (await import("./lib/demo")).installDemo();
  installTips();
  installIdle();

  // dev only: #kit shows every kit component in each theme (src/dev/KitShowcase.tsx)
  if (import.meta.env.DEV && location.hash === "#kit") {
    await loadAllThemeCss();
    (await import("./dev/KitShowcase")).mount(root());
    return;
  }
  // the skin menu shown over a running game is its own small window (src-tauri overlay.rs); #overlay shows it in a browser
  if (isMenuWindow()) {
    installTelemetry("overlay");
    installRenderWatch("overlay");
    const [m] = await Promise.all([import("./screens/ingame/Overlay"), themeReady()]);
    createRoot(root()).render(<StrictMode><m.Overlay /></StrictMode>);
    return;
  }
  const splash = startSplash();
  installTelemetry("main");
  installRenderWatch("main");
  const [m, eb, fb, t] = await Promise.all([
    import("./App"), import("./ui/ErrorBoundary"), import("./screens/settings/Feedback"), import("./ui/toast"), themeReady(), splash,
  ]);
  // App draws its own whole-window boundary; this one catches App itself failing before it gets there, so it brings
  // the feedback form and toasts its "Tell the developer" button needs
  const lastResort = <><eb.ErrorBoundary where="Feedback" quiet><fb.FeedbackHost /></eb.ErrorBoundary><t.Toasts /></>;
  createRoot(root()).render(
    <StrictMode><eb.ErrorBoundary where="gachamod" whole extra={lastResort}><m.App /></eb.ErrorBoundary></StrictMode>,
  );
}

void boot().catch((e: unknown) => console.error("start", e));
