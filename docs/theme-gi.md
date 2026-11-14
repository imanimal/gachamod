# Teyvat theme notes

How the theme reads Genshin Impact's menus, and the rules the CSS follows. References were the Paimon menu and
its exit prompt, the quest list, the Archive, Achievements, an event shop, the Mystic Offering screens, the
artifact and furnishing filter panels, party quick setup, map and graphics settings, mail, the "Replenish
Original Resin" and "Obtained" pop-ups, the profile pop-up menu and Wish History. The Adventurer Handbook and the
Wish History book are skins (a book drawn around the same paper), so only their paper rows were taken. No game
art, icons or fonts are used: shapes are CSS, gradients and inline SVG. Hex values were sampled from
screenshots, so they are close, not exact.

Files: `src/styles/themes/gi.css` (fonts and imports), `gi-kit.css` (tokens, textures, every kit class),
`gi-shell.css` (window, sidebar, page bar, the sky), `gi-screens.css` (screen classes). The kit is
imported first so screen rules win.

## The idea

Two materials trade places. Cream is warm paper. Slate is a blue grey, darker where it is a side
panel. A control always takes the material its surface does not have: cream pills on slate and on the sky, slate
pills on cream. Thin gold lines that end in diamonds and four-point stars do the decorating. Nothing has a
thick outline or a hard shadow. The window is laid out like the Paimon menu: a cream column with the namecard
and a grid of slate tiles, and a menu page over an evening sky (dark) or over cream paper (light, the default,
like the game's own menus). In light the page bar and drawers are paper too; pop-up menus, tips and toasts stay
slate.

## Rules

1. **Surfaces.** Sky: navy with star dust, behind everything. Top bars: a darker see-through strip over it.
   Slate (`#495366`, rows `#3b4354`): tiles and list rows, square corners (2 to 4 px), a lighter hairline set
   3 px inside the edge. Navy (`#273341`): panels that slide in from the side. Cream (`#ece5d8`): the
   sidebar, panels and dialogs, with a tan hairline set inside the edge and gold sparkles at a dialog's corners.
   Paper (`#f5f2ec`): rows and cards on cream, a tan line round them and a tinted cell at the right end.
2. **Controls flip.** On the sky, slate or navy a button is a cream pill with slate text. On cream it is a
   slate pill with cream text. The same goes for selects, segments and the picked tab. Text fields are the
   exception: on cream they are paper pills with a tan ring.
3. **Buttons** are full pills. The icon sits in a dark round cap (`#313131`) at the left end and is drawn in
   yellow (`#ffcc32`); the label is centred and bold. The second-rank button is an outlined pill. Hover adds a
   soft white ring, press tints the pill gold.
4. **Lists.** Rows are slate rectangles. The picked row turns cream with a white outline and gets a small
   triangle pointing at it from the left. Nav tiles in the sidebar do the same.
5. **Tabs** live in the top bar. The open tab's icon sits in a cream disc and a thin cream line runs under it.
6. **Item cards.** Picture on top with one large curve at its bottom right corner, a cream label strip under it.
   A card with no picture gets a rarity gradient (grey, blue, purple, gold). A lime border means in use (a mod
   that is on, a skin being worn), like a character picked for the party. A white outline with a glow is the
   cursor.
7. **Colour means something.** Gold (`#d3bc8e`): titles on dark, switches that are on. Yellow (`#ffcc32`):
   icons in button caps, stars. Orange (`#f39000`): numbers that matter. Lime (`#c3f436`): in use. Red
   (`#b75b4a`, `#e0523f`): claim, delete, errors. Blue (`#39a0e3`): cancel, notes.
8. **Type.** Laila, the closest open face to the game's HYWenHei: 700 for titles and anything you press, 600
   for text, 500 for long text. Upright, mixed case, no capitals for effect. Titles on dark are gold, text on
   dark is cream, text on cream is slate (`#3b4255`) with tan second lines.
9. **Tags and counts** are dark see-through pills with cream text. A warning tag is a small red block. Section
   headings on navy are flat bars (`#3a4552`); on cream they are a title over a hairline with diamond ends.
10. **Translucency.** Top bars, scrims and slate rows on the sky let it through, blurred and darkened.
    Cream never does.
11. **Idle motion.** Four-point sparkles drift across the sky and twinkle. Nothing else moves by itself. They
    stop with reduced motion.
12. **Density.** Grids sit at half a rem. The top bar holds title, tabs and buttons in one line. Spare room in the
    sidebar goes to the nav tiles and profile rows; a small emblem with the game's name shows only in what is left.
13. **Motion** is soft and short (120 to 260 ms), ease out, no overshoot: dialogs grow from 96% as they fade in,
    side panels slide, rows fade to cream.

## Colour

| Use | Hex |
|---|---|
| Cream, paper, tinted band | `#ece5d8`, `#f5f2ec`, `#e1d6c7` |
| Tan lines on cream | `#d6cbb9`, `#bfb29c` |
| Slate tile, row, button on cream | `#495366`, `#3b4354`, `#4b5367` |
| Navy panel, section bar | `#273341`, `#3a4552` |
| Sky | `#161c2b` to `#2a3654` |
| Button cap | `#313131` |
| Gold, yellow, orange | `#d3bc8e`, `#ffcc32`, `#f39000` |
| Lime, red, blue | `#c3f436`, `#b75b4a` (`#e0523f`), `#39a0e3` |
| Text on dark | `#ece5d8`, `#c9c3b6`, `#959cab` |
| Text on cream | `#3b4255`, `#4f5567`, `#62584a` (4.5:1 on cream) |
| Rarity 1 to 5 | `#72778b`, `#5f8b6f`, `#5392b8`, `#9c75b7`, `#c8823c` |

## Textures (custom properties in gi-kit.css)

`--dust` (star dust for the sky), `--star` (a four-point sparkle), `--weave` (the faint diamond lattice on cream
rows and slate tiles), `--rule` and `--rule-ink` (a hairline with diamond ends, gold or tan).

## Context

Text and line tokens are set twice: once for dark surfaces (the sky, in the dark scheme) and once under every cream
container (`.side`, `.panel`, `.dialog`, `.card`, `.tile` and so on), so a screen's own CSS picks the right ink
without knowing where it sits.

## Fonts

Laila (400 to 700) and JetBrains Mono, both OFL and bundled under `src/styles/fonts/`.
