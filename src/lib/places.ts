// A message that names a setting or a place gets a button that opens it: "Zenless has no Mods folder yet" comes
// with "Mods folders", which opens that panel in Settings. Toasts pick the button up by themselves (ui/toast.tsx)
// when they have none of their own, and a note drawn in a page asks for it with placeFor. Messages from the backend
// count too, which is why this goes by their words: the English ones, since english() undoes a translation. A new
// message that sends people somewhere gets a line here.
import { errorText, xxmi } from "./api";
import { go } from "./store";
import { toast, toastHelper, type ToastAction } from "../ui/toast";
import { english, t } from "./i18n";

const settings = (section: string) => () => go({ view: "settings", section });

/** The first match wins, so the narrower message comes first. */
const PLACES: Array<[RegExp, ToastAction]> = [
  [/signed out of GameBanana|Sign in again in Settings/i, { label: t("GameBanana settings"), run: settings("account") }],
  [/IMM manages this mod|No Reload Mod Manager (manages|picks)|Tools, Share and import/i, { label: t("Move mods"), run: () => go({ view: "tools", section: "others" }) }],
  [/XXMI Launcher isn't installed|XXMI Launcher's exe is missing/i, { label: t("XXMI Launcher settings"), run: settings("xxmi") }],
  [/Open XXMI Launcher (once|and)|Set it in XXMI Launcher|launch in XXMI Launcher|Only XXMI Launcher can/i,
    { label: t("Open XXMI Launcher"), run: () => xxmi.open().catch((e) => { toast(errorText(e), true); }) }],
  [/no Mods folder/i, { label: t("Mods folders"), run: settings("mod-folders") }],
  [/The drive is full/i, { label: t("View storage"), run: settings("disk") }],
  [/game folder (isn't set|is gone)|game folder again in Settings|loader folder in Settings|yet\. Settings, Games|isn't set up|Set up a game first/i,
    { label: t("Game folders"), run: settings("games") }],
  [/Hide adult mods from the chatbot/i, { label: t("AI helper settings"), run: settings("set-ai-adult") }],
  [/Key list in game/i, { label: t("Key list settings"), run: () => go({ view: "tools", section: "keylist" }) }],
  // a key Windows wouldn't give gachamod (src-tauri hotkeys.rs): the button opens that key's setting
  [/can't open the skin menu\. Pick another key/i, { label: t("Switch skins in game"), run: () => go({ view: "tools", section: "ingame" }) }],
  [/can't show the key list\. Pick another key/i, { label: t("Key list settings"), run: () => go({ view: "tools", section: "keylist" }) }],
  [/can't switch profiles\. Pick another key/i, { label: t("Hotkey settings"), run: settings("hotkeys") }],
  [/Tester options in Settings/i, { label: t("Tester options"), run: settings("set-tester") }],
  [/exclusive fullscreen.*window mode/i, { label: t("Launch options"), run: settings("launch") }],
  [/Settings, Appearance/i, { label: t("Appearance"), run: settings("appearance") }],
  [/import it in Settings, Custom themes/i, { label: t("Custom themes"), run: settings("themes") }],
];

/** The button for a message that names a setting or a place, if it names one. */
export const placeFor = (text: string | null | undefined): ToastAction | undefined =>
  text ? PLACES.find(([re]) => re.test(english(text)))?.[1] : undefined;

for (const [re, action] of PLACES) toastHelper((t) => re.test(t), action);
