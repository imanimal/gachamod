# Astral Express theme notes

How the theme reads Honkai: Star Rail's menus, and the rules the CSS follows. References were the Omni-Synthesizer
screens (consumables, material exchange, relic crafting), the character screen (relics, outfits), Settings, the
Nameless Honor mission list, the Replenish Trailblaze Power and Main Stat Selection dialogs, the Select Material
side panel, the coatroom panel and the phone menu. Event menus and the gold Nameless Honor dressing are skins on
this language. No game art, icons or fonts are used: shapes are CSS, gradients and inline SVG. Hex values were
sampled from screenshots, so they are close, not exact.

Files: `src/styles/themes/hsr.css` (tokens, textures, every kit class), `hsr-shell.css` (window, phone menu
sidebar, page bar, star field), `hsr-screens.css` (screen classes).

## The idea

Two materials. The menu itself is dark smoked glass over the scene: translucent, blurred, cool, with white text
and thin hairlines. Anything you read or press is a pale grey plate laid on that glass, with near-black text:
list rows, dialogs, dropdowns, buttons. Things you collect are cells: dark coloured squares with a picture and a
dark strip under it. Gold marks what is in use, orange marks numbers and the picked option.

## Rules

1. **Glass**: the page, sidebars, the page bar and side panels are dark glass (`#141518` to `#1a1b24`, 60 to 92%
   opaque, blur behind). White text. Borders are 1 px hairlines at 12 to 25% white, never heavy outlines.
2. **Plates**: panels, settings rows, dialogs, menus and buttons are pale grey (`#dadcde`, rows `#e5e5e5`, value
   wells `#edefef`, info strips `#c5c5c6`) with ink text (`#111`). Plates have square corners except the top right,
   which is cut by a large radius. Dialogs, cells and panels all share that corner.
3. **Dialogs** are a plate with a dark footer bar (`#262626`, faint rings in it) that holds the buttons. The title
   is bold ink with a hairline and a small ring ornament under it. A warning is a full-width red strip above the
   footer; a notice is a flat gold bar.
4. **Buttons are pills**: pale fill (`#e2e2e2`), ink label, and a thin grey line set 3 px inside the edge. A
   button's icon sits in a small black disc. The quiet version is the same pill with no fill, a light hairline and
   white text. Gold fill is for the one main action.
5. **Tabs**: a row of items on the glass; the open one has its icon in a white disc and a white bar under it.
   In a side list the open item turns gold and its icon gets a dotted ring.
6. **Cells**: mods, characters and pictures sit in dark slate cells with the cut top right corner, a darker
   strip for the name or count, and a coloured line at the bottom edge. The picked cell has a white frame set
   2 px outside it.
7. **Colour**: gold (`#e0be78`) is in use, equipped, current. Orange (`#f29a2e`) is numbers, sliders, the picked
   radio ring. Teal (`#61fbdd`) is active or done. Red (`#c95a50`) is the warning strip. Everything else is grey.
8. **Type**: one DIN-like face in medium and bold, sentence case, a little tracking. Numbers are condensed.
   Small labels above titles are gold. No italics, no all-caps headings.
9. **Ornament**: hairlines end in a dot or a small ring. Round things sit in thin concentric rings with a few dots
   on them (orbits). Section titles sit on a hairline with those ends.
10. **Phone menu**: the main menu is a dark panel of square tiles, each an icon over a small label, with a column
    of round keys beside it. The sidebar is that menu.
11. **Idle motion**: a star field that twinkles and large orbit rings that turn slowly behind the glass. Both stop
    with reduced motion.
12. **Density**: rows are 2.4 to 3 rem tall and touch or sit 3 px apart; grids use 0.5 rem gutters. Spare room
    carries an orbit ornament or a hairline, not blank glass.
13. **Motion** is soft and short (120 to 260 ms): fade and a small slide, no bounce.

## Light scheme

Dark is the default, as in the game. In light the page itself becomes a plate (`#e3e4e8`, panels `#eeeff1`) with ink
text, and the phone menu turns pale; its picked tile and the active profile flip to the dark key (`#26262a` with a
pale gold label). Cells (cards, tiles, portraits) stay dark slate in both, as they do on the game's own plates, so
outlines around them turn ink. Gold text on pale grounds uses `#7a4f12` (5:1). Stars and orbits are inverted to faint
ink. The picture viewer stays dark.

## Colour

| Use | Hex |
|---|---|
| Space behind everything | `#0c0f27`, `#131932`, `#0f0c1d` |
| Glass, side panel, footer bar | `#1a1b24`, `#141518`, `#262626` |
| Phone tile on its panel | `#1c1c1f` on `#121214` |
| Plate, row, well, info strip | `#dadcde`, `#e5e5e5`, `#edefef`, `#c5c5c6` |
| Button fill, its inner line | `#e2e2e2`, `#bcbaba` |
| Ink | `#111113` |
| Gold bar, gold label | `#e0be78`, `#d6bc9a` |
| Orange | `#f29a2e` (`#fbac45` on glass) |
| Teal, red | `#61fbdd`, `#c95a50` |
| Text on glass | `#ffffff`, `#c9ccd6`, `#8e93a3` |
| Cell slate, cell strip | `#3a4258` to `#566080`, `#26292d` |

## Textures (custom properties in hsr.css)

`--stars` (three layers of small dots), `--rings` (concentric hairline circles, used in footers and behind round
things), `--orbit` (one ring with dots, an SVG), `--dot-line` (a hairline that ends in a ring).

## Fonts

Sofia Sans (text) and Sofia Sans Semi Condensed (numbers), with JetBrains Mono for code. All OFL and bundled under
`src/styles/fonts/`.
