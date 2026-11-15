// A message that names a setting or a place gets a button that opens it: "Zenless has no Mods folder yet" comes
// with "Mods folders", which opens that panel in Settings. Toasts pick the button up by themselves (ui/toast.tsx)
// when they have none of their own, and a note drawn in a page asks for it with placeFor. Messages from the backend
// count too, which is why this goes by their words. A new message that sends people somewhere gets a line here.
import { errorText, xxmi } from "./api";
import { go } from "./store";
import { toast, toastHelper, type ToastAction } from "../ui/toast";

const settings = (section: string) => () => go({ view: "settings", section });

/** The first match wins, so the narrower message comes first. */
const PLACES: Array<[RegExp, ToastAction]> = [
  [/signed out of GameBanana|Sign in again in Settings/i, { label: "Account settings", run: settings("account") }],
  [/IMM manages this mod|Move mods from IMM/i, { label: "Move from IMM", run: () => go({ view: "tools", section: "imm" }) }],
  [/XXMI Launcher isn't installed|XXMI Launcher's exe is missing/i, { label: "XXMI Launcher settings", run: settings("xxmi") }],
  [/Open XXMI Launcher (once|and)|Set it in XXMI Launcher|launch in XXMI Launcher|Only XXMI Launcher can/i,
    { label: "Open XXMI Launcher", run: () => xxmi.open().catch((e) => { toast(errorText(e), true); }) }],
  [/no Mods folder/i, { label: "Mods folders", run: settings("mod-folders") }],
  [/game folder (isn't set|is gone)|game folder again in Settings|loader folder in Settings|yet\. Settings, Games|isn't set up|Set up a game first/i,
    { label: "Game folders", run: settings("games") }],
  [/import it in Settings, Custom themes/i, { label: "Custom themes", run: settings("themes") }],
];

/** The button for a message that names a setting or a place, if it names one. */
export const placeFor = (text: string | null | undefined): ToastAction | undefined =>
  text ? PLACES.find(([re]) => re.test(text))?.[1] : undefined;

for (const [re, action] of PLACES) toastHelper((t) => re.test(t), action);
