# Solaris theme notes

How the theme reads Wuthering Waves' menus, and the rules the CSS follows. References were the Terminal, the
Settings pages, Echo Upgrade and Tuning, the Activity and Milestones lists, the Forgery Challenge list, the
Souvenir Store and Synthesis panels, the Data Bank, the Utility Wheel, the Convene banner, the level-up prompt
and the confirm dialogs. Event menus and the Ascension Planner frame are skins, not the base language. No game
art, icons or fonts are used: shapes are CSS, gradients and inline SVG. Hex values were sampled from screenshots,
so they are close, not exact.

Files: `src/styles/themes/ww.css` (fonts, keyframes, accents, imports), `ww-kit.css` (tokens, textures, every kit
class), `ww-shell.css` (window, sidebar, page bar,
the sky), `ww-screens.css` (screen classes).

## The idea

A menu is a few flat sheets laid over the night sky, and each sheet is either ink or paper. Ink sheets are near
black and see-through; paper sheets are light grey and almost solid. Whatever you can press takes the opposite
tone of the sheet it lies on, so a key on paper is black and a key on ink is paper. Gold is the only colour that
is not a status, and it is thin: a line, a number, a small diamond.

## Rules

1. **Sky**: the window is a deep blue-black with a soft haze and a sparse field of small stars. Screens have no
   frame of their own. The title sits top left as a small diamond glyph and a cream name.
2. **Ink sheet**: black at about 70% over a blur, corners of 3 to 4 px, at most a faint 1 px line. Settings rows,
   the Terminal, category lists, value boxes, slots and menus are ink.
3. **Paper sheet**: light grey (`#dadada`, white for dialogs) with dark slate text. Dialogs, drawers, list rows
   that carry an action, toasts' keys and the picked row of a list are paper. A finished or switched-off row drops
   to mid grey (`#b2b2b2`).
4. **Keys flip tone**: on ink the main key is paper with dark text, on paper every key is black with white text.
   Both carry faint contour lines that sweep in from the left. Corners are 2 to 3 px, never a capsule. Lesser keys
   on ink are ink boxes with a thin slate line.
5. **Picked is white**: the current row, tab, segment or chip turns into a white card with black text. A picked
   tile gets a white outline that stands 2 px off its edge. Nothing picked is ever filled with gold.
6. **Light scheme**: the game is dark, so dark is the default. In light the paper sheet becomes the page: frosted
   paper bars, the ring drawn in ink, gold darkened to read as text. Item tiles, tags, tips and toasts stay ink.
   Keys on the page are white cards and the picked one turns black (the opposite tone of its sheet).
7. **Item tiles**: a dark slate square (`#262628`), the picture, a soft glow rising from the bottom in the
   rarity colour, a 3 px bright line, then a darker strip (`#1e1e20`) for the name or count. Mods that are on
   use gold; mods that are off lose the line and go grey.
8. **Stat rows**: label left, value right, in a full capsule of blue-black ink. Rows alternate between filled
   and bare. Numbers that changed or matter are gold.
9. **Colour meaning**: gold (`#fdd02c` bright, `#ceb99c` for lines) marks the current place, numbers and names.
   Crimson diamonds with a white mark are alerts and counts. Green is done or active, teal is claimed. Rarity
   colours (gold, violet, blue, green) only appear as the line and glow of a tile.
10. **Type**: Lato. Bold for anything you read at a glance, regular for long text, black for big numbers. Sentence
    case, slightly tight tracking, no italics, no all-caps except tiny tags. Cream (`#ebe6e2`) on ink, slate
    (`#3a4047`) on paper, true black for counts on paper.
11. **Lines and marks**: hairlines end in small hollow diamonds. Section labels are a small gold diamond and a
    name. Scrollbars are a 1 px line with a 3 px thumb (white on ink, gold on paper). Sliders are a thin track
    with a tall white capsule for a thumb; switches are built the same way.
12. **Translucency**: ink sheets blur what is behind them. Scrims are a dark blue wash with a heavy blur, like the
    game world behind a menu.
13. **Idle motion**: stars drift slowly across the sky and a large ring of fine lines turns behind the view.
    Both stop with reduced motion.
14. **Density**: tiles sit 6 to 8 px apart, rows 6 px apart. Spare room carries ring ornaments, contour lines or
    a strip of made-up script, never a bigger margin.
15. **Motion**: quick fades and short slides (120 to 240 ms), no bounce. Hover brightens; a key's contour lines
    slide a little.

## Colour

| Use | Hex |
|---|---|
| Sky | `#07080d` to `#141a2c` |
| Ink sheet | `#0c0d11` at 72%, value box `#000` at 45% |
| Stat capsule | `#202636` |
| Paper, dimmed paper, dialog | `#dadada`, `#b2b2b2`, `#f1f1ef` |
| Black key, paper key | `#0d0d0d`, `#e2e2e0` |
| Tile, tile strip | `#262628`, `#1e1e20` |
| Gold bright, gold icon, gold line | `#fdd02c`, `#fbea92`, `#ceb99c` |
| Rarity: gold, violet, blue, green | `#f9f1cc`, `#d69ae2`, `#90c5d5`, `#8dcb9c` |
| Alert, done, claimed | `#d3405c`, `#8fd16a`, `#3f9c93` |
| Text on ink | `#ebe6e2`, `#b9bcc4`, `#7f8492` |
| Text on paper | `#16181b`, `#3a4047`, `#6f757d` |

## Textures (custom properties in ww.css)

`--contour` and `--contour-ink` (the lines on keys), `--compass` (the ring mark on paper rows), `--stars`,
`--script` (the made-up script strip, used as a mask), `--dia` (a hollow diamond for line ends).

## Fonts

Lato (regular, bold, black) and JetBrains Mono, both OFL and bundled under `src/styles/fonts/`.
