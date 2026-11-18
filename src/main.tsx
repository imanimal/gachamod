import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./styles/base.css";
import "./styles/kit.css";
import "./styles/shell.css";
import "./styles/themes/default.css";
// every game theme's CSS comes in here, before any screen's CSS, so a screen rule wins a tie with a theme rule
import "./styles/themes/zzz.css";
import "./styles/themes/zzz-shell.css";
import "./styles/themes/zzz-screens.css";
import "./styles/themes/gi.css";
import "./styles/themes/hsr.css";
import "./styles/themes/ww.css";
import "./styles/themes/ef.css";
import "./styles/themes/clay.css";
import "./styles/fun.css";
import { installIdle } from "./lib/idle";
import { installTips } from "./lib/keys";
import { installTelemetry } from "./lib/telemetry";
import { installRenderWatch } from "./lib/renderWatch";
import { inTauri, isMenuWindow } from "./lib/tauri";
import { startSplash } from "./splash/splash";
import { adoptSavedChoice, lang, t } from "./lib/i18n";

const root = () => document.getElementById("root")!;

async function boot() {
  // outside Tauri (npm run dev in a browser) the demo backend answers every call; a Tauri release build leaves it out
  if (!(import.meta.env.PROD && import.meta.env.TAURI_ENV_PLATFORM) && !inTauri()) (await import("./lib/demo")).installDemo();
  // the page's language picks the right Chinese or Japanese glyphs and the system font for scripts Manrope lacks
  document.documentElement.lang = lang;
  void import("./lib/api").then(({ settings }) => settings.get("ui.lang")).then(adoptSavedChoice).catch(() => {});
  installTips();
  installIdle();

  // dev only: #kit shows every kit component in each theme (src/dev/KitShowcase.tsx)
  if (import.meta.env.DEV && location.hash === "#kit") {
    (await import("./dev/KitShowcase")).mount(root());
    return;
  }
  // the skin menu shown over a running game is its own small window (src-tauri overlay.rs); #overlay shows it in a browser
  if (isMenuWindow()) {
    installTelemetry("overlay");
    installRenderWatch("overlay");
    const m = await import("./screens/ingame/Overlay");
    createRoot(root()).render(<StrictMode><m.Overlay /></StrictMode>);
    return;
  }
  // dev builds and the browser demo: the console on ~ (src/dev/console)
  void import("./dev/console/Console").then((c) => c.mountConsole()).catch(() => {});
  const splash = startSplash();
  installTelemetry("main");
  installRenderWatch("main");
  const [m, eb, fb, toasts] = await Promise.all([
    import("./App"), import("./ui/ErrorBoundary"), import("./screens/settings/Feedback"), import("./ui/toast"), splash,
  ]);
  // App draws its own whole-window boundary; this one catches App itself failing before it gets there, so it brings
  // the feedback form and toasts its "Tell the developer" button needs
  const lastResort = <><eb.ErrorBoundary where={t("Feedback")} quiet><fb.FeedbackHost /></eb.ErrorBoundary><toasts.Toasts /></>;
  createRoot(root()).render(
    <StrictMode><eb.ErrorBoundary where="gachamod" whole extra={lastResort}><m.App /></eb.ErrorBoundary></StrictMode>,
  );
}

void boot().catch((e: unknown) => console.error("start", e));
