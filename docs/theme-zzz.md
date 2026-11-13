# New Eridu theme notes

How the theme reads Zenless Zone Zero's menus, and the rules the CSS follows. References were the Schedule
notebook (Errands tab), the outfit accessories menu, the Intel Board and the Settings and Agents screens. Skinned
menus (the green hardware Function Menu and its other themes) are skins on top of this language, not the language.
No game art, icons or fonts are used: shapes are CSS, gradients and inline SVG. Hex values were sampled from
screenshots, so they are close, not exact.

Files: `src/styles/themes/zzz.css` (tokens, textures, every kit class), `zzz-shell.css` (window, sidebar, page
bar, the wall), `zzz-screens.css` (screen classes), `src/ui/Deco.tsx` (decoration markup).

## The idea

Menus are drawn as objects, in two tones. A grey frame holds a black well, the well holds grey cards, a card holds
a black inset. Each step flips the tone, so depth reads without soft shadows. Colour is saved for state: one
saturated colour per element, on a neutral body.

## Rules

1. **Frame**: grey (`#383838` to `#464646`) with felt noise, a 2.5 to 3 px near-black outline, a 1.5 px light line
   on the top inner edge and a hard drop shadow (`0 3px 0 #000`). Panels, dialogs, drawers, popovers, the sidebar
   and cards are frames.
2. **Well**: near black (`#121212`) with a dense 4 px dot matrix and an inner shadow. Panel bodies, dialog bodies,
   the nav list, picture boxes and menus are wells.
3. **Capsule controls**: black fill with dots, a dark grey ring (`#262626`), then a thin lighter line outside it
   (`#5c5c5c`). Bold italic white label. An icon sits in a round yellow puck at the left end. Hover turns the
   outer line and the label the accent colour.
4. **One accent per element**: the accent means selected or go (current nav row, picked segment, primary key,
   switches that are on). It is orange (`#ff7a1c`) by default; Settings offers lime, yellow, cyan and pink
   (`data-accent` on the root, variables `--acc`, `--acc-hi`, `--acc-lo`, `--acc-dk`). Yellow (`#ffd21a`) marks
   the open tab, numbers and secondary lines. Red closes and warns, green is done or running.
5. **Tabs are tabs**: grey folder tabs with outlined italic text that stand on the frame's edge. The open one is
   yellow, taller, with black text.
6. **Close is a red capsule** with a thick black X that hangs off the top right corner of the frame.
7. **Type**: Rubik heavy italic for anything you press and for titles (caps for page titles), bold upright for
   reading text, grey bold for small labels. Anton only for ghost type and pressed labels.
8. **Stickers**: badges are small skewed tags with a black outline and a solid tone. Notification counts on red
   are shield shaped.
9. **Translucent surfaces** (the sticky page bar, scrims, the banner band): blur behind, a dark tint, and the dot
   matrix on top.
10. **Idle motion**: a tilted wall of huge words and textured blocks drifts behind everything (`Backdrop`), and
    strips of made-up glyphs scroll in the title bar and on the sidebar plate (`Glyphs`). Both stop with reduced
    motion.
11. **No empty areas**: grids pack tight (about 0.6 rem gutters), panels fill the width, and spare room carries
    pressed type, hatching or a glyph strip.
12. **Motion** is short and snappy (80 to 220 ms) with a little overshoot: pop with a slight tilt for dialogs, a
    skewed slide for drawers and views, a wipe for the current nav row.

## Colour

| Use | Hex |
|---|---|
| Ink (outlines) | `#090909` |
| Frame grey | `#2b2b2b` to `#464646` |
| Well | `#121212` |
| Ring, outer line | `#262626`, `#5c5c5c` |
| Accent, orange | `#ff7a1c` (`#ff9d4a` to `#f25a06`) |
| Accent, lime | `#d6f900` (`#e9ff52` to `#b4dc00`) |
| Yellow | `#ffd21a` (`#f0ae00`) |
| Orange, red, green | `#ff6a1f`, `#e8291c`, `#46e02c` |
| Text | `#ffffff`, `#c6c6c6`, `#8f8f8f` |

## Textures (custom properties in zzz.css)

`--dots` (dot matrix for dark surfaces), `--dots-ink` (the same in black, for accent and yellow fills), `--hatch`,
`--noise` (felt), `--glyphs` (the glyph strip, used as a mask).

## Fonts

Rubik with italics, Anton and JetBrains Mono, all OFL and bundled under `src/styles/fonts/`.
