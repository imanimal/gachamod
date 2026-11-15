// The setup window's page (setup.html, built into dist-setup for src-setup). It uses the app's kit, shell classes
// and every game theme, so it looks like gachamod in whatever theme src-setup picked.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/fonts.css";
import "../styles/base.css";
import "../styles/kit.css";
import "../styles/shell.css";
import "../styles/themes/default.css";
import "../styles/themes/zzz.css";
import "../styles/themes/zzz-shell.css";
import "../styles/themes/zzz-screens.css";
import "../styles/themes/gi.css";
import "../styles/themes/hsr.css";
import "../styles/themes/ww.css";
import "../styles/themes/ef.css";
import "../styles/themes/clay.css";
import "./setup.css";
import { installTips } from "../lib/keys";
import { Setup } from "./Setup";

installTips();
// no browser menu or reload keys in a window that installs things
window.addEventListener("contextmenu", (e) => { if (!(e.target as HTMLElement).closest("input, textarea")) e.preventDefault(); });
window.addEventListener("keydown", (e) => { if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r")) e.preventDefault(); });
createRoot(document.getElementById("root")!).render(<StrictMode><Setup /></StrictMode>);
