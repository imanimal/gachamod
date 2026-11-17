// Settings in the global search: every section and every setting, with the words people use for them ("trash",
// "recycle bin" and "disk space" all find how long removed mods keep their files). Picking one opens Settings at
// that setting. AI jobs show only when AI is on. Owner: SETTINGS/AI area.
import type { IconName } from "../../ui/Icon";
import type { PageInfo } from "./Paged";
import { aiShown, askAi } from "../../lib/ai";
import { ideasTask } from "../../lib/recommend";
import { registerCommands, type Command } from "../../lib/search";
import { currentGame, go } from "../../lib/store";
import { openXxmi } from "./parts";
import { openFeedback, openGameCheck } from "../../lib/feedback";

/** A panel in Settings: its id (a route section), the page it's on, and its name and words for the search. */
export interface SectionInfo { id: string; page: string; label: string; icon: IconName; keywords: string }

/** Settings' pages in order, each in its group in the list (Paged.tsx). A page holds the panels that belong together.
 *  A page's name says what is on it ("About and updates", not "About"), and its tip lists the rest. */
export const PAGES: PageInfo[] = [
  { id: "games", label: "Games and mod loaders", icon: "controller", group: "Games and mods", tip: "Game folders, one-game mode and XXMI Launcher" },
  { id: "launch", label: "Launch options", icon: "play", group: "Games and mods", tip: "How each game starts: XXMI or its exe, arguments, window mode, commands before and after, 3DMigoto's switches for mod makers and running as administrator" },
  { id: "mods", label: "Mods and downloads", icon: "mods", group: "Games and mods", tip: "Turning mods on, mods for adults, Mods folders, downloads, mod update checks, broken mods and the trash" },
  { id: "creators", label: "Creators", icon: "user", group: "Games and mods", tip: "Creators you follow, favourite, prioritize or block" },
  { id: "hotkeys", label: "In-game profile hotkeys", icon: "keyboard", group: "Games and mods", tip: "Keys that switch profiles while you play" },
  { id: "appearance", label: "Appearance", icon: "palette", group: "Look", tip: "Themes, colours, layout, text size, your own themes and hardware acceleration" },
  { id: "fun", label: "Fun extras", icon: "sparkle", group: "Look", tip: "Chill mode, the pull button, seasonal touches and your year in mods" },
  { id: "account", label: "Account, links and AI", icon: "link", group: "App", tip: "Your GameBanana account, 1-click installs, .gachamod files and the AI helper" },
  { id: "extensions", label: "Extensions", icon: "puzzle", group: "App", tip: "Themes and extensions other people made, extension lists and making your own" },
  { id: "feedback", label: "Feedback, privacy and logs", icon: "help", group: "App", tip: "Send feedback, tester options, usage counts, crash reports and log files" },
  { id: "about", label: "About and updates", icon: "info", group: "App", tip: "Version, gachamod updates (automatic or Check now), backing up settings, repair, reset and uninstall" },
];

/** The panels on those pages, in order. */
export const SECTIONS: SectionInfo[] = [
  { id: "games", page: "games", label: "Games and their folders", icon: "controller", keywords: "game folders paths add show hide detect one game mode" },
  { id: "xxmi", page: "games", label: "XXMI Launcher", icon: "package", keywords: "xxmi launcher importer gimi srmi zzmi wwmi himi efmi version folder mod loader" },
  { id: "launch", page: "launch", label: "Launch options", icon: "play", keywords: "launch start arguments args window mode borderless fullscreen priority commands before after exe xxmi fps limit hdr graphics reshade close when the game starts" },
  { id: "migoto", page: "launch", label: "Mod maker switches", icon: "code", keywords: "hunting mode dump shaders hide warnings log level calls debug logging enforce rendering 3dmigoto d3dx mod makers" },
  { id: "game-start", page: "launch", label: "Run as administrator", icon: "shield", keywords: "admin administrator elevated uac keys" },
  { id: "mods", page: "mods", label: "Turning mods on and reloading the game", icon: "mods", keywords: "new mods enable one skin shuffle reload f10" },
  { id: "adult", page: "mods", label: "Mods for adults", icon: "eye", keywords: "nsfw 18+ adult lewd blur hide show censor" },
  { id: "mod-folders", page: "mods", label: "Mods folders", icon: "folder", keywords: "mods folder path location directory where mods live detect find change pick set mod folder" },
  { id: "installing", page: "mods", label: "Downloads and installing", icon: "downloads", keywords: "download archive zip 7z rar keep delete slow server install parts variants toggles new mods" },
  { id: "automatic", page: "mods", label: "Mod update checks and rescans", icon: "refresh", keywords: "auto automatic background checks turn off disable mod updates rescan scan" },
  { id: "broken-mods", page: "mods", label: "Mods a game update broke", icon: "wand", keywords: "fixer fixes hash broken game update patch warning mute outdated" },
  { id: "storage", page: "mods", label: "Trash and removed mods", icon: "archive", keywords: "trash disk space removed files storage recycle bin deleted" },
  { id: "creators", page: "creators", label: "Creators", icon: "user", keywords: "authors modders followed favourite favorite blocked prioritized whitelist blacklist" },
  { id: "hotkeys", page: "hotkeys", label: "In-game profile hotkeys", icon: "keyboard", keywords: "profile switch keys shortcut in game hotkeys next previous" },
  { id: "appearance", page: "appearance", label: "Theme and colours", icon: "palette", keywords: "theme look dark light colours colors accent scheme" },
  { id: "layout", page: "appearance", label: "Layout, text size and animations", icon: "layout", keywords: "density compact spacing sidebar corners buttons font size zoom motion animation hints" },
  { id: "themes", page: "appearance", label: "Custom themes", icon: "wand", keywords: "my themes import export json make own theme" },
  { id: "graphics", page: "appearance", label: "Hardware acceleration and rendering log", icon: "sliders", keywords: "gpu graphics card black screen window blank flicker drawing rendering performance" },
  { id: "fun", page: "fun", label: "Fun extras", icon: "sparkle", keywords: "fun extras chill lower case lowercase pull wish warp gacha random seasonal snow hearts halloween year stats wrapped mod of the day" },
  { id: "account", page: "account", label: "GameBanana account", icon: "user", keywords: "login log in sign in gamebanana gb account" },
  { id: "integrations", page: "account", label: "1-click installs and .gachamod files", icon: "link", keywords: "gachamod links protocol url .gachamod file association default app 1-click one click install" },
  { id: "ai", page: "account", label: "AI helper", icon: "ai", keywords: "ai chatbot chatgpt claude gemini copilot grok gpt llm assistant" },
  { id: "extensions", page: "extensions", label: "Extensions", icon: "puzzle", keywords: "extensions plugins addons add-ons themes repo marketplace store community download share" },
  { id: "feedback", page: "feedback", label: "Feedback and testing", icon: "help", keywords: "feedback bug report problem suggestion idea contact developer tester check game" },
  { id: "privacy", page: "feedback", label: "Usage counts and crash reports", icon: "eye", keywords: "telemetry usage analytics counts crash reports privacy anonymous data tracking" },
  { id: "logs", page: "feedback", label: "Log files", icon: "file", keywords: "logs log file gachamod.log rendering log errors debug folder" },
  { id: "about", page: "about", label: "About gachamod", icon: "info", keywords: "version data folder licences licenses credits ko-fi kofi tip donate support" },
  { id: "updates", page: "about", label: "gachamod updates", icon: "update", keywords: "update check now new version upgrade automatic release notes what's new" },
  { id: "transfer", page: "about", label: "Back up or move your settings", icon: "export", keywords: "export import backup restore settings file new pc migrate" },
  { id: "repair", page: "about", label: "Repair, reset or uninstall", icon: "tool", keywords: "repair uninstall setup reinstall reset start over factory defaults" },
];

/** Single settings: [row id (a route section), the section it sits in, title, keywords, icon]. */
const SETTINGS: Array<[string, string, string, string, IconName]> = [
  ["set-admin", "game-start", "Run as administrator", "admin administrator elevated uac f10 keys hotkeys zenless zzz always restart", "shield"],
  ["set-only-game", "games", "One-game mode", "one game only single focus just one exclusive hide other games main game", "focus"],
  ["set-community", "games", "Community games", "pgr punishing gray raven p5x persona gf2 girls frontline identity v stella sora taimanin 3dmigoto loader other games", "controller"],
  ["set-links", "integrations", "1-click installs from GameBanana", "gachamod links protocol url one click install handler default app", "link"],
  ["set-files", "integrations", "Open .gachamod files", "gachamod file pack association double click open with default app", "link"],
  ["set-scheme", "appearance", "Light or dark mode", "dark mode light mode night theme scheme system colours colors", "moon"],
  ["set-accent", "appearance", "Accent colour", "accent color colour highlight tint", "palette"],
  ["set-layout", "layout", "Layout", "density compact comfortable spacing sidebar left right nav style corners round sharp buttons", "layout"],
  ["set-text-size", "layout", "Text size", "font size zoom bigger smaller scale ui size", "sliders"],
  ["set-motion", "layout", "Animations", "motion animation reduce reduced effects transitions", "sparkle"],
  ["set-intro", "layout", "Opening screen", "intro splash startup start opening animation loading screen tips tip of the day", "play"],
  ["set-hints", "layout", "First-start hints", "hints tips highlight tutorial tour guide new user first start", "info"],
  ["set-gpu", "graphics", "Hardware acceleration", "gpu graphics card hardware acceleration black screen window blank flicker drawing rendering performance", "sliders"],
  ["set-shuffle", "mods", "Shuffle outfits", "random randomize randomise outfits skins surprise each launch play daily", "dice"],
  ["set-chill", "fun", "Chill mode", "lower case lowercase chill relaxed text casual", "sparkle"],
  ["set-pull", "fun", "Pull button", "pull wish warp signal search convene headhunt gacha random mod pity 5 star roll lucky", "star"],
  ["set-seasonal", "fun", "Seasonal touches", "snow christmas winter valentine hearts halloween bats pumpkins spooky holiday season", "snow"],
  ["set-year", "fun", "Your year in mods", "year stats wrapped recap summary hours played most mods", "calendar"],
  ["set-enable-new", "mods", "Turn on new mods", "auto enable activate new mods after install download turn on automatically off by default", "power"],
  ["set-nsfw", "adult", "Hide, blur or show mods for adults", "nsfw 18+ adult lewd blur hide show censor", "eye"],
  ["set-gb-adult", "adult", "Match my GameBanana settings", "nsfw adult gamebanana account content ratings sync match same as site", "eye"],
  ["set-pergame", "mods", "One skin per character", "single skin outfit only one at a time auto turn off others", "characters"],
  ["set-pergame", "mods", "Reload in game automatically", "f10 reload refresh in game auto press", "refresh"],
  ["set-app-updates", "updates", "Update gachamod automatically", "app update check new version upgrade auto install automatic", "update"],
  ["set-app-check", "updates", "Check for gachamod updates", "app update check now new version upgrade latest", "update"],
  ["set-mod-updates", "automatic", "Check mods for updates", "mod updates outdated gamebanana auto check", "update"],
  ["set-rescan", "automatic", "Rescan mods automatically", "scan rescan refresh folder watch auto", "refresh"],
  ["set-archives", "installing", "Delete downloaded archives", "zip 7z rar archive keep downloads cleanup disk space", "trash"],
  ["set-all-parts", "installing", "Install every mod in an archive", "archive several mods variants parts pick which ask window all", "layers"],
  ["set-other-servers", "installing", "Move slow downloads to another server", "slow download speed mirror server filecache gamebanana faster", "downloads"],
  ["set-fix-updates", "broken-mods", "Look for new mod fixers", "fixer fixes hash broken game update patch auto", "wand"],
  ["set-fix-warn", "broken-mods", "Warn about mods a game update broke", "mute fixes broken outdated hash warning badge hide", "bell"],
  ["set-onscreen", "installing", "Toggles only while on screen", "toggles hotkeys keybinds key conflict off screen character visible active", "key"],
  ["set-ext-sources", "extensions", "Extension lists", "repo repository index source marketplace url add another list", "puzzle"],
  ["set-ext-make", "extensions", "Make an extension", "develop create build plugin addon package link folder share submit upload", "code"],
  ["set-trash-days", "storage", "Keep removed mods' files", "trash recycle bin deleted removed days storage disk space archive purge", "trash"],
  ["set-gb-signin", "account", "Sign in to GameBanana", "login log in account follow like subscribe session", "user"],
  ["set-creators-sub", "creators", "Followed creators", "following subscribed subscriptions authors", "feed"],
  ["set-creators-fav", "creators", "Favourite creators", "favorite favourites starred authors", "star"],
  ["set-creators-prio", "creators", "Prioritized creators", "priority whitelist first top authors", "crown"],
  ["set-creators-blocked", "creators", "Blocked creators", "block blacklist mute hide authors", "block"],
  ["set-feedback", "feedback", "Send feedback", "feedback bug report problem suggestion idea contact developer message", "help"],
  ["set-tester", "feedback", "Tester options", "tester testing experimental beta menu the game draws inside the game exclusive fullscreen switch skins live wuthering waves endfield", "check"],
  ["set-gamecheck", "feedback", "Check this game", "test testing tester check game report works switching skins menu genshin star rail wuthering waves endfield", "check"],
  ["set-usage", "privacy", "Usage counts", "telemetry analytics usage statistics tracking privacy anonymous", "eye"],
  ["set-crashes", "privacy", "Crash reports", "crash report error bug automatic send privacy", "bug"],
  ["set-logs", "logs", "Logs", "log logs file gachamod.log errors debug folder", "file"],
  ["set-render-log", "logs", "Rendering log", "rendering log black screen window blank flicker gpu graphics card driver nvidia frames debug", "file"],
  ["set-ai-show", "ai", "Turn AI on or off", "ai off hide ai disable chatbot buttons show everything", "ai"],
  ["set-xxmi-uninstall", "xxmi", "Uninstall XXMI Launcher", "uninstall remove delete xxmi launcher mod loader importer gimi srmi zzmi wwmi himi efmi recycle bin", "trash"],
  ["set-reset", "repair", "Reset gachamod", "reset start over factory defaults clear wipe fresh delete settings data", "undo"],
  ["set-ai-chatbot", "ai", "Your chatbot", "chatgpt claude gemini copilot grok chatbot pick change", "ai"],
  ["set-ai-adult", "ai", "Hide adult mods from the chatbot", "nsfw adult explicit names prompt refuse refused chatbot hide", "ai"],
];

/** The page a panel or a setting row is on, to open it when the panel or row isn't shown (AI turned off, an empty list). */
export const sectionOf = (id: string): string | undefined => {
  const section = SETTINGS.find((s) => s[0] === id)?.[1] ?? id;
  return SECTIONS.find((s) => s.id === section)?.page;
};

/** "Settings › Mods and downloads › Trash and removed mods" for a panel or a setting in it (the panel is left out when
 *  it has the page's name). */
export function settingsWhere(panel: string): string {
  const sec = SECTIONS.find((s) => s.id === panel);
  const page = PAGES.find((p) => p.id === sec?.page);
  if (!sec || !page) return "Settings";
  return sec.label === page.label ? `Settings › ${page.label}` : `Settings › ${page.label} › ${sec.label}`;
}

registerCommands("settings", () => {
  const list: Command[] = SECTIONS.map((s) => {
    const page = PAGES.find((p) => p.id === s.page);
    return {
      id: `settings:${s.id}`, title: s.label, section: "Settings", icon: s.icon, keywords: `settings ${s.keywords}`,
      where: page && page.label !== s.label ? `Settings › ${page.label}` : "Settings",
      run: () => go({ view: "settings", section: s.id }),
    };
  });
  for (const [section, panel, title, keywords, icon] of SETTINGS) {
    if ((section === "set-ai-chatbot" || section === "set-ai-adult") && !aiShown("useful")) continue;
    list.push({ id: `settings:${section}:${title}`, title, section: "Settings", icon, keywords: `setting ${keywords}`, where: settingsWhere(panel),
      run: () => go({ view: "settings", section }) });
  }
  list.push(
    { id: "page:extensions", title: "Extensions", section: "Pages", icon: "puzzle", keywords: "extensions plugins addons add-ons themes get more download marketplace store",
      run: () => go({ view: "extensions" }) },
    { id: "page:themes-online", title: "Get more themes", section: "Actions", icon: "palette", keywords: "themes download community share look skins", where: "Extensions › Themes",
      run: () => go({ view: "extensions", section: "themes" }) },
  );
  list.push({ id: "act:feedback", title: "Send feedback", section: "Actions", icon: "help", where: "Settings › Feedback, privacy and logs", keywords: "feedback bug report problem suggestion idea contact developer", run: () => openFeedback() });
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
