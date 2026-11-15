// Settings in the global search: every section and every setting, with the words people use for them ("trash",
// "recycle bin" and "disk space" all find how long removed mods keep their files). Picking one opens Settings at
// that setting. AI jobs show only when AI is on. Owner: SETTINGS/AI area.
import type { IconName } from "../../ui/Icon";
import { aiShown, askAi } from "../../lib/ai";
import { ideasTask } from "../../lib/recommend";
import { registerCommands, type Command } from "../../lib/search";
import { currentGame, go } from "../../lib/store";
import { openXxmi } from "./parts";
import { openFeedback, openGameCheck } from "../../lib/feedback";

export interface SectionInfo { id: string; label: string; icon: IconName; keywords: string }

export const SECTIONS: SectionInfo[] = [
  { id: "games", label: "Games", icon: "controller", keywords: "game folders paths add show hide detect" },
  { id: "xxmi", label: "XXMI Launcher", icon: "package", keywords: "xxmi launcher importer gimi srmi zzmi wwmi himi efmi version folder" },
  { id: "integrations", label: "Links and files", icon: "link", keywords: "gachamod links protocol url .gachamod file association default app 1-click one click install" },
  { id: "appearance", label: "Appearance", icon: "palette", keywords: "theme look dark light colours colors accent layout" },
  { id: "themes", label: "Custom themes", icon: "wand", keywords: "my themes import export json make own theme" },
  { id: "extensions", label: "Extensions", icon: "puzzle", keywords: "extensions plugins addons add-ons themes repo marketplace store community download share" },
  { id: "mods", label: "Mods", icon: "mods", keywords: "nsfw adult one skin reload f10" },
  { id: "automatic", label: "Automatic", icon: "refresh", keywords: "auto automatic background checks turn off disable" },
  { id: "storage", label: "Storage", icon: "archive", keywords: "trash disk space removed files" },
  { id: "creators", label: "Creators", icon: "user", keywords: "authors modders followed favourite favorite blocked prioritized whitelist blacklist" },
  { id: "hotkeys", label: "In-game hotkeys", icon: "keyboard", keywords: "profile switch keys shortcut in game" },
  { id: "account", label: "GameBanana account", icon: "user", keywords: "login log in sign in gamebanana gb account" },
  { id: "ai", label: "AI helper", icon: "ai", keywords: "ai chatbot chatgpt claude gemini copilot grok gpt llm assistant" },
  { id: "transfer", label: "Back up and move", icon: "export", keywords: "export import backup restore settings file new pc migrate" },
  { id: "fun", label: "Fun", icon: "sparkle", keywords: "fun extras chill lower case lowercase pity counter seasonal snow hearts year stats wrapped mod of the day" },
  { id: "feedback", label: "Feedback and data", icon: "help", keywords: "feedback bug report problem suggestion idea contact developer telemetry usage analytics counts crash reports logs log file privacy" },
  { id: "about", label: "About", icon: "info", keywords: "version data folder licences licenses credits update ko-fi kofi tip donate support" },
];

/** Single settings: [row id (a route section), the section it sits in, title, keywords, icon]. */
const SETTINGS: Array<[string, string, string, string, IconName]> = [
  ["set-admin", "games", "Run as administrator", "admin administrator elevated uac f10 keys hotkeys zenless zzz always restart", "shield"],
  ["set-only-game", "games", "One-game mode", "one game only single focus just one exclusive hide other games main game", "focus"],
  ["set-community", "games", "Community games", "pgr punishing gray raven p5x persona gf2 girls frontline identity v stella sora taimanin 3dmigoto loader other games", "controller"],
  ["set-links", "integrations", "1-click installs from GameBanana", "gachamod links protocol url one click install handler default app", "link"],
  ["set-files", "integrations", "Open .gachamod files", "gachamod file pack association double click open with default app", "link"],
  ["set-scheme", "appearance", "Light or dark mode", "dark mode light mode night theme scheme system colours colors", "moon"],
  ["set-accent", "appearance", "Accent colour", "accent color colour highlight tint", "palette"],
  ["set-layout", "appearance", "Layout", "density compact comfortable spacing sidebar left right nav style corners round sharp buttons", "layout"],
  ["set-text-size", "appearance", "Text size", "font size zoom bigger smaller scale ui size", "sliders"],
  ["set-motion", "appearance", "Animations", "motion animation reduce reduced effects transitions", "sparkle"],
  ["set-shuffle", "mods", "Shuffle outfits", "random randomize randomise outfits skins surprise each launch play daily", "dice"],
  ["set-chill", "fun", "Chill mode", "lower case lowercase chill relaxed text casual", "sparkle"],
  ["set-pity", "fun", "Pity counter", "pity gacha hard soft 90 browse count", "sparkle"],
  ["set-seasonal", "fun", "Seasonal touches", "snow christmas winter valentine hearts holiday season", "snow"],
  ["set-year", "fun", "Your year in mods", "year stats wrapped recap summary hours played most mods", "calendar"],
  ["set-nsfw", "mods", "Mods for adults", "nsfw 18+ adult lewd blur hide show censor", "eye"],
  ["set-pergame", "mods", "One skin per character", "single skin outfit only one at a time auto turn off others", "characters"],
  ["set-pergame", "mods", "Reload in game automatically", "f10 reload refresh in game auto press", "refresh"],
  ["set-app-updates", "automatic", "Check for gachamod updates", "app update new version upgrade auto", "update"],
  ["set-mod-updates", "automatic", "Check mods for updates", "mod updates outdated gamebanana auto check", "update"],
  ["set-rescan", "automatic", "Rescan mods automatically", "scan rescan refresh folder watch auto", "refresh"],
  ["set-archives", "automatic", "Delete downloaded archives", "zip 7z rar archive keep downloads cleanup disk space", "trash"],
  ["set-fix-updates", "automatic", "Look for new mod fixers", "fixer fixes hash broken game update patch auto", "wand"],
  ["set-onscreen", "automatic", "Toggles only while on screen", "toggles hotkeys keybinds key conflict off screen character visible active", "key"],
  ["set-ext-sources", "extensions", "Extension lists", "repo repository index source marketplace url add another list", "puzzle"],
  ["set-ext-make", "extensions", "Make an extension", "develop create build plugin addon package link folder share submit upload", "code"],
  ["set-trash-days", "storage", "Keep removed mods' files", "trash recycle bin deleted removed days storage disk space archive purge", "trash"],
  ["set-gb-signin", "account", "Sign in to GameBanana", "login log in account follow like subscribe session", "user"],
  ["set-creators-sub", "creators", "Followed creators", "following subscribed subscriptions authors", "feed"],
  ["set-creators-fav", "creators", "Favourite creators", "favorite favourites starred authors", "star"],
  ["set-creators-prio", "creators", "Prioritized creators", "priority whitelist first top authors", "crown"],
  ["set-creators-blocked", "creators", "Blocked creators", "block blacklist mute hide authors", "block"],
  ["set-feedback", "feedback", "Send feedback", "feedback bug report problem suggestion idea contact developer message", "help"],
  ["set-gamecheck", "feedback", "Check this game", "test testing tester check game report works switching skins menu genshin star rail wuthering waves endfield", "check"],
  ["set-usage", "feedback", "Usage counts", "telemetry analytics usage statistics tracking privacy anonymous", "eye"],
  ["set-crashes", "feedback", "Crash reports", "crash report error bug automatic send privacy", "bug"],
  ["set-logs", "feedback", "Logs", "log logs file gachamod.log errors debug folder", "file"],
  ["set-ai-show", "ai", "Turn AI on or off", "ai off hide ai disable chatbot buttons show everything", "ai"],
  ["set-ai-chatbot", "ai", "Your chatbot", "chatgpt claude gemini copilot grok chatbot pick change", "ai"],
];

/** The section a setting row sits in, to scroll there when the row isn't shown (an empty list). */
export const sectionOf = (rowId: string): string | undefined => SETTINGS.find((s) => s[0] === rowId)?.[1];

registerCommands("settings", () => {
  const list: Command[] = SECTIONS.map((s) => ({
    id: `settings:${s.id}`, title: s.label, section: "Settings", icon: s.icon, keywords: `settings ${s.keywords}`, hint: "In Settings",
    run: () => go({ view: "settings", section: s.id }),
  }));
  for (const [section, , title, keywords, icon] of SETTINGS) {
    if (section.startsWith("set-ai-chatbot") && !aiShown("useful")) continue;
    list.push({ id: `settings:${section}:${title}`, title, section: "Settings", icon, keywords: `setting ${keywords}`, hint: "In Settings",
      run: () => go({ view: "settings", section }) });
  }
  list.push(
    { id: "page:extensions", title: "Extensions", section: "Pages", icon: "puzzle", keywords: "extensions plugins addons add-ons themes get more download marketplace store",
      run: () => go({ view: "extensions" }) },
    { id: "page:themes-online", title: "Get more themes", section: "Actions", icon: "palette", keywords: "themes download community share look skins",
      run: () => go({ view: "extensions", section: "themes" }) },
  );
  list.push({ id: "act:feedback", title: "Send feedback", section: "Actions", icon: "help", keywords: "feedback bug report problem suggestion idea contact developer", run: () => openFeedback() });
  list.push({ id: "act:gamecheck", title: "Check this game", section: "Actions", icon: "check", keywords: "test testing tester check game report switching skins menu", run: openGameCheck });
  list.push({ id: "act:xxmi", title: "Open XXMI Launcher", section: "Actions", icon: "external", keywords: "xxmi launcher open start run", run: openXxmi });

  const g = currentGame();
  if (aiShown("useful")) {
    list.push({ id: "ai:theme", title: "Make a theme with your chatbot", section: "Actions", icon: "ai", keywords: "ai chatbot theme generate custom colours chatgpt claude",
      run: () => askAi({ kind: "theme", game: g?.id }) });
    if (g) {
      list.push(
        { id: "ai:tidy", title: "Tidy mod names with your chatbot", section: "Actions", icon: "ai", keywords: "ai chatbot rename clean names bulk mass chatgpt claude",
          run: () => askAi({ kind: "mods", game: g.id, detail: "clean" }) },
        { id: "ai:chars", title: "Set mod characters with your chatbot", section: "Actions", icon: "ai", keywords: "ai chatbot character assign sort bulk",
          run: () => askAi({ kind: "mods", game: g.id, detail: "characters" }) },
      );
    }
  }
  if (g && aiShown("extra")) {
    list.push({ id: "ai:ideas", title: "Ask your chatbot for mod ideas", section: "Actions", icon: "ai", keywords: "ai chatbot recommend suggest ideas what to download",
      run: () => { void ideasTask(g.id).then(askAi); } });
  }
  return list;
});
