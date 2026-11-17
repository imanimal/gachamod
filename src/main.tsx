import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./styles/base.css";
import "./styles/kit.css";
import "./styles/shell.css";
import "./styles/themes/default.css";
import "./styles/themes/zzz.css";
import "./styles/themes/zzz-shell.css";
import "./styles/themes/zzz-screens.css";
import "./styles/themes/gi.css";
import "./styles/themes/hsr.css";
import "./styles/themes/ww.css";
import "./styles/themes/ef.css";
import "./styles/themes/clay.css";
import "./styles/fun.css";
import { App } from "./App";
import { installDemo } from "./lib/demo";
import { installTips } from "./lib/keys";
import { installTelemetry } from "./lib/telemetry";
import { installRenderWatch } from "./lib/renderWatch";
import { isMenuWindow } from "./lib/tauri";
import { startSplash } from "./splash/splash";

installDemo();
installTips();

// dev only: #kit shows every kit component in each theme (src/dev/KitShowcase.tsx)
// the skin menu shown over a running game is its own small window (src-tauri overlay.rs); #overlay shows it in a browser
if (import.meta.env.DEV && location.hash === "#kit") void import("./dev/KitShowcase").then((m) => m.mount(document.getElementById("root")!));
else if (isMenuWindow()) {
  installTelemetry("overlay");
  installRenderWatch("overlay");
  void import("./screens/ingame/Overlay").then((m) => createRoot(document.getElementById("root")!).render(<StrictMode><m.Overlay /></StrictMode>));
}
else { startSplash(); installTelemetry("main"); installRenderWatch("main"); createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>); }
