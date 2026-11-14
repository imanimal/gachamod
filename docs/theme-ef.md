# Talos-II theme notes

How the theme reads Arknights: Endfield's menus, and the rules the CSS follows. References were release-version
screenshots of Settings (graphics and account tabs), the Credit Store and Elastic Goods market, the Operational
Manual (Node and Daily), Mail, the Valuables Stash, depot and backpack, Gear Assembly, the Sanity Recovery and
reward pop-ups, the operator and weapon screens, the friend profile, the main menu and the title screen. The
headhunting and Protocol Pass splash art is promotional layout, not the menu language, and the web account centre
(lime on black) is a different product. No game art, icons or fonts are used: shapes are CSS, gradients and inline
SVG. Hex values were sampled from screenshots, so they are close, not exact.

Files: `src/styles/themes/ef.css` (tokens, textures, every kit class), `ef-shell.css` (window, sidebar, page bar),
`ef-screens.css` (screen classes).

## The idea

A light sheet on a dark stage. The stage is charcoal, nearly black, and carries the controls: top bars, bottom
bars, the sidebar. Content sits on light grey sheets, in white cards that end in a charcoal name plate. Every
control is a pill or a disc. Signal yellow is the only loud colour and it means chosen, done or go. Around all of
it runs fine line work: hairlines, crosshairs, tick rulers and tiny captions with codes.

Light is the native scheme. In the dark scheme the sheets and cards turn charcoal (`#191919`, cards `#262626`)
with light text; the stage gets a step darker and controls keep their light pills.

## Rules

1. **Stage**: charcoal (`#1b1b1b`, bars `#101010` to `#262626`) with a faint contour texture and hairlines at 12%
   white. The title bar, sidebar, Home's quick bar, the sticky page bar, dialog headers, toasts and floating bars are
   stage. Text on it is white, small labels grey.
2. **Sheet**: light grey (`#e3e2e2`) with fine scan lines and small crosshairs. The view, dialog and drawer bodies
   and panels are sheets. Text on it is near black.
3. **Card**: white, 4 px corners, a hairline shadow. A picture card has a 4 px colour line under the picture, a
   2 px gap, then a separate charcoal name plate (`#3b3c3e`) with white text. The line is yellow when the thing is
   on and grey when it is off.
4. **Plate**: a charcoal row (`#333`) with white text, used for rows on a sheet and for panel headers. A header
   plate has an icon block at its left end and hatching at its right end. A finished or chosen plate turns yellow
   with black text.
5. **Pills**: buttons, selects, text fields, search and chips are full capsules. White with black text is the
   normal one (with a 1 px dark outline on a sheet), charcoal is the quiet one, yellow with a thin outer ring is
   the main action, grey is disabled. An icon sits in a black disc at the right end of the pill. Large pills carry
   a thin arrow line on the left.
6. **Discs**: icon buttons are round. Black disc with a white icon on a sheet, white disc with a black icon for
   close on the stage.
7. **Switch**: one capsule split in two halves, ON on the left and OFF on the right. The chosen half is a white
   pill, the other is grey text on the dark track.
8. **Tabs**: blocks standing in a row on the stage. The open one is a solid yellow block with black text and a
   short yellow bar under it. Segmented controls are a black capsule of outlined pills, the chosen one white.
9. **Section heads**: a short vertical bar, the label, a hairline to the edge and a tiny code at the far end.
   The bar and label are yellow on the stage and black on a sheet.
10. **Colour means state**: yellow is chosen, done or go. An orange diamond on a corner means new or needs a
    look. Red bars warn. Lime is a good reading on the stage. Blue marks values inside running text. Rarity
    colours only appear as the line under a card.
11. **Type**: Figtree, medium weight, never heavy. Screen titles are small caps after two slashes
    (`// SETTINGS`). Numbers are large and light with a small unit beside them (`160 /160`, `Lv.36`). Captions
    are tiny caps with wide tracking. Bracketed notes use square brackets with spaces (`[ 24 MODS ]`).
12. **Tags**: small squared labels with 2 px corners: black with white text, yellow with black text, a notched
    yellow corner tag for offers and favourites, an outlined pill for counts (`0/1`).
13. **Translucent surfaces**: scrims and floating stage parts are charcoal at 70 to 85% over a blur, with a
    hairline border.
14. **Idle motion**: a dashed ring turns slowly behind the sidebar, a code ticker runs in the title bar, a small
    square blinks beside the current screen name and running bars carry marching stripes. All of it stops with
    reduced motion.
15. **Density**: grids pack tight (about 0.45 rem gutters), sheets run edge to edge, and spare room carries
    outlined ghost words, crosshairs, rulers and serial captions.
16. **Motion** is short and flat (90 to 220 ms, no bounce): sheets slide in a few pixels, dialogs open with a
    quick vertical unfold, the yellow selection wipes in from the left.

## Colour

| Use | Hex |
|---|---|
| Stage, bars | `#1b1b1b`, `#101010` to `#262626` |
| Plate, name plate | `#333333`, `#424345` |
| Sheet, panel, card | `#e3e2e2`, `#eeecec`, `#ffffff` |
| Sheet greys | `#d5d3d3`, `#c9c8c8`, `#9a9a9a` |
| Signal yellow | `#ffee00` (`#e9d800` shade, `#f1ecc1` wash) |
| Orange marker | `#ff7a1a` |
| Lime (stage readings) | `#c5e03a` |
| Blue (values) | `#2b7fd9` on sheets, `#91a7e7` on the stage |
| Red | `#e0444a` (`#dda4a8` bar) |
| Rarity lines | `#ffb400`, `#9554fb`, `#26a8ea`, `#a4cf3d`, `#9a9a9a` |
| Text on sheet | `#1c1c1c`, `#4a4a4a`, `#7b7b7b` |
| Text on stage | `#f4f4f4`, `#c4c4c4`, `#8d8d8d` |

## Textures (custom properties in ef.css)

`--scan` (scan lines for sheets), `--cross` (crosshair marks), `--contour` (rings for the stage), `--hatch` and
`--hatch-ink` (diagonal hatching, light and dark), `--ticks` (a ruler edge), `--stripes` (hazard stripes for
running bars).

## Fonts

Figtree (400 to 800) for everything, picked by laying candidates over cropped menu text, and JetBrains Mono for
codes and paths. Both are OFL and bundled under `src/styles/fonts/`.
