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
import { App } from "./App";
import { installDemo } from "./lib/demo";
import { installTips } from "./lib/keys";

installDemo();
installTips();

// dev only: #kit shows every kit component in each theme (src/dev/KitShowcase.tsx)
if (import.meta.env.DEV && location.hash === "#kit") void import("./dev/KitShowcase").then((m) => m.mount(document.getElementById("root")!));
else createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
