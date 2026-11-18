// Settings' pages, panels and single settings, with the words people use for them ("trash", "recycle bin" and "disk
// space" all find how long removed mods keep their files). The global search lists the panels and settings, and
// picking one opens Settings at it; the search at the top of Settings and Tools (menuSearch.ts) uses all three. AI
// jobs show only when AI is on. Owner: SETTINGS/AI area.
import type { IconName } from "../../ui/Icon";
import type { PageInfo } from "./Paged";
import { aiShown, askAi } from "../../lib/ai";
import { ideasTask } from "../../lib/recommend";
import { registerCommands, type Command } from "../../lib/search";
import { currentGame, go } from "../../lib/store";
import { openXxmi } from "./parts";
import { openFeedback, openGameCheck } from "../../lib/feedback";
import { english, t } from "../../lib/i18n";

// Labels show in the user's language, and the search still finds them by their English names: shown() keeps each
// label's English (english() has it right after t()), and the commands carry it in their keywords.
const EN = new Map<string, string>();
const shown = (label: string) => { EN.set(label, english(label)); return label; };
const en = (label: string) => EN.get(label) ?? label;

/** A panel in Settings: its id (a route section), the page it's on, and its name and words for the search. */
export interface SectionInfo { id: string; page: string; label: string; icon: IconName; keywords: string }

/** Settings' pages in order, each in its group in the list (Paged.tsx). A page holds the panels that belong together.
 *  The groups follow the usual desktop order: the app in general first, then what it manages (games and mods), then
 *  the services and add-ons it connects to, then feedback and the version. A page's name is a word or two, its tip
 *  lists everything on it, and its keywords keep older names ("Account", "Creators") so they still find it. */
export const PAGES: PageInfo[] = [
  { id: "general", label: shown(t("General")), icon: "settings", group: t("General"), tip: t("Language, the opening screen, first-start hints and hardware acceleration"),
    keywords: "general language startup" },
  { id: "appearance", label: shown(t("Appearance")), icon: "palette", group: t("General"), tip: t("Themes, colours, the Mods layout, spacing, text size, zoom, animations and your own themes"),
    keywords: "look theme" },
  { id: "hotkeys", label: shown(t("Hotkeys")), icon: "keyboard", group: t("General"), tip: t("Keys that switch profiles while you play"),
    keywords: "in-game profile hotkeys controls" },
  { id: "fun", label: shown(t("Fun")), icon: "sparkle", group: t("General"), tip: t("Chill mode, the pull button, seasonal touches and your year in mods"),
    keywords: "fun extras" },
  { id: "games", label: shown(t("Games")), icon: "controller", group: t("Games and mods"), tip: t("Game folders, one-game mode and XXMI Launcher"),
    keywords: "games and mod loaders" },
  { id: "launch", label: shown(t("Launch")), icon: "play", group: t("Games and mods"), tip: t("How each game starts: XXMI or its exe, arguments, window mode, commands before and after, 3DMigoto's switches for mod makers and running as administrator"),
    keywords: "launch options start" },
  { id: "mods", label: shown(t("Mods")), icon: "mods", group: t("Games and mods"), tip: t("Turning mods on, Mods folders, mod update checks, broken mods and the trash") },
  { id: "downloads", label: shown(t("Downloads")), icon: "downloads", group: t("Games and mods"), tip: t("Archives, slow downloads, files gachamod can't place and which parts of an archive install"),
    keywords: "downloads and installing" },
  { id: "gamebanana", label: shown(t("GameBanana")), icon: "web", group: t("Online"), tip: t("Your GameBanana account, 1-click installs, creators you follow or block, and mods for adults"),
    keywords: "gamebanana account creators gb" },
  { id: "ai", label: shown(t("AI helper")), icon: "ai", group: t("Online"), tip: t("Which chatbot helps, what it may do, and whether its buttons show"),
    keywords: "ai chatbot" },
  { id: "extensions", label: shown(t("Extensions")), icon: "puzzle", group: t("Online"), tip: t("Themes and extensions other people made, extension lists and making your own") },
  { id: "feedback", label: shown(t("Feedback and privacy")), icon: "help", group: t("App"), tip: t("Send feedback, tester options, usage counts, crash reports and log files"),
    keywords: "feedback privacy and logs" },
  { id: "about", label: shown(t("About and updates")), icon: "info", group: t("App"), tip: t("Version, gachamod updates (automatic or Check now), backing up settings, repair, reset and uninstall"),
    keywords: "about and updates" },
];

/** The panels on those pages, in order. */
export const SECTIONS: SectionInfo[] = [
  { id: "general", page: "general", label: shown(t("Language and startup")), icon: "web", keywords: "language translation chinese spanish portuguese russian english opening screen intro splash hints first start" },
  { id: "graphics", page: "general", label: shown(t("Hardware acceleration and rendering log")), icon: "sliders", keywords: "gpu graphics card black screen window blank flicker drawing rendering performance" },
  { id: "appearance", page: "appearance", label: shown(t("Theme and colours")), icon: "palette", keywords: "theme look dark light colours colors accent scheme" },
  { id: "layout", page: "appearance", label: shown(t("Layout, text size and animations")), icon: "layout", keywords: "mods layout cards list panes density compact spacing sidebar buttons font size zoom scale motion animation smooth scrolling background" },
  { id: "themes", page: "appearance", label: shown(t("Custom themes")), icon: "wand", keywords: "my themes import export json make own theme" },
  { id: "hotkeys", page: "hotkeys", label: shown(t("In-game profile hotkeys")), icon: "keyboard", keywords: "profile switch keys shortcut in game hotkeys next previous" },
  { id: "fun", page: "fun", label: shown(t("Fun extras")), icon: "sparkle", keywords: "fun extras chill lower case lowercase pull wish warp gacha random seasonal snow hearts halloween year stats wrapped mod of the day" },
  { id: "games", page: "games", label: shown(t("Games and their folders")), icon: "controller", keywords: "game folders paths add show hide detect one game mode" },
  { id: "xxmi", page: "games", label: shown(t("XXMI Launcher")), icon: "package", keywords: "xxmi launcher importer gimi srmi zzmi wwmi himi efmi version folder mod loader" },
  { id: "launch", page: "launch", label: shown(t("Launch options")), icon: "play", keywords: "launch start arguments args window mode borderless fullscreen priority commands before after exe xxmi fps limit hdr graphics reshade close when the game starts" },
  { id: "migoto", page: "launch", label: shown(t("Mod maker switches")), icon: "code", keywords: "hunting mode dump shaders hide warnings log level calls debug logging enforce rendering 3dmigoto d3dx mod makers" },
  { id: "game-start", page: "launch", label: shown(t("Run as administrator")), icon: "shield", keywords: "admin administrator elevated uac keys" },
  { id: "mods", page: "mods", label: shown(t("Turning mods on and reloading the game")), icon: "mods", keywords: "new mods enable one skin shuffle reload f10" },
  { id: "mod-folders", page: "mods", label: shown(t("Mods folders")), icon: "folder", keywords: "mods folder path location directory where mods live detect find change pick set mod folder" },
  { id: "automatic", page: "mods", label: shown(t("Mod update checks and rescans")), icon: "refresh", keywords: "auto automatic background checks turn off disable mod updates rescan scan watch" },
  { id: "broken-mods", page: "mods", label: shown(t("Mods a game update broke")), icon: "wand", keywords: "fixer fixes hash broken game update patch warning mute outdated" },
  { id: "storage", page: "mods", label: shown(t("Trash and removed mods")), icon: "archive", keywords: "trash disk space removed files storage recycle bin deleted" },
  { id: "installing", page: "downloads", label: shown(t("Downloads and installing")), icon: "downloads", keywords: "download archive zip 7z rar keep delete slow server install parts variants toggles new mods" },
  { id: "account", page: "gamebanana", label: shown(t("GameBanana account")), icon: "user", keywords: "login log in sign in gamebanana gb account" },
  { id: "integrations", page: "gamebanana", label: shown(t("1-click installs and .gachamod files")), icon: "link", keywords: "gachamod links protocol url .gachamod file association default app 1-click one click install" },
  { id: "creators", page: "gamebanana", label: shown(t("Creators")), icon: "user", keywords: "authors modders followed favourite favorite blocked prioritized whitelist blacklist" },
  { id: "adult", page: "gamebanana", label: shown(t("Mods for adults")), icon: "eye", keywords: "nsfw 18+ adult lewd blur hide show censor" },
  { id: "ai", page: "ai", label: shown(t("AI helper")), icon: "ai", keywords: "ai chatbot chatgpt claude gemini copilot grok gpt llm assistant" },
  { id: "extensions", page: "extensions", label: shown(t("Extensions")), icon: "puzzle", keywords: "extensions plugins addons add-ons themes repo marketplace store community download share" },
  { id: "feedback", page: "feedback", label: shown(t("Feedback and testing")), icon: "help", keywords: "feedback bug report problem suggestion idea contact developer tester check game" },
  { id: "privacy", page: "feedback", label: shown(t("Usage counts and crash reports")), icon: "eye", keywords: "telemetry usage analytics counts crash reports privacy anonymous data tracking" },
  { id: "logs", page: "feedback", label: shown(t("Log files")), icon: "file", keywords: "logs log file gachamod.log rendering log errors debug folder developer console" },
  { id: "about", page: "about", label: shown(t("About gachamod")), icon: "info", keywords: "version data folder licences licenses credits ko-fi kofi tip donate support" },
  { id: "updates", page: "about", label: shown(t("gachamod updates")), icon: "update", keywords: "update check now new version upgrade automatic release notes what's new" },
  { id: "transfer", page: "about", label: shown(t("Back up or move your settings")), icon: "export", keywords: "export import backup restore settings file new pc migrate" },
  { id: "repair", page: "about", label: shown(t("Repair, reset or uninstall")), icon: "tool", keywords: "repair uninstall setup reinstall reset start over factory defaults" },
];

/** Single settings: [row id (a route section), the section it sits in, title, keywords, icon]. */
export const SETTINGS: Array<[string, string, string, string, IconName]> = [
  ["set-admin", "game-start", shown(t("Run as administrator")), "admin administrator elevated uac f10 keys hotkeys zenless zzz always restart", "shield"],
  ["set-only-game", "games", shown(t("One-game mode")), "one game only single focus just one exclusive hide other games main game", "focus"],
  ["set-community", "games", shown(t("Community games")), "pgr punishing gray raven p5x persona gf2 girls frontline identity v stella sora taimanin 3dmigoto loader other games", "controller"],
  ["set-links", "integrations", shown(t("1-click installs from GameBanana")), "gachamod links protocol url one click install handler default app", "link"],
  ["set-files", "integrations", shown(t("Open .gachamod files")), "gachamod file pack association double click open with default app", "link"],
  ["set-lang", "general", shown(t("Language")), "language translate translation english chinese spanish portuguese russian 语言 中文 简体 idioma español português língua язык русский", "web"],
  ["set-scheme", "appearance", shown(t("Light or dark")), "dark mode light mode night theme scheme system colours colors", "moon"],
  ["set-accent", "appearance", shown(t("Accent")), "accent colour color highlight tint", "palette"],
  ["set-format", "layout", shown(t("Mods layout")), "layout format view panes three panes character list compact list cards rows look like jasm imm integrated mod manager skinselectimpact ssi arg xxmm xx mod manager other mod manager switch from", "layout"],
  ["set-layout", "layout", shown(t("Spacing")), "layout density compact comfortable spacing sidebar left right nav style buttons", "layout"],
  ["set-text-size", "layout", shown(t("Text size")), "font size text bigger smaller letters", "sliders"],
  ["set-zoom", "layout", shown(t("Zoom")), "zoom scale ui size bigger smaller magnify whole window ctrl plus minus 100%", "search"],
  ["set-motion", "layout", shown(t("Interface animations")), "animations motion animation reduce reduced effects transitions page turns popovers fade slide instant", "sparkle"],
  ["set-motion-scroll", "layout", shown(t("Smooth scrolling")), "smooth scroll scrolling mouse wheel glide jump motion animation", "sparkle"],
  ["set-motion-bg", "layout", shown(t("Theme background motion")), "background moving animated backdrop drifting scrolling stars ambient effects zenless new eridu motion animation seasonal", "sparkle"],
  ["set-intro", "general", shown(t("Opening screen")), "intro splash startup start opening animation loading screen tips tip of the day", "play"],
  ["set-hints", "general", shown(t("First-start hints")), "hints tips highlight tutorial tour guide new user first start", "info"],
  ["set-gpu", "graphics", shown(t("Hardware acceleration")), "gpu graphics card hardware acceleration black screen window blank flicker drawing rendering performance", "sliders"],
  ["set-shuffle", "mods", shown(t("Shuffle outfits")), "random randomize randomise outfits skins surprise each launch play daily", "dice"],
  ["set-chill", "fun", shown(t("Chill mode")), "lower case lowercase chill relaxed text casual", "sparkle"],
  ["set-pull", "fun", shown(t("Pull button")), "pull wish warp signal search convene headhunt gacha random mod pity 5 star roll lucky surprise me dice", "gem"],
  ["set-seasonal", "fun", shown(t("Seasonal touches")), "snow christmas winter valentine hearts halloween bats pumpkins spooky holiday season", "snow"],
  ["set-year", "fun", shown(t("Your year in mods")), "year stats wrapped recap summary hours played most mods", "calendar"],
  ["set-enable-new", "mods", shown(t("Turn on new mods")), "auto enable activate new mods after install download turn on automatically off by default", "power"],
  ["set-nsfw", "adult", shown(t("Mods marked for adults")), "hide blur show nsfw 18+ adult lewd blur hide show censor", "eye"],
  ["set-gb-adult", "adult", shown(t("Match my GameBanana settings")), "nsfw adult gamebanana account content ratings sync match same as site", "eye"],
  ["set-pergame", "mods", shown(t("Another skin already on")), "one skin per character single skin outfit only one at a time auto turn off others", "characters"],
  ["set-pergame", "mods", shown(t("Reload in game")), "automatically f10 reload refresh in game auto press", "refresh"],
  ["set-app-updates", "updates", shown(t("Update gachamod automatically")), "app update check new version upgrade auto install automatic tell notify only off", "update"],
  ["set-app-check", "updates", shown(t("Check for updates")), "gachamod app update check now new version upgrade latest", "update"],
  ["set-mod-updates", "automatic", shown(t("Check mods for updates")), "mod updates outdated gamebanana auto check", "update"],
  ["set-watch-mods", "automatic", shown(t("Watch Mods folders for changes")), "watch watcher explorer live auto refresh folder changes added renamed deleted other manager", "refresh"],
  ["set-rescan", "automatic", shown(t("Rescan mods when Mods opens")), "scan rescan refresh folder watch auto automatically", "refresh"],
  ["set-archives", "installing", shown(t("Delete downloaded archives")), "zip 7z rar archive keep downloads cleanup disk space", "trash"],
  ["set-all-parts", "installing", shown(t("Install every mod in an archive")), "archive several mods variants parts pick which ask window all", "layers"],
  ["set-other-servers", "installing", shown(t("Move slow downloads to another server")), "slow download speed mirror server filecache gamebanana faster", "downloads"],
  ["set-fix-updates", "broken-mods", shown(t("Look for new mod fixers")), "fixer fixes hash broken game update patch auto", "wand"],
  ["set-fix-warn", "broken-mods", shown(t("Warn about broken mods")), "mods a game update broke mute fixes broken outdated hash warning badge hide", "bell"],
  ["set-onscreen", "installing", shown(t("Toggles only while on screen, for new mods")), "toggles hotkeys keybinds key conflict off screen character visible active", "key"],
  ["set-ext-sources", "extensions", shown(t("Extension lists")), "repo repository index source marketplace url add another list", "puzzle"],
  ["set-ext-make", "extensions", shown(t("Make your own")), "make an extension develop create build plugin addon package link folder share submit upload", "code"],
  ["set-trash-days", "storage", shown(t("Keep removed mods' files")), "trash recycle bin deleted removed days storage disk space archive purge", "trash"],
  ["set-gb-signin", "account", shown(t("Sign in to GameBanana")), "login log in account follow like subscribe session", "user"],
  ["set-creators-sub", "creators", shown(t("Followed creators")), "following subscribed subscriptions authors", "feed"],
  ["set-creators-fav", "creators", shown(t("Favourite creators")), "favorite favourites starred authors", "star"],
  ["set-creators-prio", "creators", shown(t("Prioritized creators")), "priority whitelist first top authors", "crown"],
  ["set-creators-blocked", "creators", shown(t("Blocked creators")), "block blacklist mute hide authors", "block"],
  ["set-feedback", "feedback", shown(t("Send feedback")), "feedback bug report problem suggestion idea contact developer message", "help"],
  ["set-tester", "feedback", shown(t("Tester options")), "tester testing experimental beta menu the game draws inside the game exclusive fullscreen switch skins live wuthering waves endfield", "check"],
  ["set-gamecheck", "feedback", shown(t("Check this game")), "test testing tester check game report works switching skins menu genshin star rail wuthering waves endfield", "check"],
  ["set-usage", "privacy", shown(t("Usage counts")), "telemetry analytics usage statistics tracking privacy anonymous", "eye"],
  ["set-crashes", "privacy", shown(t("Crash reports")), "crash report error bug automatic send privacy", "bug"],
  ["set-logs", "logs", shown(t("Logs")), "log logs file gachamod.log errors debug folder", "file"],
  ["set-console", "logs", shown(t("Developer console")), "console developer dev debug backquote tilde ~ ` key commands log output", "code"],
  ["set-render-log", "logs", shown(t("Rendering log")), "rendering log black screen window blank flicker gpu graphics card driver nvidia frames debug", "file"],
  ["set-ai-show", "ai", shown(t("Show AI buttons")), "turn ai on or off hide ai disable chatbot buttons show everything", "ai"],
  ["set-xxmi-uninstall", "xxmi", shown(t("Uninstall XXMI Launcher")), "uninstall remove delete xxmi launcher mod loader importer gimi srmi zzmi wwmi himi efmi recycle bin", "trash"],
  ["set-reset", "repair", shown(t("Reset gachamod")), "reset start over factory defaults clear wipe fresh delete settings data", "undo"],
  ["set-ai-chatbot", "ai", shown(t("Your chatbot")), "chatgpt claude gemini copilot grok chatbot pick change", "ai"],
  ["set-ai-adult", "ai", shown(t("Hide adult mods from the chatbot")), "nsfw adult explicit names prompt refuse refused chatbot hide", "ai"],
  ["set-ai-jobs", "ai", shown(t("Ask it now")), "ai chatbot make a theme tidy mod names set characters mod ideas jobs", "ai"],
  ["set-fix-automute", "broken-mods", shown(t("Turn off mods that need their author")), "fixer broken mute auto turn off cant fix can't fix need their author", "wand"],
  ["set-review-unsure", "installing", shown(t("Ask me to check files gachamod can't place")), "can't place cant place unsure no ini files where to put review check", "downloads"],
  ["set-motd", "fun", shown(t("Mod of the day")), "motd daily pick gift featured", "star"],
  ["set-extensions", "extensions", shown(t("Extensions and themes")), "extensions plugins addons themes browse manage installed", "puzzle"],
  ["set-hotkeys-on", "hotkeys", shown(t("Switch profiles with hotkeys")), "profile hotkeys keys in game switch on off", "keyboard"],
  ["set-hotkeys-profiles", "hotkeys", shown(t("Profile keys")), "profile hotkey own key each profile manage profiles editor", "profiles"],
  ["set-hotkeys-menu", "hotkeys", shown(t("In-game menu keys")), "menu key keys f7 open skin menu rebind change shortcut in game overlay", "keyboard"],
];

/** The page a panel or a setting row is on, to open it when the panel or row isn't shown (AI turned off, an empty list). */
export const sectionOf = (id: string): string | undefined => {
  const section = SETTINGS.find((s) => s[0] === id)?.[1] ?? id;
  return SECTIONS.find((s) => s.id === section)?.page;
};

/** "Settings › Mods › Trash and removed mods" for a panel or a setting in it (the panel is left out when
 *  it has the page's name). */
export function settingsWhere(panel: string): string {
  const sec = SECTIONS.find((s) => s.id === panel);
  const page = PAGES.find((p) => p.id === sec?.page);
  if (!sec || !page) return t("Settings");
  return sec.label === page.label ? t("Settings › {page}", { page: page.label }) : t("Settings › {page} › {panel}", { page: page.label, panel: sec.label });
}

registerCommands("settings", () => {
  const list: Command[] = SECTIONS.map((s) => {
    const page = PAGES.find((p) => p.id === s.page);
    return {
      id: `settings:${s.id}`, title: s.label, section: "Settings", icon: s.icon, keywords: `settings ${s.keywords}`,
      where: page && page.label !== s.label ? t("Settings › {page}", { page: page.label }) : t("Settings"),
      run: () => go({ view: "settings", section: s.id }),
    };
  });
  for (const [section, panel, title, keywords, icon] of SETTINGS) {
    if ((section === "set-ai-chatbot" || section === "set-ai-adult" || section === "set-ai-jobs") && !aiShown("useful")) continue;
    // the id stays English: recent picks are remembered by it
    list.push({ id: `settings:${section}:${en(title)}`, title, section: "Settings", icon, keywords: `setting ${keywords}`, where: settingsWhere(panel),
      run: () => go({ view: "settings", section }) });
  }
  list.push(
    { id: "page:extensions", title: shown(t("Extensions")), section: "Pages", icon: "puzzle", keywords: "extensions plugins addons add-ons themes get more download marketplace store",
      run: () => go({ view: "extensions" }) },
    { id: "page:themes-online", title: shown(t("Get more themes")), section: "Actions", icon: "palette", keywords: "themes download community share look skins", where: t("Extensions › Themes"),
      run: () => go({ view: "extensions", section: "themes" }) },
  );
  list.push({ id: "act:feedback", title: shown(t("Send feedback")), section: "Actions", icon: "help", where: t("Settings › {page}", { page: PAGES.find((p) => p.id === "feedback")!.label }), keywords: "feedback bug report problem suggestion idea contact developer", run: () => openFeedback() });
  list.push({ id: "act:gamecheck", title: shown(t("Check this game")), section: "Actions", icon: "check", keywords: "test testing tester check game report switching skins menu", run: openGameCheck });
  list.push({ id: "act:xxmi", title: shown(t("Open XXMI Launcher")), section: "Actions", icon: "external", keywords: "xxmi launcher open start run", run: openXxmi });

  const g = currentGame();
  if (aiShown("useful")) {
    list.push({ id: "ai:theme", title: shown(t("Make a theme with your chatbot")), section: "Actions", icon: "ai", keywords: "ai chatbot theme generate custom colours chatgpt claude",
      run: () => askAi({ kind: "theme", game: g?.id }) });
    if (g) {
      list.push(
        { id: "ai:tidy", title: shown(t("Tidy mod names with your chatbot")), section: "Actions", icon: "ai", keywords: "ai chatbot rename clean names bulk mass chatgpt claude",
          run: () => askAi({ kind: "mods", game: g.id, detail: "clean" }) },
        { id: "ai:chars", title: shown(t("Set mod characters with your chatbot")), section: "Actions", icon: "ai", keywords: "ai chatbot character assign sort bulk",
          run: () => askAi({ kind: "mods", game: g.id, detail: "characters" }) },
      );
    }
  }
  if (g && aiShown("extra")) {
    list.push({ id: "ai:ideas", title: shown(t("Ask your chatbot for mod ideas")), section: "Actions", icon: "ai", keywords: "ai chatbot recommend suggest ideas what to download",
      run: () => { void ideasTask(g.id).then(askAi); } });
  }
  // the English name matches too, whatever language the app is in
  return list.map((c) => (en(c.title) === c.title ? c : { ...c, keywords: `${c.keywords ?? ""} ${en(c.title)}` }));
});
