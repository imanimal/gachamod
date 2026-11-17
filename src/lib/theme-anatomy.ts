// A map of the window for custom themes: the parts a stylesheet can target, as selectors with their nesting and
// state classes, grouped by area. A chatbot writing a theme can't see the app, so the AI helper's theme prompt sends
// anatomyText(); Settings' theme editor may list it too. theme-anatomy.test.ts checks that every class named here is
// drawn by a component and styled by a CSS file, so change this when the markup changes.
// Notation in `sel`: "a > b, c" puts b and c inside a (in a chain "a > b > c, d", c and d sit inside b), "(...)"
// lists what sits somewhere inside the part before it, "|" is one or the other, and after ";" come the states
// (classes, attributes, pseudo-classes) the part or its children can carry.
// Owner: THEME area.

/** One part of the window a custom theme can style. `sel` is a selector or a short structure (".mod-card > .mod-card-img"), with its state classes. */
export interface ThemePart { sel: string; what: string }
/** A group of parts: "Sidebar", "Buttons", "Mod cards" ... */
export interface ThemeArea { id: string; name: string; parts: ThemePart[] }

export const THEME_ANATOMY: ThemeArea[] = [
  {
    id: "root", name: "Attributes on <html>", parts: [
      { sel: "[data-theme]", what: "the built-in theme under yours (default, zzz, gi, hsr, ww, ef ...); its rules still apply" },
      { sel: "[data-custom]", what: "your theme's id while it is on" },
      { sel: "[data-scheme]", what: "dark or light" },
      { sel: "[data-game]", what: "the current game's id (gi, hsr, zzz, ww, ef ...)" },
      { sel: "[data-motion]", what: "full or reduced; reduced cuts animations to 1ms" },
      { sel: "[data-density]", what: "compact or roomy, absent for cozy; the --d token is the spacing factor" },
      { sel: "[data-sidebar=\"right\"]", what: "sidebar on the right" },
      { sel: "[data-nav=\"grid\"]", what: "view buttons as two-column tiles" },
      { sel: "[data-corners]", what: "sharp or round, absent for soft; overrides the --radius tokens" },
      { sel: "[data-buttons]", what: "icons or text: buttons show only that; absent for both" },
      { sel: "[data-format]", what: "how Mods is laid out, picked by the user: chars (character list on the left), panes (plus details docked on the right), rows (dense list); absent for cards. Themes style it, never set it" },
      { sel: "html.kbd, html.pad", what: "keyboard or controller in use, focus rings show" },
    ],
  },
  {
    id: "window", name: "Window and text", parts: [
      { sel: ".app > .backdrop, .titlebar, .side, .view; [data-side=\"rail\"]", what: "the window grid; rail while the sidebar is folded" },
      { sel: ".view > .page; .home, .library, .characters, .settings", what: "scrolling area, then the screen's column with its name" },
      { sel: ".nogame", what: "first-load wait and crash page" },
      { sel: ".hint, .muted, .sub-h", what: "faint text, small headings" },
      { sel: "a, .qlink, .link-btn", what: "links; .qlink opens a character, creator or category" },
      { sel: "kbd, .kbd", what: "key caps" },
      { sel: "::-webkit-scrollbar-thumb, ::selection, :focus-visible", what: "scrollbar, selection, focus ring (outline in --ring)" },
    ],
  },
  {
    id: "icons", name: "Icons", parts: [
      { sel: ".i", what: "every icon: an inline SVG path, fill none, stroke currentColor, stroke-width 1.7 (px at any size), 1.15em square. Restyle with color, stroke-width, fill" },
      { sel: ".btn > .i:first-child, .dialog-h h2 .i, .page-h h1 .i, .empty-i", what: "icons game themes set in a round or square puck" },
    ],
  },
  {
    id: "titlebar", name: "Title bar", parts: [
      { sel: ".titlebar > .tb-l, .tb-search, .tb-r", what: "top bar; its empty parts drag the window" },
      { sel: ".tb-l > .brand (.brand-mark), .tb-nav (.tb-k), .crumb, .sp", what: "logo (a background image), back and forward, breadcrumb, spare room" },
      { sel: ".tb-k; :disabled", what: "small keys; .tb-r has undo, redo, help" },
      { sel: ".crumb > .crumb-b.crumb-game, .crumb-sep, .crumb-part (.crumb-b, .crumb-sep-b); .crumb-view", what: "breadcrumb: game, page, open item (.crumb-view)" },
      { sel: ".tb-search > .i, .tb-search-t, .kbd", what: "search box that opens the command palette" },
      { sel: ".tb-act; .is-long", what: "what the app waits on; .is-long past ten seconds" },
      { sel: ".winkeys > .wk, .wk-x", what: "minimise, maximise, close" },
    ],
  },
  {
    id: "sidebar", name: "Sidebar", parts: [
      { sel: ".side; [data-collapsed]", what: "the sidebar; folded to an icon rail" },
      { sel: ".side-top > .player-card (.player-banner, .player-av, .player-name, .player-title) | .side-me, .side-fold", what: "GameBanana account (a picture when folded), fold key" },
      { sel: ".side-game > .side-game-cur (.gbadge, .side-game-t, .side-game-s), .side-games (.side-g); .running", what: "current game card, row of other games" },
      { sel: ".side-nav > .nv (.i, .nv-t, .nv-b); .on, :disabled, [data-view]", what: "view buttons; .on is open; data-view is home, browse, library, characters, downloads, tools or settings" },
      { sel: ".nv-b; .t-bad, .t-warn, .t-ok, .t-run", what: "count badge; an empty .t-run is a pulsing dot" },
      { sel: ".side-prof > .side-prof-h (.side-h, .side-hk), .side-prof-list (.side-p)", what: "profiles heading and list" },
      { sel: ".side-p > .pthumb-mini, .side-p-t, .side-p-on; .on, .side-p-add", what: "a profile, --p-color its colour; .on is active" },
      { sel: ".side-foot > .play > .play-btn, .play-more-w (.play-more)", what: "Play (.btn-primary.btn-lg) and its options key" },
      { sel: ".play; .running, .starting, .play-big", what: "game running or starting; .play-big on Home" },
    ],
  },
  {
    id: "header", name: "Page header", parts: [
      { sel: ".page-h > .page-h-row (.page-h-t, h1, .page-h-sub, .page-h-a), .page-h-more", what: "top of each screen: icon and title, line under it, actions, filters" },
      { sel: ".page-h.is-stuck", what: "while scrolled, if a theme makes .page-h sticky; it keeps only its controls" },
    ],
  },
  {
    id: "buttons", name: "Buttons", parts: [
      { sel: ".btn > .i, .btn-t, .btn-ir; .btn-primary, .btn-secondary, .btn-ghost, .btn-danger", what: "text button: icon, label, trailing icon" },
      { sel: ".ibtn > .i; .btn-ghost, .btn-primary, .on", what: "icon-only button, ghost unless set; .on when switched on" },
      { sel: ".btn-sm, .btn-lg", what: "sizes, on both" },
      { sel: ":hover, :active, :disabled, .busy", what: "states; .busy swaps the icon for a .spin" },
      { sel: ".on-img", what: "frosted plate for buttons over pictures, set with !important" },
    ],
  },
  {
    id: "fields", name: "Fields", parts: [
      { sel: ".search > .i, input, .search-x | .search-k; :focus-within", what: "search box; a / key hint, or a clear key once typed in" },
      { sel: ".field > .field-l, input | textarea | .select (select), .hint; .mono", what: "labelled field or drop-down" },
    ],
  },
  {
    id: "pickers", name: "Pickers", parts: [
      { sel: ".chip > .chip-img | .i, .chip-t, .chip-n; .on", what: "filter pill with picture or icon and count" },
      { sel: ".seg > .seg-o; .on, .seg-sm, .seg-lg", what: "segmented choice" },
      { sel: ".tabs > .tab (.i, .tab-n); .on", what: "tabs; .tab::after is the underline" },
      { sel: ".toggle > .toggle-track (.toggle-knob), .toggle-l (.toggle-t, .hint); .on, .off, .toggle-sm", what: "switch; .off when disabled" },
      { sel: ".check > .check-box (.i), .check-t; .on, .off", what: "checkbox" },
      { sel: ".swatch; .on", what: "round colour button, --c its colour" },
      { sel: ".pchips .pchip (.pchip-img, .pchip-t, .pchip-n); .on", what: "row of round character pictures" },
    ],
  },
  {
    id: "boxes", name: "Boxes", parts: [
      { sel: ".panel > .panel-h (.panel-t, .panel-n, .panel-a), .panel-b; .flush", what: "titled block: title, count, buttons, body" },
      { sel: ".cards > .card; .card-btn, .sel", what: "card grid; .card-btn is clickable" },
      { sel: ".tiles > .tile > .tile-img, .tile-body (.tile-t, .tile-sub)", what: "picture tiles" },
      { sel: ".kv > .kv-l, .kv-v", what: "label and value rows" },
      { sel: ".note; .t-warn, .t-bad", what: "tinted note" },
      { sel: ".floatbar", what: "bar floating at the bottom of a view" },
      { sel: ".avatar; .ring", what: "round picture, or initials" },
      { sel: ".gbadge > img | .gbadge-t; [data-game]", what: "game icon, or letters on --g-accent" },
    ],
  },
  {
    id: "overlays", name: "Overlays", parts: [
      { sel: ".overlay > .dialog > .dialog-h (h2, .ibtn), .dialog-b, .dialog-f; .gone", what: "dialog on a scrim, .gone while closing" },
      { sel: ".overlay-side > .drawer > .drawer-h, .drawer-b, .drawer-f", what: "panel from the right" },
      { sel: ".popover > .menu > .menu-i, hr; .danger", what: "menu from a button" },
      { sel: ".ctx > .menu > .menu-h, .menu-i (.menu-c, .menu-img, .menu-t, .menu-k, .menu-sub); .on", what: "right-click menu, also a .popover; .on has its submenu open" },
      { sel: ".apptip", what: "hover tip" },
      { sel: ".toasts > .toast (.i, .tt, .toast-act, .toast-x, .t-life); .bad", what: "messages, bottom right; .t-life is the time bar" },
      { sel: ".palette > .palette-in, .palette-list (.palette-sec > .palette-h, .palette-i); .on", what: "command palette; .on is the highlighted result" },
      { sel: ".dropzone > .dropzone-card", what: "while files are dragged in" },
    ],
  },
  {
    id: "feedback", name: "Feedback", parts: [
      { sel: ".badge > .i; .t-accent, .t-ok, .t-warn, .t-bad, .t-info, .t-muted", what: "small tag, tone in --tone; a button when it opens what it names" },
      { sel: ".progress > .progress-bar; .indet", what: "progress; .indet when unknown" },
      { sel: ".spin", what: "spinner, borders in currentColor" },
      { sel: ".waiting > .waiting-t, .waiting-hold", what: "a wait that says what it waits on" },
      { sel: ".skel", what: "loading placeholder" },
      { sel: ".empty > .empty-i, h3, p, .empty-a", what: "empty state" },
    ],
  },
  {
    id: "library", name: "Mods screen", parts: [
      { sel: ".library-chars > .chip.char-chip, .library-chars-sep", what: "type and character chips under the header" },
      { sel: ".mod-grid; .cards, .is-list", what: "mods as cards or a list" },
      { sel: ".mod-card.card > .mod-card-hit (.mod-card-img), .mod-card-body (.mod-card-name, .mod-card-char, .mod-card-meta), .mod-card-badges, .mod-card-foot", what: "one mod; .mod-card-hit holds the picture and its ::after covers the card to open it" },
      { sel: ".mod-card-badges > .mod-card-health, .mod-card-fav, .badge", what: "tags on the picture" },
      { sel: ".mod-card-foot > .toggle, .mod-card-more", what: "on/off switch, menu key shown on hover" },
      { sel: ".mod-card; .is-off, .sel, .is-row", what: "off, selected, list row" },
      { sel: ".mod-img > img | .mod-img-none (.mod-img-ghost, .mod-img-portrait); .is-blurred", what: "mod picture; without one, the character over its faint name" },
      { sel: ".floatbar.mod-bulk", what: "actions for selected mods" },
      { sel: ".mod-drawer (.mod-drawer-hero > .mod-drawer-img, .mod-drawer-picact, .mod-drawer-badges)", what: "details drawer, picture first" },
      { sel: ".mod-drawer-fields (.mod-tag), .mod-drawer-sec (.panel), .mod-drawer-facts (.kv)", what: "tags, sections (parts, options, readme), facts" },
      { sel: ".archive-grid > .tile.archive-card", what: "the Trash tab" },
    ],
  },
  {
    id: "browse", name: "Browse screen", parts: [
      { sel: ".gbb > .gbb-bar, .gb-chars, .gbb-chips (.gbb-fchip), .gb-grid", what: "search and filters, characters, active filters, results" },
      { sel: ".gb-chars-list > .gb-ch (.gb-ch-img, .gb-ch-t); .on", what: "character picker" },
      { sel: ".gb-card.card > .gb-card-img (.gb-nsfw-badge, .gb-card-state, .gb-card-quick), .gb-card-b", what: "a GameBanana mod: picture with tags and install key, text" },
      { sel: ".gb-card-b > .gb-card-t, .gb-card-c, .gb-card-meta (.gb-card-by, .gb-stat)", what: "name, character, creator, likes" },
      { sel: ".gb-card; .is-nsfw, .is-prio, .gb-card-skel", what: "blurred, prioritised creator, loading" },
      { sel: ".gb-drawer (.gb-mod > .gb-gallery, .gb-mod-head, .gb-mod-tags, .gb-files, .gb-desc)", what: "a mod's page: pictures, creator and stats, tags, files, text" },
      { sel: ".gb-gallery > .gb-gallery-main, .gb-gallery-thumbs (.gb-thumb); .on", what: "pictures" },
      { sel: ".gb-file > .gb-file-main (.gb-file-name, .gb-file-meta), .gb-file-act", what: "a file and its install key" },
      { sel: ".gb-lightbox > .gb-lightbox-bar, .gb-lightbox-img, .gb-lightbox-prev, .gb-lightbox-next", what: "picture viewer" },
    ],
  },
  {
    id: "characters", name: "Characters screen", parts: [
      { sel: ".roster > .portrait.roster-tile > .portrait-bg, .portrait-img, .roster-owned, .portrait-c, .portrait-n; .dim", what: "grid: worn skin faint behind, portrait, owned mark, mod count, name; .dim has no mods" },
      { sel: ".char-hero > .char-hero-pic, .char-hero-t (.char-hero-back, .char-hero-name, .char-hero-a), .char-hero-nav", what: "a character's page header" },
      { sel: ".char-strip-wrap > .pchips.char-strip", what: "row of other characters" },
    ],
  },
  {
    id: "downloads", name: "Downloads screen", parts: [
      { sel: ".dl-list > .dl-item > .dl-thumb, .dl-main (.dl-name, .dl-line, .progress), .dl-act", what: "one download" },
      { sel: ".dl-item; .is-done, .is-cancelled", what: "is-<state>: waiting, downloading, installing, needsChoice, done, failed or cancelled" },
      { sel: ".dl-group-h", what: "a game's heading when all games show" },
    ],
  },
  {
    id: "settings", name: "Settings and Tools", parts: [
      { sel: ".pg > .pg-side (.pg-search, .pg-nav (.pg-group, .pg-nav-i)), .pg-stage (.pg-page); .on", what: "search field and page list left (.pg-nav-i.on is open), the page right" },
      { sel: ".pg-page.pg-results > .pg-body (.pg-from, .panel, .pg-hit)", what: "search results in place of the page: where each page's panels live, the panels, matching settings lit" },
      { sel: ".pg-page > .pg-body > .panel", what: "a page's panels, kept frameless by the app; .panel-h still takes your style" },
      { sel: ".set-row", what: "a setting: label and .hint left, control right" },
      { sel: ".set-game > .gbadge, .set-game-main (.set-game-h, .set-folder); .shown", what: "a game and its folders" },
      { sel: ".theme-card > .theme-preview, .theme-card-t", what: "theme picker; the preview draws its theme small" },
    ],
  },
  {
    id: "home", name: "Home and Profiles", parts: [
      { sel: ".home-quick > .home-quick-img, .home-quick-top (.home-quick-name, .play), .home-quick-bar (.home-pchip); .on", what: "game banner with Play and profile pills" },
      { sel: ".home-section > .home-section-h, .home-row (.home-tile, .home-char)", what: "rows of recent mods and characters" },
      { sel: ".home-tile > .home-tile-main (.home-tile-img, .home-tile-name, .home-tile-sub)", what: "a recent mod" },
      { sel: ".profile-card.card > .profile-card-main (.profile-card-banner, .profile-icon, .profile-card-name), .profile-card-a; .is-active", what: "a profile on Profiles, --p-color its colour" },
    ],
  },
  {
    id: "deco", name: "Decoration (hidden until a theme gives it display)", parts: [
      { sel: ".backdrop > .backdrop-wall > .backdrop-row > .backdrop-run > .bd-w, .bd-b; .rev", what: "behind the window: six rows, each two copies of a run of huge words and blocks. zzz tilts and drifts them; gi hides the words and puts stars on the blocks" },
      { sel: ".bd-b; .bd-dots, .bd-hatch, .bd-ring, .bd-bars, .bd-plain", what: "five kinds of empty block" },
      { sel: ".side-deco > .glyphs.run, .side-deco-m, .glyphs.rev", what: "plate above Play: a text line (loader, mod count) between two strips, at most 2.6rem tall" },
      { sel: ".glyphs; .run, .rev", what: "empty strip, also in the title bar's .sp, for a repeating pattern (zzz masks letters over currentColor); .run should scroll" },
      { sel: ".page-h-ghost", what: "copy of the screen title; zzz shows it as huge faint letters" },
      { sel: ".app::before, .backdrop::before, .backdrop::after", what: "free layers for art" },
    ],
  },
];

/** How to read `sel`, the first line of anatomyText(). */
const KEY = "How to read it: \"a > b, c\" puts b and c inside a (in \"a > b > c, d\", c and d sit inside b), \"(...)\" lists what sits somewhere inside the part before it, \"|\" is one or the other, and after \";\" come the states the part or its children can carry.";

/** The map as compact plain text for the prompt: how to read it, then one block per area ("Sidebar:" then one line per
    part, "sel: what"). */
export function anatomyText(): string {
  return [KEY, ...THEME_ANATOMY.map((a) => `${a.name}:\n${a.parts.map((p) => `${p.sel}: ${p.what}`).join("\n")}`)].join("\n\n");
}
