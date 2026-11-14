// Test fixtures for the description keybind reader (src/lib/keybinds.ts). Each entry is a short piece of
// GameBanana description HTML in a format real authors use (see docs/keybind-formats.md), written fresh, with
// what a reader should extract. `expect: []` means "show nothing" and keeps the reader precise.
//
// Conventions for `keys` (normalised, readable):
//   modifiers in the order Ctrl, Alt, Shift, joined with "+": "Ctrl+Alt+1", "Shift+F7"
//   letters upper case, digits and symbols as typed: "H", "6", "/", ",", "["
//   function keys "F6"; numpad "Num 1", "Num /", "Ctrl+Num 1"; arrows "Up", "Down", "Left", "Right"
//   ("Arrows" when the author only says "arrow keys"); VK_ names are translated ("VK_LEFT" is "Left")
//   alternatives joined with " / ": "Up / Down", "H / /", "Alt+4 / Alt+5"; a range is "1-5" or "Alt+1-4"
//   mouse "LMB", "RMB", "MMB", "Wheel"; controller buttons start with "Pad": "Pad A", "Pad LB+RB+B"
//   named keys "Space", "Tab", "Enter", "Esc", "Backspace", "Delete", "Insert", "Home", "End", "PgUp", "PgDn"
// Conventions for `action`: the author's words after the separator, first letter upper case, no trailing full
// stop, leading "to" / "for" dropped ("Press H to toggle the cape" gives "Toggle the cape"). Table rows join the
// cells that are not the key with " - ". The same key listed twice in two languages is one entry.
// EM and EN below are the long dashes authors type as separators, built here so the file has no typed-out dash.

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

export interface KeybindFixture {
  name: string;
  html: string;
  expect: Array<{ keys: string; action: string }>;
}

export const KEYBIND_FIXTURES: Array<{ name: string; html: string; expect: Array<{ keys: string; action: string }> }> = [
  // ── key first: separators ──
  {
    name: "dash: digits under a bold heading",
    html: `<b>Toggles</b><br>5 - top<br>6 - skirt<br>7 - hair color<br>0 - reset`,
    expect: [
      { keys: "5", action: "Top" },
      { keys: "6", action: "Skirt" },
      { keys: "7", action: "Hair color" },
      { keys: "0", action: "Reset" },
    ],
  },
  {
    name: "em dash: modifier plus digit with a space",
    html: `Toggle keys:<br>ALT 5 ${EM} Jacket on/off<br>CTRL 5 ${EM} Pasties on/off<br>ALT 6 ${EM} Skirt variants`,
    expect: [
      { keys: "Alt+5", action: "Jacket on/off" },
      { keys: "Ctrl+5", action: "Pasties on/off" },
      { keys: "Alt+6", action: "Skirt variants" },
    ],
  },
  {
    name: "en dash between key and action",
    html: `Ctrl + 1 ${EN} remove the red leggings<br>Ctrl + 2 ${EN} remove the gloves<br>Ctrl + 3 ${EN} swap the belt`,
    expect: [
      { keys: "Ctrl+1", action: "Remove the red leggings" },
      { keys: "Ctrl+2", action: "Remove the gloves" },
      { keys: "Ctrl+3", action: "Swap the belt" },
    ],
  },
  {
    name: "colon: letters in a list under an h2",
    html: `<h2>Controls</h2><ul><li>H: toggle jacket</li><li>Y: toggle hat</li><li>N: swap shoes</li></ul>`,
    expect: [
      { keys: "H", action: "Toggle jacket" },
      { keys: "Y", action: "Toggle hat" },
      { keys: "N", action: "Swap shoes" },
    ],
  },
  {
    name: "equals: spaced plus with == heading",
    html: `== Toggles ==<br>Ctrl + 4 = Shoes<br>Ctrl + 5 = Gloves<br>Alt + 4 = Hair length`,
    expect: [
      { keys: "Ctrl+4", action: "Shoes" },
      { keys: "Ctrl+5", action: "Gloves" },
      { keys: "Alt+4", action: "Hair length" },
    ],
  },
  {
    name: "arrow glyphs with equals",
    html: `Toggles:<br>↑ = Shirt<br>↓ = Shorts<br>→ = Bikini<br>← = Waist beads<br>Alt + ← = Soda can`,
    expect: [
      { keys: "Up", action: "Shirt" },
      { keys: "Down", action: "Shorts" },
      { keys: "Right", action: "Bikini" },
      { keys: "Left", action: "Waist beads" },
      { keys: "Alt+Left", action: "Soda can" },
    ],
  },
  {
    name: "arrow words with colon",
    html: `Up Arrow: hide helmet<br>Down Arrow: hide hair<br>Left Arrow: hide shoulder pads<br>Right Arrow: hide cape`,
    expect: [
      { keys: "Up", action: "Hide helmet" },
      { keys: "Down", action: "Hide hair" },
      { keys: "Left", action: "Hide shoulder pads" },
      { keys: "Right", action: "Hide cape" },
    ],
  },
  {
    name: "bracketed arrow with name",
    html: `Toggle<br>[↑Up] - Upper part (covered, exposed)<br>[↓Down] - Lower part<br>[→Right] - Bikini on/off<br>[←Left] - Nude on/off`,
    expect: [
      { keys: "Up", action: "Upper part (covered, exposed)" },
      { keys: "Down", action: "Lower part" },
      { keys: "Right", action: "Bikini on/off" },
      { keys: "Left", action: "Nude on/off" },
    ],
  },
  {
    name: "bold keys in a list",
    html: `<ul><li><b>Ctrl+H</b> - body type</li><li><b>Ctrl+T</b> - transparency</li><li><b>Alt+Up</b> - hat</li></ul>`,
    expect: [
      { keys: "Ctrl+H", action: "Body type" },
      { keys: "Ctrl+T", action: "Transparency" },
      { keys: "Alt+Up", action: "Hat" },
    ],
  },
  {
    name: "ordered list with colon",
    html: `<ol><li>Alt + 1: long or short pants</li><li>Alt + 2: sleeves</li><li>Alt + 3: coat</li></ol>`,
    expect: [
      { keys: "Alt+1", action: "Long or short pants" },
      { keys: "Alt+2", action: "Sleeves" },
      { keys: "Alt+3", action: "Coat" },
    ],
  },
  {
    name: "key then spaces (nbsp) then action",
    html: `0&nbsp;&nbsp;&nbsp;&nbsp;Switch outfit<br>↑&nbsp;&nbsp;&nbsp;&nbsp;Toggle hairstyle<br>↓&nbsp;&nbsp;&nbsp;&nbsp;Switch shoes`,
    expect: [
      { keys: "0", action: "Switch outfit" },
      { keys: "Up", action: "Toggle hairstyle" },
      { keys: "Down", action: "Switch shoes" },
    ],
  },
  {
    name: "tilde separator",
    html: `<b>Toggles</b><br>4 ~ Clothes<br>5 ~ Underwear<br>6 ~ Shoes<br>7 ~ Face`,
    expect: [
      { keys: "4", action: "Clothes" },
      { keys: "5", action: "Underwear" },
      { keys: "6", action: "Shoes" },
      { keys: "7", action: "Face" },
    ],
  },
  {
    name: "fat arrow separator and a comma list of keys",
    html: `Skirt layers<br>ALT+4, ALT+5, ALT+6 => skirt layers 1, 2, 3`,
    expect: [{ keys: "Alt+4 / Alt+5 / Alt+6", action: "Skirt layers 1, 2, 3" }],
  },
  {
    name: "html entities and font colours",
    html: `<span class="GreenColor"><b>Toggle keys</b></span><br><font color="#ff7a7a">Alt&nbsp;+&nbsp;1</font> - top<br><font color="#ff7a7a">Alt&nbsp;+&nbsp;2</font> - bottom<br><font color="#ff7a7a">Alt&nbsp;+&nbsp;3</font> - hair`,
    expect: [
      { keys: "Alt+1", action: "Top" },
      { keys: "Alt+2", action: "Bottom" },
      { keys: "Alt+3", action: "Hair" },
    ],
  },
  {
    name: "emoji decoration around the heading and key",
    html: `<h1>✦ toggle keys ✦</h1>( ↓ ) face toggle (on / off)<br>( 9 ) tan skin toggle (on / off)`,
    expect: [
      { keys: "Down", action: "Face toggle (on / off)" },
      { keys: "9", action: "Tan skin toggle (on / off)" },
    ],
  },
  {
    name: "bilingual action after the key",
    html: `↑ toggle hair 切换头发<br>↓ toggle sandals 切换凉鞋<br>1 toggle hat 切换帽子`,
    expect: [
      { keys: "Up", action: "Toggle hair 切换头发" },
      { keys: "Down", action: "Toggle sandals 切换凉鞋" },
      { keys: "1", action: "Toggle hat 切换帽子" },
    ],
  },

  // ── key first: sentences ──
  {
    name: "press X for Y, one per line",
    html: `HOW TO TOGGLE:<br>Press 5 for skin and outfit color<br>Press Alt + 5 for eyes and makeup<br>Press 6 for hair<br>Press Alt + . to lock toggles`,
    expect: [
      { keys: "5", action: "Skin and outfit color" },
      { keys: "Alt+5", action: "Eyes and makeup" },
      { keys: "6", action: "Hair" },
      { keys: "Alt+.", action: "Lock toggles" },
    ],
  },
  {
    name: "press combo to toggle, with arrows and brackets",
    html: `Press ctrl+H to toggle body type (normal, larger chest)<br>Press ctrl+T to toggle transparency<br>Press ctrl+↓ to show/hide shorts<br>Press ctrl+[ to show/hide bra`,
    expect: [
      { keys: "Ctrl+H", action: "Toggle body type (normal, larger chest)" },
      { keys: "Ctrl+T", action: "Toggle transparency" },
      { keys: "Ctrl+Down", action: "Show/hide shorts" },
      { keys: "Ctrl+[", action: "Show/hide bra" },
    ],
  },
  {
    name: "key to verb, no press",
    html: `7 to toggle earrings<br>8 to toggle the hair bows<br>9 to toggle the choker`,
    expect: [
      { keys: "7", action: "Toggle earrings" },
      { keys: "8", action: "Toggle the hair bows" },
      { keys: "9", action: "Toggle the choker" },
    ],
  },
  {
    name: "bold key inside a sentence",
    html: `<b>H</b> toggles the jacket and <b>Y</b> toggles the hat.`,
    expect: [
      { keys: "H", action: "Toggles the jacket" },
      { keys: "Y", action: "Toggles the hat" },
    ],
  },
  {
    name: "hold and press",
    html: `Hold "Ctrl" and press "← →" to cycle through outfit colors.`,
    expect: [{ keys: "Ctrl+Left / Ctrl+Right", action: "Cycle through outfit colors" }],
  },
  {
    name: "numbered step that is a key instruction",
    html: `1. Install the mod.<br>2. Press 0 to open the UI toggle window.<br>3. Click a button to toggle it.`,
    expect: [{ keys: "0", action: "Open the UI toggle window" }],
  },

  // ── action first ──
  {
    name: "action colon key, symbols",
    html: `Toggle steam: Alt + ,<br>Toggle wind resistance: Alt + .`,
    expect: [
      { keys: "Alt+,", action: "Toggle steam" },
      { keys: "Alt+.", action: "Toggle wind resistance" },
    ],
  },
  {
    name: "action pipe key with arrow words and glyphs",
    html: `-Toggle Gloves | CTRL + RIGHT Arrow Key (→)<br>-Toggle Shirt | ALT + UP Arrow Key (↑)<br>-Toggle Shorts | SHIFT + DOWN Arrow Key (↓)`,
    expect: [
      { keys: "Ctrl+Right", action: "Toggle Gloves" },
      { keys: "Alt+Up", action: "Toggle Shirt" },
      { keys: "Shift+Down", action: "Toggle Shorts" },
    ],
  },
  {
    name: "action then key in parentheses",
    html: `Fulmine outfit toggle (Alt + left)<br>Jacket-cape toggle (Alt + down)<br>Hair toggle (Alt + right)`,
    expect: [
      { keys: "Alt+Left", action: "Fulmine outfit toggle" },
      { keys: "Alt+Down", action: "Jacket-cape toggle" },
      { keys: "Alt+Right", action: "Hair toggle" },
    ],
  },
  {
    name: "action equals key",
    html: `Variant Toggle = ]<br>Hat Toggle = [`,
    expect: [
      { keys: "]", action: "Variant Toggle" },
      { keys: "[", action: "Hat Toggle" },
    ],
  },
  {
    name: "action dash key",
    html: `Panties - Alt 5<br>Stockings - Alt 6<br>Garter - Alt 7`,
    expect: [
      { keys: "Alt+5", action: "Panties" },
      { keys: "Alt+6", action: "Stockings" },
      { keys: "Alt+7", action: "Garter" },
    ],
  },
  {
    name: "label with key then action",
    html: `Toggle key: Num 1 Hair accessories<br>Toggle key: Num 2 Skirt<br>Toggle key: Num 3 Tail`,
    expect: [
      { keys: "Num 1", action: "Hair accessories" },
      { keys: "Num 2", action: "Skirt" },
      { keys: "Num 3", action: "Tail" },
    ],
  },
  {
    name: "action in parentheses after quoted keys",
    html: `Keys : "," (Back) "." (Forward)`,
    expect: [
      { keys: ",", action: "Back" },
      { keys: ".", action: "Forward" },
    ],
  },
  {
    name: "emoji bullets, tilde, action first",
    html: `♡ Makeup ~ <b>ALT p</b><br>♡ Outfit color ~ <b>ALT &gt;</b><br>♡ Skirt ~ <b>ALT 0</b>`,
    expect: [
      { keys: "Alt+P", action: "Makeup" },
      { keys: "Alt+>", action: "Outfit color" },
      { keys: "Alt+0", action: "Skirt" },
    ],
  },
  {
    name: "named punctuation keys",
    html: `' (Apostrophe Key): normal hair or stiff hair<br>. (Period Key): glow on/off<br>[ : free toggle all shoes`,
    expect: [
      { keys: "'", action: "Normal hair or stiff hair" },
      { keys: ".", action: "Glow on/off" },
      { keys: "[", action: "Free toggle all shoes" },
    ],
  },

  // ── single key mentions ──
  {
    name: "one key in a sentence",
    html: `Press H to toggle the hooded cloak. Questions are welcome in the comments.`,
    expect: [{ keys: "H", action: "Toggle the hooded cloak" }],
  },
  {
    name: "toggle between with a key",
    html: `Toggle between jacket and no jacket with P.`,
    expect: [{ keys: "P", action: "Toggle between jacket and no jacket" }],
  },
  {
    name: "toggle key is",
    html: `Toggle key is H for all variants.`,
    expect: [{ keys: "H", action: "" }],
  },
  {
    name: "minus as a key",
    html: `Press - to open the switch instructions in game`,
    expect: [{ keys: "-", action: "Open the switch instructions in game" }],
  },
  {
    name: "slash and a note about the numpad",
    html: `Press / (not the numpad one) to open the menu`,
    expect: [{ keys: "/", action: "Open the menu" }],
  },
  {
    name: "digit row, not numpad",
    html: `Toggle Key: Press 9 (not Numpad) to turn outlines on/off.`,
    expect: [{ keys: "9", action: "Turn outlines on/off" }],
  },
  {
    name: "alt dash letter with a full stop",
    html: `ALT - K. Brings up the toggle menu.`,
    expect: [{ keys: "Alt+K", action: "Brings up the toggle menu" }],
  },
  {
    name: "arrows with no direction",
    html: `Use Arrows for toggles`,
    expect: [{ keys: "Arrows", action: "Toggles" }],
  },

  // ── key spellings ──
  {
    name: "numpad spellings mixed",
    html: `Numpad 1: hide crown<br>NUMPAD2 - hide collar<br>Num3 = hide belt<br>num 4 : hide gloves<br>Numpad / - reset all`,
    expect: [
      { keys: "Num 1", action: "Hide crown" },
      { keys: "Num 2", action: "Hide collar" },
      { keys: "Num 3", action: "Hide belt" },
      { keys: "Num 4", action: "Hide gloves" },
      { keys: "Num /", action: "Reset all" },
    ],
  },
  {
    name: "modifier plus numpad",
    html: `Ctrl + Numpad 1: SFW leggings<br>Ctrl + Numpad 2: glasses<br>Alt + Numpad 1: backpack`,
    expect: [
      { keys: "Ctrl+Num 1", action: "SFW leggings" },
      { keys: "Ctrl+Num 2", action: "Glasses" },
      { keys: "Alt+Num 1", action: "Backpack" },
    ],
  },
  {
    name: "function keys that are not F10",
    html: `F6 - toggle outfit<br>F7: next hair<br>Shift+F7: previous hair<br>Press F9 to show the toggle list<br>F11 - hide the panel`,
    expect: [
      { keys: "F6", action: "Toggle outfit" },
      { keys: "F7", action: "Next hair" },
      { keys: "Shift+F7", action: "Previous hair" },
      { keys: "F9", action: "Show the toggle list" },
      { keys: "F11", action: "Hide the panel" },
    ],
  },
  {
    name: "range with a modifier",
    html: `Alt 1-4: hair styles<br>Ctrl 1-4: eye colors`,
    expect: [
      { keys: "Alt+1-4", action: "Hair styles" },
      { keys: "Ctrl+1-4", action: "Eye colors" },
    ],
  },
  {
    name: "range with tilde",
    html: `1~5 - choose a preset<br>6 - save preset`,
    expect: [
      { keys: "1-5", action: "Choose a preset" },
      { keys: "6", action: "Save preset" },
    ],
  },
  {
    name: "alternatives with or",
    html: `Press H or / to open the toggle menu`,
    expect: [{ keys: "H / /", action: "Open the toggle menu" }],
  },
  {
    name: "alternatives with a slash between keys",
    html: `Z / X - previous / next outfit`,
    expect: [{ keys: "Z / X", action: "Previous / next outfit" }],
  },
  {
    name: "left right pair without spaces",
    html: `Left/Right arrow - swap between short and long cape`,
    expect: [{ keys: "Left / Right", action: "Swap between short and long cape" }],
  },
  {
    name: "angle brackets as keys",
    html: `&lt; or &gt; - Toggle variants (9 variants)`,
    expect: [{ keys: "< / >", action: "Toggle variants (9 variants)" }],
  },
  {
    name: "two modifiers",
    html: `Ctrl + Alt + 0 - reset toggles<br>Ctrl+Shift+Backspace - reset menu position`,
    expect: [
      { keys: "Ctrl+Alt+0", action: "Reset toggles" },
      { keys: "Ctrl+Shift+Backspace", action: "Reset menu position" },
    ],
  },
  {
    name: "modifiers in square brackets",
    html: `Toggle form - [ALT]+[SHIFT]+[R]<br>Toggle hat - [ALT]+[SHIFT]+[H]`,
    expect: [
      { keys: "Alt+Shift+R", action: "Toggle form" },
      { keys: "Alt+Shift+H", action: "Toggle hat" },
    ],
  },
  {
    name: "one pair of brackets around a combo",
    html: `<ul><li>[ ALT M ] opens the toggle menu</li><li>[ ' ] locks the toggles</li></ul>`,
    expect: [
      { keys: "Alt+M", action: "Opens the toggle menu" },
      { keys: "'", action: "Locks the toggles" },
    ],
  },
  {
    name: "ctrl alt plus arrows",
    html: `Ctrl+Alt+Arrows: move the zoom point`,
    expect: [{ keys: "Ctrl+Alt+Arrows", action: "Move the zoom point" }],
  },
  {
    name: "shift with right/left",
    html: `Shift+Right/Left Arrow: toggle next / toggle back`,
    expect: [{ keys: "Shift+Right / Shift+Left", action: "Toggle next / toggle back" }],
  },
  {
    name: "named keys",
    html: `Home - reset pose<br>End - hide all<br>Page Up / Page Down - zoom<br>Space - freeze the cloth`,
    expect: [
      { keys: "Home", action: "Reset pose" },
      { keys: "End", action: "Hide all" },
      { keys: "PgUp / PgDn", action: "Zoom" },
      { keys: "Space", action: "Freeze the cloth" },
    ],
  },
  {
    name: "mouse buttons in a menu mod",
    html: `<h2>Main controls</h2><ul><li><b>/</b> - Open or close the menu</li><li><b>Left or right mouse button</b> - Click and drag the sliders</li><li><b>Alt</b> - Hold to move the panel</li></ul>`,
    expect: [
      { keys: "/", action: "Open or close the menu" },
      { keys: "LMB / RMB", action: "Click and drag the sliders" },
      { keys: "Alt", action: "Hold to move the panel" },
    ],
  },
  {
    name: "mouse with a modifier",
    html: `RMB - move slider<br>Alt + Left click - paint<br>Mouse wheel - brush size`,
    expect: [
      { keys: "RMB", action: "Move slider" },
      { keys: "Alt+LMB", action: "Paint" },
      { keys: "Wheel", action: "Brush size" },
    ],
  },
  {
    name: "controller combos",
    html: `Toggle hat - [Left Bumper]+[Right Bumper]+[B]<br>Toggle jacket - [Left Bumper]+[Right Bumper]+[A]`,
    expect: [
      { keys: "Pad LB+RB+B", action: "Toggle hat" },
      { keys: "Pad LB+RB+A", action: "Toggle jacket" },
    ],
  },
  {
    name: "key or controller",
    html: `Press '6' or Xbox LB + RT + X to toggle the waist wrap`,
    expect: [{ keys: "6 / Pad LB+RT+X", action: "Toggle the waist wrap" }],
  },
  {
    name: "d-pad lines",
    html: `D-pad Up - next outfit<br>D-pad Down - previous outfit<br>Pad Start - open the menu`,
    expect: [
      { keys: "Pad D-pad Up", action: "Next outfit" },
      { keys: "Pad D-pad Down", action: "Previous outfit" },
      { keys: "Pad Start", action: "Open the menu" },
    ],
  },
  {
    name: "VK names",
    html: `"Alt + VK_LEFT" to remove the arm armor<br>"Ctrl + VK_NUMPAD1" to take off shoes`,
    expect: [
      { keys: "Alt+Left", action: "Remove the arm armor" },
      { keys: "Ctrl+Num 1", action: "Take off shoes" },
    ],
  },

  // ── tables ──
  {
    name: "table: hotkey, object, features",
    html: `<span class="GreenColor"><b>Toggle Section</b></span><table><thead><tr><th>Hotkey</th><th>Object</th><th>Features</th></tr></thead><tbody>
<tr><td><span class="GreenColor">NUMPAD1</span></td><td>Visor</td><td>On / Off</td></tr>
<tr><td>NUMPAD2</td><td>Glitter</td><td>On / Off</td></tr>
<tr><td>Alt + NUMPAD1</td><td>Visor color</td><td>Cycle</td></tr></tbody></table>`,
    expect: [
      { keys: "Num 1", action: "Visor - On / Off" },
      { keys: "Num 2", action: "Glitter - On / Off" },
      { keys: "Alt+Num 1", action: "Visor color - Cycle" },
    ],
  },
  {
    name: "table: key in the middle column",
    html: `<table><tbody><tr><td>面妆</td><td>0</td><td>Makeup</td></tr><tr><td>光环</td><td>9</td><td>Halo</td></tr><tr><td>丝袜</td><td>7</td><td>Stockings</td></tr></tbody></table>`,
    expect: [
      { keys: "0", action: "面妆 - Makeup" },
      { keys: "9", action: "光环 - Halo" },
      { keys: "7", action: "丝袜 - Stockings" },
    ],
  },
  {
    name: "table: code spans and a note about the numpad",
    html: `<table><thead><tr><td><strong>Key Press</strong></td><td><strong>Action</strong></td></tr></thead><tbody><tr><td><code>*</code> <i>(Numpad Star)</i></td><td>Cycle oil texture styles</td></tr><tr><td><code>Shift + ↑</code></td><td>Toggle the effect</td></tr></tbody></table>`,
    expect: [
      { keys: "Num *", action: "Cycle oil texture styles" },
      { keys: "Shift+Up", action: "Toggle the effect" },
    ],
  },

  // ── other languages ──
  {
    name: "chinese: press combo to toggle",
    html: `按ctrl+H切换体型（正常、更大胸臀）<br>按ctrl+↑显示/隐藏外套<br>按ctrl+[显示/隐藏手套`,
    expect: [
      { keys: "Ctrl+H", action: "切换体型（正常、更大胸臀）" },
      { keys: "Ctrl+Up", action: "显示/隐藏外套" },
      { keys: "Ctrl+[", action: "显示/隐藏手套" },
    ],
  },
  {
    name: "chinese: heading, fullwidth colon, shift arrows",
    html: `切换键：<br>SHIFT + ↑：切换发型<br>SHIFT + ↓：切换服装`,
    expect: [
      { keys: "Shift+Up", action: "切换发型" },
      { keys: "Shift+Down", action: "切换服装" },
    ],
  },
  {
    name: "chinese: number key and numbered lines",
    html: `1.数字键6 头发<br>2.数字键7 帽子`,
    expect: [
      { keys: "6", action: "头发" },
      { keys: "7", action: "帽子" },
    ],
  },
  {
    name: "chinese: slash between modifiers and the small keyboard",
    html: `CTRL/ALT+小键盘5：开关宿镜<br>CTRL/ALT+小键盘9：切换美甲样式`,
    expect: [
      { keys: "Ctrl+Num 5 / Alt+Num 5", action: "开关宿镜" },
      { keys: "Ctrl+Num 9 / Alt+Num 9", action: "切换美甲样式" },
    ],
  },
  {
    name: "chinese and english of the same line count once",
    html: `按H切换斗篷，有什么问题欢迎留言<br>Press H to toggle the cloak. Leave a comment if you have questions.`,
    expect: [{ keys: "H", action: "Toggle the cloak" }],
  },
  {
    name: "english line with a fullwidth colon",
    html: `Open Key UI： 0(The operation method can be found in the document.)`,
    expect: [{ keys: "0", action: "Open Key UI" }],
  },
  {
    name: "japanese: numpad and letter",
    html: `テンキー2：靴の表示切替<br>Hキーで上着の表示を切り替え`,
    expect: [
      { keys: "Num 2", action: "靴の表示切替" },
      { keys: "H", action: "上着の表示を切り替え" },
    ],
  },
  {
    name: "korean: letter plus key word",
    html: `H 키: 재킷 켜기/끄기<br>Y 키: 모자 켜기/끄기`,
    expect: [
      { keys: "H", action: "재킷 켜기/끄기" },
      { keys: "Y", action: "모자 켜기/끄기" },
    ],
  },
  {
    name: "russian: colon and press",
    html: `H: показать или скрыть куртку<br>Нажмите Y, чтобы переключить шляпу`,
    expect: [
      { keys: "H", action: "Показать или скрыть куртку" },
      { keys: "Y", action: "Переключить шляпу" },
    ],
  },
  {
    name: "spanish: pulsa",
    html: `<b>CONTROLES</b><br>Pulsa H para mostrar u ocultar la chaqueta<br>Pulsa Ctrl+Y para cambiar el color`,
    expect: [
      { keys: "H", action: "Mostrar u ocultar la chaqueta" },
      { keys: "Ctrl+Y", action: "Cambiar el color" },
    ],
  },
  {
    name: "german: taste",
    html: `Taste H: Jacke an/aus<br>Taste Y: Hut an/aus`,
    expect: [
      { keys: "H", action: "Jacke an/aus" },
      { keys: "Y", action: "Hut an/aus" },
    ],
  },
  {
    name: "french: appuyez sur",
    html: `Appuyez sur H pour afficher ou cacher la veste`,
    expect: [{ keys: "H", action: "Afficher ou cacher la veste" }],
  },

  // ── negatives: nothing to show ──
  {
    name: "no: press F to pay respects",
    html: `Press F to pay respects to the old outfit.`,
    expect: [],
  },
  {
    name: "no: F as a grade",
    html: `I would give the weights an F and the textures an A-. Be kind in the comments.`,
    expect: [],
  },
  {
    name: "no: version numbers",
    html: `<b>Version:</b> 1.5<br>Game version 5.2 / loader 1.3<br>Tested on patch 4.8`,
    expect: [],
  },
  {
    name: "no: changelog",
    html: `v1.2 - fixed the hair weights<br>v1.1 - added a tan skin<br>v1.0 - first release`,
    expect: [],
  },
  {
    name: "no: likes campaign",
    html: `100 likes - original body proportions<br>300 likes - extra toggles<br>600 likes - full version`,
    expect: [],
  },
  {
    name: "no: install steps with the reload key",
    html: `1. Download the zip<br>2. Extract it into your Mods folder<br>3. Press F10 in game to reload the mods`,
    expect: [],
  },
  {
    name: "no: credits",
    html: `Credits:<br>Model - someone<br>Textures - another person<br>Weights - a third person`,
    expect: [],
  },
  {
    name: "no: questions and answers",
    html: `Q: Does it work with the new patch?<br>A: Yes, I tested it.<br>Q: Can I get a version without sleeves?<br>A: No.`,
    expect: [],
  },
  {
    name: "no: keys only in an image",
    html: `<h2>Toggles</h2><img src="https://images.example.invalid/toggles.jpg"><br>`,
    expect: [],
  },
  {
    name: "no: pointer to the readme",
    html: `The README file shows how to change the hotkeys.`,
    expect: [],
  },
  {
    name: "no: ini excerpt",
    html: `<pre>[TextureOverrideHair]
hash = 1a2b3c4d
match_priority = 4
$swapvar = 0</pre>`,
    expect: [],
  },
  {
    name: "no: how to change the key in the ini",
    html: `Change the entire section after "key = " to your desired shortcut key.`,
    expect: [],
  },
  {
    name: "no: emoticons",
    html: `Hope you like it :D<br>Have fun! :3<br>Enjoy ;-;<br>xD`,
    expect: [],
  },
  {
    name: "no: alt as alternate",
    html: `Alt skin textures: base and tan<br>Alt hair: ponytail<br>Alt version without sleeves`,
    expect: [],
  },
  {
    name: "no: dates",
    html: `Updated 10/29: new body type<br>Released 12/05/2026`,
    expect: [],
  },
  {
    name: "no: key words used as plain words",
    html: `This mod changes the space between her shoulder and neck. Enter the game, look at the end of the cutscene and tab through the menu to see it.`,
    expect: [],
  },
  {
    name: "no: says there are no toggles",
    html: `No toggles in this version. The full toggle version is on my other page.`,
    expect: [],
  },
  {
    name: "no: patreon tiers",
    html: `Tier 1 - early access<br>Tier 2 - toggles<br>Tier 3 - requests`,
    expect: [],
  },
  {
    name: "no: numbered feature list",
    html: `1. New hair<br>2. Better stockings<br>3. Tan skin<br>4. Two glove styles`,
    expect: [],
  },
  {
    name: "no: promised toggles",
    html: `Toggles coming soon! Recolors and toggles will come once this reaches 300 likes.`,
    expect: [],
  },
  {
    name: "no: a controls heading with nothing in it",
    html: `<h2>Controls</h2>The mod has no controls. It only replaces the outfit.`,
    expect: [],
  },
  {
    name: "no: letters as version labels",
    html: `Version A: sleeves<br>Version B: no sleeves<br>Version C: crop top`,
    expect: [],
  },
  {
    name: "no: body measurements",
    html: `B: 90, W: 58, H: 88 (measurements used for the base mesh)`,
    expect: [],
  },
  {
    name: "no: pasted update block",
    html: `<details open=""><summary><strong>UI alignment fix</strong> <small>v2.36</small></summary>Fixed the alignment when the window is resized.</details>`,
    expect: [],
  },
  {
    name: "no: mod id that looks like a numpad key",
    html: `Princess dress (ice theme) - Num023<br>Maiden dress - Num065`,
    expect: [],
  },
];
