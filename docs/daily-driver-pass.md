# gachamod daily-use issue log

## Fix these first

1. Pressing Tab or an arrow key blanks the whole window (Whole app) (fixed)
2. Drawers and dialogs don't take focus, so keys act on the screen behind them (Whole app) (fixed)
3. Popovers can't be used from the keyboard (Whole app: Browse Sort and Filters, Tools fix menu) (fixed)
4. My Mods badge is one global count, so other games show the wrong number (Sidebar) (fixed)
5. The one-time "Keep new mods off" offer gets lost during a burst of installs (Downloads) (fixed)
6. Rename from a profile's page does nothing, then shows up later on the grid (Profiles) (fixed)
7. A profile hotkey silently takes another profile's key, and Undo can't give it back (Profiles) (fixed)
8. Swapping a character's outfit asks every time, and you can't save "swap" as the answer (Characters) (fixed)
9. Ctrl+Enter starts the game while you type in a field or have a dialog open (Whole app) (fixed)
10. Esc in a mod details field throws away what you typed (My Mods) (fixed)

---

## Whole app

### Pressing Tab or an arrow key blanks the whole window [high, bug]
- **Status:** fixed
- **Where:** Every screen. First seen when moving through My Mods cards with the arrow keys.
- **What happens:** lib/keys.ts adds the class `kbd` to `<html>` on Tab or an arrow key, and gamepad.ts adds `kbd` and `pad`. kit.css styles `.kbd` as a keycap (`display: inline-grid; height: 1.5em`), so `<html>` itself becomes a keycap and the page goes blank. Grid arrows also break in this state: every card measures as one column, so ArrowDown moves by one card.
- **Expected:** Keyboard mode only adds focus rings.
- **Fix:** Rename the html class (for example `html.kb-nav`) everywhere it's used, or scope the keycap rule to `kbd, .kbd:not(html)`.
- **Code:** src/styles/kit.css:148, src/lib/keys.ts:159, src/lib/gamepad.ts:93

### Drawers and dialogs don't take focus, and Tab walks out of them [high, bug]
- **Status:** fixed
- **Where:** Kit Drawer and Dialog: the mod details drawer in My Mods, the GameBanana mod page in Browse, the Shortcuts list.
- **What happens:** Dialog and Drawer only listen for Escape. Opening one leaves focus on the card behind it, Tab carries on through the page underneath, and closing doesn't return focus, so after Esc in a field focus lands on `<body>`. The controller does stay in the top layer (moveFocus uses topLayer), so keyboard and pad behave differently. Only Confirm focuses something.
- **Expected:** Opening moves focus into the layer, Tab stays inside, and closing puts focus back on whatever opened it.
- **Fix:** In Dialog and Drawer, save document.activeElement on mount, focus the close button or first control, cycle Tab inside the layer, and refocus the saved element on close if it's still in the page.
- **Code:** src/ui/kit.tsx:323-359

### Keys act on the screen behind an open drawer [high, bug]
- **Status:** fixed
- **Where:** Browse and My Mods while a mod drawer is open.
- **What happens:** Focus stays on the card behind the drawer, so that card's key handler runs. On Browse, I installs the hidden card. In My Mods, Space toggles a mod you can't see, Delete trashes it, and the arrows move through the hidden grid. With a selection active, ModGrid swallows Escape to clear the selection, so the drawer stays open.
- **Expected:** Keys act on the drawer you can see.
- **Fix:** Fixing drawer focus (above) solves most of this. As a backstop, card key handlers can return early while an `.overlay` is open.
- **Code:** src/screens/browse/ModCard.tsx:44-48, src/screens/library/ModGrid.tsx:161-196

### Popovers can't be used from the keyboard [high, bug]
- **Status:** fixed
- **Where:** Kit Popover, used by all 12 popovers. Seen on the Browse Sort and Filters buttons and on Tools > Problems "Keep a different one on" (the same FixButton also appears in mod details).
- **What happens:** Opening leaves focus on the trigger. Down does nothing. The popover is portaled to the end of `.app`, so Tab moves to the next control on the page while the menu stays open. Nothing in Sort can be picked by keyboard. The controller D-pad does reach the entries.
- **Expected:** Focus moves to the first (or checked) item, arrows move between items, Enter picks one, and Tab doesn't leave the open menu.
- **Fix:** In Popover, focus the first focusable child or the checked menuitem on open, and handle Up and Down by reusing ContextMenu's key handling. Another option is to open these entries with openMenu().
- **Code:** src/ui/Popover.tsx:41-62, src/screens/modtools/FixButton.tsx:20, src/ui/kit.tsx:376

### Ctrl+Enter starts the game while you type in a field or have a dialog open [medium, bug]
- **Status:** fixed
- **Where:** Global keys, in any text field or dialog.
- **What happens:** installKeys handles Ctrl+Enter before its inField check and clicks `.side .play-btn`, so the game launches behind the dialog. In the New profile name field, the field's own Enter handler wins and saves instead. When the sidebar shows Set up (that button also has the `play-btn` class), Ctrl+Enter starts installing XXMI.
- **Expected:** Inside a field or overlay, Ctrl+Enter submits the dialog or does nothing.
- **Fix:** Skip Play when focus is in a field or an `.overlay` or `.popover` is open. Make the App play() helper ignore `.play-setup`.
- **Code:** src/lib/keys.ts:83, src/App.tsx:206

### Menus show key hints that don't work where the menu opens [medium, rule-break]
- **Status:** fixed
- **Where:** The mod menu on Home tiles (Recently installed, Updates), the character tile menu on Home and the character chip menu in My Mods (Owned O), the sidebar profile buttons and the profile page header (Rename F2, Delete Del), and the mod menu opened from Characters or the details drawer.
- **What happens:** The menu shows Turn on Space, Rename F2, Move to trash Del and Owned O, but only ModGrid handles Space, F2 and Del for mods, only the profiles grid handles them for profiles, and O only works on the Characters screens. On a Home tile, Space opens details. Elsewhere the keys do nothing, or O starts type-to-search.
- **Expected:** A key hint shown in a menu works where that menu opened.
- **Fix:** Handle the keys on Home tiles, sidebar `.side-p` buttons, profile page header buttons and My Mods character chips. Otherwise, drop `keys` from those entries when the menu opens somewhere that doesn't support them.
- **Code:** src/screens/home/Home.tsx:348; src/screens/library/menus.ts:91, 115, 131, 152; src/screens/profiles/menus.ts:24, 33; src/shell/Sidebar.tsx:233-236; src/screens/profiles/ProfilePage.tsx:162, 186

### Toast buttons can't be reached with the keyboard or a controller [medium, inconvenience]
- **Status:** fixed
- **Where:** All toasts with a button (Show, Downloads, Keep new mods off, View mod, Use F9).
- **What happens:** The toast timer pauses only on mouse hover, not on focus. Toast buttons come after every control on the page in Tab order, and no shortcut jumps to them, so the toast usually times out first. Ctrl+Z covers Undo but none of the other buttons.
- **Expected:** Every action works with the mouse, the keyboard and a controller.
- **Fix:** Pause the timer on focusin and resume it on focusout. Add a shortcut that focuses the newest toast's button and list it in the shortcuts.
- **Code:** src/ui/toast.tsx:81

### Focus drops to the page body after a view change, game switch, launch or fix [medium, inconvenience]
- **Status:** fixed
- **Where:** Ctrl+1 to Ctrl+8, Ctrl+Tab, switching games from the palette, opening a character page, Alt+Left or the back crumb from a character page, Play anyway, Attempt fix.
- **What happens:** Nothing moves focus when the route changes, so activeElement is `<body>` and the next Tab starts at the title bar's Back button. Going back to Resonators restores the scroll position but not focus on the tile you opened. When the focused Attempt fix or Play anyway button disappears, focus also falls to body.
- **Expected:** Focus lands on the new screen's main content. On Back, it returns to the element you came from.
- **Fix:** After a route change, focus the view's first control (or the `.view` container with tabIndex -1). Remember the last opened character per game and focus its `.roster-tile` on return. When a focused button unmounts, move focus to the next row.
- **Code:** src/screens/characters/CharacterPage.tsx:100, src/screens/characters/Characters.tsx:74

### No quick way past about 30 Tab stops of title bar and sidebar [medium, inconvenience]
- **Status:** fixed
- **Where:** Title bar and sidebar, on every screen.
- **What happens:** Back, the crumbs, Search, Help, the window buttons, Sign in, Fold, the game switcher, 7 nav buttons, each profile, New profile, Play and More ways to start all come before the content. That's 29 stops before the first control in My Mods.
- **Expected:** A quick way into the content.
- **Fix:** Add F6 to move between title bar, sidebar and view, or start Tab inside `.view` after a route change.

### Shift+F10 and the Menu key don't turn on keyboard mode, so the first menu item isn't highlighted [low, bug]
- **Status:** fixed
- **Where:** Context menus opened from the keyboard.
- **What happens:** `kbd` is only added on Tab and the arrow keys, and the item focus style is `html.kbd .menu-i:focus`. After using the mouse, Shift+F10 opens a menu with no visible focus until you press an arrow.
- **Expected:** The focused item is highlighted right away.
- **Fix:** Also set keyboard mode on F10 and ContextMenu, or use `.menu-i:focus-visible`. This depends on the html class rename above.
- **Code:** src/lib/keys.ts:159, src/styles/kit.css:264

### Menu items with a check mark are indented [low, bug]
- **Status:** fixed
- **Where:** Any menu item with both `checked` and an icon, for example Favourite in the mod card menu.
- **What happens:** A `.menu-c` span renders before the icon, so the star sits one column to the right of the other icons. The role stays menuitem.
- **Expected:** Icons line up, and checkable items use role menuitemcheckbox.
- **Fix:** Put the check after the label or reserve that column on every row. Set role=menuitemcheckbox whenever `checked` is defined.
- **Code:** src/ui/ContextMenu.tsx:211-224

### The shortcuts list leaves out the keys used on each screen [low, missing-option]
- **Status:** fixed
- **Where:** The Shortcuts dialog (?).
- **What happens:** It's missing Space, Shift+Space, Ctrl+Space or Ctrl+click, Ctrl+A, F2, Del, Enter for details, I on Browse cards, O on a character page, and Home and End in grids.
- **Expected:** The keys people use every day are listed.
- **Fix:** Add a short "On a mod" group below the global keys.
- **Code:** src/lib/keys.ts:4-18

### LB and RB go through pages in a different order than the sidebar [low, bug]
- **Status:** fixed
- **Where:** Controller bumpers.
- **What happens:** nextView walks VIEWS (home, browse, characters, library, profiles, downloads...), so RB from Browse skips Mods, and Profiles comes before Downloads.
- **Expected:** The same order as the sidebar and Ctrl+1 to Ctrl+8.
- **Fix:** Use KEY_VIEWS in nextView.
- **Code:** src/App.tsx:212, src/lib/store.ts:124, src/shell/names.ts:26

### No way to switch games from the controller [low, missing-option]
- **Status:** fixed
- **Where:** The controller button mapping.
- **What happens:** Nothing does what Ctrl+Tab does. You have to D-pad up to the sidebar game switcher.
- **Expected:** A pad button for the next and previous game.
- **Fix:** Map View held with LB or RB to nextGame, and list it in PAD_SHORTCUTS.
- **Code:** src/lib/gamepad.ts:94-115

### The opening screen's fade-out has no time limit [low, bug]
- **Status:** fixed
- **Where:** Skipping the opening screen (splash.ts).
- **What happens:** After a skip, the code waits on `stage.animate(...).finished` with no timeout. Until finish() runs, a capture listener keeps eating Escape, Enter and Space. The play path is capped by MAX_PLAY, but this path isn't. It was seen while the window drew no frames.
- **Expected:** The fade-out ends even if no frames arrive.
- **Fix:** Race the finished promise against a short sleep of about 400 ms.
- **Code:** src/splash/splash.ts:190

---

## Title bar and command palette

### Back and Forward history menus list several identical "Home" entries [medium, bug]
- **Status:** fixed
- **Where:** Right-click on Back or Forward.
- **What happens:** Each game switch adds a history entry, but the label is only the page name, so the menu reads Home, Home, Home. The game name only appears in the hover tip.
- **Expected:** Entries name the game when it differs from the current one ("Home, Genshin"), and identical neighbours are merged.
- **Fix:** In historyMenu, add the game's short name when `p.game` differs from the current game, and merge runs with the same label and game.
- **Code:** src/shell/Titlebar.tsx:29

### Palette ranks settings above the everyday action for "update" and above the game for "zzz" [medium, inconvenience]
- **Status:** fixed
- **Where:** Ctrl+K.
- **What happens:** For "update", the setting "Update gachamod automatically" outscores "Check mods for updates", so Settings leads and the mod check sits further down. "Check for gachamod updates" is listed under both Actions and Settings. For "zzz", "Run as administrator" ties with the game, and Settings comes before Games.
- **Expected:** Everyday actions and games rank above settings that only match on a keyword, so typing "update" and pressing Enter checks mods for updates.
- **Fix:** Give act:updates, act:rescan and the game entries a higher priority, or rank Settings below Actions and Games on ties. Remove the duplicate gachamod update entry.
- **Code:** src/lib/search.ts:88, src/shell/CommandPalette.tsx:42, src/screens/settings/settingsSearch.ts:68, 91, 92

### Search can't find several Tools pages and actions [medium, missing-option]
- **Status:** fixed
- **Where:** Ctrl+K.
- **What happens:** "conflict" finds only the top-level Tools entry, not Conflicts or Key clashes. "hash" doesn't find Find a hash. "import" doesn't find importing a .gachamod or moving mods from IMM. "shader cache" finds the page but no action to clear it.
- **Expected:** Pages for Conflicts, Key clashes and Find a hash, and actions for Import a .gachamod, Clear shader cache and Move mods from IMM (when IMM is found).
- **Fix:** Add these entries to registerCommands('tools').
- **Code:** src/screens/tools/Tools.tsx:20-38, src/shell/commands.ts:116

### Several settings can't be found with search [medium, bug]
- **Status:** fixed
- **Where:** Ctrl+K settings results.
- **What happens:** "need their author", "can't place" and "mod of the day" find nothing. These row ids are missing from SETTINGS: set-fix-automute, set-review-unsure, set-motd, set-ai-jobs and set-extensions. The "Switch profiles with hotkeys" switch has no id at all.
- **Expected:** Every setting row can be found.
- **Fix:** Add the rows to SETTINGS and give the hotkeys switch the id set-hotkeys-on. Add a test that compares the `id="set-*"` values in the code with SETTINGS.
- **Code:** src/screens/settings/settingsSearch.ts:67-121, src/screens/settings/HotkeysSection.tsx:39-42

### In-game menu keys can't be found from search or Settings [medium, missing-option]
- **Status:** fixed
- **Where:** Ctrl+K, and Settings > In-game profile hotkeys.
- **What happens:** "menu key" only offers a GameBanana search, because the Tools "In-game menu" entry has no "key", "keys" or "f7" keyword. The hotkeys page covers profile keys only and has no link to the menu keys.
- **Expected:** Search finds the rebindable menu keys, and the hotkeys page links to them.
- **Fix:** Add "menu key keys f7 rebind" to the tools:ingame keywords. Add a row on the hotkeys page with a button to Tools > Switch skins in game.
- **Code:** src/screens/tools/Tools.tsx:26, src/screens/settings/HotkeysSection.tsx

### Search result titles don't match the setting labels [low, wording]
- **Status:** fixed
- **Where:** Ctrl+K compared with the Settings rows.
- **What happens:** "Warn about mods a game update broke" opens "Warn about broken mods". "Rescan mods automatically" opens "Rescan mods when Mods opens". "Accent colour" opens "Accent". "Make an extension" opens "Make your own". "Check for gachamod updates" opens "Check for updates".
- **Expected:** The same words in both places.
- **Fix:** Use the row label as the search title and move the extra words into keywords.
- **Code:** src/screens/settings/settingsSearch.ts:74, 92, 94, 99, 102

### Palette results have no right-click menu [low, missing-option]
- **Status:** fixed
- **Where:** Mod, profile and character results in Ctrl+K.
- **What happens:** Right-click shows the generic page menu, because the Command type has no field naming a menu.
- **Expected:** Right-click or Shift+F10 on a result opens that thing's usual menu.
- **Fix:** Add an optional menu kind and args to Command, set them in the mod, profile and character sources, and call menuFor on right-click. Don't add any new entries.
- **Code:** src/lib/search.ts:15, src/shell/CommandPalette.tsx

### The Mods page has two names, "My Mods" and "Mods" [low, wording]
- **Status:** fixed
- **Where:** Sidebar nav, breadcrumb, palette, shortcuts list, Home buttons.
- **What happens:** VIEW_INFO and the palette say "My Mods" (title case). The shortcuts list, Home ("In Mods", "Open Mods") and the palette crumb ("Mods › Trash") say "Mods".
- **Expected:** One name in sentence case.
- **Fix:** Rename VIEW_INFO.library to "Mods", or use "My mods" everywhere. Build the Ctrl+1 to Ctrl+8 line from viewLabel.
- **Code:** src/shell/names.ts:15, src/lib/keys.ts:8, src/shell/commands.ts:111

### The Shuffle outfits command shows raw error text [low, bug]
- **Status:** fixed
- **Where:** Palette > Actions > Shuffle outfits, when it fails.
- **What happens:** The error is shown with String(e), which gives "Error: ..." or "[object Object]", and no place button is added.
- **Expected:** The same error text as everywhere else.
- **Fix:** Use errorText(e).
- **Code:** src/shell/commands.ts:158

---

## Sidebar

### My Mods badge is one global count, so it shows the wrong number after switching games [high, bug]
- **Status:** fixed
- **Where:** The My Mods nav badge and its tip.
- **What happens:** The badge lives in one app-wide store and is only written when an update check runs. Nothing recomputes it on a game switch or after an update installs. After a check on WuWa, every game shows "2 with updates", including Endfield, and the count doesn't drop after updating. At launch the badge is empty even though Home already lists mods with updates.
- **Expected:** The badge matches the current game and goes down when an update installs.
- **Fix:** Work the count out from the current game's mods (updateAvailable), or store it per game. Refresh it on game switch and on library-refresh.
- **Code:** src/lib/store.ts:287; writers at src/shell/commands.ts:37, src/screens/library/data.ts:84, src/screens/library/Library.tsx:117

### Game card and corner show mod counts from when the app started [medium, bug]
- **Status:** fixed
- **Where:** The sidebar game card ("4 of 7 mods on"), the corner text ("WWMI · 7 MODS") and the Settings game rows.
- **What happens:** These counts come from GameState, which only updates on refreshGames. The sidebar said 4 of 7 while My Mods had 33 mods with 14 on.
- **Expected:** The counts follow the library.
- **Fix:** Update modCount and enabledCount from the library's publish(), or refresh the games after a library change.
- **Code:** src/shell/Sidebar.tsx:95, src/ui/Deco.tsx:51, src/screens/settings/Settings.tsx:189, src/lib/store.ts:116

### Downloads badge and tip count a pending pick as "downloading" [low, bug]
- **Status:** fixed
- **Where:** The sidebar Downloads badge and tip. Shows from Browse quick installs and from the Downloads page.
- **What happens:** Running, waiting and unseen needsChoice items are added into one count, and the tip says "Downloads (Ctrl+5). 1 downloading" when the only item is waiting for you to pick. Once marked seen, the pick drops out of the badge even though it still needs you.
- **Expected:** "1 waiting for you to pick", or "2 downloading, 1 to pick", shown until the pick is made.
- **Fix:** Pass the pick count separately to the badge, build the tip from it, and leave needsChoice items out of the seen timer.
- **Code:** src/screens/browse/OnlineOverlays.tsx:42-50, src/shell/Sidebar.tsx:171

### "New profile" always opens a dialog, and right-click has no "no mods" option [low, inconvenience]
- **Status:** fixed
- **Where:** The sidebar New profile row and the + chip on Home.
- **What happens:** A click opens the full editor before anything is saved. Right-click shows the generic page menu, though the palette already has "New profile with no mods".
- **Expected:** One click makes the profile, with the dialog available for extras.
- **Fix:** Create the profile right away from the mods on now, start a rename and show an Undo toast. Add a right-click menu with "New profile with no mods" and "New profile with options...".
- **Code:** src/shell/Sidebar.tsx:243, src/screens/home/Home.tsx:230, src/screens/profiles/actions.ts:130

### Sidebar nav items have no right-click menu [low, missing-option]
- **Status:** fixed
- **Where:** My Mods and Downloads in the nav.
- **What happens:** Right-click shows only the generic page menu.
- **Expected:** A short menu with the everyday action for that page.
- **Fix:** My Mods: Check for updates, Rescan mods, Open Mods folder. Downloads: Pause all and Resume all when the queue has items.
- **Code:** src/shell/Sidebar.tsx:176

### Game strip tips say Ctrl+Tab goes to each game [low, wording]
- **Status:** fixed
- **Where:** The row of other games' icons.
- **What happens:** Every icon says "Switch to X (Ctrl+Tab)", but Ctrl+Tab only goes to the next game in the list.
- **Expected:** A shortcut in a tip opens what the tip names.
- **Fix:** Show (Ctrl+Tab) only on the next game's icon, or remove it from the strip.
- **Code:** src/shell/Sidebar.tsx:132

### "Other games" tip points to Settings for something the same menu can do [low, wording]
- **Status:** fixed
- **Where:** The game menu's Other games submenu, in one-game mode.
- **What happens:** The tip says to turn it off in Settings, Games and mod loaders, with no way there, while the same menu has the checked "Only show WuWa" entry that turns it off.
- **Expected:** The tip points to the entry right there.
- **Fix:** "Untick Only show X below to bring them back", or add a Show all games entry.
- **Code:** src/shell/Sidebar.tsx:64

---

## Home

### Right-click on Play shows the page menu instead of the start options [medium, missing-option]
- **Status:** fixed
- **Where:** The sidebar Play button and the big Play on Home.
- **What happens:** Right-click gives the generic page menu. The start options are only behind the small More ways to start button.
- **Expected:** Right-clicking Play shows the same entries as More ways to start.
- **Fix:** Add onContextMenu to `.play-btn` that opens the existing Menu items. Don't add new entries.
- **Code:** src/screens/home/PlayButton.tsx:132

### Updating a multi-part mod asks again which parts to install [medium, inconvenience]
- **Status:** fixed
- **Where:** The Update button in Home's Updates widget, and every other getUpdate path.
- **What happens:** The update request carries `replaces` but not which parts are installed, and place_inner only skips the picker when `replaces` is none. An archive with several mods inside opens the variant picker from wherever you are, with only the first part ticked.
- **Expected:** An update keeps the parts already installed and ends with a toast. The picker only shows when the parts changed.
- **Fix:** Send the installed mod's part keys with the update request, and install without asking when they still match.
- **Code:** crates/gacha-core/src/install.rs:832, src/lib/gamebanana.ts:1211, src/screens/browse/OnlineOverlays.tsx:168

### The "Checking for updates" toast stays up next to its own result [low, inconvenience]
- **Status:** fixed
- **Where:** Check for updates from the Home quick bar, the palette or the game menu.
- **What happens:** One toast says "Checking Wuthering Waves's mods for updates", then a second toast shows the result, and both stay up. "Waves's" also reads badly.
- **Expected:** One toast that changes into the result.
- **Fix:** Keep the first toast's id and retoast() it with the result. Use "Checking for mod updates in Wuthering Waves" and a "View updates" button.
- **Code:** src/shell/commands.ts:33

### Customise Home says "Your characters" while Home says "Your resonators" [low, wording]
- **Status:** fixed
- **Where:** Customise Home, the header and Move up/down labels for the characters widget.
- **What happens:** The edit view uses WIDGETS.characters.title, while the widget itself uses charNoun ("Your resonators", "Your agents").
- **Expected:** The same name in both places.
- **Fix:** Use the charNoun(game.id) title in the edit header and its button labels.
- **Code:** src/screens/home/Home.tsx:115

### No right-click on Home widget headers to hide a widget [low, missing-option]
- **Status:** fixed
- **Where:** Home section headers.
- **What happens:** Only the page menu appears. Hiding one widget takes Customise Home, Hide, then Done.
- **Expected:** Right-click a header and pick Hide from Home.
- **Fix:** A two-entry header menu: Hide from Home (with Undo) and Customise Home.
- **Code:** src/screens/home/Home.tsx:253

### Clicking the active profile does different things on Home and in the sidebar [low, inconvenience]
- **Status:** fixed
- **Where:** The Home profile chips compared with the sidebar profile rows.
- **What happens:** The sidebar opens the profile. On Home, the active chip does nothing, and its tip only says "is on now. Right-click for more".
- **Expected:** The same click does the same thing.
- **Fix:** Make the active chip go to `{view: "profiles", profile: id}` and use the sidebar's tip wording.
- **Code:** src/screens/home/Home.tsx:212, 223

### A game with no mods says "0 of 0 mods on" and puts the getting-started prompt near the bottom [low, wording]
- **Status:** fixed
- **Where:** Home quick bar and the Recently installed widget (for example Arknights: Endfield).
- **What happens:** The quick bar reads "0 of 0 mods on". The "No mods yet / Browse GameBanana" prompt comes after four other widgets.
- **Expected:** "No mods yet" in the quick bar, linking to Browse, with the prompt near the top.
- **Fix:** When the total is 0, show "No mods yet" in the count button and send it to Browse. Consider showing the empty-library prompt right after the quick bar.
- **Code:** src/screens/home/Home.tsx:184, src/screens/home/layout.ts:20

### The Play tip repeats itself while the game runs [low, wording]
- **Status:** fixed
- **Where:** The Play button while the game is running.
- **What happens:** "Genshin Impact is running (running 0:00)".
- **Expected:** "Genshin Impact is running (0:00)".
- **Fix:** Use only the elapsed time in the tip, not label.toLowerCase().
- **Code:** src/screens/home/PlayButton.tsx:128

---

## Browse

### A card shows nothing while its mod is queued, downloading or waiting for a pick [medium, bug]
- **Status:** fixed
- **Where:** The mod card's picture corner and quick install button.
- **What happens:** ModCard only reads the library. Once the item is queued, the card shows the enabled "Install the newest file (I)" button again with no badge until it's installed. A mod waiting on a variant pick looks untouched. The drawer's file rows already show queue state.
- **Expected:** The card shows Waiting, a progress bar, Installing, or a Pick badge that opens the picker.
- **Fix:** Read useQueue() in ModCard (or pass a map from the grid) and match on game and mod id. Show a progress badge, a clickable Pick badge for needsChoice items, and hide the quick button while an item is active.
- **Code:** src/screens/browse/ModCard.tsx:34-37

### Coming back to Browse drops every filter and the scroll position [medium, inconvenience]
- **Status:** fixed
- **Where:** Browse, after a toast's Show button, a sidebar view, Back, or a game switch.
- **What happens:** beginVisit resets the filters on every mount unless the last visit was under 5 seconds ago. After going to Downloads and pressing Back, the character, High quality and sort are gone and the grid is back at the top. Every install toast's Show button leads away, so batch installing costs you your place.
- **Expected:** Back, or a return within the session, restores your filters and scroll.
- **Fix:** Keep the filters on history Back and Forward or when the last visit was a few minutes ago. Remember the grid's scrollTop per game.
- **Code:** src/screens/browse/state.ts:111-116

### The variant picker pops up as a modal during browsing, one after another [medium, rule-break]
- **Status:** fixed
- **Where:** The variant picker dialog. It shows during Browse quick installs and while the Downloads queue runs.
- **What happens:** Every archive that needs a choice opens "X has N mods inside" over whatever you're doing. When one closes, the next pending one opens. After Escape, only the Downloads badge shows that something is waiting.
- **Expected:** No modal where a toast will do. A pick waits until you ask for it.
- **Fix:** Keep auto-open only for installs started from the drawer. For quick installs, show a toast with a Pick button that calls openVariantPicker, plus the card's Pick badge. Keep "Install all, always" in the dialog.
- **Code:** src/screens/browse/OnlineOverlays.tsx:63-69

### Any later file of an installed mod is called "Update", and you can't install a second file next to it [medium, missing-option]
- **Status:** fixed
- **Where:** The mod drawer's Files list.
- **What happens:** Any file uploaded after the installed one is labelled "Update" and replaces the installed copy, even alternate files uploaded seconds apart. The installed row's More popover has only Reinstall.
- **Expected:** Only a clearly newer file is called an update, and any file can be installed alongside the current one.
- **Fix:** Call a file an update only when it's newer by a margin or matches the installed file's name. Add "Install alongside" (queueModFile without replaces) to the file row's More popover.
- **Code:** src/screens/browse/ModDrawer.tsx:336-339

### You can't turn an installed mod on or off from its Browse card or menu [medium, missing-option]
- **Status:** fixed
- **Where:** The Browse card's right-click menu and its Installed badge.
- **What happens:** The menu starts with Install again and Show in Mods, with no Turn on or Turn off. The badge says "Installed" whether the mod is on or off.
- **Expected:** The menu can toggle the mod, and the badge says whether it's on.
- **Fix:** Make Turn on / Turn off the first entry and move Install again below Show in Mods. Show "Installed, off" when it's off.
- **Code:** src/screens/browse/menus.ts:95-99

### Mods hidden with "Not interested" can't be found again once the toast is gone [medium, missing-option]
- **Status:** fixed
- **Where:** The Filters popover and the empty state.
- **What happens:** Hidden mods are left out everywhere. "Show in Browse again" only appears in a hidden mod's menu, which you can't reach. The empty state mentions mods "you hid" with no button.
- **Expected:** A way to see and unhide them.
- **Fix:** Add "Show mods you hid (N)" to Filters, and make the "you hid" part of the empty state a button that turns it on.
- **Code:** src/screens/browse/GbBrowser.tsx:226

### The grid has no arrow keys, and each card is three Tab stops [medium, inconvenience]
- **Status:** fixed
- **Where:** The Browse results grid and creator pages.
- **What happens:** Arrow keys do nothing, unlike My Mods, Characters and Profiles. The character (or category) link and the creator link are their own Tab stops inside every card.
- **Expected:** Arrows move between cards, and the inner links are reachable from the card menu.
- **Fix:** Add `onKeyDown={(e) => moveInGrid(e, ref.current, '.gb-card')}` on the grid containers, as Characters.tsx:132 does. Set tabIndex -1 on links inside cards.
- **Code:** src/screens/browse/GbBrowser.tsx:362, src/screens/browse/CreatorPage.tsx:80, 136, src/screens/browse/ModCard.tsx:78-82

### The character row has 126 Tab stops before the first mod [medium, inconvenience]
- **Status:** fixed
- **Where:** The Browse character row. The My Mods character chips have the same problem.
- **What happens:** Every portrait is its own Tab stop, so reaching the grid takes more than 140 Tabs.
- **Expected:** The row is one Tab stop, and the arrows move inside it (rowKeys already handles them).
- **Fix:** Use a roving tabindex in rowKeys rows: tabIndex 0 on the selected or last focused item and -1 on the rest. Do the same for the My Mods chip toolbar.
- **Code:** src/screens/browse/CharRow.tsx:36-49, src/screens/browse/sideScroll.ts:175, src/screens/library/Library.tsx:279

### The drawer's More menu offers actions for the page you're already on [low, rule-break]
- **Status:** fixed
- **Where:** The mod drawer header's More button.
- **What happens:** It reuses the card menu, so it lists Open details (this page), Choose a file (already on screen) and Open on GameBanana (already an icon right beside it).
- **Expected:** A menu that fits where it opens.
- **Fix:** Add a from-drawer flag to gbModItems that drops those three entries.
- **Code:** src/screens/browse/ModDrawer.tsx:148

### The drawer shows "Show in Mods" three times for an installed mod [low, inconvenience]
- **Status:** fixed
- **Where:** The mod drawer for an installed mod.
- **What happens:** There's a gallery tag, an Installed badge in the tags row, and an Installed badge plus a Show in Mods button in the file row. The file row also has a More button whose only entry is Reinstall, and there's no Move to trash.
- **Expected:** One Show in Mods, plus the actions people take on an installed mod.
- **Fix:** Drop the gallery tag or the file-row button. Turn the one-item More into a Reinstall button, or add Move to trash and Install alongside to it.
- **Code:** src/screens/browse/ModDrawer.tsx:328-333

### Installed and Removed badges on a creator page's cards for other games open the wrong game [low, bug]
- **Status:** fixed (it was already fixed before this run)
- **Where:** Creator page, the sections for that creator's mods in other games.
- **What happens:** The badges call go() without switching game, so the mod isn't found. The menu's Show in Mods uses goIn() and works.
- **Expected:** The badge switches to the mod's game.
- **Fix:** Use goIn(game, ...) for both badge clicks.
- **Code:** src/screens/browse/ModCard.tsx:64-67

### Creator page "Load more" fails without a message [low, bug]
- **Status:** fixed
- **Where:** Load more under a creator's mods.
- **What happens:** The error only renders when no mods are listed yet. Once some are listed, the button just stops being busy.
- **Expected:** "Couldn't load more. Try again", like the main grid.
- **Fix:** When mods are shown and an error is set, show the retry text in place of the button.
- **Code:** src/screens/browse/CreatorPage.tsx:117

### Pressing X or I on an installed card does nothing [low, inconvenience]
- **Status:** fixed (it was already fixed before this run)
- **Where:** A Browse card for an installed mod, using a controller or the keyboard.
- **What happens:** No quick action is rendered, so X and I do nothing.
- **Expected:** They open the mod in Mods, as the Installed badge does.
- **Fix:** When installed, make X and I call go({ view: 'library', modId }).
- **Code:** src/screens/browse/ModCard.tsx:34-37, 70-74

### The variant picker's title and hint disagree, and "Cancel" cancels the download [low, wording]
- **Status:** fixed
- **Where:** The variant picker dialog.
- **What happens:** The title says "X has 3 mods inside" and the hint says "They install as one mod". The footer Cancel cancels the whole download, while Escape only postpones it. The "Always install all" tip names a settings page with no way there.
- **Expected:** One word for the parts in both lines, and a footer button that says what it does.
- **Fix:** "3 parts inside" in both lines. Rename Cancel to "Don't install". Add a settings button to the toast that installAllPartsPref.set already shows.
- **Code:** src/screens/browse/OnlineOverlays.tsx:198-210

### Install toasts word the same thing in different ways [low, wording]
- **Status:** fixed
- **Where:** Toasts after an install.
- **What happens:** "It's on, X went off", "It's on, and X went off" and "and turned it on" all appear. A category mod reads "Installed X for NPCs & Entities".
- **Expected:** One pattern, and no "for <category>" when there's no character.
- **Fix:** Use one phrase for the "went off" part, and drop "for Y" from the backend text when Y is a category.
- **Code:** src/screens/library/afterInstall.ts:57

### The character portrait menu in Browse offers "Find mods online" instead of filtering Browse [low, inconvenience]
- **Status:** fixed
- **Where:** Right-click on a portrait in the Browse character row.
- **What happens:** "Find mods online" leaves Browse for the character page's Online tab.
- **Expected:** In Browse, the menu filters Browse.
- **Fix:** From CharRow, replace that entry with "Show only <name>".
- **Code:** src/screens/library/menus.ts:145

### "Save filters" isn't offered for High quality or a sort on their own [low, inconvenience]
- **Status:** fixed
- **Where:** The Browse chip row.
- **What happens:** Save filters only renders inside the chip row, and High quality and sort don't make chips. Both also reset on every visit.
- **Expected:** Any set of filters that isn't the default can be saved.
- **Fix:** Show Save filters whenever `!isPlain(f) && !savedNow`. Optionally keep High quality per game.
- **Code:** src/screens/browse/GbBrowser.tsx:335-348

### Filters has overlapping Type and Category choices, and the Other tip names Bangboo in every game [low, wording]
- **Status:** fixed
- **Where:** The Filters popover.
- **What happens:** Type has UI and Outfits, and Category also has UI and Character Skins, with different results for the same word. The Other tip mentions Bangboo in every game.
- **Expected:** Distinct choices and tips that fit the game.
- **Fix:** Label the section "GameBanana category" or hide categories that duplicate a type. Mention Bangboo only in ZZZ.
- **Code:** src/screens/browse/state.ts:52

### Searching a character's exact name doesn't offer the character filter [low, missing-option]
- **Status:** fixed
- **Where:** The Browse search field.
- **What happens:** "carlotta" runs a text search with mixed results.
- **Expected:** A one-click "Show only Carlotta".
- **Fix:** When the search text equals a character name, show a chip that calls `set({ character, search: '' })`.
- **Code:** src/screens/browse/GbBrowser.tsx:192-198

### Comments are always sorted by Popular [low, missing-option]
- **Status:** fixed
- **Where:** The mod drawer's comments.
- **What happens:** Recent "broken after the update" reports get buried.
- **Expected:** A Newest option.
- **Fix:** Add a Popular / Newest switch in the comments header and remember it across mods.
- **Code:** src/screens/browse/Comments.tsx:52

### Pull can hand you a mod you already have [low, inconvenience]
- **Status:** fixed
- **Where:** The Pull button, when it's turned on.
- **What happens:** ok() filters out hidden mods, blocked creators and adult mods, but not installed ones.
- **Expected:** Pull leaves out installed mods.
- **Fix:** Add `!libIndexNow(game.id).byMod.has(c.id)` to ok().
- **Code:** src/screens/browse/Pull.tsx:28

### The creator page and creator menu name the same options differently, and a creator's list has no sort [low, wording]
- **Status:** fixed
- **Where:** The creator page buttons and the creator right-click submenu.
- **What happens:** The page says "Add to favourites"/"Favourite" and "Prioritize"/"Prioritized". The menu says "Favourite" and "Priority". The list is always sorted by Popular.
- **Expected:** The same names in both places, and a sort option.
- **Fix:** Use "Favourite" and "Prioritize" in both. Add a New / Most downloaded sort.
- **Code:** src/screens/browse/CreatorPage.tsx:54-57, 101, 113; src/screens/browse/menus.ts:74-75

### Waits in the drawer say only "Loading" or show bare skeletons [low, rule-break]
- **Status:** fixed
- **Where:** The drawer title while loading, and the comments skeleton.
- **What happens:** Neither says what it's waiting on, and neither has a timeout line.
- **Expected:** "Asking GameBanana for this mod", "Loading comments".
- **Fix:** Use the kit's Waiting with a line. After 10 seconds, say GameBanana may be slow and offer Open on GameBanana.
- **Code:** src/screens/browse/ModDrawer.tsx:141, src/screens/browse/Comments.tsx:66

### The adult "Show" tip is a joke and doesn't match the menu [low, wording]
- **Status:** fixed
- **Where:** The Filters popover, the drawer header and Settings.
- **What happens:** "Pictures show unblurred. Warning: No panic button, sorry", while the card menu says "Show everything".
- **Expected:** "Mods for adults: show their pictures unblurred".
- **Fix:** Use one string in all four places.
- **Code:** src/screens/browse/GbBrowser.tsx:412, src/screens/library/ModDrawer.tsx:54, src/screens/settings/Sections.tsx:87, src/screens/browse/menus.ts:13

---

## Downloads

### The one-time "Keep new mods off" offer gets lost during a burst of installs [high, bug]
- **Status:** fixed
- **Where:** The toast after the first install ever.
- **What happens:** The "asked" flag is saved before the toast shows. The stack keeps 4 toasts at most, so later "Installed X" toasts push the offer out within seconds and it never comes back. Two installs that finish together can both show it. "Keep new mods off" only turns off the mod named in that toast, and the others from the same burst stay on.
- **Expected:** It shows once and stays until seen, and "Keep new mods off" turns off every mod that was turned on automatically.
- **Fix:** Save the flag only once the toast has been used or has timed out, with a module-level guard against a second copy. Keep this toast from being pushed out. Have the button restore every mod turned on since the offer appeared.
- **Code:** src/screens/library/afterInstall.ts:40-51, src/ui/toast.tsx:59

### Every finished install gets its own toast, which floods the screen during bulk installs [medium, inconvenience]
- **Status:** fixed
- **Where:** Install toasts, routed through afterInstall.
- **What happens:** Queuing 20 mods gives 20 toasts, with 4 on screen at most. Useful ones (Review files, failures with Install mod loader, the one-time offer) get pushed out. Installing several skins for one character also posts a "Switch <name>'s skins while you play?" toast per install, and that toast drops the Open button.
- **Expected:** Installs that finish close together share one toast that updates in place ("Installed 7 of 12") with a Downloads button. Same-character installs are combined. Failure and review toasts stay separate.
- **Fix:** While the queue is busy, gather successful installs into one toast updated with retoast. Merge per-character switch toasts within a short window and pass Open as the second action.
- **Code:** src/App.tsx:156, src/screens/library/afterInstall.ts:52-58

### Cancel deletes the partial file, so Retry starts over [medium, bug]
- **Status:** fixed
- **Where:** The Cancel x on in-progress rows, then Retry.
- **What happens:** Cancel deletes the .part file, so Retry downloads from zero, though the spec says retry resumes. Cancel has no confirm or undo, so a misclick at 90% of a large file loses all of it. There's no pause.
- **Expected:** Retry after a cancel resumes, or a Pause keeps the bytes already downloaded.
- **Fix:** Keep the .part on cancel and delete it on Clear. Optionally add an Undo toast after Cancel.
- **Code:** src-tauri/src/runner.rs:287, docs/spec.md:509

### No "Retry failed" when many downloads fail [medium, missing-option]
- **Status:** fixed
- **Where:** The Downloads header and batch headings.
- **What happens:** Each failed row needs its own Retry. A batch heading shows "3 failed" but only has Turn all on, Turn all off and Clear.
- **Expected:** One click retries every failure.
- **Fix:** Add "Retry failed (N)" next to Clear finished, and a Retry button in BatchHead when anything failed.
- **Code:** src/screens/downloads/Batches.tsx:142-157

### Download rows have no right-click menu [medium, missing-option]
- **Status:** fixed
- **Where:** Every Downloads row.
- **What happens:** Right-click and Shift+F10 give nothing for the row, so its actions can't be reached from a menu, and there's no way to copy the GameBanana link.
- **Expected:** Show in Mods, Retry or Cancel, Show file, Open GameBanana page, Copy link and Clear from list.
- **Fix:** Register a "download" menu with the row's existing actions plus Copy link. Reuse the mod menu for finished single-mod rows.
- **Code:** src/screens/downloads/Downloads.tsx:190

### "Show in Mods" points at mods that have since been removed [medium, bug]
- **Status:** fixed
- **Where:** The Show in Mods button on finished rows.
- **What happens:** The button shows even after the mod is gone. Clicking it opens Mods, which shows "That mod isn't installed anymore" and closes, with no way to the trash or a reinstall. Single-mod rows never show the "removed since" note.
- **Expected:** The row says the mod was removed and offers to restore or reinstall it.
- **Fix:** Hide Show in Mods when no mods remain and some are gone. Show "Removed since" with Restore (opens the trash) or Reinstall.
- **Code:** src/screens/downloads/Downloads.tsx:228-231

### Failures get buried among finished rows and count as seen before anyone looks [medium, inconvenience]
- **Status:** fixed
- **Where:** The Finished panel, the seen timer and the sidebar badge.
- **What happens:** Failed rows sort with finished rows by time, so in a batch of 30 a failure can sit below the fold. Every failure counts as seen after 5 seconds on the page, even rows scrolled out of view. While anything runs, the badge only shows the running count. The header counts only running and waiting items.
- **Expected:** Failures stay easy to find and only count as seen once they've been on screen.
- **Fix:** Sort failed and needsChoice rows first in each batch. Mark rows seen with an IntersectionObserver. Add failures to the header ("2 running, 4 waiting, 1 failed").
- **Code:** src/screens/downloads/Downloads.tsx:70-86, src/screens/downloads/Batches.tsx:27, src/screens/browse/OnlineOverlays.tsx:45-47

### Show in Mods is disabled for another game's download, though the toast's Open switches games [low, inconvenience]
- **Status:** fixed
- **Where:** Downloads with All games on, on a finished row from another game.
- **What happens:** The button is disabled with "Switch to X to see it", but the install toast's Open switches games and opens the mod.
- **Expected:** Show in Mods switches to that game.
- **Fix:** Reuse the toast's logic: setGame if needed, then go to the mod.
- **Code:** src/screens/downloads/Downloads.tsx:229-230

### The game badge and Update badge on a row do nothing when clicked [low, rule-break]
- **Status:** fixed
- **Where:** The game badge and the Update badge on a Downloads row.
- **What happens:** Both name something but have no onClick.
- **Expected:** The game badge switches to that game, and the Update badge opens the mod it replaced.
- **Fix:** `onClick={() => setGame(i.req.game)}`, and open `meta.replaces` in Mods.
- **Code:** src/screens/downloads/Downloads.tsx:202-203

### The slow-download line promises a server switch even when that setting is off [low, wording]
- **Status:** fixed
- **Where:** The state line on a downloading row.
- **What happens:** After 10 seconds with no data, it always says gachamod will move to another server, without checking the setting.
- **Expected:** With the setting off, the line says the server may be busy and offers a button to the setting.
- **Fix:** Read otherServersPref in stateLine. When it's off: "No data for 14 s. GameBanana's server may be busy", with a Settings button.
- **Code:** src/screens/downloads/Downloads.tsx:111

### Installing rows have no Cancel and no reason why [low, inconvenience]
- **Status:** fixed
- **Where:** An in-progress row in the installing state.
- **What happens:** The Cancel x is hidden with no explanation.
- **Expected:** A disabled Cancel with the tip "It's being installed right now and will be done in a moment".
- **Fix:** Render the button disabled with that title instead of hiding it.
- **Code:** src/screens/downloads/Downloads.tsx:248

### Clearing rows has no undo, and kept archives can't be found from the app [low, inconvenience]
- **Status:** fixed
- **Where:** Clear finished, the batch Clear x and Clear from list.
- **What happens:** Clearing happens at once with no Undo. With archive deletion off, after clearing, nothing opens the downloads folder.
- **Expected:** An Undo toast, and a way to open the downloads folder.
- **Fix:** Show "Cleared 14 downloads" with Undo. Add an "Open the downloads folder" button next to the settings icon.
- **Code:** src/screens/downloads/Downloads.tsx:279

### No keyboard movement between Downloads rows [low, inconvenience]
- **Status:** fixed
- **Where:** The Downloads list.
- **What happens:** The only way through is Tab across every button of every row.
- **Expected:** Arrows move between rows, Enter opens the mod, and Delete cancels or clears.
- **Fix:** Reuse the list movement from library/gridNav.ts.
- **Code:** src/screens/downloads/Downloads.tsx:190

### A bundle's open or closed mod list is forgotten when you leave Downloads [low, inconvenience]
- **Status:** fixed
- **Where:** The "N of M on" toggle on a finished row.
- **What happens:** The state lives in the component, so it resets every time you come back.
- **Expected:** It's remembered for the session.
- **Fix:** Keep it in a module-level store or sessionStorage, keyed by item id.
- **Code:** src/screens/downloads/Downloads.tsx:156-158

---

## My Mods

### Esc in a details field throws away what you typed [medium, bug]
- **Status:** fixed
- **Where:** The mod drawer's Name, Character, Add a tag and Notes fields.
- **What happens:** The drawer's window-level Escape closes it, and the fields only save on blur. The input is removed without a blur, so the edit is lost.
- **Expected:** Esc saves the field (or reverts only that field) before the drawer closes.
- **Fix:** Save pending values when the drawer closes or unmounts, or make the first Esc blur the field and the second close the drawer.
- **Code:** src/screens/library/ModDrawer.tsx:268-292, src/ui/kit.tsx:311-317

### Turning a mod on quietly turns another off, and the toast doesn't say so [medium, bug]
- **Status:** fixed
- **Where:** The bulk bar's Turn on, single toggles in My Mods, and outfit swaps on a character page.
- **What happens:** The one-skin rule turns off another mod, but the toast only names the mods you picked ("Turned on Adeptus Hu Tao." while Hu Tao Summer went off). That makes it unclear what Undo will bring back. When the selection holds two skins for one character, it doesn't say which one won.
- **Expected:** "Turned on X, turned off Y."
- **Fix:** Always build the label with summarize(change), as afterInstall.ts already does.
- **Code:** src/screens/library/data.ts:155-156

### The character chip menu only opens from the name text [medium, bug]
- **Status:** fixed
- **Where:** The character chips in My Mods.
- **What happens:** onContextMenu sits on the inner name span. Right-clicking the portrait or count gives the page menu, and Shift+F10, the Menu key and the controller's menu button never reach the span, though the tip says "Right-click for more".
- **Expected:** The character menu opens from anywhere on the chip and from the keyboard.
- **Fix:** Let kit Chip take onContextMenu and put the handler on the button.
- **Code:** src/screens/library/Library.tsx:229-235, src/ui/kit.tsx:76-84

### No Update all in My Mods [medium, missing-option]
- **Status:** fixed
- **Where:** The Updates filter chip, the bulk bar, and the menu with several mods selected.
- **What happens:** Home has "Update all N", but My Mods doesn't. "Get the update" only works on one mod.
- **Expected:** One click updates every mod that has an update.
- **Fix:** Add "Update all (N)" next to the Updates chip while it's on, and let "Get the update" work on a selection.
- **Code:** src/screens/library/menus.ts:126, src/screens/library/ModGrid.tsx:241-268

### Removing a mod with no GameBanana link can't be undone when the trash keeps no files [medium, bug]
- **Status:** fixed
- **Where:** The Delete key, bulk Trash and the menu's Move to trash, with trash days set to 0.
- **What happens:** Files are deleted at once with no confirm, and Delete works from anywhere on the screen while a selection exists. Undo only re-downloads mods that came from GameBanana and silently does nothing for the rest. The labels still say "Move to trash", and the bulk tip says "Undo puts them back".
- **Expected:** Undo works or says it can't. Mods that can't come back are confirmed first, or the label says Delete.
- **Fix:** Confirm first when any mod in the selection has no source and trash days are 0. In Undo, say which mods couldn't come back. Say "Delete" when nothing is kept.
- **Code:** src/screens/library/data.ts:194-228, src/screens/library/menus.ts:131, src/screens/library/ModGrid.tsx:265

### Shuffle counts sub-mods as outfits and gives a skin to characters that had none on [medium, bug]
- **Status:** fixed
- **Where:** The Shuffle outfits button, and shuffle at Play.
- **What happens:** Sub-mods (for example a hair recolour) can be picked as the outfit, and a character with every mod off on purpose gets one turned on.
- **Expected:** Sub-mods follow their parent, and characters with nothing on are left alone.
- **Fix:** Skip mods with a parent, and only shuffle characters that have a mod on.
- **Code:** src/screens/library/shuffle.ts:18-34

### Delete leaves keyboard focus nowhere [medium, inconvenience]
- **Status:** fixed
- **Where:** Pressing Delete on a focused card.
- **What happens:** Focus falls to `<body>`, so the next arrow does nothing and you can't keep deleting down the list.
- **Expected:** Focus moves to the next card, or the previous one at the end.
- **Fix:** After trash(), focus the card at the same index, clamped to the list.
- **Code:** src/screens/library/ModGrid.tsx:111-114, 192

### Search has no keyboard path to the results [medium, inconvenience]
- **Status:** fixed
- **Where:** The My Mods search field. Browse has the same gap.
- **What happens:** After typing, ArrowDown and Enter do nothing. Reaching the first card takes about 14 Tabs.
- **Expected:** ArrowDown or Enter moves to the first match.
- **Fix:** Pass onEnter that focuses the first `.mod-card-hit` (the first `.gb-card` on Browse), and treat ArrowDown like Enter in SearchField.
- **Code:** src/screens/library/Library.tsx:202, src/ui/kit.tsx:114-122

### The bulk bar and the menu disagree on which mods Attempt fix covers [low, bug]
- **Status:** fixed
- **Where:** The bulk bar's "Attempt fix" and the More menu's "Attempt fix for the game update".
- **What happens:** The bar counts only broken mods (1). The menu also counts unfixable mods that have a fixer (3). The menu tip can list the same reason twice.
- **Expected:** The same set in both places, with each reason listed once.
- **Fix:** Share isBroken with ModGrid, and remove duplicate reasons before slice(0, 3).
- **Code:** src/screens/library/ModGrid.tsx:226, src/screens/library/menus.ts:35, 103

### The first item in the card menu is Select, not the common action [low, inconvenience]
- **Status:** fixed
- **Where:** The card menu (Shift+F10, right-click, or X on a controller).
- **What happens:** "Select Ctrl+Space" sits above Turn on/off, so Shift+F10 then Enter selects the card.
- **Expected:** Turn on/off first, then Details.
- **Fix:** Move Select and Clear the selection below Details.
- **Code:** src/screens/library/ModGrid.tsx:137-145

### The Trash page has no arrow keys and no bulk cleanup [low, missing-option]
- **Status:** fixed
- **Where:** My Mods > Trash.
- **What happens:** Tiles have no ... button, no arrow-key movement, and there's no Empty trash, Put back all or multi-select.
- **Expected:** Arrow and controller movement through tiles, and one-click cleanup.
- **Fix:** Add moveInGrid over the tiles, and an "Empty trash" button (with a confirm, since it can't be undone).
- **Code:** src/screens/library/Archive.tsx:121-176

### No Select all for mouse or controller [low, missing-option]
- **Status:** fixed
- **Where:** The card menu and the bulk bar.
- **What happens:** Selecting everything shown only works with Ctrl+A.
- **Expected:** Mouse and controller users can select everything shown.
- **Fix:** Add "Select all shown (Ctrl+A)" next to Select at the top of the card menu.
- **Code:** src/screens/library/ModGrid.tsx:137-146

### Space toggles a selection differently than the menu does [low, inconvenience]
- **Status:** fixed
- **Where:** Space on a focused card that's part of a selection.
- **What happens:** Space uses the focused mod's state for the whole selection, while the menu uses "are all on?".
- **Expected:** Both behave the same.
- **Fix:** Use the menu's allOn rule.
- **Code:** src/screens/library/ModGrid.tsx:190

### Four different labels for the same update actions [low, wording]
- **Status:** fixed
- **Where:** The card badge "Update", the menu's "Get the update" and "Check for update", the drawer's "Get the update" and "Check for an update", and "Mod page" in the drawer compared with "Open on GameBanana" in the menu.
- **What happens:** In the broken-mod notes, "Check for an update" downloads right away. The menu's "Check for update" stays singular with many mods selected.
- **Expected:** One verb per action.
- **Fix:** "Update" for downloading, "Check for updates" for checking, and "Open on GameBanana" everywhere.
- **Code:** src/screens/library/ModDrawer.tsx:218-221, 247-250; src/screens/library/menus.ts:126-127

### The Rescan tip says opening the page only reads the folder [low, wording]
- **Status:** fixed
- **Where:** The Rescan button tip.
- **What happens:** Opening the page also checks for updates, and does so every 30 minutes.
- **Expected:** The tip matches what happens.
- **Fix:** Remove the last sentence.
- **Code:** src/screens/library/Library.tsx:104-123, 212-213

### "Check for update" shows no wait message [low, inconvenience]
- **Status:** fixed
- **Where:** The menu's Check for update, and the Update badge.
- **What happens:** Nothing shows until the check finishes, and the badge shows no busy state after a click.
- **Expected:** The wait says what it's waiting on.
- **Fix:** Show "Checking 3 mods on GameBanana" while it runs, and a busy state on the badge.
- **Code:** src/screens/library/actions.ts:226-242, src/screens/library/ModCard.tsx:92-94

### F2 rename doesn't select the name [low, inconvenience]
- **Status:** fixed
- **Where:** The rename dialog.
- **What happens:** The caret goes to the end, so typing adds to the old name.
- **Expected:** The name is selected, as in Explorer.
- **Fix:** Select the text on mount.
- **Code:** src/screens/library/LibDialogs.tsx:60

### Clicking a tag in the drawer deletes it, and tag fields don't suggest existing tags [low, inconvenience]
- **Status:** fixed
- **Where:** The drawer's tags and the Tags dialog.
- **What happens:** A plain click removes the tag. The tag fields offer no list of existing tags, so the same tag ends up spelled several ways.
- **Expected:** Clicking a tag filters My Mods by it, an x removes it, and existing tags are suggested.
- **Fix:** Make the chip body search for the tag and only the x remove it. Add a datalist of the library's tags to both fields.
- **Code:** src/screens/library/ModDrawer.tsx:279-287, src/screens/library/LibDialogs.tsx:122

### The header and bulk bar wrap badly in a small window [low, bug]
- **Status:** fixed
- **Where:** The My Mods header, the bulk bar and the title bar breadcrumb, at about 1024 px wide.
- **What happens:** View, Rescan and Shuffle drop to their own row. The search placeholder is cut off. Trash and x wrap onto a second line, and the breadcrumb for an open mod shrinks to "A.".
- **Expected:** Controls fit or collapse neatly.
- **Fix:** Let the search shrink first, move the bulk bar's chatbot and share buttons into its ... menu, and give the breadcrumb a minimum width.

### Mod card tips don't name the keys for selecting or the menu [low, wording]
- **Status:** fixed
- **Where:** The card tip and More button in My Mods, and the More button in the Browse drawer.
- **What happens:** The card names Ctrl+click but not Ctrl+Space. The More button names right-click and X but not Shift+F10. The two More buttons are worded differently.
- **Expected:** Tips name the keys.
- **Fix:** "Ctrl+click or Ctrl+Space selects". Use "More actions (right-click or Shift+F10)" on both More buttons.
- **Code:** src/screens/library/ModCard.tsx:61, 114; src/screens/browse/ModDrawer.tsx:148

### Hover tips name a setting with no way to get there [low, rule-break]
- **Status:** fixed
- **Where:** The drawer's "For adults" switch tip and the Shuffle button tip.
- **What happens:** Both say "(Settings, Mods and downloads)" with nothing that opens it.
- **Expected:** A place that's named comes with a way there.
- **Fix:** Remove the place from the tips, or add a small settings link (Shuffle could open a menu with the at-Play option).
- **Code:** src/screens/library/ModDrawer.tsx:296, src/screens/library/Library.tsx:214

---

## Characters

### Swapping a character's outfit asks every time, and only "keep both" can be remembered [high, inconvenience]
- **Status:** fixed
- **Where:** A mod card's switch on a character page or in My Mods, when another mod for that character is on.
- **What happens:** A menu asks "Another Camellya mod is on" and offers Turn off the other / Keep both / Make it a sub-mod / Keep both and don't ask again. With the default Ask, every outfit swap takes an extra click, and only the less common answer can be remembered. The switch's tip suggests a plain click swaps.
- **Expected:** "Swap" can be remembered from the same menu.
- **Fix:** Add "Turn off the other and don't ask again" (sets oneSkin to auto, with Undo), or make auto the default, since the backend already checks that both mods change the same parts.
- **Code:** src/screens/library/overlap.ts:89-103

### No way to pick a character's outfit from the right-click menu [medium, missing-option]
- **Status:** fixed
- **Where:** Right-click on a roster tile, a character strip chip, or a character chip in My Mods.
- **What happens:** The menu has Turn on all mods, which ends with only the last one on while one skin per character is set (its own tip says so). Changing an outfit takes four steps through the character page.
- **Expected:** Pick an outfit straight from the menu.
- **Fix:** Replace "Turn on all mods" with a "Wear" submenu: one checked entry per mod plus Default outfit, using changeStates. Show Turn on all mods only when one skin per character is off.
- **Code:** src/screens/library/menus.ts:135-158

### "Default outfit" on the page is "Turn off all mods" in the menu [low, wording]
- **Status:** fixed
- **Where:** The character page's hero button compared with the roster tile menu.
- **What happens:** One action has two names and two icons.
- **Expected:** One name.
- **Fix:** Call the menu entry "Default outfit" and use the same icon.
- **Code:** src/screens/characters/CharacterPage.tsx:111, src/screens/library/menus.ts:150

### Text says "Characters" in games where the page has another name [low, wording]
- **Status:** fixed
- **Where:** The Owned tip in the character menu, the profile editor's Character tab hint, and the Ctrl+4 line in the shortcuts list.
- **What happens:** These say "Characters page" or "Characters" while WuWa calls the page Resonators and ZZZ calls it Agents.
- **Expected:** The game's own word.
- **Fix:** Use charNoun(game) (IconPicker needs the game passed in), and build the shortcuts line from viewLabel.
- **Code:** src/screens/library/menus.ts:152, src/screens/profiles/ProfileEditor.tsx:284, src/lib/keys.ts:8

### The Owned chip always shows a check mark [low, wording]
- **Status:** fixed
- **Where:** The Owned chip in the roster header.
- **What happens:** The check shows whether the filter is on or off, so it looks on when it's off.
- **Expected:** The check only shows when the filter is on.
- **Fix:** `icon={view.owned ? 'check' : undefined}`.
- **Code:** src/screens/characters/Characters.tsx:103

### The roster sort and "Only with mods" toggle have no label or tip [low, rule-break]
- **Status:** fixed
- **Where:** The roster header.
- **What happens:** The sort select has no title or aria-label (kit Select doesn't take a title), and the toggle has no tip.
- **Expected:** Controls that need explaining get a hover tip.
- **Fix:** Add a title prop to kit Select and pass "Sort the roster". Give the toggle "Leave out characters with no mods installed".
- **Code:** src/screens/characters/Characters.tsx:102, 105, src/ui/kit.tsx:140-148

---

## Profiles

### Rename from a profile's page does nothing, then shows up later on the grid [high, bug]
- **Status:** fixed
- **Where:** A profile's page, More (or right-click the header) > Rename (F2).
- **What happens:** requestEdit doesn't navigate, and the rename flag is set for the grid card, which isn't on screen. When you go back to Profiles, that card is in rename mode.
- **Expected:** Rename works where you are.
- **Fix:** On the profile page, treat "rename" like "all" (open the editor with the name selected), or make the page title editable. Clear the rename flag when you leave the grid.
- **Code:** src/screens/profiles/Profiles.tsx:44-47, 57-69

### A hotkey another profile uses gets taken silently, and Undo doesn't give it back [high, bug]
- **Status:** fixed
- **Where:** Profile editor > In-game hotkey.
- **What happens:** Saving Ctrl+Alt+1 on Beach day clears it from Night run, as the backend does. The field never says the key is already used, and the toast only says "Changed Beach day". Undo restores only Beach day, so Night run is left without a hotkey.
- **Expected:** While recording, the field says "Night run uses Ctrl+Alt+1. Saving moves it here", the toast names the move, and Undo restores both profiles.
- **Fix:** Check knownProfiles(game) for the key and show it as the field's note. Record one history step that also restores the other profile's hotkey.
- **Code:** src/screens/profiles/actions.ts:66-76, src/screens/profiles/ProfileEditor.tsx:122-138, 180, crates/gacha-core/src/hotkeys.rs:138

### The profile page swaps outfits silently while the rest of the app asks [medium, inconvenience]
- **Status:** fixed
- **Where:** A profile that isn't on > Add mods > turning on a second mod for one character.
- **What happens:** The other mod is taken out without asking, because the page reads the setting as `v !== "0"`, so Ask behaves like auto. It also skips the same-parts check, so adding a hair recolour removes the outfit. Shift+click does nothing here.
- **Expected:** One rule everywhere for "Another skin already on".
- **Fix:** Read all three values of the setting and reuse askOverlap with the profile's members as the "on" set.
- **Code:** src/screens/profiles/ProfilePage.tsx:48, 52, 97-112

### A new profile made from the mods on now isn't switched to [medium, inconvenience]
- **Status:** fixed
- **Where:** The New profile dialog.
- **What happens:** The old profile stays on, so changes you make right after go to it instead of the profile you just made.
- **Expected:** The new profile, which already matches the mods on now, becomes the one in use.
- **Fix:** Make it active after creating it from the current mods (no files change). For "No mods", add a Switch to it button on the toast.
- **Code:** src/screens/profiles/actions.ts:37-54, crates/gacha-core/src/profiles.rs:156-175

### Enter in the hotkey field doesn't save the dialog [low, inconvenience]
- **Status:** fixed
- **Where:** The In-game hotkey field in the profile editor and New profile.
- **What happens:** The field swallows every key except Tab, though Save says "(Enter)". "Set a hotkey" from a menu opens with this field focused, so Enter never works on that path.
- **Expected:** After a key is recorded, a bare Enter saves.
- **Fix:** Let a bare Enter (no modifiers) through. It isn't a valid hotkey anyway.
- **Code:** src/screens/profiles/HotkeyField.tsx:33-47

### Deleting a profile with Del drops focus to the page body [low, inconvenience]
- **Status:** fixed
- **Where:** The profiles grid.
- **What happens:** The focused card disappears and focus goes to `<body>`.
- **Expected:** Focus moves to the next card.
- **Fix:** Note the card's index first and focus the neighbour once the list reloads.
- **Code:** src/screens/profiles/Profiles.tsx:74

### Switching from a menu, search or the sidebar shows no busy state and can run twice [low, inconvenience]
- **Status:** fixed
- **Where:** Profile switching from the right-click menu, search, or the sidebar.
- **What happens:** Only switching from the grid marks the card busy. The other paths leave Switch enabled, switchProfile has no guard, and the sidebar shows a bare spinner with the old tip. The title bar does say "Switching profile" after 1.2 seconds.
- **Expected:** The card, sidebar and menu all show the switch, and a second switch can't start.
- **Fix:** Keep a shared "switching profile id" in data.ts and read it in the card, the sidebar (tip "Switching to X") and the menu.
- **Code:** src/screens/profiles/menus.ts:18-19, src/screens/profiles/Profiles.tsx:49-53, src/shell/Sidebar.tsx:239, src/screens/profiles/data.ts:72

### Duplicate doesn't let you name the copy [low, inconvenience]
- **Status:** fixed
- **Where:** Profile menu > Duplicate.
- **What happens:** It makes "Night run copy", and you have to find the card and press F2.
- **Expected:** The copy appears in rename mode with its name selected.
- **Fix:** Call requestEdit(copy.id, 'rename') after duplicating. This needs the profile page rename fix first.
- **Code:** src/screens/profiles/actions.ts:56-63

### The editor's "Open the Characters screen" hint has no button [low, rule-break]
- **Status:** fixed
- **Where:** Profile editor > icon > Character tab, when no portraits are loaded.
- **What happens:** The hint names a place with no way there.
- **Expected:** A button, or the portraits load right there.
- **Fix:** Add "Open <Resonators>", or load the portraits in the picker.
- **Code:** src/screens/profiles/ProfileEditor.tsx:284

### The banner picker's wait says "this profile" but reads every mod in the game [low, wording]
- **Status:** fixed
- **Where:** Profile editor > banner > A mod's preview.
- **What happens:** It says "Reading the mods in this profile" but lists every mod in the game.
- **Expected:** Wording that matches what it reads.
- **Fix:** "Reading your mods".
- **Code:** src/screens/profiles/ProfileEditor.tsx:300, 325

### The "Add mods" tab count includes mods already in the profile [low, wording]
- **Status:** fixed
- **Where:** The tabs on a profile's page.
- **What happens:** "In this profile 3" sits next to "Add mods 7", where 7 is every mod in the game.
- **Expected:** The count matches the label.
- **Fix:** Show the total minus the profile's count, or rename the tab "All mods".
- **Code:** src/screens/profiles/ProfilePage.tsx:158, 177-178

---

## Tools

### Mod rows in Tools have no mod right-click menu [medium, missing-option]
- **Status:** fixed
- **Where:** Mod names in Problems, Fixes (listed, dead ends, Muted, Fixed), Conflicts, Key clashes and Find a hash results.
- **What happens:** Right-click and Shift+F10 give the shell's page menu. You can't turn the mod off, open its folder, trash it, or use Wait for an update or Ignore problems without going to Mods first.
- **Expected:** The same mod menu as everywhere else. That also gives Fixes rows a per-mod mute.
- **Fix:** Add `onContextMenu={menuHandler(() => menuFor('mod', {game, mod}))}` on each `tp-link`. Look the mod up from a getter for library/menus.ts lastMods, falling back to library.list. Add no new entries.
- **Code:** src/screens/modtools/ProblemsPanel.tsx:89, 109; src/screens/modtools/ToolsPanels.tsx:111, 206, 247, 321; src/screens/tools/FixesPanel.tsx:112, 127, 166, 208

### Opening any Tools page marks every conflict and problem as seen [medium, bug]
- **Status:** fixed
- **Where:** The sidebar Tools badge.
- **What happens:** Opening Tools on Share and move or Mod makers clears the badge, though Problems and Conflicts were never shown.
- **Expected:** A page only marks its own items as seen.
- **Fix:** Pass the page id into markToolsSeen and clear "p|" keys only on Problems and fixes, and "c|" keys only on Conflicts.
- **Code:** src/screens/modtools/toolsBadge.ts:39, 53; src/screens/modtools/ModtoolsOverlays.tsx:41-45

### The Tools page list shows no counts [medium, inconvenience]
- **Status:** fixed
- **Where:** The page list on the left of Tools.
- **What happens:** Once Tools opens, the badge clears and no page says which one has new items.
- **Expected:** Problems and fixes and Conflicts show their own counts.
- **Fix:** Add an optional count to PageInfo and fill it from toolsBadge.ts.
- **Code:** src/screens/tools/Tools.tsx:41-47, src/screens/settings/Paged.tsx:17

### The Tools badge leaves out mods a game update broke [medium, inconvenience]
- **Status:** fixed
- **Where:** The sidebar Tools badge compared with Tools > Fixes.
- **What happens:** The badge only counts conflicts and problems, so after a game update, the most common reason to open Tools never shows on it.
- **Expected:** Broken mods that are on and not held count, and clear once seen.
- **Fix:** Add a "fixes" part fed from lib/fixes.ts, respecting the fix warnings mute.
- **Code:** src/screens/modtools/toolsBadge.ts:11

### One "Attempt fix" click makes several Undo steps and several toasts [medium, inconvenience]
- **Status:** fixed
- **Where:** Tools > Fixes > Attempt fix on N mods.
- **What happens:** Hash swaps record one Undo step, and each fixer run records another and posts its own toast ("changed no files in X", "still broken") with its own View mod button.
- **Expected:** One click is one Undo step with one summary toast ("Fixed 2 mods, 1 needs its author").
- **Fix:** Have swapHashes and runFixers return their results and backups, and have fixMods record and toast once.
- **Code:** src/lib/fixes.ts:204-224, 370-381

### Frame dumps Delete removes gigabytes for good in one click [medium, rule-break]
- **Status:** fixed
- **Where:** Tools > Mod makers > Frame dumps > Delete.
- **What happens:** remove_dir_all runs on every FrameAnalysis folder (1.7 GB in the demo), with no Undo and no trash.
- **Expected:** Never lose a user's files.
- **Fix:** Send the folders to the Recycle Bin, keep the one click, and say in the toast where they went.
- **Code:** crates/gacha-core/src/devtools.rs:130-133, src/screens/tools/Tools.tsx:124-125

### The overlay and the Conflicts panel report different conflict keys to the badge [low, bug]
- **Status:** fixed
- **Where:** The conflicts part of the Tools badge.
- **What happens:** The overlay reports ignored conflicts too. If you leave Tools within 1.5 seconds of ignoring one, it comes back on the badge as new.
- **Expected:** Ignored conflicts never count.
- **Fix:** Report `g.filter((x) => !x.ignored).map(conflictKey)` in the overlay.
- **Code:** src/screens/modtools/ModtoolsOverlays.tsx:51, src/screens/modtools/ToolsPanels.tsx:66

### The Problems header counts mods that are off, though the Off tip says they don't count [low, bug]
- **Status:** fixed
- **Where:** The Problems header count and the Off badge tip.
- **What happens:** The header includes mods that are off, while the badge skips them and the tip says they don't count.
- **Expected:** The header and the badge agree.
- **Fix:** Count only mods that are on, or reword the tip to say they don't count on the sidebar badge.
- **Code:** src/screens/modtools/ProblemsPanel.tsx:45, 110; src/screens/modtools/problems.ts:41

### The Redo toast lowercases the mod name [low, bug]
- **Status:** fixed
- **Where:** The toast after undoing a fix on Problems.
- **What happens:** "Undone: beach Walk Camellya: Kept ...".
- **Expected:** "Undone: Beach Walk Camellya: ...".
- **Fix:** Start fix labels with a verb ("Kept 3/Variant.ini on in Beach Walk Camellya"), or skip lowercasing when the label doesn't start with one.
- **Code:** src/lib/history.ts:56, src/screens/modtools/problems.ts:124

### The Fixed list disappears once every broken mod is fixed [low, bug]
- **Status:** fixed
- **Where:** Tools > Fixes after Attempt fix.
- **What happens:** It says "gachamod fixed 2 mods", but the Fixed list only renders while broken mods remain.
- **Expected:** Fixed (n) shows whenever something was fixed.
- **Fix:** Remove the `listed.length > 0` condition.
- **Code:** src/screens/tools/FixesPanel.tsx:121

### Shader cache Clear stays enabled while the game runs [low, bug]
- **Status:** fixed
- **Where:** Tools > Mod makers > Shader cache > Clear.
- **What happens:** The backend refuses while the game runs, so the click ends in an error toast. Wipe in the same list is disabled with "Close the game first".
- **Expected:** Disabled with the same tip.
- **Fix:** `disabled={!st?.shaderCache.bytes || game.running}` with the same title switch as Wipe.
- **Code:** src/screens/tools/Tools.tsx:119, crates/gacha-core/src/devtools.rs:123

### The import button counts mods that Skip leaves out [low, bug]
- **Status:** fixed
- **Where:** The .gachamod import dialog.
- **What happens:** "Import 3 mods" while one of them will be skipped.
- **Expected:** "Import 2 mods".
- **Fix:** Subtract existing mods when Skip is chosen.
- **Code:** src/screens/modtools/ModtoolsOverlays.tsx:331

### Find a hash keeps the last game's results after switching games [low, bug]
- **Status:** fixed
- **Where:** Tools > Mod makers > Find a hash.
- **What happens:** Results and their Open in Mods links still point at the previous game.
- **Expected:** Results clear on a game switch.
- **Fix:** `useEffect(() => setHits(null), [game])`.
- **Code:** src/screens/modtools/ToolsPanels.tsx:288-304

### "Wipe saved mod options" asks in a modal even though a backup exists [low, inconvenience]
- **Status:** fixed
- **Where:** Tools > Mod makers > Saved mod options > Wipe.
- **What happens:** A Confirm opens, though d3dx_user.ini.wiped.bak is written first.
- **Expected:** It acts right away with an Undo toast.
- **Fix:** Record an Undo that restores the backup and remove the Confirm.
- **Code:** src/screens/tools/Tools.tsx:143-147, crates/gacha-core/src/devtools.rs:146

### Hash results can't open the ini they name [low, missing-option]
- **Status:** fixed
- **Where:** Find a hash results.
- **What happens:** The ini file and section show as plain text.
- **Expected:** Clicking opens that ini.
- **Fix:** Make it a `tp-link` that opens the file with shell.openPath.
- **Code:** src/screens/modtools/ToolsPanels.tsx:322

### No Ignore for key clashes [low, missing-option]
- **Status:** fixed
- **Where:** Tools > Conflicts > Key clashes.
- **What happens:** A deliberate shared key stays listed and counted forever.
- **Expected:** Ignore, as Conflicts has.
- **Fix:** Reuse ConflictsPanel's Ignore button and Ignored list.
- **Code:** src/screens/modtools/ToolsPanels.tsx:196-201

### The other mod's name in a mod's Conflicts isn't a link [low, inconvenience]
- **Status:** fixed
- **Where:** The Conflicts section in mod details.
- **What happens:** The name is plain text, while the same names in Tools open the mod.
- **Expected:** The name opens that mod.
- **Fix:** Use a `tp-link` button.
- **Code:** src/screens/modtools/ModInsides.tsx:199

### The new-fixer box has no way to its setting [low, inconvenience]
- **Status:** fixed
- **Where:** Tools > Fixes > "A new fixer on GameBanana".
- **What happens:** The box only has Dismiss.
- **Expected:** A way to the setting that turns this check off.
- **Fix:** Add a small button that opens Settings at broken-mods.
- **Code:** src/screens/tools/FixesPanel.tsx:238-243

### The IMM move confirm asks you to close apps the backend already checks for [low, inconvenience]
- **Status:** fixed
- **Where:** Tools > Share and move > Move mods from IMM.
- **What happens:** The confirm always says to close IMM and the game first, though the move already refuses with a clear message when either is running.
- **Expected:** The confirm only covers the move itself.
- **Fix:** Remove the "Close ... first" sentence, or disable the button while the game runs.
- **Code:** src/screens/modtools/ToolsPanels.tsx:418-421, crates/gacha-core/src/imm.rs:231-235

### The Fixes header "Mute" doesn't say what it mutes [low, wording]
- **Status:** fixed
- **Where:** The Tools > Fixes header.
- **What happens:** The header Mute turns off all broken-mod warnings, while a dead-end row's Mute only covers those mods.
- **Expected:** The header button says what it mutes.
- **Fix:** "Mute warnings" / "Unmute warnings".
- **Code:** src/screens/tools/FixesPanel.tsx:54-57

### "Show which parts both mods change" is wrong for three or more mods [low, wording]
- **Status:** fixed
- **Where:** The "N shared parts" tip in Conflicts.
- **Fix:** "Show which parts these mods change".
- **Code:** src/screens/modtools/ModInsides.tsx:165

### Flippant empty-state line in Conflicts [low, wording]
- **Status:** fixed
- **Where:** Tools > Conflicts with no conflicts.
- **What happens:** "... Enjoy it while it lasts."
- **Fix:** "No conflicts between the mods that are on."
- **Code:** src/screens/modtools/ToolsPanels.tsx:91

### The key clash bulk buttons are long and vague [low, wording]
- **Status:** fixed
- **Where:** The Key clashes footer.
- **What happens:** "Toggles only while on screen for all mods" and "Take it out of all mods" (it's unclear what "it" is).
- **Fix:** "Limit all toggles to on screen" and "Remove on-screen check from all".
- **Code:** src/screens/modtools/ToolsPanels.tsx:229, 232

### The "Switch skins in game" page has no tip [low, rule-break]
- **Status:** fixed
- **Where:** The Tools page list.
- **What happens:** Every other page has a tip.
- **Fix:** Add one, such as "The menu over the game for picking skins without a reload, and the key list".
- **Code:** src/screens/tools/Tools.tsx:44

---

## In-game menu (Tools > Switch skins in game, and the menu over the game)

### Shift+F10 and the Menu key do nothing in the menu over the game [medium, bug]
- **Status:** fixed
- **Where:** The overlay window's mod tiles.
- **What happens:** The overlay's key handler never calls menuForFocus, and the main window's key setup doesn't run there. Only the controller's right stick press opens the menu. A comment in the code says Shift+F10 does.
- **Expected:** Shift+F10 and the Menu key open the focused tile's menu.
- **Fix:** In onKey, before the bound-key check: `if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') { e.preventDefault(); menuForFocus(); return; }`
- **Code:** src/screens/ingame/Overlay.tsx:303-340, 403

### Menu keys bound to "Show the key list" or "Back to characters" do nothing [medium, bug]
- **Status:** fixed
- **Where:** Menu keys, and the overlay's key handling.
- **What happens:** boundAction doesn't know "keys", and "back" only leaves the details pane or a creator page. The hint still says "Keyboard keys work in both menus."
- **Expected:** "Show the key list" opens the Keys tab, and "Back to characters" focuses the character rail.
- **Fix:** Add "keys" to boundAction and call setTab('keys') when the key list is on. With nothing open, make "back" focus the selected `.ov-who`.
- **Code:** src/screens/ingame/data.ts:186-193, src/screens/ingame/Overlay.tsx:312-320, src/screens/ingame/MenuKeys.tsx:103

### Moving through the Keys tab skips a card's first keys [medium, bug]
- **Status:** fixed
- **Where:** The overlay's Keys tab.
- **What happens:** Both the card and its chips take focus, and focus moves by centre point, so Down from a card skips the chips above its middle and Right can land back on the card. Enter on a card does nothing, though the footer says Enter rebinds.
- **Expected:** Arrows step through the chips in order, and focus never lands on a card that does nothing.
- **Fix:** Remove tabIndex from the card and focus its first `.ke-chip` on open and in toFirst.
- **Code:** src/screens/ingame/OverlayKeys.tsx:48-54, 115; src/lib/gamepad.ts:42-55

### The Toggles badge in the overlay's mod details does nothing [medium, rule-break]
- **Status:** fixed
- **Where:** Overlay > My mods > Details (I) for a mod with keys.
- **What happens:** The badge has a tip but no onClick. On the main window's card, the same tag opens the mod's keys.
- **Expected:** The tag opens what it names.
- **Fix:** Switch to the Keys tab with the search set to the mod's name. With the key list off, open the key list settings.
- **Code:** src/screens/ingame/Overlay.tsx:609, 144

### The key list hint says F8 works while the key list is unavailable [medium, bug]
- **Status:** fixed
- **Where:** Tools > Key list in game.
- **What happens:** The hint promises F8 while the panel right below says the key list needs Switch skins in game turned on.
- **Expected:** No promise of F8 until it works.
- **Fix:** Pick the hint based on list.available. The "Switch skins in game" button could also turn switching on instead of only going to the panel.
- **Code:** src/screens/ingame/KeyListPanel.tsx:68-76

### Live skin chips in Tools have no right-click menu [medium, missing-option]
- **Status:** fixed
- **Where:** The character rows in Switch skins in game.
- **What happens:** Right-click shows only the shell's page menu.
- **Expected:** Show in game, View in Mods and Stop switching this skin.
- **Fix:** Add onContextMenu to Chip with those three entries and nothing else.
- **Code:** src/screens/ingame/InGamePanel.tsx:138-173

### The startup key clash toast only offers "Use F9" [medium, inconvenience]
- **Status:** fixed
- **Where:** The toast at app or game start that says Medal takes a screenshot on F7.
- **What happens:** Someone who wants to keep F7 has to dismiss the toast and gets asked again, up to three times, unless they find Keep F7 in Tools.
- **Expected:** The toast also offers Keep F7.
- **Fix:** Pass `{ label: \`Keep ${c.key}\`, run: () => keepKey(c) }` as the toast's second action.
- **Code:** src/screens/ingame/otherKeys.ts:80-89

### Rebinding a toggle to a key the mod already uses gives no warning [medium, inconvenience]
- **Status:** fixed
- **Where:** Toggles in the Mods drawer (KeyEditor), and the overlay's Keys tab.
- **What happens:** It saves without a word, and one key now fires two toggles. Binding a toggle to F7, F8 or the reload key gets no warning either.
- **Expected:** A note such as "Ctrl+Alt+J also changes Jacket". The change still goes through, with Undo.
- **Fix:** In rebind, compare the new key with the mod's other keys and gachamod's own keys, and pass a note to finish().
- **Code:** crates/gacha-core/src/keys.rs:1172-1177, src/ui/KeyEditor.tsx:44

### A live.info failure looks the same as switching being off [medium, bug]
- **Status:** fixed
- **Where:** Tools > Switch skins in game.
- **What happens:** On an error, reloadLive stores an empty stand-in, so the panel shows the switch off with no error and no Try again.
- **Expected:** "Couldn't read the game's skins" with Try again, as KeyListPanel does.
- **Fix:** Store the error per game and render it with a Try again button.
- **Code:** src/screens/ingame/data.ts:18-21

### The overlay's footer is one very long sentence, and it names the wrong controller button [low, wording]
- **Status:** fixed
- **Where:** The overlay footer on the My mods and Browse tabs.
- **What happens:** It lists every key in one sentence. It says "the menu button shows more", but in this window the pad's Menu button does nothing and the keyboard Menu key isn't handled. The right stick opens the menu.
- **Expected:** A short hint for the focused item, naming buttons that work.
- **Fix:** Map the pad's Menu button to menuForFocus in this window. Cut the line down to short key chips (Enter Pick, I Details, Tab Tabs, Esc Close), and only show the Shift part when it applies.
- **Code:** src/screens/ingame/Overlay.tsx:340, 429-437

### The Browse and Downloads tabs of the overlay leave focus on the body [low, inconvenience]
- **Status:** fixed
- **Where:** Switching overlay tabs with Tab or the bumpers.
- **What happens:** The focused tile goes away and nothing gets focus in the new tab.
- **Expected:** Focus lands on the first card or row.
- **Fix:** After the tab renders, focus the first `.gb-card` or row button, as toFirst does in Keys.
- **Code:** src/screens/ingame/Overlay.tsx:174-179

### "Say when another app uses one of these keys" is hidden inside Menu keys [low, inconvenience]
- **Status:** fixed
- **Where:** The Menu keys fold.
- **What happens:** The checkbox is in the closed fold, but its tip is about the key that opens the menu, which sits outside the fold.
- **Expected:** It sits next to "Key that opens it".
- **Fix:** Move it beside the key field or under the clash note, labelled "Say when another app uses this key".
- **Code:** src/screens/ingame/MenuKeys.tsx:106-107, src/screens/ingame/InGamePanel.tsx:123-127

### The "Open with a controller" row offers to add keyboard keys [low, wording]
- **Status:** fixed
- **Where:** Menu keys > Open with a controller.
- **What happens:** The row's tip says controller buttons only, but its + button and chips ask for a key or combination. The backend rejects keyboard keys after you try.
- **Expected:** This row only asks for controller buttons.
- **Fix:** Pass the row id to AddKey and BindChip, use "Press the controller buttons", and ignore keyboard presses with a short note.
- **Code:** src/screens/ingame/MenuKeys.tsx:22, 54, 68, 73

### The administrator hint shows in every game with no button [low, rule-break]
- **Status:** fixed
- **Where:** The hint under the menu options.
- **What happens:** "When the game runs as administrator (Zenless Zone Zero does)..." shows in every game, but the button that fixes it only shows when the game is detected as blocked.
- **Expected:** Show it only where it applies, or with the button.
- **Fix:** Remove the sentence from MENU_HINT, since Blocked already covers it, or add the AdminRow button.
- **Code:** src/screens/ingame/InGamePanel.tsx:81, 88-101

### Games without the drawn menu give no route to the tester option [low, missing-option]
- **Status:** fixed
- **Where:** The Switch skins in game hint for games without the drawn menu.
- **What happens:** It says borderless or windowed mode is needed, but says nothing for exclusive fullscreen.
- **Expected:** "Playing in exclusive fullscreen? Tester options add the menu the game draws.", with a button.
- **Fix:** When the drawn menu isn't available, add a button that calls setTester(true), which already confirms the risks.
- **Code:** src/screens/ingame/InGamePanel.tsx:80-82, 131

### Menu settings changed quickly can undo each other [low, bug]
- **Status:** fixed
- **Where:** Switch skins in game: the Segmented control, the checkboxes, the key field and Menu keys.
- **What happens:** Each change is built from the old `menu` prop, and nothing is locked while it saves, so a second quick change puts the first one back.
- **Expected:** Changes queue up, or the controls lock while saving.
- **Fix:** Add a busy flag, or merge patches in a pending ref.
- **Code:** src/screens/ingame/InGamePanel.tsx:109, src/screens/ingame/data.ts:166-177

### Every Keys card repeats "Click a key to rebind it" [low, inconvenience]
- **Status:** fixed
- **Where:** The overlay's Keys tab.
- **Fix:** Remove the line from each card. The footer and chip tips already say it.
- **Code:** src/screens/ingame/OverlayKeys.tsx:141

### The Undo label "Changed the in-game menu's keys" doesn't say which key [low, wording]
- **Status:** fixed
- **Where:** The toast after any Menu keys change.
- **Expected:** "Added K to Close the menu".
- **Fix:** Build the label from the difference between the old and new binds, using bindingLabel and the ROWS labels.
- **Code:** src/screens/ingame/data.ts:171-172

### The menu key field checks a hard-coded F10 and has no way back to F7 [low, inconvenience]
- **Status:** fixed
- **Where:** Key that opens it (HotkeyField).
- **What happens:** It rejects F10 even in games whose reload key is different, and would allow that game's real reload key. There's no reset.
- **Expected:** The check uses the game's reload key, and a reset shows when the key isn't F7.
- **Fix:** Pass reloadKeyOf(game) as a prop, and add a "Use F7" button when the value isn't F7.
- **Code:** src/screens/profiles/HotkeyField.tsx:43, src/screens/ingame/InGamePanel.tsx:124

### Toggle switches in KeyEditor have no accessible name [low, bug]
- **Status:** fixed
- **Where:** The switch at the end of each row in the Toggles section of the Mods drawer.
- **What happens:** The title is on the wrapping span, so the checkbox itself has no name.
- **Fix:** Give kit Toggle an ariaLabel prop and pass `${e.name} toggle`. The same prop fixes the Settings switches.
- **Code:** src/ui/KeyEditor.tsx:380-382, src/ui/kit.tsx:55-63

### A button tip names a specific chatbot model [low, rule-break]
- **Status:** fixed
- **Where:** KeyEditor, the tip on the chatbot helper button.
- **What happens:** The tip names a product and version, which will go out of date.
- **Fix:** "Works best with a strong chatbot."
- **Code:** src/ui/KeyEditor.tsx:350

### "Its own key help" wording [low, wording]
- **Status:** fixed
- **Where:** The card subtitle in the overlay's Keys tab.
- **Fix:** "Shows its key help with Ctrl+F1".
- **Code:** src/screens/ingame/OverlayKeys.tsx:120

---

## Settings and Extensions

### The Rendering log tip shows a broken folder path [medium, bug]
- **Status:** fixed
- **Where:** Appearance > Hardware acceleration and rendering log, and Feedback, privacy and logs > Log files.
- **What happens:** The single backslashes are read as escapes, so the tip shows "%APPDATA%app.gachamod.desktoplogs" followed by a carriage return and "endering". This is the tip for people with a black window, and the path doesn't work in Win+R.
- **Expected:** `%APPDATA%\app.gachamod.desktop\logs\rendering`
- **Fix:** Escape the backslashes or use String.raw.
- **Code:** src/screens/settings/Feedback.tsx:136-138

### Number fields in Launch options can't be cleared, and new digits merge with the old value [medium, bug]
- **Status:** fixed
- **Where:** Launch options > FPS limit, and every number in Extra.
- **What happens:** Each keystroke saves, and an empty value is ignored. Backspacing 120 saves 12, then 1, then stops at 1. Typing 90 then gives 190, capped to 120. FPS limits of 12 and 1 get written along the way.
- **Expected:** The field empties, then shows 90.
- **Fix:** Keep a local text draft, save only valid numbers, and cap the value on blur.
- **Code:** src/screens/settings/Launch.tsx:385-388

### "Update available" badges for XXMI Launcher and its loaders lead nowhere [medium, missing-option]
- **Status:** fixed
- **Where:** Games and mod loaders > XXMI Launcher panel.
- **What happens:** "2.5.0 available" and the loader update badges have no click and no tip, and nothing on the panel updates them.
- **Expected:** Clicking runs the update or opens XXMI Launcher, with a matching button for keyboard and controller.
- **Fix:** Give the badges an onClick and title, plus a row button.
- **Code:** src/screens/settings/Settings.tsx:300, 308

### "Ask" for another skin doesn't ask when a new mod installs [medium, wording]
- **Status:** fixed
- **Where:** Mods and downloads > the Turn on new mods hint and the per-game "Another skin already on" setting.
- **What happens:** On Ask, installs turn the other skin off without asking, and the Turn on new mods hint says so. The two settings contradict each other.
- **Expected:** Ask asks, or its tip says it only applies when you turn a mod on yourself.
- **Fix:** Make Ask apply to installs with a toast (Keep both / Undo), or reword the Ask tip.
- **Code:** src/screens/library/afterInstall.ts:27, src/screens/settings/Sections.tsx:60, 96

### No way to the profile editor from the hotkeys page [medium, rule-break]
- **Status:** fixed
- **Where:** Settings > In-game profile hotkeys.
- **What happens:** "Give a profile its key in the profile's editor" has no button, and you can't see which profile has which key.
- **Expected:** A button to the profiles, or each profile listed with its key.
- **Fix:** Add "Manage profiles", or list each profile with a HotkeyField that shares the editor's state.
- **Code:** src/screens/settings/HotkeysSection.tsx:40

### Setting switches have no accessible name, and clicking the setting's name does nothing [medium, inconvenience]
- **Status:** fixed
- **Where:** Every SetRow with a bare Toggle, plus the per-game "Reload in game" switches.
- **What happens:** The label is a `<b>` next to the switch and isn't tied to it, so only the small track is clickable and screen readers or controller focus get no name.
- **Expected:** Clicking the label flips the switch, and the switch has a name.
- **Fix:** Have SetRow pass its label as an aria-label, or wrap Toggle rows in a label. Label the reload switches `${game.name}: reload in game`.
- **Code:** src/screens/settings/parts.tsx:24-31, src/ui/kit.tsx:55-63

### Edits to a theme that came from a package don't last [medium, bug]
- **Status:** fixed
- **Where:** Custom themes > right-click a package theme > Edit or Delete.
- **What happens:** Package themes are re-synced every session, so edits are lost on the next start. Delete leaves the package installed, and the theme comes back.
- **Expected:** Editing makes the theme your own, and deleting removes the package.
- **Fix:** For package themes, make Edit save a copy and make Delete remove or turn off the package with Undo. Or hide both in favour of Duplicate and View in Extensions.
- **Code:** src/screens/settings/Appearance.tsx:256, 262; src/lib/extensions.ts:109-133

### Extension cards have no right-click menu [medium, missing-option]
- **Status:** fixed
- **Where:** Extensions, the Available and Installed cards.
- **What happens:** Only the app's page menu appears. Card actions are only behind the small more button.
- **Fix:** Wrap the cards in WithMenu with the same entries as the more button.
- **Code:** src/screens/extensions/Extensions.tsx:142, 178

### Installing a theme package doesn't offer to use it [medium, inconvenience]
- **Status:** fixed
- **Where:** Extensions > Install on a theme.
- **What happens:** The toast only says "Installed Sakura night." with Undo. Using the theme takes three more steps.
- **Expected:** "Use for Wuthering Waves" next to Undo.
- **Fix:** For packages with themes, add a toast action that calls setThemePick for the current game.
- **Code:** src/lib/extensions.ts:163-170

### Setting labels show twice [low, bug]
- **Status:** fixed
- **Where:** Appearance > First-start hints, Hardware acceleration and Rendering log, and Account > Hide adult mods from the chatbot.
- **What happens:** The Toggle has its own label inside a row that already shows the same label.
- **Fix:** Remove `label=` from these Toggles, or pass it as an aria-label only.
- **Code:** src/screens/settings/Appearance.tsx:150, 172; src/screens/settings/Feedback.tsx:153; src/screens/settings/AiSection.tsx:46

### The chatbot helper doesn't preselect the chatbot found on the PC [low, inconvenience]
- **Status:** fixed
- **Where:** The chatbot helper dialog, and Settings > Your chatbot.
- **What happens:** No chatbot is preselected, and the button falls back to "Copy the prompt", though one was found and labelled "on this PC".
- **Expected:** The installed one is preselected, and the button says "Copy and open ChatGPT".
- **Fix:** When nothing is picked yet, default to the installed chatbot without saving that choice until it's used.
- **Code:** src/screens/ai/AiHost.tsx:38-51, 59, 128

### The theme description box has a generic placeholder [low, wording]
- **Status:** fixed
- **Where:** Make a theme with your chatbot > Describe the look.
- **What happens:** "Enter text here...".
- **Fix:** "Navy and gold with sharp corners".
- **Code:** src/screens/ai/tasks.ts:444

### Escape in the chatbot helper or the feedback dialog throws away what you typed [low, inconvenience]
- **Status:** fixed
- **Where:** The chatbot helper dialog and the feedback dialog.
- **What happens:** Text and a pasted reply are lost on close.
- **Expected:** The draft is still there for the rest of the session.
- **Fix:** Keep the last draft per task kind, and the feedback text, in memory.
- **Code:** src/screens/ai/AiHost.tsx:56-62, src/screens/settings/Feedback.tsx:31-33

### "Your year in mods" shows a bare spinner [low, rule-break]
- **Status:** fixed
- **Where:** Fun extras > See your year.
- **Fix:** `Waiting what="Counting your mods and play time"`.
- **Code:** src/screens/settings/FunSection.tsx:98

### Hints name places and settings with no way there [low, rule-break]
- **Status:** fixed
- **Where:** Mods and downloads (Tools > Fixes, Mods, Trash), Fun extras (Animations), and Feedback, privacy and logs (docs/telemetry.md).
- **Expected:** A small button or link for each place.
- **Fix:** Add buttons ("Open Fixes", "Open Trash", "Animations"), or make the place names links as Onboarding does.
- **Code:** src/screens/settings/Sections.tsx:174-183, 217-218; src/screens/settings/FunSection.tsx:38; src/screens/settings/Feedback.tsx:109

### Exported settings leave out the opening screen choice [low, bug]
- **Status:** fixed
- **Where:** About and updates > Back up or move your settings.
- **What happens:** isUiKey doesn't include "gm.intro".
- **Fix:** Add `k === "gm.intro"` to isUiKey.
- **Code:** src/screens/settings/SettingsTransfer.tsx:16-17, src/splash/splash.ts:40

### Themes are set per game, with no way to use one everywhere [low, missing-option]
- **Status:** fixed
- **Where:** The custom theme card menu.
- **Fix:** Add "Use for every game", with Undo, under "Use for <game>".
- **Code:** src/screens/settings/Appearance.tsx:255, src/lib/theme.ts:37

### You can't get told about gachamod updates without installing them automatically [low, missing-option]
- **Status:** fixed
- **Where:** About and updates > Update gachamod automatically.
- **What happens:** Off means it never checks on its own.
- **Fix:** A Segmented control: Install automatically / Only tell me / Off, under the same row id.
- **Code:** src/screens/settings/SettingsTransfer.tsx:175-182, src/screens/settings/automatic.ts:12

### Each game's Mods folder is hidden on the Games page in the usual setup [low, rule-break]
- **Status:** fixed
- **Where:** Games and mod loaders, each game row.
- **What happens:** The Mods row only shows when the folder isn't `<loader>\Mods`.
- **Expected:** It shows under Games as well as Mods, with shared state.
- **Fix:** Always show the Mods row, with Change, when a Mods folder is set.
- **Code:** src/screens/settings/Settings.tsx:193

### The chatbot web address reverts without a word when it lacks https:// [low, inconvenience]
- **Status:** fixed
- **Where:** Your chatbot > Another one > Its web address.
- **Fix:** Add https:// when the scheme is missing, or say in the hint why it wasn't saved.
- **Code:** src/screens/settings/AiSection.tsx:38

### Pending extension updates only show in a hover tip [low, inconvenience]
- **Status:** fixed
- **Where:** The Installed tab on Extensions.
- **Fix:** Show the update count on the tab, and an "Update all" button when more than one extension has an update.
- **Code:** src/screens/extensions/Extensions.tsx:67

---

## Docs

### The spec contradicts what happens after an install [low, wording]
- **Status:** fixed
- **Where:** docs/spec.md, the install step under Downloads and Browse.
- **What happens:** Line 505 says installing never turns a mod on. Line 772 and afterInstall.ts turn new mods on by default.
- **Fix:** Reword line 505: the backend places new mods off, then the UI turns them on when "Turn on new mods" is on.
- **Code:** docs/spec.md:505

---

## Not tested

The browser pane was hidden for most of the pass, so screenshots failed and nothing visual or layout-related was checked by eye. Real key presses often didn't reach the page, so many keys were sent as script events or checked by reading the code. The demo state was shared and kept changing (the current game and theme switched mid-run), so destructive or shared-state actions were left alone.

- **Input:** No controller was tested anywhere. Gamepad findings come from lib/gamepad.ts and App.tsx. Escape in the palette, menus and dialogs, Enter to run palette results, and Enter or Space on a KeyEditor chip were only checked in code. "?" was dispatched by script.
- **Shell:** The Activity button (demo calls finish too fast), the window buttons (no Tauri), Import .gachamod (native file picker), the auto-fold for narrow windows, one-game mode from start to finish, and hiding a game. No "Tools status rows" exist at the bottom of the sidebar: it ends with Play, and Tools only has a nav badge.
- **Browse:** Narrow-width layout. Comment rendering (it never got past the skeleton). Pull (off by default, checked in code). Update and Removed card states (code only). Thanks, likes and subscribe (need a GameBanana sign-in).
- **Downloads:** Nothing was checked live. Every finding comes from the code: layout with many rows, rendered tips, focus order, the variant picker's look, and the effect of shared demo storage on the seen state and the badge. The overlay's Downloads tab wasn't reviewed beyond its label.
- **My Mods:** The Conflict, Sub-mod, Parts, Live and Next reload badges with live data (checked in code). The 3D viewer, Combine into one mod, Make sub-mod of, the Profiles submenu, and Put back and Forget in the trash. The page went blank twice from the `html.kbd` bug.
- **Characters and profiles:** Other games' wording (code only). Icon and banner pickers that need a file dialog, Share as .gachamod, Import owned (file, UID or paste), extension character tabs, and the Home profile widgets. Undo after a hotkey clash was confirmed from code, not in the browser.
- **Tools:** Move mods from IMM, Remove from this mod, Clear, Delete and Wipe weren't clicked. The shader cache and frame dump findings come from code. The Insides view in mod details was read in code only. The dead-end "Turn off and mute" flow never came up, because the demo had no dead-end mods.
- **In-game menu:** Pad capture and pad binds (code only). The tester confirm dialog wasn't opened. ZZZ, Star Rail and Honkai Impact 3rd drawn-menu differences weren't seen live. Change Medal's key, Use F9 and Keep F7 weren't pressed. A possible scroll shift in the overlay header after focus couldn't be confirmed.
- **Settings:** The first-start setup page (code only). Folder pickers, settings export and import, linking or sharing extension folders, Restart as administrator and app updates only work in the real app. Reset gachamod, Uninstall XXMI and uninstalling mod loaders weren't clicked. A chatbot reply was never pasted or applied. Check this game needs a running game.
- **Keyboard pass:** Grid column counts for ArrowUp and ArrowDown (layout was stuck). Downloads rows were empty, so their keys were checked in code. Real game launch and in-game reload. Home widget reordering (Alt+Up/Down) and the O key on Characters. About 500 console errors in the demo looked like failed image loads and weren't logged.

---

## Check results

After the fix run, these all pass from the repo root: `npx tsc --noEmit`, `npm run build` (only the usual large-chunk warning), `npx vitest run` (7 files, 148 tests), `cargo check` and `cargo test -p gacha-core` (285 passed, 6 ignored).

Two problems turned up in the check and were fixed there. The mod-count listeners in `src/lib/store.ts` ran on import and threw "window is not defined" under vitest, so they now run only when a window exists. `openVariantPicker` and `PICK_EVENT` were defined in both `browse/cardQueue.ts` and `browse/OnlineOverlays.tsx`, and now live only in cardQueue.
