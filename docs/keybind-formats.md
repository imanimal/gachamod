# Keybind formats in GameBanana descriptions

How mod authors write their key lists, measured on real descriptions, so the Keys tab reader
(`src/lib/keybinds.ts`) knows what to expect. Test cases are in `src/lib/keybinds.fixtures.ts` (100 cases, 25 of
them "show nothing").

## What was measured

- 2203 descriptions (`_sText`): 572 Genshin, 545 Star Rail, 553 ZZZ, 533 Wuthering Waves. It is the same text the
  ProfilePage returns (checked on two mods).
- Per game: most downloaded pages 1 to 3 and 8 to 9, most liked pages 1 to 2, newest pages 1 to 3 and 10 to 11,
  latest modified pages 1 to 2, duplicates removed. Fetched with `Mod/Index` (50 per page) and
  `Mod/Multi?_csvRowIds=<10 ids>&_csvProperties=_idRow,_sName,_sText`, 4 requests at a time, about 3 minutes.
- Counting is by description, not by line. A regex detector did the first pass, then 100 random descriptions and
  about 100 flagged ones were read by hand to check it. Treat every number as plus or minus 3 points. The detector
  misses odd forms, so true shares are a little higher than the "found" numbers.
- The raw data is not in the repo.

## How many descriptions list keys

| The description has | Share |
| --- | --- |
| A list of 2 or more keys with what they do | 25% found, about 26% after the hand check |
| One or two keys in a sentence ("Press H to toggle the cloak") | about 14% |
| Only a pointer ("see the README", "change it in the ini", "press 0 for the key panel") | about 4% |
| Keys only as an image (a keys heading followed straight by a picture) | under 1% (16 descriptions) |
| Nothing about keys (skins, recolors, UI and tool mods, "no toggles") | about 55% |

So about 4 in 10 descriptions give at least one readable key in text, and 1 in 4 gives a real list.

- By popularity: top 150 downloaded per game 35% have a list, most liked 48%, newest 19%, downloads ranks 351 to 450
  20%. Newer mods write fewer lists, and many of them are plain recolors.
- By game: ZZZ 33%, Genshin 25%, Wuthering Waves 24%, Star Rail 19%. Star Rail has the most one-key sentences
  (26%, mostly "Press H to toggle", often with a Chinese line first).
- List size: median 5 key lines, mean 6, 84 of 560 have 12 or more, longest 38. 19% have two or more separate
  blocks (outfit toggles plus a menu section, or one block per variant).
- Position: the first key line is the 5th text line at the median. 80% start within the first 10 text lines and 96%
  within 25. The median description is 19 text lines long.
- Key lines are short: median 28 characters, 95% under 80, 99% under 130.

## Catalogue

### Headings above the list (527 descriptions with a clear first key line)

| Heading | Count |
| --- | --- |
| "Toggles", "Toggle", "Toggle options" | 176 (33%) |
| None within 6 lines above | 126 (24%) |
| Other lead-in (an outfit name, "Read before downloading", "The buttons for this mod") | 54 (10%) |
| "Toggle keys", "Toggle controls" | 50 (9%) |
| "Controls", "Keyboard controls", "Buttons" | 38 (7%) |
| "How to toggle", "How to use" | 24 (5%) |
| "Instructions", "Features" | 18 (3%) |
| Chinese ("按键切换如下", "切换键", "快捷键") | 18 (3%) |
| "Keys", "Keybinds", "Hotkeys", "Shortcuts" | 19 (4%) |
| A "Press ..." line | 4 |

"Keybinds" and "Hotkeys" are rare (about 1% each). "Toggles" is the word people use. The heading is a plain
line in 44% of cases, bold in 28%, an h1 to h3 in 27%. Authors decorate it: `== Toggles ==`, `TOGGLES :`,
`꒰ toggle keys ꒱`, `୨୧ toggles ୨୧`, an emoji or two.

### How the lines are built (560 list descriptions)

| Build | Count |
| --- | --- |
| Loose lines separated by `<br>` (the default; the whole corpus has 43,000 `<br>` and 3,500 `<li>`) | about 65% |
| `<ul>` or `<ol>` items | 142 (25%) |
| Key in bold or strong at the start of the line | 168 (30%) |
| `<h1>` to `<h3>` used as the heading | 110 |
| `<code>` for the key | 16 |
| `<pre>` | 7 |
| Table cells (7 descriptions have a table at all) | 3 |
| Inside a spoiler span or `<details>` | 1 and 0 |

Notes: `<span class="Spoiler">` is an inline blur effect, not a container. `<details>` only shows up when someone pasted
a GameBanana update block. Colour comes from `<font color>` and `<span class="GreenColor">` or `RedColor`; it
carries no meaning. Raw newlines in the HTML are not line breaks. Text pasted from a chatbot brings attributes like
`data-path-to-node` and a `<response-element>` tag.

### Line shapes (descriptions using it in 2 or more lines, or as the only key line)

| Shape | Example | Descriptions |
| --- | --- | --- |
| KEY - ACTION | `5 - top` | 141 (plus 21 with an em dash, 4 with `--`) |
| Press KEY to / for ACTION | `Press 6 for hair` | 139 (plus 15 as running sentences) |
| ACTION: KEY | `Toggle steam: Alt + ,` | 95 |
| KEY: ACTION | `H: toggle jacket` | 80 (plus 7 with a fullwidth colon) |
| Key inside a sentence | `Toggle between jacket and no jacket with P.` | 77 |
| [KEY] - ACTION | `[↑Up] - Upper part` | 43 |
| ACTION - KEY | `Panties - Alt 5` | 42 |
| KEY to / for ACTION | `7 to toggle earrings` | 41 |
| KEY = ACTION | `Ctrl + 4 = Shoes` | 38 |
| ACTION \| KEY | `Toggle Gloves \| CTRL + RIGHT Arrow Key (→)` | 37 |
| ACTION = KEY | `Variant Toggle = ]` | 35 |
| ACTION (KEY) | `Jacket (alt +→)` | 19 |
| KEY then spaces, tab or nbsp | `↑    Toggle hairstyle` | 15 |
| ACTION ~ KEY, KEY ~ ACTION | `Makeup ~ ALT p` | 8 and 7 |
| KEY > ACTION, KEY -> ACTION | `[→] -> Panty` | 6 |
| Label with key, then action | `Toggle key: Num 1 Hair accessories` | a handful |
| Table row | `NUMPAD1 \| Visor \| On / Off` | 4 |

About 70% of list descriptions put the key first, 30% the action first. A description sticks to one shape, so decide
per block. Emoji or symbol bullets in front of key lines are rare (about 4% of lines, mostly `-`, `•`, `>>`); the
decoration sits on the heading instead. Two-line pairs (action on one line, key on the next) turn up in 6
descriptions.

### Key spellings (all key lines found)

| Kind | Lines | Descriptions |
| --- | --- | --- |
| Single digit (`6`) | 837 | 222 |
| Single letter (`H`) | 420 | 225 |
| Modifier plus key (`Ctrl+H`, `ALT 5`) | 723 | 185 |
| Modifier plus arrow (`Ctrl+↑`, `Alt + Left`) | 686 | 164 |
| Arrow alone (`↑`, `Up Arrow`) | 367 | 128 |
| Arrow pairs (`Left/Right`, `← →`) | 234 | 112 |
| Symbol (`/` 59, `-` 41, `=` 24, `,` 11, `.` 10, `~` 8) | 157 | 125 |
| Numpad (with or without a modifier) | 99 | 27 |
| Two or more modifiers (`Ctrl+Alt+0`) | 17 | 8 |
| Mouse | 30 | 19 |
| F1 to F12 (F10 left out) | 6 | 6 |

Spellings seen, with the number of descriptions:

- Modifier joins: `Ctrl + X` 236, `Ctrl+X` 113, `Ctrl X` 39, three keys `Ctrl + Alt + X` 26, brackets `[ALT]+[X]` 8.
  No `Ctrl-X`. Upper, lower and mixed case are all common (`ALT`, `ctrl`, `Alt`).
- Arrows: glyphs `↑↓←→` 226, `Up Arrow` words 178, "arrow keys" 140, `Arrow Up` 13, emoji `⬆️` 9, `[↑Up]` forms.
- Numpad: `NumN` 28, `Numpad N` 12, `NumpadN` 7, `Num N` 7, `Numpad /` 13, plus `小键盘5`, `テンキー2` and
  `VK_NUMPAD1`.
- Mouse: "left mouse button", "right click" 46, scroll 11, `LMB` or `RMB` 2. No `Mouse4`.
- Controller: 65 descriptions use controller words, about 10 list buttons (`Xbox LB + RT + X`,
  `[Left Bumper]+[B]`, `A-Button`). One uses `XB_RIGHT_TRIGGER`.
- `VK_` names: 3. Named punctuation ("minus key", "comma key"): 9. Space, Tab, Enter, Backspace: 5.
- Ranges: `Alt 1-4`, `ctrl+1-9`, `1~5`: 3. Alternatives: "press up or down" 28, `a / b` 2, `Left/Right` common.
- F keys other than F10 appear in only 33 descriptions (F6 7, F9 4, F11 4). Toggle keys are overwhelmingly the
  number row, letters, arrows and Ctrl/Alt/Shift combos.
- "Not the numpad" notes (`9 (not Numpad)`, `/ ... NOT the NumPad /`) exist because digits and slash are ambiguous.

### Other cases

- Languages: Chinese is in 381 descriptions (17%), usually next to an English copy of the same line. Typical forms:
  `按ctrl+H切换体型`, `按H键切换`, `数字键6`, `小键盘5`, `切换键：`, `按键切换如下：`, `打开按键UI： 0`. Japanese (49
  descriptions), Korean (31) and Russian (3) hold a handful of key lines. Spanish and German show up once or twice.
- Pointers only: 33 descriptions say the keys are in the README or ini ("README file shows how to change the
  hotkey", "Open Read Me for toggle keys", "operation method can be found in the document"). 56 more say only
  "press X to open the menu/panel".
- Keys in an image: 16 descriptions have a keys heading followed directly by an image. A few say "as shown in the
  screenshot". "(Gallery)" next to toggle names is a link label, not keys.
- Whole in-game panels: UI mods list 2 to 4 keys plus mouse use ("Left or right mouse button - interact with the
  menu").
- Author changes keys: "change the key in the ini" appears in about 70 descriptions, usually beside a real key.

## Normalisation

| Written | Normalised |
| --- | --- |
| `Ctrl`, `CTRL`, `Control`, `LCtrl`, `[ALT]` | `Ctrl`, `Alt`, `Shift` (this order when combined) |
| `Ctrl + 5`, `Ctrl+5`, `CTRL 5`, `[ALT]+[SHIFT]+[R]` | `Ctrl+5`, `Alt+Shift+R` |
| `h`, `'H'`, `"H"`, `[H]`, `(H)` | `H` |
| `6`, `"6"`, `Number 6`, `数字键6` | `6` |
| `Numpad 1`, `NUMPAD1`, `Num1`, `VK_NUMPAD1`, `小键盘1`, `テンキー1` | `Num 1` |
| `Numpad +`, `Numpad Star` | `Num +`, `Num *` |
| `f6`, `F6` | `F6` |
| `↑`, `Up Arrow`, `Arrow Up`, `⬆️`, `VK_UP` | `Up` (also `Down`, `Left`, `Right`) |
| "arrow keys", "arrows" | `Arrows` |
| `Left/Right`, `Up or Down`, `H or /` | `Left / Right`, `Up / Down`, `H / /` |
| `ALT+4, ALT+5, ALT+6` | `Alt+4 / Alt+5 / Alt+6` |
| `1-5`, `1~5`, `1 to 5`, `Alt 1-4` | `1-5`, `Alt+1-4` |
| `CTRL/ALT+小键盘5` | `Ctrl+Num 5 / Alt+Num 5` |
| comma, `,`, "Comma key"; period; slash; minus; equals; apostrophe | `,` `.` `/` `-` `=` `'` |
| `Space`, `Spacebar`, `Esc`, `Del`, `Page Up`, `Caps Lock` | `Space`, `Esc`, `Delete`, `PgUp`, `Caps Lock` |
| `Left Click`, `LMB`, `left mouse button`; right; middle; scroll wheel | `LMB`, `RMB`, `MMB`, `Wheel` |
| `Xbox A`, `[A-Button]`, `Left Bumper`, `LB`, `D-Pad Down` | `Pad A`, `Pad LB`, `Pad D-pad Down` |
| Fullwidth `５`, `＋`, `：` | ASCII |

Action text: keep the author's words, first letter upper case, drop the separator, a leading "to" or "for" and the
final full stop. Table rows: the cells that are not the key, joined with " - ". The same key in two languages is
one entry.

## Traps

- **F10 reload.** 72 descriptions (3%) say "press F10 in game to reload". It is a loader key, not a mod key. Drop
  lines whose key is F10 and that say reload, refresh or apply.
- **Likes goals.** 180 descriptions (8%): `100 likes - original proportions`, `600 likes: full version`. A number
  with 2 or more digits is never a key.
- **Install steps.** `1. Extract...`, `2. Press F10`. A list number is not a key. Strip it only when what follows is
  "press", "hold" or "use".
- **Letters that are labels.** `Q:` and `A:` in a FAQ, `Version A: sleeves`, `B: 90, W: 58, H: 88`, `Credits:`
  lines. Lone letters need a keys heading, a run of 2 or more lines, or a control verb (see below).
- **Emoticons.** `:D`, `:3`, `;-;`, `xD` look like "D: ..." or "key: D".
- **Alt as "alternate".** `Alt skin textures: ...`, `Alt hair: ponytail`.
- **Mod ids.** Chinese cross-posts add `-Num027` to titles. `Num` plus 3 digits is an id, not a numpad key.
- **ini text.** `[TextureOverride...]`, `hash = ...`, `$swapvar = 0`, `key = no_modifiers /`, "change the entire section
  after key =". 85 descriptions have ini lines. Skip them; the Keys editor reads the real ini.
- **Changelogs and dates.** `v1.1 - fixed...`, `Updated 10/29`, `Game version 5.2`, `1.5 Compatible`.
- **Plain words.** Space, Tab, Enter, Home, End, Up, Down, Left, Right, Shift, Control, Click, Delete used in
  sentences ("enter the game", "right click here", "Click Here for the NSFW version").
- **Other mods.** Lists of the author's other toggle packs ("Insiders Access - X Multitoggle"), Patreon tiers
  ("Tier 2 - toggles"), "(Gallery)" labels.
- **Meme text.** "Press F to pay respects", "I give the weights an F".
- **Pasted update blocks.** `<details>`, `<summary>`, `module` wrappers copied from a GameBanana page.
- **Duplicates.** Chinese and English lines saying the same thing; one list copied for several variants.
- **Digit row or numpad.** A bare digit is the digit row unless the author writes Num.
- **Paid versions.** "Toggles" may only exist in the Patreon build. The text cannot tell you.

## Recommended approach

1. **Make lines first.** Turn raw `\r`, `\n` and tabs into spaces. Break lines on `br p div li ul ol tr h1-h6 hr
   blockquote details summary pre`. Turn `</td>` into " | ". Decode entities, treat nbsp as a space, drop
   script and style. Put a marker line where an `img` or `iframe` was. For each line keep its text, whether the key
   part is bold, and the heading level of its element.
2. **Match four shapes on lines of 170 characters or less.** Key first (`[bullet] [Press] KEY SEP ACTION`, where
   SEP is a hyphen, en dash or em dash, or one of `: = > -> → ~ |`, two spaces, or "to / for"). Action first (`ACTION SEP KEY` or `ACTION (KEY)`).
   Sentences (`press|hold|use|with|by pressing KEY`, `toggle key is KEY`, `KEY toggles ...`, plus the Chinese,
   Japanese, Korean, Russian, Spanish and German verbs in the fixtures). Table rows (the cell that is a key, the
   rest as action).
3. **Parse a key expression, not a word.** Modifiers (joined by `+`, `&`, space, brackets) then one base: F key,
   numpad, arrow (glyph or word), named key, mouse, pad, `VK_`, or one letter, digit or symbol. Allow `/`, "or", `,`
   and `|` for alternatives, `1-5` and `1~5` for ranges.
4. **Strong and weak keys.** Strong has a modifier, F key, numpad, arrow, mouse, pad, `VK_` or named key. Weak is a
   lone letter, digit or symbol. Accept weak keys only (a) in a run of 2 or more lines with the same shape,
   (b) under a keys heading within 6 lines, or (c) in a sentence with a control verb (toggle, switch, swap, cycle,
   show, hide, open, close, change, remove, reset, lock, on/off, next, previous). This one rule removes almost
   every false hit: emoticons, `Q:`, `Version A:`, measurements, "Alt hair".
5. **Group into blocks.** Key lines at most 2 non-key lines apart belong together. Drop a block of one weak line.
   Scan the whole text, but expect lists near the top (80% in the first 10 lines). Keep several blocks in page
   order (19% of descriptions have more than one).
6. **Anchor.** Use the nearest line above the block (up to 6 lines) that is at most 48 characters and either ends
   with a colon, is an h1 to h4, is bold, or has a heading word (toggle, toggles, toggle keys, controls, keybinds,
   hotkeys, keys, how to toggle, instructions, 切换键, 按键, 快捷键). Otherwise the first key line. 76% of lists have
   a heading. Insert an empty `<span id="gm-keys-N"></span>` just before that line; most lines are loose text
   between `<br>`, so there is nothing to put an id on.
7. **Filter before output.** Drop F10 reload lines, lines with a URL, ini lines (`[Section]`, `hash =`, `$x =`,
   `key =`), `N likes` lines, `Q:` and `A:` lines, version and date lines, anything inside `<details>`, `<pre>` and
   `<code>` that looks like ini, and `Num` followed by 3 digits.
8. **Normalise** with the table above, then merge duplicates: same keys within 3 lines, one of them non-Latin keeps
   the English action.
9. **Prefer precision.** Three right keys beat eight with two wrong. If no block passes, show no Keys tab. The mod's
   own ini (read by the keys module) is the better source: use the description as a fallback, and as the label for
   an ini key when the keys match.
10. **Check against the fixtures.** The quick regex reader used for the counts here gets the yes/no right on 78 of
    the 100 fixtures. It misses the non-English lines, "Press / (not the numpad one) to open the menu", a table with
    the key in the middle column, bold keys inside a sentence and arrows given only as "Arrows". It wrongly accepts
    seven negatives (emoticons, Q and A, Alt as alternate, `Num023` ids, "pay respects", measurements, "change
    the key ="). Those cases are the work.
