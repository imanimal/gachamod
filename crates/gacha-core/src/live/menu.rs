//! The skin menu the game draws by itself (docs/ingame.md, "The menu the game draws"). It needs nothing but
//! 3DMigoto, so it also shows in exclusive fullscreen, where gachamod's own window can't.
//!
//! gachamod writes three kinds of file next to live.ini: `menu.hlsl` (a shader that draws one rectangle),
//! `menu<group>.dds` (one picture per character: a header and a row per skin, text already drawn) and `menu.dds`
//! (the footer and the small marks). The sections added to live.ini keep the menu's state in variables, move it with
//! keys, a controller or the mouse, and draw the rectangles each frame while it is open. Picking a row sets the
//! group's number, the same number the gates in the mod inis read, so the skin changes in that frame.
//!
//! Each game gets pictures drawn after its own menus (`Look`): every shape is drawn here in code and the text uses
//! Windows' own fonts. A page's picture holds every row twice: on the left as it shows, on the right as the picked
//! row, which live.ini draws over the left one where the keys or the mouse are.
//!
//! The key list the game draws (keylist.rs) rides on the same window size and shader: `menuk<group>_<slot>.dds` is one
//! picture per live skin with its keys, drawn in the top right corner while that skin's character is on screen.
//!
//! Every size is in menu pixels: the pictures are made for the screen's height, and the shader scales them when the
//! game's window is another size. Owner: INGAME area.

use crate::error::Result;
use std::collections::HashMap;
use std::f32::consts::{FRAC_1_SQRT_2, PI};
use std::path::Path;

/// Bump when the pictures or the ini change shape, so files made by an older version are made again.
const VERSION: u32 = 11;
/// The number the app sends with no group to open or close the menu.
pub(crate) const TOGGLE: u32 = 1;
/// The number the app sends with no group to show or hide the key list the game draws.
pub(crate) const KEYS: u32 = 2;
const NL: &str = "\r\n";

/// Which game's menus the pictures are drawn after. Community games get the plain one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Look { Plain, Zzz, Genshin, StarRail, Wuwa, Hi3, Endfield }

impl Look {
    pub fn of(game: &str) -> Self {
        match game {
            "zzz" => Look::Zzz,
            "gi" => Look::Genshin,
            "hsr" => Look::StarRail,
            "ww" => Look::Wuwa,
            "hi3" => Look::Hi3,
            "ef" => Look::Endfield,
            _ => Look::Plain,
        }
    }
}

/// Sizes in menu pixels, for a screen `gen_h` pixels high and a game's look (the numbers at 1080 are in `with_look`).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Layout {
    pub gen_h: u32,
    pub look: Look,
    pub w: u32,
    pub head: u32,
    pub row: u32,
    pub thumb: u32,
    pub pad: u32,
    pub foot: u32,
    /// The arrows on the list's top and bottom edges: width and height of one.
    pub arw: u32,
    pub arh: u32,
    /// The check on the row that is showing: its size, and its left edge from the menu's left.
    pub chk: u32,
    pub chk_x: u32,
    /// Gap between the screen's left edge and the menu.
    pub x0: u32,
    /// Rows shown at once.
    pub vis: u32,
    /// How much of the header's bottom and the footer's top is drawn as the list's own background, so the gap above
    /// the first row and under the last is the gap between two rows. 0 where rows have no gaps.
    pub gut: u32,
    /// How round the corners of the list's background are. The rows scroll under them, so they are two strips of
    /// their own in `menu.dds` that live.ini lays over the first and the last row in view. 0: square, no strips.
    pub round: u32,
    /// The scroll bar along the list's right side: its left edge from the menu's left, its width, how far its ends
    /// sit inside the list, and whether its ends are round.
    pub bar_x: u32,
    pub bar_w: u32,
    pub bar_in: u32,
    pub bar_round: bool,
    /// How much further from the right the rows' art ends on a list long enough to have the bar.
    pub room: u32,
}

impl Layout {
    /// The layout of `game`'s look on a screen `screen_h` pixels high.
    pub fn for_game(screen_h: u32, game: &str) -> Self { Self::with_look(screen_h, Look::of(game)) }
    /// The plain look, for tests that don't care which.
    #[cfg(test)]
    pub fn new(screen_h: u32) -> Self { Self::with_look(screen_h, Look::Plain) }
    fn with_look(screen_h: u32, look: Look) -> Self {
        let gen_h = screen_h.clamp(720, 2160);
        let s = |v: u32| ((v * gen_h) as f32 / 1080.0).round() as u32;
        // at 1080: width, header, row, picture, left padding, footer, check, the check's gap to the right edge, the
        // list's margin inside the header and the footer, how round the list's corners are
        let (w, head, row, thumb, pad, foot, chk, chk_r, gut, round) = match look {
            Look::Plain => (440, 60, 68, 50, 16, 42, 24, 20, 0, 0),
            // a pill sits 3 inside its row, the well 6 inside the pills' sides: 6 between pills and all round them
            Look::Zzz => (460, 75, 62, 46, 20, 49, 26, 30, 3, 22),
            Look::Genshin => (450, 68, 66, 48, 17, 46, 24, 28, 0, 0),
            Look::StarRail => (450, 64, 66, 48, 16, 44, 24, 22, 0, 0),
            Look::Wuwa => (440, 64, 64, 46, 18, 44, 22, 22, 0, 0),
            Look::Hi3 => (450, 66, 66, 48, 18, 44, 24, 22, 0, 0),
            Look::Endfield => (450, 64, 66, 48, 22, 44, 24, 22, 0, 0),
        };
        // the scroll bar at 1080: width, its gap to the menu's right edge, how much the rows' art moves in for it, how
        // far its ends sit inside the list, round ends. Each keeps 4 to 6 between the bar and the rows' art
        let (bar_w, bar_r, room, bar_in, bar_round) = match look {
            Look::Plain => (5, 7, 10, 6, true),
            // as far from the frame as the pills are, and the same 6 from the pills
            Look::Zzz => (8, 15, 14, 3, true),
            Look::Genshin => (4, 12, 9, 6, true),
            Look::StarRail => (4, 6, 6, 4, true),
            Look::Wuwa => (3, 6, 6, 4, false),
            Look::Hi3 => (4, 6, 8, 4, false),
            Look::Endfield => (4, 6, 8, 4, false),
        };
        let w = s(w);
        let bar_w = s(bar_w).max(2);
        Layout {
            gen_h, look, w, head: s(head), row: s(row), thumb: s(thumb), pad: s(pad), foot: s(foot), arw: s(52), arh: s(18), chk: s(chk),
            chk_x: w - s(chk_r) - s(chk), x0: s(40), vis: 8, gut: s(gut), round: s(round),
            bar_x: w - s(bar_r) - bar_w, bar_w, bar_in: s(bar_in), bar_round, room: s(room),
        }
    }
    fn s(&self, v: u32) -> u32 { ((v * self.gen_h) as f32 / 1080.0).round() as u32 }
    /// A drawing size given at 1080.
    fn f(&self, v: f32) -> f32 { v * self.gen_h as f32 / 1080.0 }
    /// Where a row's name starts.
    fn text_x(&self) -> u32 { self.pad + self.thumb + self.s(12) }
    /// Left edges in the middle strip of `menu.dds`: the up and down arrows, the same under the mouse, the check and
    /// the check on the picked row, then the round ends of the scroll bar's track (top, bottom) and thumb.
    fn arrow_u(&self, down: bool, hover: bool) -> u32 { self.arw * (down as u32 + 2 * hover as u32) }
    fn chk_u(&self, on_pick: bool) -> u32 { 4 * self.arw + on_pick as u32 * self.chk }
    fn cap_u(&self, thumb: bool, bottom: bool) -> u32 { 4 * self.arw + 2 * self.chk + self.bar_w * (bottom as u32 + 2 * thumb as u32) }
    /// How high a round end of the scroll bar is; 0 for square ends.
    fn cap_h(&self) -> u32 { if self.bar_round { self.bar_w.div_ceil(2) } else { 0 } }
    /// The scroll bar's track length. The bar only shows on a full list, so it is always this long.
    fn track(&self) -> u32 { self.vis * self.row - 2 * self.bar_in }
    /// The shortest the thumb gets on a very long list.
    fn thumb_min(&self) -> u32 { self.s(28).max(2 * self.cap_h() + 2) }
    /// How far the arrows reach past the list's top and bottom edges, into the header and the footer.
    fn arrow_out(&self) -> u32 { self.s(6) }
    /// The arrows' top edges from the menu's top: the up arrow's, and the down arrow's less `$vis` rows.
    fn arrow_y(&self) -> (u32, u32) {
        (self.head - self.gut - self.arrow_out(), self.head + self.gut + self.arrow_out() - self.arh)
    }
    /// The arrows' left edge from the menu's left: centred.
    fn arrow_x(&self) -> u32 { (self.w - self.arw) / 2 }
}

/// One character's page: its group number and the slot of each row after "None".
pub(crate) struct IniPage { pub n: u32, pub slots: Vec<u32> }

/// Sizes of the key list's pictures in menu pixels, from the menu's layout (the numbers at 1080 are in `of`).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct KeyLayout {
    pub w: u32,
    pub head: u32,
    pub row: u32,
    pub foot: u32,
    pub pad: u32,
    /// Width of the key column and of the note column.
    pub key_w: u32,
    pub note_w: u32,
    /// Gap between the screen's top and right edges and the list, and between two sheets.
    pub margin: u32,
    pub gap: u32,
}

/// Rows a sheet shows at most. A longer list shows one less and a last row with how many more there are.
const KEY_ROWS: usize = 14;

impl KeyLayout {
    pub fn of(l: &Layout) -> Self {
        KeyLayout { w: l.s(400), head: l.s(44), row: l.s(30), foot: l.s(30), pad: l.s(14), key_w: l.s(118), note_w: l.s(84), margin: l.s(40), gap: l.s(12) }
    }
    /// The height of a sheet with `rows` keys.
    pub fn sheet_h(&self, rows: usize) -> u32 { self.head + self.row * rows.min(KEY_ROWS) as u32 + self.foot }
    /// The height of the picture that says no character on screen has keys.
    pub fn none_h(&self) -> u32 { self.head + self.foot }
}

/// One key sheet as live.ini draws it: a live skin (group and slot) and the height of its picture.
pub(crate) struct IniSheet { pub n: u32, pub slot: u32, pub h: u32 }

/// The key list the game draws. `sheets` is never empty (no sheet, no key list). `key` is the key list key as a
/// 3DMigoto binding when the game binds it itself; `menu`: the keys that show it from the skin menu (Y on a
/// controller until the player picks others).
pub(crate) struct KeyListIni { pub sheets: Vec<IniSheet>, pub key: Option<String>, pub menu: Vec<String> }

/// The menu's keys as 3DMigoto bindings ("no_modifiers VK_F7", "VK_UP", "XB_A"), any number for each thing a key
/// does. `open` is empty when the app holds the key and opens the menu itself. The player picks them
/// (`live::MENU_BINDS` has the ones a menu starts with).
pub(crate) struct Keys { pub open: Vec<String>, pub up: Vec<String>, pub down: Vec<String>, pub show: Vec<String>, pub back: Vec<String>, pub close: Vec<String> }

#[derive(Default)]
struct Out(String);
impl Out {
    fn l(&mut self, s: impl AsRef<str>) { self.0.push_str(s.as_ref()); self.0.push_str(NL); }
    fn section(&mut self, name: &str) { self.l(""); self.l(format!("[{name}]")); }
    /// A piece of the bound picture at (x, y), `w` by `h`, taken from (u, v).
    fn quad(&mut self, x: impl AsRef<str>, y: impl AsRef<str>, w: impl AsRef<str>, h: impl AsRef<str>, u: impl AsRef<str>, v: impl AsRef<str>) {
        self.l(format!("$qx = {}", x.as_ref()));
        self.l(format!("$qy = {}", y.as_ref()));
        self.l(format!("$qw = {}", w.as_ref()));
        self.l(format!("$qh = {}", h.as_ref()));
        self.l(format!("$qu = {}", u.as_ref()));
        self.l(format!("$qv = {}", v.as_ref()));
        self.l("$qflat = 0");
        self.l("$qa = 1");
        self.l("run = CustomShaderMenuQuad");
    }
    /// A rectangle of one colour at (x, y), `w` by `h`, with `a` cover.
    fn flat(&mut self, x: impl AsRef<str>, y: impl AsRef<str>, w: impl AsRef<str>, h: impl AsRef<str>, rgb: Rgb, a: f32) {
        self.l(format!("$qx = {}", x.as_ref()));
        self.l(format!("$qy = {}", y.as_ref()));
        self.l(format!("$qw = {}", w.as_ref()));
        self.l(format!("$qh = {}", h.as_ref()));
        self.l("$qflat = 1");
        self.l(format!("$qa = {a:.3}"));
        for (v, c) in ["qr", "qg", "qb"].iter().zip(rgb) { self.l(format!("${v} = {:.3}", c as f32 / 255.0)); }
        self.l("run = CustomShaderMenuQuad");
    }
}

const VARS: &[&str] = &["char", "here", "fv", "sel", "top", "rows", "vis", "act", "zone", "hover", "lx", "ly", "mx", "my", "ww", "wh",
    "k", "y0", "cx", "th", "ty", "qx", "qy", "qw", "qh", "qu", "qv", "qflat", "qa", "qr", "qg", "qb", "seen", "at", "who"];
/// The IniParams the shader reads. Other mods may use them too, so the menu puts back what was there.
const SLOTS: [u32; 4] = [86, 87, 88, 89];
const XYZW: [char; 4] = ['x', 'y', 'z', 'w'];
/// Frames a character's flag has to keep its new value before `$o<group>` follows it: about half a second at 60 fps.
pub(crate) const HOLD: u32 = 30;

/// The lines for live.ini's [Constants]. `$open`, the on-screen flags and `$o<group>` are always there: the gated mod
/// inis read them, and the app reads `$o<group>` from the saved values, whether the menu is on or not. `key_list`:
/// the key list's own variables too.
pub(crate) fn constants(pages: &[IniPage], on: bool, key_list: bool) -> String {
    let mut o = Out::default();
    o.l("global $open = 0");
    for p in pages {
        o.l(format!("global $s{} = 0", p.n));
        o.l(format!("global persist $o{} = 0", p.n));
        o.l(format!("global $h{} = 0", p.n));
    }
    if on {
        for v in VARS { o.l(format!("global ${v} = 0")); }
        if pages.len() > 1 {
            // who was on screen as the menu opened, and each character's place on the list of characters
            for p in pages {
                o.l(format!("global $m{} = 0", p.n));
                o.l(format!("global $p{} = 0", p.n));
            }
        }
        for i in 0..16 { o.l(format!("global $b{i} = 0")); }
        if key_list {
            for v in ["keys", "kx", "ky"] { o.l(format!("global ${v} = 0")); }
        }
    }
    o.0
}

/// The menu's sections for live.ini. With `keys` None the menu is off: only the lists the gated mods call remain.
///
/// Pages 0 to n-1 are the characters, in the order given, each with its skins. With two or more characters, page n
/// lists the characters themselves: left goes there from a character, and showing a row there opens that character.
///
/// `key_list`: the key list the game draws in its top right corner, which rides on the menu's window size and shader.
pub(crate) fn sections(pages: &[IniPage], l: &Layout, keys: Option<&Keys>, key_list: Option<&KeyListIni>) -> String {
    let mut o = Out::default();
    o.l("");
    o.l("; a gated skin runs one of these when it is drawn, so the menu knows which character is on screen");
    for p in pages {
        o.section(&format!("CommandListSeen{}", p.n));
        o.l(format!("$s{} = 1", p.n));
    }
    // the key list rides on the menu
    let key_list = key_list.filter(|k| keys.is_some() && !k.sheets.is_empty());
    o.section("Present");
    if key_list.is_some() {
        // the on-screen flags are still set here: `post` clears them after the frame
        o.l("if $keys == 1");
        o.l("  run = CommandListKeysFrame");
        o.l("endif");
    }
    if keys.is_some() {
        for (k, p) in pages.iter().enumerate() {
            o.l(format!("if $s{} == 1", p.n));
            o.l(format!("  $here = {k}"));
            o.l("endif");
        }
    }
    o.l("run = CommandListOnScreen");
    for p in pages { o.l(format!("post $s{} = 0", p.n)); }
    if keys.is_some() {
        o.l("if $open == 1");
        o.l("  run = CommandListMenuFrame");
        o.l("endif");
    }

    o.section("CommandListOnScreen");
    o.l(format!("; o<group> says the character is on screen. It follows the frame's flag once that has kept its new value for {HOLD}"));
    o.l("; frames in a row, so a character who flickers out of view doesn't change it: it is saved, and every change makes");
    o.l("; the game write its saved values again");
    for p in pages {
        let n = p.n;
        o.l(format!("if $s{n} == $o{n}"));
        o.l(format!("  $h{n} = 0"));
        o.l("else");
        o.l(format!("  $h{n} = $h{n} + 1"));
        o.l(format!("  if $h{n} >= {HOLD}"));
        o.l(format!("    $o{n} = $s{n}"));
        o.l(format!("    $h{n} = 0"));
        o.l("  endif");
        o.l("endif");
    }
    let Some(keys) = keys else { return o.0 };
    let many = pages.len() > 1;
    let list = pages.len();
    let (w, head, row, foot, arw, x0, vis) = (l.w, l.head, l.row, l.foot, l.arw, l.x0, l.vis);
    let right = x0 + w;

    o.l("");
    o.l("; ── the menu the game draws ──");
    o.section("CommandListMenuFrame");
    o.l("run = CommandListMenuWindow");
    o.l("if $ww > 0 && $wh > 0");
    o.l("  run = CommandListMenuLoad");
    o.l("  run = CommandListMenuPointer");
    o.l("  run = CommandListMenuDraw");
    o.l("endif");

    o.section("CommandListMenuWindow");
    o.l("if window_width >= 640");
    o.l("  $ww = window_width");
    o.l("  $wh = window_height");
    o.l("else if rt_width >= 640");
    o.l("  $ww = rt_width");
    o.l("  $wh = rt_height");
    o.l("else if res_width >= 640");
    o.l("  $ww = res_width");
    o.l("  $wh = res_height");
    o.l("else");
    o.l("  $ww = 0");
    o.l("  $wh = 0");
    o.l("endif");

    o.section("CommandListMenuLoad");
    o.l("; how many rows the page has, which one has the check, and which footer goes under it");
    o.l("$fv = 0");
    for (k, p) in pages.iter().enumerate() {
        o.l(format!("if $char == {k}"));
        o.l(format!("  $rows = {}", p.slots.len() + 1));
        o.l("  $act = 0");
        for (i, slot) in p.slots.iter().enumerate() {
            o.l(format!("  if $g{} == {slot}", p.n));
            o.l(format!("    $act = {}", i + 1));
            o.l("  endif");
        }
        o.l("endif");
    }
    if many {
        o.l("; the list of characters: the check is on the one seen last, or with characters on screen as it opened, on");
        o.l("; each of them (the first $seen rows), and the menu starts on the first");
        o.l(format!("if $char == {list}"));
        o.l(format!("  $rows = {list}"));
        o.l("  $act = $here");
        o.l("  if $seen > 0");
        o.l("    $act = 0");
        o.l("  endif");
        o.l(format!("  $fv = {}", 2 * foot));
        o.l("endif");
    }
    o.l("$vis = $rows");
    o.l(format!("if $vis > {vis}"));
    o.l(format!("  $vis = {vis}"));
    o.l("endif");
    o.l("; where the check goes: the rows make room for the scroll bar on a list longer than the menu");
    o.l(format!("$cx = {}", x0 + l.chk_x));
    o.l("if $rows > $vis");
    o.l(format!("  $cx = {}", x0 + l.chk_x - l.room));
    o.l("endif");

    o.section("CommandListMenuScroll");
    o.l("; keep the picked row in view");
    o.l("if $sel < $top");
    o.l("  $top = $sel");
    o.l("endif");
    o.l("if $sel > $top + $vis - 1");
    o.l("  $top = $sel - $vis + 1");
    o.l("endif");
    o.l("if $top > $rows - $vis");
    o.l("  $top = $rows - $vis");
    o.l("endif");
    o.l("if $top < 0");
    o.l("  $top = 0");
    o.l("endif");

    o.section("CommandListMenuPointer");
    o.l("; where the menu sits, and what the mouse is over: 1 a row, 2 a character's header (back to the list), 4 and 5 the");
    o.l("; arrows on the list's top and bottom edges, 6 and 7 the scroll bar's track above and below its thumb");
    o.l(format!("$k = $wh / {}", l.gen_h));
    o.l(format!("$y0 = ({} - $vis * {row}) / 2", l.gen_h - head - foot));
    let (track, bar_top) = (l.track(), head + l.bar_in);
    o.l("; the scroll bar's thumb: as long as the share of rows in view, as far down as the list is scrolled");
    o.l("if $rows > $vis");
    o.l(format!("  $th = {} / $rows", track * vis));
    o.l(format!("  if $th < {}", l.thumb_min()));
    o.l(format!("    $th = {}", l.thumb_min()));
    o.l("  endif");
    o.l(format!("  $ty = $y0 + {bar_top} + ({track} - $th) * $top / ($rows - $vis)"));
    o.l("endif");
    o.l("$mx = cursor_x * $ww / $k");
    o.l(format!("$my = cursor_y * {}", l.gen_h));
    o.l("$zone = 0");
    o.l("$hover = 0");
    o.l(format!("if $mx >= {x0} && $mx < {right}"));
    if many {
        o.l(format!("  if $my >= $y0 && $my < $y0 + {head}"));
        o.l(format!("    if $char < {list}"));
        o.l("      $zone = 2");
        o.l("    endif");
        o.l("  endif");
    }
    o.l(format!("  if $my >= $y0 + {head} && $my < $y0 + {head} + $vis * {row}"));
    o.l("    $zone = 1");
    o.l("    $hover = $top");
    for r in 1..vis {
        o.l(format!("    if $my >= $y0 + {}", head + r * row));
        o.l(format!("      $hover = $top + {r}"));
        o.l("    endif");
    }
    o.l("  endif");
    o.l("  if $rows > $vis");
    o.l(format!("    if $mx >= {} && $my >= $y0 + {head} && $my < $y0 + {head} + $vis * {row}", x0 + l.bar_x - l.s(4)));
    o.l("      $zone = 0");
    o.l("      if $my < $ty");
    o.l("        $zone = 6");
    o.l("      endif");
    o.l("      if $my >= $ty + $th");
    o.l("        $zone = 7");
    o.l("      endif");
    o.l("    endif");
    let ((up_y, down_y), ax) = (l.arrow_y(), x0 + l.arrow_x());
    o.l(format!("    if $mx >= {ax} && $mx < {}", ax + arw));
    o.l("      if $top > 0");
    o.l(format!("        if $my >= $y0 + {up_y} && $my < $y0 + {}", up_y + l.arh));
    o.l("          $zone = 4");
    o.l("        endif");
    o.l("      endif");
    o.l("      if $top + $vis < $rows");
    o.l(format!("        if $my >= $y0 + {down_y} + $vis * {row} && $my < $y0 + {} + $vis * {row}", down_y + l.arh));
    o.l("          $zone = 5");
    o.l("        endif");
    o.l("      endif");
    o.l("    endif");
    o.l("  endif");
    o.l("endif");
    o.l("; the mouse picks a row only when it moved, so it doesn't fight the keys");
    o.l("if cursor_x != $lx || cursor_y != $ly");
    o.l("  $lx = cursor_x");
    o.l("  $ly = cursor_y");
    o.l("  if $zone == 1");
    o.l("    $sel = $hover");
    o.l("  endif");
    o.l("endif");

    o.section("CommandListMenuDraw");
    for (i, s) in SLOTS.iter().enumerate() {
        for (j, c) in XYZW.iter().enumerate() { o.l(format!("$b{} = {c}{s}", i * 4 + j)); }
    }
    for (k, p) in pages.iter().enumerate() {
        o.l(format!("if $char == {k}"));
        o.l(format!("  ps-t100 = ResourceMenuPage{}", p.n));
        o.l("endif");
    }
    if many {
        o.l(format!("if $char == {list}"));
        o.l("  ps-t100 = ResourceMenuList");
        o.l("endif");
    }
    o.l("; the rows in view, then the header over them");
    if many {
        o.l("; the list with characters on screen first: a row at a time, each from its character's row in the picture");
        o.l(format!("if $char == {list} && $seen > 0"));
        for r in 0..vis {
            o.l(format!("if $vis > {r}"));
            o.l(format!("$at = $top + {r}"));
            o.l("run = CommandListMenuWho");
            o.quad(x0.to_string(), format!("$y0 + {}", head + r * row), w.to_string(), row.to_string(), "0", format!("{head} + $who * {row}"));
            o.l("endif");
        }
        o.l("else");
    }
    o.quad(x0.to_string(), format!("$y0 + {head}"), w.to_string(), format!("$vis * {row}"), "0", format!("{head} + $top * {row}"));
    if many { o.l("endif"); }
    o.quad(x0.to_string(), "$y0", w.to_string(), head.to_string(), "0", "0");
    if many {
        o.l("; the back button under the mouse, from the picture's right half");
        o.l("if $zone == 2");
        o.quad(x0.to_string(), "$y0", w.to_string(), head.to_string(), w.to_string(), "0");
        o.l("endif");
    }
    o.l("; the row the keys are on: the picture's right half has each row as the picked one");
    o.l("if $sel >= $top && $sel < $top + $vis");
    if many {
        o.l("$at = $sel");
        o.l("run = CommandListMenuWho");
    }
    let pick = if many { "$who" } else { "$sel" };
    o.quad(x0.to_string(), format!("$y0 + {head} + ($sel - $top) * {row}"), w.to_string(), row.to_string(), w.to_string(), format!("{head} + {pick} * {row}"));
    o.l("endif");
    o.l("ps-t100 = ResourceMenuChrome");
    o.quad(x0.to_string(), format!("$y0 + {head} + $vis * {row}"), w.to_string(), foot.to_string(), "0", "$fv");
    if l.round > 0 {
        o.l("; the list's round corners, over the first and the last row in view");
        o.quad(x0.to_string(), format!("$y0 + {}", head - l.gut), w.to_string(), l.round.to_string(), "0", (3 * foot).to_string());
        o.quad(x0.to_string(), format!("$y0 + {} + $vis * {row}", head + l.gut - l.round), w.to_string(), l.round.to_string(), "0", (3 * foot + l.round).to_string());
    }
    o.l("; a check on the skin that is showing, in the picked row's colours when the keys are on it");
    let cy = format!("$y0 + {} + ($act - $top) * {row}", head + (row - l.chk) / 2);
    if many { o.l(format!("if $char < {list} || $seen == 0")); }
    o.l("if $act >= $top && $act < $top + $vis");
    o.l("if $act == $sel");
    o.quad("$cx", &cy, l.chk.to_string(), l.chk.to_string(), l.chk_u(true).to_string(), foot.to_string());
    o.l("else");
    o.quad("$cx", &cy, l.chk.to_string(), l.chk.to_string(), l.chk_u(false).to_string(), foot.to_string());
    o.l("endif");
    o.l("endif");
    if many {
        o.l("endif");
        o.l("; on the list, a check on each character on screen as the menu opened: the first $seen rows");
        o.l(format!("if $char == {list} && $seen > 0"));
        for r in 0..vis {
            let cy = format!("$y0 + {}", head + (row - l.chk) / 2 + r * row);
            o.l(format!("if $vis > {r} && $top + {r} < $seen"));
            o.l(format!("if $top + {r} == $sel"));
            o.quad("$cx", &cy, l.chk.to_string(), l.chk.to_string(), l.chk_u(true).to_string(), foot.to_string());
            o.l("else");
            o.quad("$cx", &cy, l.chk.to_string(), l.chk.to_string(), l.chk_u(false).to_string(), foot.to_string());
            o.l("endif");
            o.l("endif");
        }
        o.l("endif");
    }
    o.l("; the scroll bar along the list's right side, when the list is longer than the menu");
    o.l("if $rows > $vis");
    let ((track_rgb, track_a), (thumb_rgb, thumb_a)) = l.look.bar();
    let (bx, bw, ch) = ((x0 + l.bar_x).to_string(), l.bar_w.to_string(), l.cap_h());
    if ch > 0 {
        // round ends from menu.dds, flat between them
        let (chs, fv) = (ch.to_string(), foot.to_string());
        o.quad(&bx, format!("$y0 + {bar_top}"), &bw, &chs, l.cap_u(false, false).to_string(), &fv);
        o.flat(&bx, format!("$y0 + {}", bar_top + ch), &bw, (track - 2 * ch).to_string(), track_rgb, track_a);
        o.quad(&bx, format!("$y0 + {}", bar_top + track - ch), &bw, &chs, l.cap_u(false, true).to_string(), &fv);
        o.quad(&bx, "$ty", &bw, &chs, l.cap_u(true, false).to_string(), &fv);
        o.flat(&bx, format!("$ty + {ch}"), &bw, format!("$th - {}", 2 * ch), thumb_rgb, thumb_a);
        o.quad(&bx, format!("$ty + $th - {ch}"), &bw, &chs, l.cap_u(true, true).to_string(), &fv);
    } else {
        o.flat(&bx, format!("$y0 + {bar_top}"), &bw, track.to_string(), track_rgb, track_a);
        o.flat(&bx, "$ty", &bw, "$th", thumb_rgb, thumb_a);
    }
    o.l("endif");
    o.l("; an arrow on the list's top edge when rows are above it, one on its bottom edge when rows are below, lit under the mouse");
    let ((up_y, down_y), ax) = (l.arrow_y(), (x0 + l.arrow_x()).to_string());
    for (down, zone, cond, ay) in [(false, 4, "$top > 0", format!("$y0 + {up_y}")), (true, 5, "$top + $vis < $rows", format!("$y0 + {down_y} + $vis * {row}"))] {
        o.l(format!("if {cond}"));
        o.quad(&ax, &ay, arw.to_string(), l.arh.to_string(), l.arrow_u(down, false).to_string(), foot.to_string());
        o.l(format!("if $zone == {zone}"));
        o.quad(&ax, &ay, arw.to_string(), l.arh.to_string(), l.arrow_u(down, true).to_string(), foot.to_string());
        o.l("endif");
        o.l("endif");
    }
    o.l("ps-t100 = null");
    for (i, s) in SLOTS.iter().enumerate() {
        for (j, c) in XYZW.iter().enumerate() { o.l(format!("{c}{s} = $b{}", i * 4 + j)); }
    }

    o.section("CustomShaderMenuQuad");
    o.l("vs = menu.hlsl");
    o.l("ps = menu.hlsl");
    o.l("hs = null");
    o.l("ds = null");
    o.l("gs = null");
    o.l("blend = add src_alpha inv_src_alpha");
    o.l("cull = none");
    o.l("topology = triangle_strip");
    o.l("run = BuiltInCommandListUnbindAllRenderTargets");
    o.l("o0 = set_viewport no_view_cache bb");
    o.l("x86 = $qx");
    o.l("y86 = $qy");
    o.l("z86 = $qw");
    o.l("w86 = $qh");
    o.l("x87 = $qu");
    o.l("y87 = $qv");
    o.l("z87 = $qflat");
    o.l("w87 = $qa");
    o.l("x88 = $ww");
    o.l("y88 = $wh");
    o.l("z88 = $k");
    o.l("x89 = $qr");
    o.l("y89 = $qg");
    o.l("z89 = $qb");
    o.l("w89 = 1");
    o.l("draw = 4, 0");

    for p in pages {
        o.section(&format!("ResourceMenuPage{}", p.n));
        o.l(format!("filename = menu{}.dds", p.n));
    }
    if many {
        o.section("ResourceMenuList");
        o.l("filename = menu0.dds");
    }
    o.section("ResourceMenuChrome");
    o.l("filename = menu.dds");

    o.section("CommandListMenuToggle");
    if many {
        o.l("; opening goes to the character on screen. With two or more on screen it goes to the list of characters, where");
        o.l("; they come first; with none, to the character seen last");
    } else {
        o.l("; opening goes to the character on screen");
    }
    o.l("$open = 1 - $open");
    o.l("if $open == 1");
    if many { o.l("  run = CommandListMenuFreeze"); }
    o.l("  $char = $here");
    if many {
        o.l("  if $seen == 1");
        for (k, p) in pages.iter().enumerate() {
            o.l(format!("    if $m{} == 1", p.n));
            o.l(format!("      $char = {k}"));
            o.l("    endif");
        }
        o.l("  endif");
        o.l("  if $seen > 1");
        o.l(format!("    $char = {list}"));
        o.l("  endif");
    }
    o.l("  run = CommandListMenuTurn");
    o.l("endif");

    if many {
        o.section("CommandListMenuFreeze");
        o.l("; who is on screen as the menu opens, kept until it opens again so the list's rows stay put: those characters");
        o.l("; take the list's first places in its usual order, then everyone else");
        o.l("$seen = 0");
        for p in pages {
            o.l(format!("$m{} = 0", p.n));
            o.l(format!("if $o{} == 1", p.n));
            o.l(format!("  $m{} = 1", p.n));
            o.l(format!("  $p{} = $seen", p.n));
            o.l("  $seen = $seen + 1");
            o.l("endif");
        }
        o.l("$at = $seen");
        for p in pages {
            o.l(format!("if $m{} == 0", p.n));
            o.l(format!("  $p{} = $at", p.n));
            o.l("  $at = $at + 1");
            o.l("endif");
        }

        o.section("CommandListMenuWho");
        o.l("; the page's row at place $at: on the list with characters on screen first, the character whose place it is");
        o.l("$who = $at");
        o.l(format!("if $char == {list} && $seen > 0"));
        for (k, p) in pages.iter().enumerate() {
            o.l(format!("  if $p{} == $at", p.n));
            o.l(format!("    $who = {k}"));
            o.l("  endif");
        }
        o.l("endif");
    }

    o.section("CommandListMenuTurn");
    o.l("; a page was opened: start on the row with the check");
    o.l("run = CommandListMenuLoad");
    o.l("$sel = $act");
    o.l("$top = 0");
    o.l("run = CommandListMenuScroll");

    o.section("CommandListMenuUp");
    o.l("$sel = $sel - 1");
    o.l("if $sel < 0");
    o.l("  $sel = $rows - 1");
    o.l("endif");
    o.l("run = CommandListMenuScroll");

    o.section("CommandListMenuDown");
    o.l("$sel = $sel + 1");
    o.l("if $sel > $rows - 1");
    o.l("  $sel = 0");
    o.l("endif");
    o.l("run = CommandListMenuScroll");

    if many {
        o.section("CommandListMenuList");
        o.l("; from a character back to the list of characters, on the one that was open");
        o.l(format!("if $char < {list}"));
        for (k, p) in pages.iter().enumerate() {
            o.l(format!("  if $char == {k}"));
            o.l(format!("    $sel = $p{}", p.n));
            o.l("  endif");
        }
        o.l(format!("  $char = {list}"));
        o.l("  run = CommandListMenuLoad");
        o.l("  $top = 0");
        o.l("  run = CommandListMenuScroll");
        o.l("endif");
    }

    o.section("CommandListMenuPageUp");
    o.l("$top = $top - $vis + 1");
    o.l("if $top < 0");
    o.l("  $top = 0");
    o.l("endif");
    o.l("if $sel > $top + $vis - 1");
    o.l("  $sel = $top + $vis - 1");
    o.l("endif");

    o.section("CommandListMenuPageDown");
    o.l("$top = $top + $vis - 1");
    o.l("if $top > $rows - $vis");
    o.l("  $top = $rows - $vis");
    o.l("endif");
    o.l("if $sel < $top");
    o.l("  $sel = $top");
    o.l("endif");

    o.section("CommandListMenuShow");
    let pad = if many { "  " } else { "" };
    if many {
        o.l("; on the list of characters a row opens that character");
        o.l(format!("if $char == {list}"));
        o.l("  $at = $sel");
        o.l("  run = CommandListMenuWho");
        o.l("  $char = $who");
        o.l("  run = CommandListMenuTurn");
        o.l("else");
    }
    o.l(format!("{pad}; show the row the keys are on: row 0 is none of them"));
    for (k, p) in pages.iter().enumerate() {
        o.l(format!("{pad}if $char == {k}"));
        o.l(format!("{pad}  if $sel == 0"));
        o.l(format!("{pad}    $g{} = 0", p.n));
        o.l(format!("{pad}  endif"));
        for (i, slot) in p.slots.iter().enumerate() {
            o.l(format!("{pad}  if $sel == {}", i + 1));
            o.l(format!("{pad}    $g{} = {slot}", p.n));
            o.l(format!("{pad}  endif"));
        }
        o.l(format!("{pad}endif"));
    }
    if many { o.l("endif"); }

    o.section("CommandListMenuClick");
    o.l("if $zone == 1");
    o.l("  $sel = $hover");
    o.l("  run = CommandListMenuShow");
    o.l("endif");
    if many {
        o.l("if $zone == 2");
        o.l("  run = CommandListMenuList");
        o.l("endif");
    }
    o.l("; the arrows and the scroll bar's track page up and down");
    for (zone, run) in [(4, "PageUp"), (5, "PageDown"), (6, "PageUp"), (7, "PageDown")] {
        o.l(format!("if $zone == {zone}"));
        o.l(format!("  run = CommandListMenu{run}"));
        o.l("endif");
    }

    // two keys to a section, the way a keyboard key and a controller button share one: more get a section of
    // their own (KeyMenuShow2)
    let mut key = |name: &str, binds: &[String], cond: &str, run: &str| {
        for (i, pair) in binds.chunks(2).enumerate() {
            o.section(&if i == 0 { name.to_string() } else { format!("{name}{}", i + 1) });
            if !cond.is_empty() { o.l(format!("condition = {cond}")); }
            for b in pair { o.l(format!("key = {b}")); }
            o.l(format!("run = {run}"));
        }
    };
    key("KeyMenuOpen", &keys.open, "", "CommandListMenuToggle");
    key("KeyMenuUp", &keys.up, "$open == 1", "CommandListMenuUp");
    key("KeyMenuDown", &keys.down, "$open == 1", "CommandListMenuDown");
    if many { key("KeyMenuList", &keys.back, "$open == 1", "CommandListMenuList"); }
    key("KeyMenuShow", &keys.show, "$open == 1", "CommandListMenuShow");
    key("KeyMenuClick", &["VK_LBUTTON".to_string()], "$open == 1 && $zone > 0", "CommandListMenuClick");
    key("KeyMenuClose", &keys.close, "$open == 1", "CommandListMenuToggle");
    if let Some(kl) = key_list { key_list_sections(&mut o, kl, l); }
    o.0
}

/// The key list's sections: a sheet per live skin with keys, drawn down the top right corner for each character on
/// screen whose skin it is, and a small picture saying there are none when no sheet was drawn.
fn key_list_sections(o: &mut Out, kl: &KeyListIni, l: &Layout) {
    let k = KeyLayout::of(l);
    o.l("");
    o.l("; ── the key list the game draws ──");
    o.section("CommandListKeysFrame");
    o.l("run = CommandListMenuWindow");
    o.l("if $ww > 0 && $wh > 0");
    o.l(format!("  $k = $wh / {}", l.gen_h));
    for (i, s) in SLOTS.iter().enumerate() {
        for (j, c) in XYZW.iter().enumerate() { o.l(format!("  $b{} = {c}{s}", i * 4 + j)); }
    }
    o.l(format!("  $kx = $ww / $k - {}", k.margin + k.w));
    o.l(format!("  $ky = {}", k.margin));
    for s in &kl.sheets {
        o.l(format!("  if $s{} == 1 && $g{} == {}", s.n, s.n, s.slot));
        o.l(format!("    ps-t100 = ResourceKeys{}_{}", s.n, s.slot));
        o.quad("$kx", "$ky", k.w.to_string(), s.h.to_string(), "0", "0");
        o.l(format!("    $ky = $ky + {}", s.h + k.gap));
        o.l("  endif");
    }
    o.l("  ; none of the characters on screen has a sheet");
    o.l(format!("  if $ky == {}", k.margin));
    o.l("    ps-t100 = ResourceKeysNone");
    o.quad("$kx", "$ky", k.w.to_string(), k.none_h().to_string(), "0", "0");
    o.l("  endif");
    o.l("  ps-t100 = null");
    for (i, s) in SLOTS.iter().enumerate() {
        for (j, c) in XYZW.iter().enumerate() { o.l(format!("  {c}{s} = $b{}", i * 4 + j)); }
    }
    o.l("endif");

    o.section("CommandListKeysToggle");
    o.l("$keys = 1 - $keys");

    for s in &kl.sheets {
        o.section(&format!("ResourceKeys{}_{}", s.n, s.slot));
        o.l(format!("filename = menuk{}_{}.dds", s.n, s.slot));
    }
    o.section("ResourceKeysNone");
    o.l("filename = menukeys.dds");

    if let Some(key) = &kl.key {
        o.section("KeyGachamodKeys");
        o.l(format!("key = {key}"));
        o.l("run = CommandListKeysToggle");
    }
    for (i, pair) in kl.menu.chunks(2).enumerate() {
        o.section(&if i == 0 { "KeyMenuKeys".to_string() } else { format!("KeyMenuKeys{}", i + 1) });
        o.l("condition = $open == 1");
        for b in pair { o.l(format!("key = {b}")); }
        o.l("run = CommandListKeysToggle");
    }
}

/// Key hints as a footer draws them: the keys of each hint on key caps, then the word for what they do.
pub(crate) type Hint = Vec<(Vec<String>, &'static str)>;

/// The keys the hints name, each as the player reads it ("F7", "W", "Pad A", an arrow key as its arrow). An empty
/// one has no key, and its hint is left out.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct HintKeys { pub up: String, pub down: String, pub show: String, pub back: String, pub close: String }

impl HintKeys {
    /// The keys a menu starts with, closed by `close` ("F7").
    #[cfg(test)]
    pub fn standard(close: &str) -> Self {
        HintKeys { up: "\u{2191}".into(), down: "\u{2193}".into(), show: "\u{2192}".into(), back: "\u{2190}".into(), close: close.into() }
    }
}

/// A binding as a key cap names it: "VK_UP" is an arrow, "ctrl VK_J" is "Ctrl+J", "XB_A" is "Pad A".
pub(crate) fn cap_name(binding: &str) -> String {
    match crate::ini::binding_label(binding).as_str() {
        "Up" => "\u{2191}".into(), "Down" => "\u{2193}".into(), "Left" => "\u{2190}".into(), "Right" => "\u{2192}".into(),
        other => other.to_string(),
    }
}

/// The hints under a character's skins and under the list of characters.
pub(crate) fn hints(k: &HintKeys, many: bool) -> (Hint, Hint) {
    let hint = |keys: &[&String], word: &'static str| {
        let caps: Vec<String> = keys.iter().filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
        (!caps.is_empty()).then_some((caps, word))
    };
    let back = if many { hint(&[&k.back], "characters") } else { None };
    let skins = [hint(&[&k.up, &k.down], "choose"), hint(&[&k.show], "show"), back, hint(&[&k.close], "close")];
    let list = [hint(&[&k.up, &k.down], "choose"), hint(&[&k.show], "open"), hint(&[&k.close], "close")];
    (skins.into_iter().flatten().collect(), list.into_iter().flatten().collect())
}

/// Draws one rectangle: a piece of the picture in t100, or a flat colour. No vertex buffer: the four corners come
/// from the vertex number.
pub(crate) const HLSL: &str = r#"// gachamod writes this file. It draws one rectangle of the skin menu: a piece of a picture, or a flat colour.
// IniParams 86: left, top, width and height in menu pixels
// IniParams 87: left and top of the piece in the picture, 1 for a flat colour, opacity
// IniParams 88: window width, window height, window pixels per menu pixel
// IniParams 89: the flat colour

Texture1D<float4> IniParams : register(t120);
Texture2D<float4> Picture : register(t100);

struct Corner {
	float4 pos : SV_Position0;
	float2 at : TEXCOORD0;
};

#ifdef VERTEX_SHADER
void main(uint id : SV_VertexID, out Corner o)
{
	float4 rect = IniParams.Load(int2(86, 0));
	float4 view = IniParams.Load(int2(88, 0));
	float2 corner = float2(id % 2, id / 2);
	// whole window pixels, so a picture drawn at its own size stays sharp
	float2 a = floor(rect.xy * view.z + 0.5);
	float2 b = floor((rect.xy + rect.zw) * view.z + 0.5);
	float2 p = lerp(a, b, corner);
	o.pos = float4(p.x / view.x * 2 - 1, 1 - p.y / view.y * 2, 0, 1);
	o.at = corner * rect.zw;
}
#endif

#ifdef PIXEL_SHADER
void main(Corner i, out float4 o0 : SV_Target0)
{
	float4 rect = IniParams.Load(int2(86, 0));
	float4 src = IniParams.Load(int2(87, 0));
	float4 c = IniParams.Load(int2(89, 0));
	if (src.z < 0.5) {
		// blend the four nearest pixels of the piece, so it stays smooth at any window size
		float2 t = i.at - 0.5;
		float2 f = frac(t);
		int2 lo = int2(src.xy);
		int2 hi = lo + int2(rect.zw) - 1;
		int2 p = lo + int2(floor(t));
		float4 c00 = Picture.Load(int3(clamp(p, lo, hi), 0));
		float4 c10 = Picture.Load(int3(clamp(p + int2(1, 0), lo, hi), 0));
		float4 c01 = Picture.Load(int3(clamp(p + int2(0, 1), lo, hi), 0));
		float4 c11 = Picture.Load(int3(clamp(p + int2(1, 1), lo, hi), 0));
		c = lerp(lerp(c00, c10, f.x), lerp(c01, c11, f.x), f.y);
	}
	c.a *= src.w;
	o0 = c;
}
#endif
"#;

// ── the pictures ──

/// One character's page with what its picture shows.
pub(crate) struct Page { pub n: u32, pub character: String, pub rows: Vec<Row> }
pub(crate) struct Row { pub name: String, pub preview: Option<String> }

type Rgb = [u8; 3];

const fn hex(v: u32) -> Rgb { [(v >> 16) as u8, (v >> 8) as u8, v as u8] }
const WHITE: Rgb = hex(0xffffff);

/// The colours of each look. The game themes in src/styles/themes use the same ones.
mod plain {
    use super::{hex, Rgb};
    pub const BG: Rgb = hex(0x13161d);
    pub const BAND: Rgb = hex(0x1a1e27);
    pub const LINE: Rgb = hex(0x262b38);
    pub const PICK: Rgb = hex(0x282d3b);
    pub const KEY: Rgb = hex(0x2d3344);
    pub const TEXT: Rgb = hex(0xeef0f5);
    pub const DIM: Rgb = hex(0xb3bbc9);
    pub const ACCENT: Rgb = hex(0x8b7cff);
}
mod zzz {
    use super::{hex, Rgb};
    pub const INK: Rgb = hex(0x090909);
    pub const FRAME: Rgb = hex(0x262626);
    pub const FRAME_HI: Rgb = hex(0x313131);
    pub const WELL: Rgb = hex(0x0b0b0b);
    pub const RIM: Rgb = hex(0x4c4c4c);
    pub const CARD_HI: Rgb = hex(0x2a2a2a);
    pub const CARD_LO: Rgb = hex(0x1c1c1c);
    pub const RING: Rgb = hex(0x3a3a3a);
    pub const HOLE: Rgb = hex(0x161616);
    pub const ORANGE: Rgb = hex(0xff7a1c);
    pub const TEXT: Rgb = hex(0xf1f1f1);
    pub const TEXT2: Rgb = hex(0xc6c6c6);
    pub const TEXT3: Rgb = hex(0x8f8f8f);
}
mod gi {
    use super::{hex, Rgb};
    pub const NAVY: Rgb = hex(0x222b39);
    pub const NAVY_HI: Rgb = hex(0x2c3749);
    pub const NAVY_LO: Rgb = hex(0x1c2430);
    pub const CREAM: Rgb = hex(0xece5d8);
    pub const GOLD: Rgb = hex(0xd3bc8e);
    pub const INK: Rgb = hex(0x3b4255);
    pub const CAP: Rgb = hex(0x2c2f38);
    pub const HOLE: Rgb = hex(0x1a212c);
    pub const DIM: Rgb = hex(0x9a9488);
    pub const WORDS: Rgb = hex(0xc9c2b4);
}
mod hsr {
    use super::{hex, Rgb};
    pub const GLASS: Rgb = hex(0x12162a);
    pub const GLASS_HI: Rgb = hex(0x1c2139);
    pub const BAR_HI: Rgb = hex(0x1e2236);
    pub const BAR_LO: Rgb = hex(0x171a2b);
    pub const PLATE_HI: Rgb = hex(0xeceef0);
    pub const PLATE_LO: Rgb = hex(0xd5d7db);
    pub const PILL: Rgb = hex(0xe2e2e2);
    pub const LINE_IN: Rgb = hex(0xb9b8ba);
    pub const INK: Rgb = hex(0x111113);
    pub const GOLD: Rgb = hex(0xe0be78);
    pub const ORANGE: Rgb = hex(0xf29a2e);
    pub const HOLE: Rgb = hex(0x232842);
    pub const TEXT2: Rgb = hex(0xc9ccd6);
    pub const TEXT3: Rgb = hex(0x8e93a3);
}
mod ww {
    use super::{hex, Rgb};
    pub const INK: Rgb = hex(0x07080d);
    pub const SHEET: Rgb = hex(0xf1efeb);
    pub const TEXT: Rgb = hex(0xebe6e2);
    pub const DIM: Rgb = hex(0x8d8d8d);
    pub const WORDS: Rgb = hex(0xb8b8b8);
    pub const GOLD: Rgb = hex(0xfdd02c);
    pub const GOLD_LINE: Rgb = hex(0xceb99c);
    pub const GOLD_DK: Rgb = hex(0x8a6a12);
    pub const DARK: Rgb = hex(0x101113);
    pub const HOLE: Rgb = hex(0x15171d);
}
mod hi3 {
    use super::{hex, Rgb};
    pub const DEEP: Rgb = hex(0x0b1628);
    pub const DEEP_HI: Rgb = hex(0x112340);
    pub const DEEP_LO: Rgb = hex(0x081120);
    pub const CYAN: Rgb = hex(0x45c6ff);
    pub const CYAN_HI: Rgb = hex(0x3fd0ff);
    pub const BLUE: Rgb = hex(0x1f6fd8);
    pub const YELLOW: Rgb = hex(0xffd200);
    pub const NAVY: Rgb = hex(0x0b1f3a);
    pub const SHADE: Rgb = hex(0x0b3a73);
    pub const HOLE: Rgb = hex(0x0f2038);
    pub const TEXT: Rgb = hex(0xe6f2ff);
    pub const DIM: Rgb = hex(0x7f93ab);
    pub const WORDS: Rgb = hex(0x9fb6cf);
}
mod ef {
    use super::{hex, Rgb};
    pub const STAGE: Rgb = hex(0x1b1b1b);
    pub const PLATE: Rgb = hex(0x333333);
    pub const EDGE: Rgb = hex(0x2e2e2e);
    pub const SHEET: Rgb = hex(0xe3e2e2);
    pub const PAPER: Rgb = hex(0xffffff);
    pub const INK: Rgb = hex(0x1c1c1c);
    pub const YELLOW: Rgb = hex(0xffee00);
    pub const GREY: Rgb = hex(0x6f6f6f);
    pub const LIGHT: Rgb = hex(0xc4c4c4);
    pub const TICK: Rgb = hex(0x5a5a5a);
    pub const CROSS: Rgb = hex(0x7a7a7a);
}

/// A Windows font: a face name, a size in pixels, a weight, italic, and extra space between letters.
#[derive(Clone, Copy)]
struct Font { face: &'static str, size: u32, weight: u32, italic: bool, track: i32 }

impl Look {
    /// The header's font, `size` pixels high.
    fn title_font(self, size: u32) -> Font {
        let (face, weight, italic, track) = match self {
            Look::Zzz => ("Bahnschrift Condensed", 700, true, 0),
            Look::Genshin => ("Segoe UI", 600, false, 1),
            Look::StarRail => ("Bahnschrift SemiBold", 400, false, 0),
            Look::Wuwa => ("Segoe UI", 600, false, 2),
            Look::Hi3 => ("Bahnschrift SemiCondensed", 700, false, 1),
            Look::Endfield => ("Segoe UI", 700, false, 0),
            Look::Plain => ("Segoe UI", 600, false, 0),
        };
        Font { face, size, weight, italic, track }
    }
    /// A row's font; `pick`: on the picked row.
    fn row_font(self, size: u32, pick: bool) -> Font {
        let (face, weight, italic) = match (self, pick) {
            (Look::Zzz, _) => ("Bahnschrift SemiCondensed", 700, true),
            (Look::StarRail, false) => ("Bahnschrift", 400, false),
            (Look::StarRail, true) => ("Bahnschrift SemiBold", 400, false),
            (Look::Hi3, false) => ("Bahnschrift SemiCondensed", 400, false),
            (Look::Hi3, true) => ("Bahnschrift SemiCondensed", 700, false),
            (_, false) => ("Segoe UI", 400, false),
            (_, true) => ("Segoe UI", 600, false),
        };
        Font { face, size, weight, italic, track: 0 }
    }
    /// The words of the key hints.
    fn hint_font(self, size: u32) -> Font {
        let (face, weight, italic) = match self {
            Look::Zzz => ("Bahnschrift SemiCondensed", 700, true),
            Look::StarRail => ("Bahnschrift", 400, false),
            Look::Hi3 => ("Bahnschrift SemiCondensed", 400, false),
            _ => ("Segoe UI", 400, false),
        };
        Font { face, size, weight, italic, track: 0 }
    }
    /// The letters on a key cap.
    fn cap_font(self, size: u32) -> Font {
        let (face, weight) = match self {
            Look::Zzz | Look::Hi3 => ("Bahnschrift SemiCondensed", 700),
            Look::StarRail => ("Bahnschrift SemiBold", 400),
            _ => ("Segoe UI", 700),
        };
        Font { face, size, weight, italic: false, track: 0 }
    }
    /// Sizes at 1080 of the header, a row and the hints.
    fn title_size(self) -> u32 {
        match self { Look::Zzz => 32, Look::Genshin => 23, Look::StarRail => 25, Look::Hi3 => 26, _ => 21 }
    }
    fn row_size(self) -> u32 {
        match self { Look::Zzz | Look::Hi3 => 19, Look::StarRail => 18, _ => 17 }
    }
    fn hint_size(self) -> u32 {
        match self { Look::Zzz => 15, Look::StarRail | Look::Hi3 => 14, _ => 13 }
    }
    /// Headers in capitals.
    fn caps(self) -> bool { matches!(self, Look::Zzz | Look::Hi3) }
    /// Text on a row, dim text ("None", notes), text on the picked row, the header's text and the hints' words.
    fn text(self) -> Rgb {
        match self {
            Look::Plain => plain::TEXT, Look::Zzz => zzz::TEXT, Look::Genshin => gi::CREAM, Look::StarRail => WHITE,
            Look::Wuwa => ww::TEXT, Look::Hi3 => hi3::TEXT, Look::Endfield => ef::INK,
        }
    }
    fn dim(self) -> Rgb {
        match self {
            Look::Plain => plain::DIM, Look::Zzz => zzz::TEXT3, Look::Genshin => gi::DIM, Look::StarRail => hsr::TEXT3,
            Look::Wuwa => ww::DIM, Look::Hi3 => hi3::DIM, Look::Endfield => ef::GREY,
        }
    }
    fn pick_text(self) -> Rgb {
        match self {
            Look::Plain => plain::TEXT, Look::Zzz => zzz::INK, Look::Genshin => gi::INK, Look::StarRail => hsr::INK,
            Look::Wuwa => ww::DARK, Look::Hi3 => WHITE, Look::Endfield => ef::INK,
        }
    }
    fn head_text(self) -> Rgb {
        match self { Look::Plain => plain::TEXT, Look::Zzz => zzz::TEXT, Look::Genshin => gi::CREAM, _ => WHITE }
    }
    fn words(self) -> Rgb {
        match self {
            Look::Plain => plain::DIM, Look::Zzz => zzz::TEXT2, Look::Genshin => gi::WORDS, Look::StarRail => hsr::TEXT2,
            Look::Wuwa => ww::WORDS, Look::Hi3 => hi3::WORDS, Look::Endfield => ef::LIGHT,
        }
    }
    /// The line between rows, and how much it covers.
    fn line(self) -> (Rgb, f32) {
        match self {
            Look::Plain => (plain::LINE, 1.0), Look::Zzz => (zzz::RING, 1.0), Look::Genshin => (gi::GOLD, 0.14),
            Look::StarRail => (WHITE, 0.1), Look::Wuwa => (WHITE, 0.08), Look::Hi3 => (hi3::CYAN, 0.1), Look::Endfield => (ef::INK, 0.12),
        }
    }
    /// The scroll bar's track and thumb, each a colour and how much it covers.
    fn bar(self) -> ((Rgb, f32), (Rgb, f32)) {
        match self {
            Look::Plain => ((plain::LINE, 1.0), (plain::DIM, 1.0)),
            Look::Zzz => ((zzz::FRAME, 1.0), (zzz::ORANGE, 1.0)),
            Look::Genshin => ((gi::GOLD, 0.2), (gi::GOLD, 1.0)),
            Look::StarRail => ((WHITE, 0.14), (hsr::PILL, 1.0)),
            Look::Wuwa => ((WHITE, 0.12), (ww::GOLD_LINE, 1.0)),
            Look::Hi3 => ((hi3::CYAN, 0.18), (hi3::CYAN, 1.0)),
            Look::Endfield => ((ef::INK, 0.12), (ef::INK, 1.0)),
        }
    }
}

/// A shape inside a box, for fills, outlines and cutting pictures.
#[derive(Clone, Copy)]
enum Shape {
    Rect,
    Round(f32),
    /// Rounded corners: top left, top right, bottom right, bottom left.
    Corners([f32; 4]),
    /// Fully round ends (a circle in a square box).
    Pill,
    /// Corners cut off at 45 degrees, in the same order.
    Chamfer([f32; 4]),
    /// Leaning like /, its top edge moved right by this much.
    Slant(f32),
    Diamond,
}

impl Shape {
    /// Distance from (x, y) in a `w` by `h` box to the shape's edge: below 0 inside.
    fn sd(self, x: f32, y: f32, w: f32, h: f32) -> f32 {
        match self {
            Shape::Rect => rounded(x, y, w, h, [0.0; 4]),
            Shape::Round(r) => rounded(x, y, w, h, [r; 4]),
            Shape::Corners(r) => rounded(x, y, w, h, r),
            Shape::Pill => rounded(x, y, w, h, [w.min(h) / 2.0; 4]),
            Shape::Chamfer(c) => {
                let mut d = (-x).max(x - w).max(-y).max(y - h);
                for (cut, u) in [(c[0], x + y), (c[1], w - x + y), (c[2], w - x + h - y), (c[3], x + h - y)] {
                    if cut > 0.0 { d = d.max((cut - u) * FRAC_1_SQRT_2); }
                }
                d
            }
            Shape::Slant(f) => {
                let n = h / (h * h + f * f).sqrt();
                let left = (f - x - f * y / h) * n;
                let right = (x - w + f * y / h) * n;
                (-y).max(y - h).max(left).max(right)
            }
            Shape::Diamond => {
                let (cx, cy, a, b) = ((x - w / 2.0).abs(), (y - h / 2.0).abs(), w / 2.0, h / 2.0);
                (cx * b + cy * a - a * b) / (a * a + b * b).sqrt()
            }
        }
    }
}

fn rounded(x: f32, y: f32, w: f32, h: f32, r: [f32; 4]) -> f32 {
    let (cx, cy) = (x - w / 2.0, y - h / 2.0);
    let r = if cx < 0.0 { if cy < 0.0 { r[0] } else { r[3] } } else if cy < 0.0 { r[1] } else { r[2] };
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    let (qx, qy) = (cx.abs() - w / 2.0 + r, cy.abs() - h / 2.0 + r);
    qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - r
}

/// How a shape is filled: one colour, or blended top to bottom or left to right.
#[derive(Clone, Copy)]
enum Paint { Solid(Rgb), Down(Rgb, Rgb), Across(Rgb, Rgb) }

impl Paint {
    fn at(self, tx: f32, ty: f32) -> Rgb {
        let mix = |a: Rgb, b: Rgb, t: f32| {
            let t = t.clamp(0.0, 1.0);
            [0, 1, 2].map(|i| (a[i] as f32 + (b[i] as f32 - a[i] as f32) * t).round() as u8)
        };
        match self { Paint::Solid(c) => c, Paint::Down(a, b) => mix(a, b, ty), Paint::Across(a, b) => mix(a, b, tx) }
    }
}

#[derive(Clone, Copy)]
enum Dir { Left, Right, Up, Down }

#[derive(Clone, Copy, PartialEq)]
enum Align { Left, Center }

pub(crate) struct Canvas { pub w: u32, pub h: u32, pub px: Vec<u8>, clip: [i32; 4] }

impl Canvas {
    fn new(w: u32, h: u32, fill: [u8; 4]) -> Self {
        let mut px = Vec::with_capacity((w * h * 4) as usize);
        for _ in 0..w * h { px.extend_from_slice(&fill); }
        Canvas { w, h, px, clip: [0, 0, w as i32, h as i32] }
    }
    /// Draw only inside this box until `unclip`.
    fn clip(&mut self, x0: f32, y0: f32, x1: f32, y1: f32) {
        self.clip = [(x0.floor() as i32).max(0), (y0.floor() as i32).max(0), (x1.ceil() as i32).min(self.w as i32), (y1.ceil() as i32).min(self.h as i32)];
    }
    fn unclip(&mut self) { self.clip = [0, 0, self.w as i32, self.h as i32]; }
    fn fill(&mut self, x: u32, y: u32, w: u32, h: u32, c: [u8; 4]) {
        for yy in y..(y + h).min(self.h) {
            for xx in x..(x + w).min(self.w) {
                let i = ((yy * self.w + xx) * 4) as usize;
                self.px[i..i + 4].copy_from_slice(&c);
            }
        }
    }
    /// Set a box to a colour with `a` cover, replacing what was there.
    fn put(&mut self, x: f32, y: f32, w: f32, h: f32, rgb: Rgb, a: f32) {
        let (x0, y0) = (x.round().max(0.0) as u32, y.round().max(0.0) as u32);
        let (x1, y1) = ((x + w).round().max(0.0) as u32, (y + h).round().max(0.0) as u32);
        self.fill(x0, y0, x1.saturating_sub(x0), y1.saturating_sub(y0), [rgb[0], rgb[1], rgb[2], (a * 255.0).round() as u8]);
    }
    /// Lay a colour over a pixel with `cov` (0 to 1) of it covered.
    fn over(&mut self, x: i32, y: i32, rgb: Rgb, cov: f32) {
        if x < self.clip[0] || y < self.clip[1] || x >= self.clip[2] || y >= self.clip[3] || cov <= 0.0 { return; }
        let i = ((y as u32 * self.w + x as u32) * 4) as usize;
        let (sa, da) = (cov.min(1.0), self.px[i + 3] as f32 / 255.0);
        let oa = sa + da * (1.0 - sa);
        if oa <= 0.0 { return; }
        for c in 0..3 {
            let v = (rgb[c] as f32 * sa + self.px[i + c] as f32 * da * (1.0 - sa)) / oa;
            self.px[i + c] = v.round().clamp(0.0, 255.0) as u8;
        }
        self.px[i + 3] = (oa * 255.0).round() as u8;
    }
    /// Run `f` for each pixel of a box (inside the clip), with the pixel's centre relative to the box.
    fn each(&mut self, x: f32, y: f32, w: f32, h: f32, mut f: impl FnMut(&mut Self, i32, i32, f32, f32)) {
        let (x0, y0) = ((x.floor() as i32).max(self.clip[0]), (y.floor() as i32).max(self.clip[1]));
        let (x1, y1) = (((x + w).ceil() as i32).min(self.clip[2]), ((y + h).ceil() as i32).min(self.clip[3]));
        for py in y0..y1 {
            for px in x0..x1 { f(self, px, py, px as f32 + 0.5 - x, py as f32 + 0.5 - y); }
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn shape(&mut self, x: f32, y: f32, w: f32, h: f32, s: Shape, p: Paint, a: f32) {
        if w <= 0.0 || h <= 0.0 { return; }
        self.each(x, y, w, h, |c, px, py, lx, ly| {
            let cov = (0.5 - s.sd(lx, ly, w, h)).clamp(0.0, 1.0);
            if cov > 0.0 { c.over(px, py, p.at(lx / w, ly / h), cov * a); }
        });
    }
    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, rgb: Rgb, a: f32) { self.shape(x, y, w, h, Shape::Rect, Paint::Solid(rgb), a); }
    /// A line `t` thick just inside the edge of a shape.
    #[allow(clippy::too_many_arguments)]
    fn ring(&mut self, x: f32, y: f32, w: f32, h: f32, s: Shape, t: f32, rgb: Rgb, a: f32) {
        if w <= 0.0 || h <= 0.0 { return; }
        self.each(x, y, w, h, |c, px, py, lx, ly| {
            let d = s.sd(lx, ly, w, h);
            let cov = (0.5 - d).clamp(0.0, 1.0) - (0.5 - d - t).clamp(0.0, 1.0);
            if cov > 0.0 { c.over(px, py, rgb, cov * a); }
        });
    }
    /// A picture at (x, y), cut to a shape the size of the picture.
    fn picture(&mut self, x: f32, y: f32, img: &image::RgbaImage, s: Shape) {
        let (w, h) = (img.width() as f32, img.height() as f32);
        let (x, y) = (x.round() as i32, y.round() as i32);
        for (ix, iy, p) in img.enumerate_pixels() {
            let cov = (0.5 - s.sd(ix as f32 + 0.5, iy as f32 + 0.5, w, h)).clamp(0.0, 1.0);
            self.over(x + ix as i32, y + iy as i32, [p[0], p[1], p[2]], cov * p[3] as f32 / 255.0);
        }
    }
    /// A line through `pts`, `width` pixels thick, with smooth edges.
    fn stroke(&mut self, pts: &[(f32, f32)], width: f32, rgb: Rgb, a: f32) {
        let r = width / 2.0;
        let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for &(x, y) in pts { x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y); }
        let (bx, by) = (x0 - r - 1.0, y0 - r - 1.0);
        self.each(bx, by, x1 + r + 1.0 - bx, y1 + r + 1.0 - by, |c, px, py, _, _| {
            let (px_, py_) = (px as f32 + 0.5, py as f32 + 0.5);
            let mut d = f32::MAX;
            for s in pts.windows(2) {
                let ((ax, ay), (bx, by)) = (s[0], s[1]);
                let (vx, vy) = (bx - ax, by - ay);
                let len = vx * vx + vy * vy;
                let t = if len > 0.0 { (((px_ - ax) * vx + (py_ - ay) * vy) / len).clamp(0.0, 1.0) } else { 0.0 };
                let (cx, cy) = (ax + vx * t - px_, ay + vy * t - py_);
                d = d.min((cx * cx + cy * cy).sqrt());
            }
            c.over(px, py, rgb, (r + 0.5 - d).clamp(0.0, 1.0) * a);
        });
    }
    /// An open arrowhead pointing `dir`, `a` from its middle to its tips.
    fn chevron(&mut self, cx: f32, cy: f32, a: f32, dir: Dir, t: f32, rgb: Rgb) {
        let h = a / 2.0;
        let pts = match dir {
            Dir::Left => [(cx + h, cy - a), (cx - h, cy), (cx + h, cy + a)],
            Dir::Right => [(cx - h, cy - a), (cx + h, cy), (cx - h, cy + a)],
            Dir::Up => [(cx - a, cy + h), (cx, cy - h), (cx + a, cy + h)],
            Dir::Down => [(cx - a, cy - h), (cx, cy + h), (cx + a, cy - h)],
        };
        self.stroke(&pts, t, rgb, 1.0);
    }
    /// An arrow with a shaft, `a` from its middle to its tip, for the arrow keys.
    fn arrow(&mut self, cx: f32, cy: f32, a: f32, dir: Dir, t: f32, rgb: Rgb) {
        let (dx, dy) = match dir { Dir::Left => (-1.0, 0.0), Dir::Right => (1.0, 0.0), Dir::Up => (0.0, -1.0), Dir::Down => (0.0, 1.0) };
        let tip = (cx + dx * a, cy + dy * a);
        self.stroke(&[(cx - dx * a, cy - dy * a), tip], t, rgb, 1.0);
        let (bx, by, px, py) = (cx + dx * a * 0.3, cy + dy * a * 0.3, -dy * a * 0.6, dx * a * 0.6);
        self.stroke(&[(bx + px, by + py), tip, (bx - px, by - py)], t, rgb, 1.0);
    }
    /// A grid of dots `step` apart over a box, their radius going from `r0` at the left to `r1` at the right.
    #[allow(clippy::too_many_arguments)]
    fn dots(&mut self, x: f32, y: f32, w: f32, h: f32, step: f32, r0: f32, r1: f32, rgb: Rgb, a: f32) {
        let (nx, ny) = ((w / step).floor() as i32, (h / step).floor() as i32);
        for j in 0..ny {
            for i in 0..nx {
                let (cx, cy) = (x + (i as f32 + 0.5) * step, y + (j as f32 + 0.5) * step);
                let r = r0 + (r1 - r0) * (cx - x) / w;
                if r >= 0.3 { self.shape(cx - r, cy - r, 2.0 * r, 2.0 * r, Shape::Pill, Paint::Solid(rgb), a); }
            }
        }
    }
    /// Stripes leaning like / inside a shape, `period` apart and `width` thick.
    #[allow(clippy::too_many_arguments)]
    fn stripes(&mut self, x: f32, y: f32, w: f32, h: f32, s: Shape, period: f32, width: f32, rgb: Rgb, a: f32) {
        self.each(x, y, w, h, |c, px, py, lx, ly| {
            let cov = (0.5 - s.sd(lx, ly, w, h)).clamp(0.0, 1.0);
            let d = (((lx + ly) * FRAC_1_SQRT_2).rem_euclid(period) - period / 2.0).abs();
            let k = (width / 2.0 - d + 0.5).clamp(0.0, 1.0);
            if cov * k > 0.0 { c.over(px, py, rgb, cov * k * a); }
        });
    }
    /// Small dots of light scattered over a box, the same each time for the same `seed`. `size` scales them.
    #[allow(clippy::too_many_arguments)]
    fn stars(&mut self, x: f32, y: f32, w: f32, h: f32, seed: u32, size: f32, a: f32) {
        let mut s = seed.wrapping_mul(0x9E37_79B9) | 1;
        let mut next = move || {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            s as f32 / u32::MAX as f32
        };
        for _ in 0..(w * h / (900.0 * size * size)) as u32 {
            let (sx, sy, r, b) = (x + next() * w, y + next() * h, (0.45 + next() * 0.7) * size, next());
            self.shape(sx - r, sy - r, 2.0 * r, 2.0 * r, Shape::Pill, Paint::Solid(WHITE), a * (0.2 + 0.8 * b * b));
        }
    }
    /// One line of text in a box, cut with "..." when it is too long. `shadow`: the same text in another colour,
    /// moved by (x, y), under it.
    #[allow(clippy::too_many_arguments)]
    fn label(&mut self, x: f32, y: f32, w: f32, h: f32, s: &str, f: Font, rgb: Rgb, align: Align, shadow: Option<(Rgb, i32, i32)>) {
        let (w, h) = (w.round().max(0.0) as u32, h.round().max(0.0) as u32);
        if w == 0 || h == 0 || s.is_empty() { return; }
        let Some(mask) = gdi::text_mask(s, w, h, &f, align == Align::Center) else { return };
        let (x, y) = (x.round() as i32, y.round() as i32);
        let lay = |c: &mut Canvas, dx: i32, dy: i32, rgb: Rgb| {
            for yy in 0..h {
                for xx in 0..w {
                    let cov = mask[(yy * w + xx) as usize];
                    if cov > 0 { c.over(x + xx as i32 + dx, y + yy as i32 + dy, rgb, cov as f32 / 255.0); }
                }
            }
        };
        if let Some((srgb, dx, dy)) = shadow { lay(self, dx, dy, srgb); }
        lay(self, 0, 0, rgb);
    }
}

/// The width of a line of text in pixels. Without Windows' text, a guess.
fn text_w(s: &str, f: Font) -> u32 {
    if s.is_empty() { return 0; }
    gdi::text_width(s, &f).unwrap_or_else(|| (s.chars().count() as f32 * f.size as f32 * 0.55).round() as u32)
}

/// A thin line from `x0` to `x1` with a small diamond at each end, `d` across half.
#[allow(clippy::too_many_arguments)]
fn rule(c: &mut Canvas, x0: f32, x1: f32, y: f32, rgb: Rgb, a: f32, d: f32) {
    c.rect(x0 + 2.0 * d, y, x1 - x0 - 4.0 * d, 1.0, rgb, a);
    for x in [x0 + d, x1 - d] {
        c.ring(x - d, y + 0.5 - d, 2.0 * d, 2.0 * d, Shape::Diamond, 1.0, rgb, a);
        c.shape(x - d * 0.4, y + 0.5 - d * 0.4, d * 0.8, d * 0.8, Shape::Diamond, Paint::Solid(rgb), a);
    }
}

/// A diamond inside a diamond outline, for corners.
fn gem(c: &mut Canvas, cx: f32, cy: f32, r: f32, rgb: Rgb) {
    c.ring(cx - 1.8 * r, cy - 1.8 * r, 3.6 * r, 3.6 * r, Shape::Diamond, 1.0, rgb, 0.6);
    c.shape(cx - r, cy - r, 2.0 * r, 2.0 * r, Shape::Diamond, Paint::Solid(rgb), 1.0);
}

/// A four-pointed star.
fn sparkle(c: &mut Canvas, cx: f32, cy: f32, r: f32, rgb: Rgb) {
    c.shape(cx - r * 0.28, cy - r, r * 0.56, 2.0 * r, Shape::Diamond, Paint::Solid(rgb), 1.0);
    c.shape(cx - r, cy - r * 0.28, 2.0 * r, r * 0.56, Shape::Diamond, Paint::Solid(rgb), 1.0);
}

/// Corner brackets: an L `len` long and `t` thick at each corner of a box.
#[allow(clippy::too_many_arguments)]
fn brackets(c: &mut Canvas, x: f32, y: f32, w: f32, h: f32, len: f32, t: f32, rgb: Rgb, a: f32) {
    for (left, top) in [(true, true), (false, true), (true, false), (false, false)] {
        let hx = if left { x } else { x + w - len };
        let vx = if left { x } else { x + w - t };
        let hy = if top { y } else { y + h - t };
        let vy = if top { y + t } else { y + h - len };
        c.rect(hx, hy, len, t, rgb, a);
        c.rect(vx, vy, t, len - t, rgb, a);
    }
}

/// Zenless Zone Zero's title bar in a header `w` by `h`: one black capsule that holds the back button and the name.
/// `cut`: where its orange end starts at the bottom edge, which is as far as the name goes.
struct ZzzBar { x: f32, y: f32, w: f32, h: f32, cut: f32 }

fn zzz_bar(l: &Layout, w: f32, h: f32) -> ZzzBar {
    let bh = (h * 0.58).round();
    let y = ((h - bh) / 2.0).round();
    // in line with the rows' pills, or as far from the side as from the top in a small header
    let x = y.min(l.f(15.0).round());
    let cut = w - x - (bh * 1.75).round();
    ZzzBar { x, y, w: w - 2.0 * x, h: bh, cut }
}

/// The panel behind a header, `w` by `h` at the top of the picture.
fn head_bg(c: &mut Canvas, l: &Layout, w: f32, h: f32) {
    let f = |v: f32| l.f(v);
    let pad = l.pad as f32;
    c.clip(0.0, 0.0, w, h);
    match l.look {
        Look::Plain => {
            let r = f(10.0);
            c.shape(0.0, 0.0, w, h + r, Shape::Corners([r, r, 0.0, 0.0]), Paint::Solid(plain::BAND), 1.0);
            c.ring(0.0, 0.0, w, h + 2.0 * r, Shape::Corners([r, r, 0.0, 0.0]), 1.0, plain::LINE, 1.0);
            c.rect(0.0, h - 1.0, w, 1.0, plain::LINE, 1.0);
        }
        Look::Zzz => {
            // a grey frame with a black outline. In it one black capsule, as wide as the rows' pills, with the well's
            // dot matrix. Its right end is orange with black stripes behind a leaning edge
            let (r, b) = (f(18.0), f(2.0));
            c.shape(0.0, 0.0, w, h + r, Shape::Corners([r, r, 0.0, 0.0]), Paint::Solid(zzz::INK), 1.0);
            c.shape(b, b, w - 2.0 * b, h + r, Shape::Corners([r - b, r - b, 0.0, 0.0]), Paint::Down(zzz::FRAME_HI, zzz::FRAME), 1.0);
            let bar = zzz_bar(l, w, h);
            c.shape(bar.x, bar.y, bar.w, bar.h, Shape::Pill, Paint::Solid(zzz::INK), 1.0);
            let lean = (bar.h * 0.4).round();
            // the same dots as the well behind the rows (`body_bg`), kept inside the capsule
            let (step, dot) = (f(5.0), f(0.9));
            let (nx, ny) = ((bar.w / step).floor() as i32, (bar.h / step).floor() as i32);
            let oy = (bar.h - ny as f32 * step) / 2.0;
            for j in 0..ny {
                for i in 0..nx {
                    let (lx, ly) = ((i as f32 + 0.5) * step, oy + (j as f32 + 0.5) * step);
                    if Shape::Pill.sd(lx, ly, bar.w, bar.h) > -(dot + b) { continue; }
                    c.shape(bar.x + lx - dot, bar.y + ly - dot, 2.0 * dot, 2.0 * dot, Shape::Pill, Paint::Solid(WHITE), 0.08);
                }
            }
            let n = bar.h / bar.h.hypot(lean);
            let (period, thick) = (bar.h * 0.24, bar.h * 0.12);
            c.each(bar.x, bar.y, bar.w, bar.h, |c, px, py, lx, ly| {
                let inside = (0.5 - Shape::Pill.sd(lx, ly, bar.w, bar.h)).clamp(0.0, 1.0);
                let past = ((lx - (bar.cut - bar.x) - lean * (1.0 - ly / bar.h)) * n + 0.5).clamp(0.0, 1.0);
                if inside * past <= 0.0 { return; }
                c.over(px, py, zzz::ORANGE, inside * past);
                let d = (((lx + ly) * FRAC_1_SQRT_2).rem_euclid(period) - period / 2.0).abs();
                c.over(px, py, zzz::INK, inside * past * (thick / 2.0 - d + 0.5).clamp(0.0, 1.0));
            });
            c.ring(bar.x, bar.y, bar.w, bar.h, Shape::Pill, b, zzz::INK, 1.0);
        }
        Look::Genshin => {
            // navy with a thin gold border inside the edge, gems on its corners, a star and a rule under the name
            let (r, i) = (f(10.0), f(6.0).round());
            c.shape(0.0, 0.0, w, h + r, Shape::Corners([r, r, 0.0, 0.0]), Paint::Down(gi::NAVY_HI, gi::NAVY), 0.94);
            c.rect(i, i, w - 2.0 * i, 1.0, gi::GOLD, 0.55);
            c.rect(i, i, 1.0, h - i, gi::GOLD, 0.55);
            c.rect(w - i - 1.0, i, 1.0, h - i, gi::GOLD, 0.55);
            gem(c, i + 0.5, i + 0.5, f(3.5), gi::GOLD);
            gem(c, w - i - 0.5, i + 0.5, f(3.5), gi::GOLD);
            sparkle(c, w - f(30.0), h / 2.0 - f(2.0), f(7.0), gi::GOLD);
            rule(c, f(22.0), w - f(22.0), h - f(8.0), gi::GOLD, 0.55, f(3.5));
        }
        Look::StarRail => {
            // smoked glass with stars, its top right corner cut round, a gold mark on the line under the name
            let big = f(26.0).min(h * 0.45);
            c.shape(0.0, 0.0, w, h + big, Shape::Corners([f(2.0), big, 0.0, 0.0]), Paint::Down(hsr::GLASS_HI, hsr::GLASS), 0.9);
            c.stars(0.0, 0.0, w - big, h, 7, f(1.0), 0.8);
            c.rect(pad, h - 1.0, w - 2.0 * pad, 1.0, WHITE, 0.16);
            c.rect(pad, h - f(3.0), f(34.0), f(2.0), hsr::GOLD, 1.0);
            let d = f(22.0).min(h * 0.5);
            let (ox, oy) = (w - big - f(26.0) - d, (h - d) / 2.0);
            c.ring(ox, oy, d, d, Shape::Pill, 1.0, WHITE, 0.3);
            let (dx, dy) = (ox + d / 2.0 + d / 2.0 * FRAC_1_SQRT_2, oy + d / 2.0 - d / 2.0 * FRAC_1_SQRT_2);
            c.shape(dx - f(3.0), dy - f(3.0), f(6.0), f(6.0), Shape::Pill, Paint::Solid(hsr::GOLD), 1.0);
        }
        Look::Wuwa => {
            // see-through black, faint nested curves at the right, a gold hairline with diamond ends
            let r = f(3.0);
            c.shape(0.0, 0.0, w, h + r, Shape::Corners([r, r, 0.0, 0.0]), Paint::Solid(ww::INK), 0.82);
            c.stars(0.0, 0.0, w, h, 3, f(1.0), 0.5);
            let cy = h * 0.46;
            let cx = w - f(24.0) - h * 0.35;
            for k in 0..3 {
                let rr = h * (0.13 + 0.11 * k as f32);
                let mut pts = vec![(w * 0.5, cy - rr), (cx, cy - rr)];
                for i in 1..16 {
                    let t = -PI / 2.0 + PI * i as f32 / 16.0;
                    pts.push((cx + rr * t.cos(), cy + rr * t.sin()));
                }
                pts.extend([(cx, cy + rr), (w * 0.5, cy + rr)]);
                c.stroke(&pts, 1.0, WHITE, 0.12);
            }
            rule(c, pad, w - pad, h - f(5.0), ww::GOLD_LINE, 0.75, f(3.5));
        }
        Look::Hi3 => {
            // deep blue with the top left corner cut, a cyan edge, and slanted ticks at the right
            let cut = f(14.0);
            c.shape(0.0, 0.0, w, h + cut, Shape::Chamfer([cut, 0.0, 0.0, 0.0]), Paint::Down(hi3::DEEP_HI, hi3::DEEP), 0.92);
            c.ring(0.0, 0.0, w, h + 2.0 * cut, Shape::Chamfer([cut, 0.0, 0.0, 0.0]), 1.0, hi3::CYAN, 0.5);
            c.rect(cut + f(4.0), 0.0, f(72.0), f(3.0), hi3::CYAN, 1.0);
            for k in 0..5 {
                c.shape(w - f(34.0) - k as f32 * f(12.0), h * 0.35, f(10.0), h * 0.3, Shape::Slant(f(5.0)), Paint::Solid(hi3::CYAN), 0.85 - 0.16 * k as f32);
            }
            c.rect(0.0, h - 1.0, w, 1.0, hi3::CYAN, 0.3);
            c.rect(pad, h - f(2.0), f(56.0), f(2.0), hi3::CYAN, 1.0);
        }
        Look::Endfield => {
            // charcoal with a yellow edge, a ruler along the bottom and a crosshair in the corner
            c.put(0.0, 0.0, w, h, ef::STAGE, 1.0);
            c.put(0.0, 0.0, f(5.0), h, ef::YELLOW, 1.0);
            let step = f(6.0).round().max(4.0);
            let mut x = (w * 0.6).round();
            let mut i = 0;
            while x < w - f(14.0) {
                let t = if i % 5 == 0 { f(9.0) } else { f(4.0) };
                c.rect(x, h - f(3.0) - t, 1.0, t, ef::TICK, 1.0);
                x += step;
                i += 1;
            }
            let (cx, cy) = (w - f(16.0), f(13.0));
            c.rect(cx - f(5.0), cy, f(11.0), 1.0, ef::CROSS, 1.0);
            c.rect(cx, cy - f(5.0), 1.0, f(11.0), ef::CROSS, 1.0);
        }
    }
    c.unclip();
}

/// The panel behind the rows, `w` wide and `h` high from `y`.
fn body_bg(c: &mut Canvas, l: &Layout, y: f32, w: f32, h: f32) {
    let f = |v: f32| l.f(v);
    match l.look {
        Look::Plain => {
            c.put(0.0, y, w, h, plain::BG, 1.0);
            c.rect(0.0, y, 1.0, h, plain::LINE, 1.0);
            c.rect(w - 1.0, y, 1.0, h, plain::LINE, 1.0);
        }
        Look::Zzz => {
            // the grey frame goes on down both sides of a black well with a dot matrix
            let (b, fr) = (f(2.0).round(), f(9.0).round());
            c.put(0.0, y, w, h, zzz::INK, 1.0);
            c.put(b, y, w - 2.0 * b, h, zzz::FRAME, 1.0);
            c.put(fr, y, w - 2.0 * fr, h, zzz::WELL, 1.0);
            c.dots(fr, y, w - 2.0 * fr, h, f(5.0), f(0.9), f(0.9), WHITE, 0.08);
        }
        Look::Genshin => {
            let i = f(6.0).round();
            c.put(0.0, y, w, h, gi::NAVY, 0.94);
            c.rect(i, y, 1.0, h, gi::GOLD, 0.55);
            c.rect(w - i - 1.0, y, 1.0, h, gi::GOLD, 0.55);
        }
        Look::StarRail => {
            c.put(0.0, y, w, h, hsr::GLASS, 0.9);
            c.stars(0.0, y, w, h, 12, f(1.0), 0.6);
        }
        Look::Wuwa => {
            c.put(0.0, y, w, h, ww::INK, 0.82);
        }
        Look::Hi3 => {
            c.put(0.0, y, w, h, hi3::DEEP, 0.92);
            c.rect(0.0, y, 1.0, h, hi3::CYAN, 0.5);
            c.rect(w - 1.0, y, 1.0, h, hi3::CYAN, 0.5);
        }
        Look::Endfield => {
            c.put(0.0, y, w, h, ef::SHEET, 1.0);
        }
    }
}

/// Zenless Zone Zero's wells have round corners: the frame's grey over the corners of the well that is `w` wide (the
/// whole panel's width) from `y` to `y + h`, `r` round. `top` and `bottom` pick which pair.
#[allow(clippy::too_many_arguments)]
fn well_corners(c: &mut Canvas, l: &Layout, y: f32, w: f32, h: f32, r: f32, top: bool, bottom: bool) {
    let fr = l.f(9.0).round();
    let (bw, shape) = (w - 2.0 * fr, Shape::Corners([if top { r } else { 0.0 }, if top { r } else { 0.0 }, if bottom { r } else { 0.0 }, if bottom { r } else { 0.0 }]));
    c.each(fr, y, bw, h, |c, px, py, lx, ly| {
        let outside = (0.5 + shape.sd(lx, ly, bw, h)).clamp(0.0, 1.0);
        if outside > 0.0 { c.over(px, py, zzz::FRAME, outside); }
    });
}

/// The panel behind a footer, `w` by `h` at `y`.
fn foot_bg(c: &mut Canvas, l: &Layout, y: f32, w: f32, h: f32) {
    let f = |v: f32| l.f(v);
    let pad = l.pad as f32;
    c.clip(0.0, y, w, y + h);
    match l.look {
        Look::Plain => {
            let r = f(10.0);
            c.shape(0.0, y - r, w, h + r, Shape::Corners([0.0, 0.0, r, r]), Paint::Solid(plain::BAND), 1.0);
            c.ring(0.0, y - 2.0 * r, w, h + 2.0 * r, Shape::Corners([0.0, 0.0, r, r]), 1.0, plain::LINE, 1.0);
            c.rect(0.0, y, w, 1.0, plain::LINE, 1.0);
        }
        Look::Zzz => {
            let (r, b) = (f(18.0), f(2.0));
            c.shape(0.0, y - r, w, h + r, Shape::Corners([0.0, 0.0, r, r]), Paint::Solid(zzz::INK), 1.0);
            c.shape(b, y - r, w - 2.0 * b, h + r - b, Shape::Corners([0.0, 0.0, r - b, r - b]), Paint::Down(zzz::FRAME, zzz::FRAME_HI), 1.0);
        }
        Look::Genshin => {
            let (r, i) = (f(10.0), f(6.0).round());
            c.shape(0.0, y - r, w, h + r, Shape::Corners([0.0, 0.0, r, r]), Paint::Down(gi::NAVY, gi::NAVY_LO), 0.94);
            c.rect(i, y, 1.0, h - i, gi::GOLD, 0.55);
            c.rect(w - i - 1.0, y, 1.0, h - i, gi::GOLD, 0.55);
            c.rect(i, y + h - i - 1.0, w - 2.0 * i, 1.0, gi::GOLD, 0.55);
            gem(c, i + 0.5, y + h - i - 0.5, f(3.5), gi::GOLD);
            gem(c, w - i - 0.5, y + h - i - 0.5, f(3.5), gi::GOLD);
            rule(c, f(22.0), w - f(22.0), y + f(2.0), gi::GOLD, 0.45, f(3.0));
        }
        Look::StarRail => {
            c.shape(0.0, y, w, h, Shape::Corners([0.0, 0.0, f(2.0), f(2.0)]), Paint::Down(hsr::BAR_HI, hsr::BAR_LO), 0.94);
            c.rect(pad, y, w - 2.0 * pad, 1.0, WHITE, 0.12);
        }
        Look::Wuwa => {
            let r = f(3.0);
            c.shape(0.0, y - r, w, h + r, Shape::Corners([0.0, 0.0, r, r]), Paint::Solid(ww::INK), 0.82);
            rule(c, pad, w - pad, y + f(2.0), ww::GOLD_LINE, 0.6, f(3.0));
        }
        Look::Hi3 => {
            let cut = f(14.0);
            c.shape(0.0, y - cut, w, h + cut, Shape::Chamfer([0.0, 0.0, cut, 0.0]), Paint::Down(hi3::DEEP, hi3::DEEP_LO), 0.92);
            c.ring(0.0, y - 2.0 * cut, w, h + 2.0 * cut, Shape::Chamfer([0.0, 0.0, cut, 0.0]), 1.0, hi3::CYAN, 0.5);
            c.rect(0.0, y, w, 1.0, hi3::CYAN, 0.3);
            c.rect(w - cut - f(76.0), y + h - f(3.0), f(64.0), f(3.0), hi3::CYAN, 1.0);
        }
        Look::Endfield => {
            c.put(0.0, y, w, h, ef::STAGE, 1.0);
            c.rect(0.0, y, w, 1.0, ef::EDGE, 1.0);
        }
    }
    c.unclip();
}

fn back_size(l: &Layout) -> f32 { l.f(30.0) }

/// The header's words, `size` pixels high: a character's name, "Characters", or a mod's name on a key sheet.
/// `back`: the back button sits before them.
fn title(c: &mut Canvas, l: &Layout, w: f32, h: f32, text: &str, size: u32, back: bool) {
    let f = |v: f32| l.f(v);
    let pad = l.pad as f32;
    let text = if l.look.caps() { text.to_uppercase() } else { text.to_string() };
    let mut x = pad + if back { back_size(l) + f(12.0) } else { 0.0 };
    let tag = size as f32 * 0.8;
    let mut keep = match l.look {
        Look::Plain | Look::Wuwa => pad,
        Look::Zzz => 0.0,
        Look::Genshin => f(48.0),
        Look::StarRail => f(86.0),
        Look::Hi3 => f(100.0),
        Look::Endfield => f(30.0),
    };
    match l.look {
        Look::Zzz => {
            // inside the capsule: after the back button, or after an orange tag
            let bar = zzz_bar(l, w, h);
            if back {
                x = bar.x + (bar.h + back_size(l)) / 2.0 + f(10.0);
            } else {
                let tw = (tag * 0.5).round();
                x = bar.x + (bar.h * 0.42).round();
                c.shape(x, (h - tag) / 2.0, tw, tag, Shape::Slant(tag * 0.25), Paint::Solid(zzz::ORANGE), 1.0);
                x += tw + f(8.0);
            }
            keep = w - bar.cut + f(8.0);
        }
        Look::Hi3 if !back => {
            c.shape(x, (h - tag) / 2.0, f(10.0), tag, Shape::Slant(tag * 0.25), Paint::Solid(hi3::CYAN), 1.0);
            x += f(18.0);
        }
        _ => {}
    }
    c.label(x, 0.0, w - x - keep, h, &text, l.look.title_font(size), l.look.head_text(), Align::Left, None);
}

/// A round button's face, `d` across at (x, y), as each look draws it, and the colour of the mark on it. `hover`: as
/// under the mouse, drawn over the plain one.
fn button(c: &mut Canvas, l: &Layout, x: f32, y: f32, d: f32, hover: bool) -> Rgb {
    let f = |v: f32| l.f(v);
    let mut face = |s: Shape, rgb: Rgb| c.shape(x, y, d, d, s, Paint::Solid(rgb), 1.0);
    match (l.look, hover) {
        (Look::Plain, false) => plain::DIM,
        (Look::Plain, true) => { face(Shape::Round(f(6.0)), plain::KEY); plain::TEXT }
        (Look::Zzz, false) => {
            face(Shape::Pill, zzz::INK);
            c.ring(x, y, d, d, Shape::Pill, f(2.0), zzz::RIM, 1.0);
            zzz::TEXT
        }
        (Look::Zzz, true) => {
            face(Shape::Pill, zzz::ORANGE);
            c.ring(x, y, d, d, Shape::Pill, f(2.0), zzz::INK, 1.0);
            zzz::INK
        }
        (Look::Genshin, false) => { c.ring(x, y, d, d, Shape::Pill, f(1.5), gi::CREAM, 0.6); gi::CREAM }
        (Look::Genshin, true) => { face(Shape::Pill, gi::CREAM); gi::INK }
        (Look::StarRail, false) => { c.ring(x, y, d, d, Shape::Pill, f(1.2), WHITE, 0.5); WHITE }
        (Look::StarRail, true) => { face(Shape::Pill, hsr::PILL); hsr::INK }
        (Look::Wuwa, false) => { c.ring(x, y, d, d, Shape::Round(f(3.0)), 1.0, WHITE, 0.5); WHITE }
        (Look::Wuwa, true) => { face(Shape::Round(f(3.0)), ww::SHEET); ww::DARK }
        (Look::Hi3, false) => { c.ring(x, y, d, d, Shape::Chamfer([f(6.0), 0.0, f(6.0), 0.0]), 1.0, hi3::CYAN, 0.9); hi3::CYAN }
        (Look::Hi3, true) => { face(Shape::Chamfer([f(6.0), 0.0, f(6.0), 0.0]), hi3::CYAN); hi3::NAVY }
        (Look::Endfield, false) => { face(Shape::Pill, ef::PLATE); WHITE }
        (Look::Endfield, true) => { face(Shape::Pill, ef::PAPER); ef::INK }
    }
}

/// The back button before a character's name. `hover`: as under the mouse, drawn alone in the picture's right half.
fn back_button(c: &mut Canvas, l: &Layout, x0: f32, hover: bool) {
    let d = back_size(l);
    let head = (l.head - l.gut) as f32;
    let left = match l.look {
        // at the capsule's left end, as far from its side as from its top
        Look::Zzz => { let bar = zzz_bar(l, l.w as f32, head); bar.x + ((bar.h - d) / 2.0).round() }
        _ => l.pad as f32,
    };
    let (x, y) = (x0 + left, ((head - d) / 2.0).round());
    let fg = button(c, l, x, y, d, hover);
    c.chevron(x + d / 2.0 - l.f(1.0), y + d / 2.0, d * 0.17, Dir::Left, l.f(2.2), fg);
}

/// An arrow on the list's top or bottom edge, `arw` by `arh` at (x, y): a small tab in the look's own shape with a
/// chevron. It covers the rows under it, so its face is solid. `hover`: as under the mouse.
fn arrow_tab(c: &mut Canvas, l: &Layout, x: f32, y: f32, dir: Dir, hover: bool) {
    let f = |v: f32| l.f(v);
    let (w, h) = (l.arw as f32, l.arh as f32);
    let cut = Shape::Chamfer([f(6.0), 0.0, f(6.0), 0.0]);
    // shape, face, a line round it (colour, thickness, cover), the chevron's colour
    let (s, face, ring, fg) = match (l.look, hover) {
        (Look::Plain, false) => (Shape::Round(f(6.0)), plain::KEY, Some((plain::LINE, 1.0, 1.0)), plain::TEXT),
        (Look::Plain, true) => (Shape::Round(f(6.0)), plain::ACCENT, None, WHITE),
        (Look::Zzz, false) => (Shape::Pill, zzz::INK, Some((zzz::RIM, f(2.0), 1.0)), zzz::TEXT),
        (Look::Zzz, true) => (Shape::Pill, zzz::ORANGE, Some((zzz::INK, f(2.0), 1.0)), zzz::INK),
        (Look::Genshin, false) => (Shape::Pill, gi::NAVY_HI, Some((gi::GOLD, f(1.5), 0.8)), gi::CREAM),
        (Look::Genshin, true) => (Shape::Pill, gi::CREAM, Some((gi::GOLD, f(1.5), 0.8)), gi::INK),
        (Look::StarRail, false) => (Shape::Pill, hsr::GLASS_HI, Some((WHITE, 1.0, 0.4)), WHITE),
        (Look::StarRail, true) => (Shape::Pill, hsr::PILL, None, hsr::INK),
        (Look::Wuwa, false) => (Shape::Round(f(3.0)), ww::INK, Some((WHITE, 1.0, 0.5)), WHITE),
        (Look::Wuwa, true) => (Shape::Round(f(3.0)), ww::SHEET, None, ww::DARK),
        (Look::Hi3, false) => (cut, hi3::DEEP_HI, Some((hi3::CYAN, 1.0, 0.9)), hi3::CYAN),
        (Look::Hi3, true) => (cut, hi3::CYAN, None, hi3::NAVY),
        (Look::Endfield, false) => (Shape::Pill, ef::INK, None, ef::YELLOW),
        (Look::Endfield, true) => (Shape::Pill, ef::YELLOW, Some((ef::INK, f(1.5), 1.0)), ef::INK),
    };
    c.shape(x, y, w, h, s, Paint::Solid(face), 1.0);
    if let Some((rgb, t, a)) = ring { c.ring(x, y, w, h, s, t, rgb, a); }
    c.chevron(x + w / 2.0, y + h / 2.0, f(6.0), dir, f(2.0), fg);
}

/// The mark on the row that is showing, `chk` square at (x, y). `on_pick`: for the picked row's colours.
fn check(c: &mut Canvas, l: &Layout, x: f32, y: f32, on_pick: bool) {
    let f = |v: f32| l.f(v);
    let s = l.chk as f32;
    let tick = |c: &mut Canvas, rgb: Rgb| c.stroke(&[(x + s * 0.28, y + s * 0.53), (x + s * 0.44, y + s * 0.68), (x + s * 0.73, y + s * 0.34)], f(2.6), rgb, 1.0);
    let disc = |c: &mut Canvas, sh: Shape, rgb: Rgb| c.shape(x, y, s, s, sh, Paint::Solid(rgb), 1.0);
    match l.look {
        Look::Plain => tick(c, plain::ACCENT),
        Look::Zzz if on_pick => { disc(c, Shape::Pill, zzz::INK); tick(c, zzz::ORANGE) }
        Look::Zzz => { disc(c, Shape::Pill, zzz::ORANGE); tick(c, zzz::INK) }
        Look::Genshin if on_pick => { disc(c, Shape::Pill, gi::INK); tick(c, gi::CREAM) }
        Look::Genshin => { c.ring(x, y, s, s, Shape::Pill, f(1.5), gi::GOLD, 1.0); tick(c, gi::GOLD) }
        Look::StarRail => { disc(c, Shape::Corners([f(2.0), f(7.0), f(2.0), f(2.0)]), hsr::GOLD); tick(c, hsr::INK) }
        Look::Wuwa => {
            let rgb = if on_pick { ww::GOLD_DK } else { ww::GOLD };
            c.ring(x, y, s, s, Shape::Diamond, f(1.3), rgb, 1.0);
            c.shape(x + s * 0.3, y + s * 0.3, s * 0.4, s * 0.4, Shape::Diamond, Paint::Solid(rgb), 1.0);
        }
        Look::Hi3 => { disc(c, Shape::Chamfer([f(5.0), 0.0, f(5.0), 0.0]), hi3::YELLOW); tick(c, hi3::NAVY) }
        Look::Endfield => { disc(c, Shape::Pill, ef::INK); tick(c, ef::YELLOW) }
    }
}

/// What a row of a list shows.
struct Item { label: String, img: Option<image::RgbaImage>, none: bool }

/// A row's picture in a shape: the mod's preview, or for "None" an empty box with a line through it. `ring`: a line
/// round its edge (colour, thickness, cover).
#[allow(clippy::too_many_arguments)]
fn thumb(c: &mut Canvas, it: &Item, x: f32, y: f32, d: f32, s: Shape, hole: Rgb, ring: Option<(Rgb, f32, f32)>, slash: Rgb) {
    c.shape(x, y, d, d, s, Paint::Solid(hole), 1.0);
    if let Some(img) = &it.img { c.picture(x, y, img, s); }
    if it.none {
        let (a, b) = (d * 0.32, d * 0.68);
        c.stroke(&[(x + a, y + b), (x + b, y + a)], (d / 24.0).max(1.5), slash, 1.0);
    }
    if let Some((rgb, t, a)) = ring { c.ring(x, y, d, d, s, t, rgb, a); }
}

/// One row of a list at `y`, with its left edge at `x0`. `pick`: as the picked row, drawn alone in the picture's
/// right half and laid over the plain row by live.ini, so it covers what it changes. `room`: how much further from
/// the right its art ends, to leave the scroll bar clear.
#[allow(clippy::too_many_arguments)]
fn row(c: &mut Canvas, l: &Layout, x0: f32, y: f32, it: &Item, pick: bool, room: f32) {
    let f = |v: f32| l.f(v);
    let (w, rh, pad) = (l.w as f32 - room, l.row as f32, l.pad as f32);
    let (tx, ty, td) = (x0 + pad, y + ((l.row - l.thumb) / 2) as f32, l.thumb as f32);
    let (line, la) = l.look.line();
    let fg = if pick { l.look.pick_text() } else if it.none { l.look.dim() } else { l.look.text() };
    let mut shadow = None;
    c.clip(x0, y, x0 + w, y + rh);
    match (l.look, pick) {
        (Look::Plain, false) => {
            c.rect(x0 + pad, y + rh - 1.0, w - 2.0 * pad, 1.0, line, la);
            thumb(c, it, tx, ty, td, Shape::Round(f(6.0)), plain::LINE, None, plain::DIM);
        }
        (Look::Plain, true) => {
            // a soft box with the accent down its left edge
            let (px, py, pw, ph, r) = (x0 + f(6.0), y + f(4.0), w - f(12.0), rh - f(8.0), f(8.0));
            c.shape(px, py, pw, ph, Shape::Round(r), Paint::Solid(plain::ACCENT), 1.0);
            c.clip(px + f(4.0), y, x0 + w, y + rh);
            c.shape(px, py, pw, ph, Shape::Round(r), Paint::Solid(plain::PICK), 1.0);
            c.clip(x0, y, x0 + w, y + rh);
            thumb(c, it, tx, ty, td, Shape::Round(f(6.0)), plain::LINE, None, plain::DIM);
        }
        (Look::Zzz, _) => {
            // chunky pills on the well; the picked one turns orange with a hard shadow and stripes over its right end
            let (px, py, pw, ph) = (x0 + f(15.0), y + f(3.0), w - f(30.0), rh - f(6.0));
            if pick {
                c.shape(px, py + f(3.0), pw, ph, Shape::Pill, Paint::Solid(zzz::INK), 1.0);
                c.shape(px, py, pw, ph, Shape::Pill, Paint::Solid(zzz::ORANGE), 1.0);
                // they start along a stripe and run to the end of the pill, round end included
                let (sw, period, thick) = (f(72.0) + ph / 2.0, f(8.0), f(3.0));
                let sx = px + pw - sw;
                c.each(sx, py, sw, ph, |c, qx, qy, lx, ly| {
                    let inside = (0.5 - Shape::Pill.sd(lx + sx - px, ly, pw, ph)).clamp(0.0, 1.0);
                    if inside <= 0.0 || lx + ly < ph { return; }
                    let d = (((lx + ly) * FRAC_1_SQRT_2).rem_euclid(period) - period / 2.0).abs();
                    let k = (thick / 2.0 - d + 0.5).clamp(0.0, 1.0);
                    if k > 0.0 { c.over(qx, qy, zzz::INK, inside * k * 0.13); }
                });
                c.ring(px, py, pw, ph, Shape::Pill, f(2.0), zzz::INK, 1.0);
            } else {
                c.shape(px, py, pw, ph, Shape::Pill, Paint::Down(zzz::CARD_HI, zzz::CARD_LO), 1.0);
                c.ring(px, py, pw, ph, Shape::Pill, f(2.0), zzz::RING, 1.0);
                shadow = Some((zzz::INK, 0, l.s(1).max(1) as i32));
            }
            thumb(c, it, tx, ty, td, Shape::Pill, zzz::HOLE, Some((zzz::INK, f(2.0), 1.0)), zzz::TEXT3);
        }
        (Look::Genshin, false) => {
            c.rect(x0 + f(22.0), y + rh - 1.0, w - f(44.0), 1.0, line, la);
            thumb(c, it, tx, ty, td, Shape::Pill, gi::HOLE, Some((gi::CREAM, f(1.5), 0.45)), gi::DIM);
        }
        (Look::Genshin, true) => {
            // a cream pill with a thin line around it, the picture in a dark round cap at its left end
            c.ring(x0 + f(11.0), y + f(3.0), w - f(22.0), rh - f(6.0), Shape::Pill, 1.0, gi::CREAM, 0.5);
            c.shape(x0 + f(14.0), y + f(6.0), w - f(28.0), rh - f(12.0), Shape::Pill, Paint::Solid(gi::CREAM), 1.0);
            c.shape(tx - f(3.0), ty - f(3.0), td + f(6.0), td + f(6.0), Shape::Pill, Paint::Solid(gi::CAP), 1.0);
            thumb(c, it, tx, ty, td, Shape::Pill, gi::CAP, None, gi::CREAM);
        }
        (Look::StarRail, _) => {
            // cells with the top right corner cut round; the picked one is a pale plate with a line set inside it
            let (px, py, pw, ph) = (x0 + f(10.0), y + f(4.0), w - f(20.0), rh - f(8.0));
            let cut = Shape::Corners([f(2.0), f(12.0), f(2.0), f(2.0)]);
            if pick {
                c.rect(x0 + f(3.0), y + f(16.0), f(3.0), rh - f(32.0), hsr::ORANGE, 1.0);
                c.shape(px, py, pw, ph, cut, Paint::Down(hsr::PLATE_HI, hsr::PLATE_LO), 1.0);
                c.ring(px + f(3.0), py + f(3.0), pw - f(6.0), ph - f(6.0), Shape::Corners([f(1.0), f(9.0), f(1.0), f(1.0)]), 1.0, hsr::LINE_IN, 1.0);
            } else {
                c.shape(px, py, pw, ph, cut, Paint::Solid(WHITE), 0.05);
                c.ring(px, py, pw, ph, cut, 1.0, WHITE, 0.1);
            }
            let ring = if pick { (hsr::INK, 1.0, 0.3) } else { (WHITE, 1.0, 0.25) };
            thumb(c, it, tx, ty, td, Shape::Corners([f(2.0), f(9.0), f(2.0), f(2.0)]), hsr::HOLE, Some(ring), hsr::TEXT3);
        }
        (Look::Wuwa, false) => {
            c.rect(x0 + pad, y + rh - 1.0, w - 2.0 * pad, 1.0, line, la);
            thumb(c, it, tx, ty, td, Shape::Round(f(3.0)), ww::HOLE, Some((WHITE, 1.0, 0.22)), ww::DIM);
        }
        (Look::Wuwa, true) => {
            // what is picked turns white, with a small gold diamond on its left edge
            c.shape(x0 + f(8.0), y + f(4.0), w - f(16.0), rh - f(8.0), Shape::Round(f(3.0)), Paint::Solid(ww::SHEET), 1.0);
            let d = f(10.0);
            c.shape(x0 + f(8.0) - d / 2.0, y + (rh - d) / 2.0, d, d, Shape::Diamond, Paint::Solid(ww::GOLD), 1.0);
            thumb(c, it, tx, ty, td, Shape::Round(f(3.0)), ww::HOLE, Some((ww::DARK, 1.0, 0.2)), ww::DIM);
        }
        (Look::Hi3, false) => {
            c.rect(x0 + pad, y + rh - 1.0, w - 2.0 * pad, 1.0, line, la);
            thumb(c, it, tx, ty, td, Shape::Chamfer([f(8.0), 0.0, f(8.0), 0.0]), hi3::HOLE, Some((hi3::CYAN, 1.0, 0.55)), hi3::DIM);
        }
        (Look::Hi3, true) => {
            // a cyan to blue plate with cut corners and a yellow tag
            let (px, py, pw, ph) = (x0 + f(8.0), y + f(4.0), w - f(16.0), rh - f(8.0));
            c.shape(px, py, pw, ph, Shape::Chamfer([f(10.0), 0.0, f(10.0), 0.0]), Paint::Across(hi3::CYAN_HI, hi3::BLUE), 1.0);
            c.ring(px + f(2.0), py + f(2.0), pw - f(4.0), ph - f(4.0), Shape::Chamfer([f(9.0), 0.0, f(9.0), 0.0]), 1.0, WHITE, 0.35);
            c.shape(x0 + f(1.0), y + f(16.0), f(9.0), rh - f(32.0), Shape::Slant(f(4.0)), Paint::Solid(hi3::YELLOW), 1.0);
            thumb(c, it, tx, ty, td, Shape::Chamfer([f(8.0), 0.0, f(8.0), 0.0]), hi3::HOLE, Some((WHITE, 1.0, 0.75)), hi3::DIM);
            shadow = Some((hi3::SHADE, 0, l.s(1).max(1) as i32));
        }
        (Look::Endfield, false) => {
            c.rect(x0 + pad, y + rh - 1.0, w - 2.0 * pad, 1.0, line, la);
            thumb(c, it, tx, ty, td, Shape::Rect, ef::PAPER, None, ef::GREY);
            brackets(c, tx - f(3.0), ty - f(3.0), td + f(6.0), td + f(6.0), f(7.0), f(1.5), ef::INK, 0.75);
        }
        (Look::Endfield, true) => {
            // signal yellow with hazard stripes down its left and brackets on its corners
            let (px, py, pw, ph) = (x0 + f(6.0), y + f(4.0), w - f(12.0), rh - f(8.0));
            c.rect(px, py, pw, ph, ef::YELLOW, 1.0);
            c.stripes(px, py, f(8.0), ph, Shape::Rect, f(6.0), f(3.0), ef::INK, 1.0);
            brackets(c, px, py, pw, ph, f(9.0), f(2.0), ef::INK, 1.0);
            thumb(c, it, tx, ty, td, Shape::Rect, ef::PAPER, None, ef::GREY);
            brackets(c, tx - f(3.0), ty - f(3.0), td + f(6.0), td + f(6.0), f(7.0), f(1.5), ef::INK, 0.9);
        }
    }
    let text_w = (l.chk_x as f32 - room - (l.text_x() + l.s(10)) as f32).max(0.0);
    let font = l.look.row_font(l.s(l.look.row_size()), pick);
    c.label(x0 + l.text_x() as f32, y, text_w, rh, &it.label, font, fg, Align::Left, shadow);
    c.unclip();
}

/// The arrow a key cap shows instead of letters.
fn arrow_of(label: &str) -> Option<Dir> {
    match label { "\u{2190}" => Some(Dir::Left), "\u{2192}" => Some(Dir::Right), "\u{2191}" => Some(Dir::Up), "\u{2193}" => Some(Dir::Down), _ => None }
}

/// The width of a key cap `h` high, at most `max_w`.
fn cap_w(l: &Layout, h: f32, label: &str, max_w: f32) -> f32 {
    if arrow_of(label).is_some() { return h; }
    (text_w(label, l.look.cap_font((h * 0.62).round() as u32)) as f32 + h * 0.7).max(h).min(max_w).round()
}

/// A key cap `h` high at (x, y): the key's name, or an arrow for an arrow key. Returns its width.
#[allow(clippy::too_many_arguments)]
fn cap(c: &mut Canvas, l: &Layout, x: f32, y: f32, h: f32, label: &str, max_w: f32) -> f32 {
    let f = |v: f32| l.f(v);
    let w = cap_w(l, h, label, max_w);
    let s = match l.look {
        Look::Plain => Shape::Round(f(4.0)),
        Look::Wuwa => Shape::Round(f(3.0)),
        Look::Hi3 => Shape::Chamfer([f(4.0), 0.0, f(4.0), 0.0]),
        _ => Shape::Pill,
    };
    let mut face = |rgb: Rgb, a: f32| c.shape(x, y, w, h, s, Paint::Solid(rgb), a);
    let fg = match l.look {
        Look::Plain => { face(plain::KEY, 1.0); plain::TEXT }
        Look::Zzz => { face(zzz::TEXT, 1.0); zzz::INK }
        Look::Genshin => { face(gi::CREAM, 1.0); gi::INK }
        Look::StarRail => {
            face(hsr::PILL, 1.0);
            c.ring(x + f(2.0), y + f(2.0), w - f(4.0), h - f(4.0), Shape::Pill, 1.0, hsr::LINE_IN, 1.0);
            hsr::INK
        }
        Look::Wuwa => { c.ring(x, y, w, h, s, 1.0, WHITE, 0.85); WHITE }
        Look::Hi3 => {
            face(hi3::CYAN, 0.14);
            c.ring(x, y, w, h, s, 1.0, hi3::CYAN, 1.0);
            WHITE
        }
        Look::Endfield => { face(ef::PAPER, 1.0); ef::INK }
    };
    match arrow_of(label) {
        Some(d) => c.arrow(x + w / 2.0, y + h / 2.0, h * 0.25, d, f(1.7), fg),
        None => c.label(x, y, w, h, label, l.look.cap_font((h * 0.62).round() as u32), fg, Align::Center, None),
    }
    w
}

/// Key hints in a footer, from `x` and at most `w` wide: each hint's keys on caps, then its word. Everything
/// shrinks a little when they don't fit.
#[allow(clippy::too_many_arguments)]
fn hint_row(c: &mut Canvas, l: &Layout, x: f32, y: f32, w: f32, h: f32, hint: &Hint) {
    let f = |v: f32| l.f(v);
    let (cap_h, size) = (f(22.0).min(h - f(10.0)), l.s(l.look.hint_size()) as f32);
    let font = |k: f32| l.look.hint_font((size * k).round() as u32);
    let width = |k: f32| {
        let items: f32 = hint.iter().map(|(keys, word)| {
            keys.iter().map(|key| cap_w(l, (cap_h * k).round(), key, w) + f(4.0) * k).sum::<f32>() + f(3.0) * k + text_w(word, font(k)) as f32
        }).sum();
        items + f(14.0) * k * hint.len().saturating_sub(1) as f32
    };
    let mut k = 1.0;
    while k > 0.72 && width(k) > w { k -= 0.04; }
    let ch = (cap_h * k).round();
    let cy = y + ((h - ch) / 2.0).round();
    let mut cx = x;
    for (keys, word) in hint {
        for key in keys { cx += cap(c, l, cx.round(), cy, ch, key, w) + f(4.0) * k; }
        cx += f(3.0) * k;
        let ww = text_w(word, font(k)) as f32;
        let room = x + w - cx;
        if room <= 0.0 { break; }
        c.label(cx, y, (ww + f(6.0)).min(room), h, word, font(k), l.look.words(), Align::Left, None);
        cx += ww + f(14.0) * k;
    }
}

/// A mod's preview, cut square. None for a remote picture or one that can't be read.
fn thumb_img(preview: &str, size: u32) -> Option<image::RgbaImage> {
    if preview.contains("://") { return None; }
    let img = image::ImageReader::open(preview).ok()?.with_guessed_format().ok()?.decode().ok()?;
    Some(img.resize_to_fill(size, size, image::imageops::FilterType::Triangle).to_rgba8())
}

/// A list's picture: the header and a row per item, each row twice side by side. The left half is the menu as it
/// shows; the right half holds each row as the picked one (and the back button under the mouse), which live.ini
/// lays over the left half.
/// `apart`: live.ini draws the rows in another order (the list of characters, characters on screen first), so Zenless
/// Zone Zero's dot matrix starts again on each row and lines up wherever a row lands.
fn render_rows(l: &Layout, name: &str, back: bool, items: &[Item], apart: bool) -> Canvas {
    let n = items.len() as u32;
    // the header's own part: under it the list's background starts, `gut` above the first row
    let (w, head) = (l.w as f32, (l.head - l.gut) as f32);
    let mut c = Canvas::new(2 * l.w, l.head + l.row * n, [0, 0, 0, 0]);
    if apart && l.look == Look::Zzz {
        body_bg(&mut c, l, head, w, l.gut as f32);
        for i in 0..n { body_bg(&mut c, l, (l.head + i * l.row) as f32, w, l.row as f32); }
    } else {
        body_bg(&mut c, l, head, w, (l.gut + l.row * n) as f32);
    }
    head_bg(&mut c, l, w, head);
    title(&mut c, l, w, head, name, l.s(l.look.title_size()), back);
    if back {
        back_button(&mut c, l, 0.0, false);
        back_button(&mut c, l, w, true);
    }
    // a list longer than the menu gets the scroll bar, and its rows make room for it
    let room = if n > l.vis { l.room as f32 } else { 0.0 };
    for (i, it) in items.iter().enumerate() {
        let y = (l.head + i as u32 * l.row) as f32;
        row(&mut c, l, 0.0, y, it, false, room);
        row(&mut c, l, w, y, it, true, room);
    }
    c
}

pub(crate) fn render_page(p: &Page, l: &Layout, many: bool) -> Canvas {
    let mut items = vec![Item { label: "None".into(), img: None, none: true }];
    items.extend(p.rows.iter().map(|r| Item { label: r.name.clone(), img: r.preview.as_deref().and_then(|p| thumb_img(p, l.thumb)), none: false }));
    // with more characters, a back button before the name: left (or a click on the header) goes to the list of them
    render_rows(l, &p.character, many, &items, false)
}

/// The list of characters: a row each, with a picture of one of the character's skins.
pub(crate) fn render_list(pages: &[Page], l: &Layout) -> Canvas {
    let items: Vec<Item> = pages.iter().map(|p| Item {
        label: p.character.clone(),
        img: p.rows.iter().find_map(|r| r.preview.as_deref()).and_then(|p| thumb_img(p, l.thumb)),
        none: false,
    }).collect();
    render_rows(l, "Characters", false, &items, true)
}

/// Three strips: the footer under a character's skins; then the up and down arrows, the same under the mouse, the
/// check, the check on the picked row and the scroll bar's round ends (`Layout::arrow_u`, `chk_u`, `cap_u`); then the
/// footer under the list of characters.
pub(crate) fn render_chrome(l: &Layout, hint: &Hint, list_hint: &Hint) -> Canvas {
    let (w, ft) = (l.w as f32, l.foot as f32);
    let mut c = Canvas::new(l.w, l.foot * 3 + l.round * 2, [0, 0, 0, 0]);
    let room = w - 2.0 * l.pad as f32;
    let gut = l.gut as f32;
    for (y, h) in [(0.0, hint), (2.0 * ft, list_hint)] {
        // the list's background goes on `gut` under the last row, then the footer itself
        if l.gut > 0 { body_bg(&mut c, l, y, w, gut); }
        foot_bg(&mut c, l, y + gut, w, ft - gut);
        hint_row(&mut c, l, l.pad as f32, y + gut, room, ft - gut, h);
    }
    for hover in [false, true] {
        for (down, dir) in [(false, Dir::Up), (true, Dir::Down)] {
            arrow_tab(&mut c, l, l.arrow_u(down, hover) as f32, ft, dir, hover);
        }
        check(&mut c, l, l.chk_u(hover) as f32, ft, hover);
    }
    if l.cap_h() > 0 {
        // each round end is half of a pill as wide as the bar
        let ((track, ta), (thumb, ha)) = l.look.bar();
        let (bw, ch) = (l.bar_w as f32, l.cap_h() as f32);
        for (is_thumb, rgb, a) in [(false, track, ta), (true, thumb, ha)] {
            for bottom in [false, true] {
                let x = l.cap_u(is_thumb, bottom) as f32;
                c.clip(x, ft, x + bw, ft + ch);
                c.shape(x, if bottom { ft - ch } else { ft }, bw, 2.0 * ch, Shape::Pill, Paint::Solid(rgb), a);
            }
        }
        c.unclip();
    }
    if l.round > 0 {
        // the list's top corners, then its bottom ones: each strip is the end of a well twice as high
        let (r, y) = (l.round as f32, 3.0 * ft);
        c.clip(0.0, y, w, y + r);
        well_corners(&mut c, l, y, w, 2.0 * r, r, true, false);
        c.clip(0.0, y + r, w, y + 2.0 * r);
        well_corners(&mut c, l, y, w, 2.0 * r, r, false, true);
        c.unclip();
    }
    c
}

/// One live skin's keys for the key list the game draws.
pub(crate) struct Sheet { pub n: u32, pub slot: u32, pub name: String, pub rows: Vec<crate::keylist::KeyRow> }

/// The dim note after a key: how it works when that isn't a plain press.
fn key_note(r: &crate::keylist::KeyRow) -> String {
    match r.kind.as_str() {
        "hold" => "Hold".into(),
        "cycle" if r.options > 2 => format!("{} options", r.options),
        _ => String::new(),
    }
}

/// The hints in a sheet's footer, and in the picture that says no character on screen has keys. `key` is the key
/// list key as the player reads it ("F8").
pub(crate) fn key_hints(key: &str) -> (Hint, Hint) { (vec![(vec![key.to_string()], "hide keys")], vec![(vec![key.to_string()], "hide this")]) }

/// A sheet: the mod's name, one row per key (the key, what it changes, a note), and the key that hides it.
pub(crate) fn render_sheet(s: &Sheet, l: &Layout, hint: &Hint) -> Canvas {
    let k = KeyLayout::of(l);
    let h = k.sheet_h(s.rows.len());
    let (w, kh, kr, pad) = (k.w as f32, k.head as f32, k.row as f32, k.pad as f32);
    let fy = (h - k.foot) as f32;
    let mut c = Canvas::new(k.w, h, [0, 0, 0, 0]);
    body_bg(&mut c, l, kh, w, fy - kh);
    head_bg(&mut c, l, w, kh);
    title(&mut c, l, w, kh, &s.name, l.s(17), false);
    let cut = s.rows.len() > KEY_ROWS;
    let shown = if cut { KEY_ROWS - 1 } else { s.rows.len() };
    let (what_x, note_w) = (pad + k.key_w as f32, k.note_w as f32);
    let what_w = w - what_x - note_w - pad;
    let ch = l.f(22.0).min(kr - l.f(8.0)).round();
    let (line, la) = l.look.line();
    for (i, r) in s.rows.iter().take(shown).enumerate() {
        let y = kh + i as f32 * kr;
        cap(&mut c, l, pad, y + ((kr - ch) / 2.0).round(), ch, &r.keys.join(", "), (k.key_w - l.s(8)) as f32);
        c.label(what_x, y, what_w, kr, &r.what, l.look.row_font(l.s(15), false), l.look.text(), Align::Left, None);
        c.label(w - pad - note_w + l.f(8.0), y, note_w - l.f(8.0), kr, &key_note(r), l.look.hint_font(l.s(13)), l.look.dim(), Align::Left, None);
        c.rect(pad, y + kr - 1.0, w - 2.0 * pad, 1.0, line, la);
    }
    if cut {
        let y = kh + shown as f32 * kr;
        c.label(pad, y, w - 2.0 * pad, kr, &format!("{} more keys", s.rows.len() - shown), l.look.row_font(l.s(14), false), l.look.dim(), Align::Left, None);
    }
    if l.look == Look::Zzz { well_corners(&mut c, l, kh, w, fy - kh, l.f(12.0), true, true); }
    foot_bg(&mut c, l, fy, w, k.foot as f32);
    hint_row(&mut c, l, pad, fy, w - 2.0 * pad, k.foot as f32, hint);
    c
}

/// The picture drawn when none of the characters on screen has a sheet.
pub(crate) fn render_no_keys(l: &Layout, hint: &Hint) -> Canvas {
    let k = KeyLayout::of(l);
    let (w, kh, pad) = (k.w as f32, k.head as f32, k.pad as f32);
    let mut c = Canvas::new(k.w, k.none_h(), [0, 0, 0, 0]);
    head_bg(&mut c, l, w, kh);
    let (x, keep) = match l.look {
        Look::Zzz => { let bar = zzz_bar(l, w, kh); (bar.x + (bar.h * 0.5).round(), w - bar.cut + l.f(8.0)) }
        _ => (pad, pad),
    };
    c.label(x, 0.0, w - x - keep, kh, "No mod keys for the characters on screen", l.look.row_font(l.s(15), false), l.look.head_text(), Align::Left, None);
    foot_bg(&mut c, l, kh, w, k.foot as f32);
    hint_row(&mut c, l, pad, kh, w - 2.0 * pad, k.foot as f32, hint);
    c
}

/// Write the key list's pictures that changed since last time (hashes in `menukeys.json`), and remove the ones of
/// sheets that are gone. With no sheets every key list file goes. True when a file was written or removed.
pub(crate) fn write_key_assets(dir: &Path, sheets: &[Sheet], l: &Layout, key: &str) -> Result<bool> {
    let mut changed = false;
    let marks = dir.join("menukeys.json");
    let old: HashMap<String, String> = std::fs::read(&marks).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let mut new: HashMap<String, String> = HashMap::new();
    let mut files: Vec<String> = Vec::new();
    if !sheets.is_empty() {
        let base = format!("{VERSION}:{}:{:?}", l.gen_h, l.look);
        let (hint, none_hint) = key_hints(key);
        let mark = stamp(&[base.clone(), format!("{none_hint:?}")]);
        let file = dir.join("menukeys.dds");
        if old.get("none") != Some(&mark) || !file.is_file() {
            crate::xxmi::write_atomic(&file, &dds(&render_no_keys(l, &none_hint)))?;
            changed = true;
        }
        new.insert("none".into(), mark);
        files.push("menukeys.dds".into());
        for s in sheets {
            let mut parts = vec![base.clone(), format!("{hint:?}"), s.name.clone()];
            for r in &s.rows { parts.extend([r.keys.join("\u{1}"), r.what.clone(), key_note(r)]); }
            let mark = stamp(&parts);
            let id = format!("{}_{}", s.n, s.slot);
            let file = dir.join(format!("menuk{id}.dds"));
            if old.get(&id) != Some(&mark) || !file.is_file() {
                crate::xxmi::write_atomic(&file, &dds(&render_sheet(s, l, &hint)))?;
                changed = true;
            }
            new.insert(id.clone(), mark);
            files.push(format!("menuk{id}.dds"));
        }
    }
    // sheets of skins that aren't live or listed any more
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_ascii_lowercase();
            if name.starts_with("menuk") && name.ends_with(".dds") && !files.contains(&name) && std::fs::remove_file(e.path()).is_ok() { changed = true; }
        }
    }
    if new.is_empty() {
        let _ = std::fs::remove_file(&marks);
    } else if new != old {
        crate::xxmi::write_atomic(&marks, &serde_json::to_vec(&new)?)?;
    }
    Ok(changed)
}

/// A .dds file holding `c` as plain 8-bit RGBA, the one format every loader build reads the same way.
pub(crate) fn dds(c: &Canvas) -> Vec<u8> {
    let mut b = Vec::with_capacity(148 + c.px.len());
    let u = |b: &mut Vec<u8>, v: u32| b.extend_from_slice(&v.to_le_bytes());
    b.extend_from_slice(b"DDS ");
    u(&mut b, 124);
    u(&mut b, 0x100F); // caps, height, width, pitch, pixel format
    u(&mut b, c.h);
    u(&mut b, c.w);
    u(&mut b, c.w * 4);
    u(&mut b, 0);
    u(&mut b, 1);
    for _ in 0..11 { u(&mut b, 0); }
    u(&mut b, 32);
    u(&mut b, 0x4); // the format is named in the DX10 header below
    b.extend_from_slice(b"DX10");
    for _ in 0..5 { u(&mut b, 0); }
    u(&mut b, 0x1000); // a texture
    for _ in 0..4 { u(&mut b, 0); }
    u(&mut b, 28); // R8G8B8A8_UNORM
    u(&mut b, 3); // 2D
    u(&mut b, 0);
    u(&mut b, 1);
    u(&mut b, 0);
    b.extend_from_slice(&c.px);
    b
}

/// The menu as live.ini lays it out over something to see through, for a look at it without the game. `zone` is
/// what the mouse is over (2 the back button, 4 and 5 the up and down arrows) and `fv` which footer shows.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn mock(page: &Canvas, chrome: &Canvas, l: &Layout, rows: u32, top: u32, sel: u32, act: u32, zone: u32, fv: u32) -> Canvas {
    let vis = rows.min(l.vis);
    let m = l.s(24);
    let mut c = Canvas::new(l.w + 2 * m, l.head + vis * l.row + l.foot + 2 * m, [0, 0, 0, 255]);
    for y in 0..c.h {
        for x in 0..c.w {
            let t = (x + y) as f32 / (c.w + c.h) as f32;
            let lift = if (x / 40 + y / 40) % 2 == 0 { 30.0 } else { 0.0 };
            let i = ((y * c.w + x) * 4) as usize;
            for (k, (a, b)) in [(0x2f, 0xe6), (0x5d, 0xb0), (0x8a, 0x7a)].into_iter().enumerate() {
                c.px[i + k] = (a as f32 + (b as f32 - a as f32) * t + lift).min(255.0) as u8;
            }
        }
    }
    let copy = |c: &mut Canvas, from: &Canvas, dx: u32, dy: u32, w: u32, h: u32, u: u32, v: u32| {
        for y in 0..h {
            for x in 0..w {
                let i = (((v + y) * from.w + u + x) * 4) as usize;
                c.over((m + dx + x) as i32, (m + dy + y) as i32, [from.px[i], from.px[i + 1], from.px[i + 2]], from.px[i + 3] as f32 / 255.0);
            }
        }
    };
    copy(&mut c, page, 0, l.head, l.w, vis * l.row, 0, l.head + top * l.row);
    copy(&mut c, page, 0, 0, l.w, l.head, 0, 0);
    if zone == 2 { copy(&mut c, page, 0, 0, l.w, l.head, l.w, 0); }
    if sel >= top && sel < top + vis {
        copy(&mut c, page, 0, l.head + (sel - top) * l.row, l.w, l.row, l.w, l.head + sel * l.row);
    }
    copy(&mut c, chrome, 0, l.head + vis * l.row, l.w, l.foot, 0, fv);
    if l.round > 0 {
        copy(&mut c, chrome, 0, l.head - l.gut, l.w, l.round, 0, 3 * l.foot);
        copy(&mut c, chrome, 0, l.head + l.gut + vis * l.row - l.round, l.w, l.round, 0, 3 * l.foot + l.round);
    }
    let scrolls = rows > vis;
    let chk_x = l.chk_x - if scrolls { l.room } else { 0 };
    if act >= top && act < top + vis {
        copy(&mut c, chrome, chk_x, l.head + (act - top) * l.row + (l.row - l.chk) / 2, l.chk, l.chk, l.chk_u(act == sel), l.foot);
    }
    if scrolls {
        let ((track_rgb, track_a), (thumb_rgb, thumb_a)) = l.look.bar();
        let (track, ch, bt) = (l.track(), l.cap_h(), l.head + l.bar_in);
        let th = (track * vis / rows).max(l.thumb_min());
        let ty = bt + (track - th) * top / (rows - vis);
        let flat = |c: &mut Canvas, y: u32, h: u32, rgb: Rgb, a: f32| c.rect((m + l.bar_x) as f32, (m + y) as f32, l.bar_w as f32, h as f32, rgb, a);
        flat(&mut c, bt + ch, track - 2 * ch, track_rgb, track_a);
        flat(&mut c, ty + ch, th - 2 * ch, thumb_rgb, thumb_a);
        if ch > 0 {
            for (y, thumb, bottom) in [(bt, false, false), (bt + track - ch, false, true), (ty, true, false), (ty + th - ch, true, true)] {
                copy(&mut c, chrome, l.bar_x, y, l.bar_w, ch, l.cap_u(thumb, bottom), l.foot);
            }
        }
        let (up_y, down_y) = l.arrow_y();
        for (down, z, show, y) in [(false, 4, top > 0, up_y), (true, 5, top + vis < rows, down_y + vis * l.row)] {
            if !show { continue; }
            copy(&mut c, chrome, l.arrow_x(), y, l.arw, l.arh, l.arrow_u(down, zone == z), l.foot);
        }
    }
    c
}

// ── the files ──

fn stamp(parts: &[String]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    for p in parts { h.update(p.as_bytes()); h.update([0]); }
    hex::encode(&h.finalize()[..12])
}

fn file_mark(path: &str) -> String {
    std::fs::metadata(path).ok().map(|m| {
        let t = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
        format!("{}:{t}", m.len())
    }).unwrap_or_default()
}

fn is_ours(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "menu.hlsl" || n == "menu.json" || n == "menukeys.json" || (n.starts_with("menu") && n.ends_with(".dds")) || (n.starts_with("menu") && n.ends_with(".bin"))
}

/// Take the menu's files out of the live folder (the menu was turned off, or nothing is live any more).
pub(crate) fn clear(dir: &Path) -> bool {
    let mut any = false;
    let Ok(rd) = std::fs::read_dir(dir) else { return false };
    for e in rd.flatten() {
        if e.file_name().to_str().is_some_and(is_ours) && std::fs::remove_file(e.path()).is_ok() { any = true; }
    }
    any
}

/// Write the shader and every picture that changed since last time. True when a file was written or removed.
pub(crate) fn write_assets(dir: &Path, pages: &[Page], l: &Layout, keys: &HintKeys) -> Result<bool> {
    let mut changed = false;
    let hlsl = dir.join("menu.hlsl");
    if std::fs::read(&hlsl).ok().as_deref() != Some(HLSL.as_bytes()) {
        crate::xxmi::write_atomic(&hlsl, HLSL.as_bytes())?;
        changed = true;
    }
    let marks = dir.join("menu.json");
    let old: HashMap<String, String> = std::fs::read(&marks).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let mut new: HashMap<String, String> = HashMap::new();
    let many = pages.len() > 1;
    let base = format!("{VERSION}:{}:{:?}", l.gen_h, l.look);
    let (hint, list_hint) = hints(keys, many);

    let mark = stamp(&[base.clone(), format!("{hint:?}"), format!("{list_hint:?}")]);
    let file = dir.join("menu.dds");
    if old.get("chrome") != Some(&mark) || !file.is_file() {
        crate::xxmi::write_atomic(&file, &dds(&render_chrome(l, &hint, &list_hint)))?;
        changed = true;
    }
    new.insert("chrome".into(), mark);

    // the list of characters is menu0.dds (group numbers start at 1)
    if many {
        let mut parts = vec![base.clone()];
        for p in pages {
            let pic = p.rows.iter().find_map(|r| r.preview.clone()).unwrap_or_default();
            parts.push(p.character.clone());
            parts.push(file_mark(&pic));
            parts.push(pic);
        }
        let mark = stamp(&parts);
        let file = dir.join("menu0.dds");
        if old.get("0") != Some(&mark) || !file.is_file() {
            crate::xxmi::write_atomic(&file, &dds(&render_list(pages, l)))?;
            changed = true;
        }
        new.insert("0".into(), mark);
    }

    for p in pages {
        let mut parts = vec![base.clone(), many.to_string(), p.character.clone()];
        for r in &p.rows {
            parts.push(r.name.clone());
            parts.push(r.preview.clone().unwrap_or_default());
            parts.push(r.preview.as_deref().map(file_mark).unwrap_or_default());
        }
        let mark = stamp(&parts);
        let file = dir.join(format!("menu{}.dds", p.n));
        if old.get(&p.n.to_string()) != Some(&mark) || !file.is_file() {
            crate::xxmi::write_atomic(&file, &dds(&render_page(p, l, many)))?;
            changed = true;
        }
        new.insert(p.n.to_string(), mark);
    }
    // pictures of characters that aren't live any more
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_ascii_lowercase();
            let Some(n) = name.strip_prefix("menu").and_then(|r| r.strip_suffix(".dds")) else { continue };
            if !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()) && !new.contains_key(n) && std::fs::remove_file(e.path()).is_ok() { changed = true; }
        }
    }
    if new != old { crate::xxmi::write_atomic(&marks, &serde_json::to_vec(&new)?)?; }
    Ok(changed)
}

/// Text drawn by Windows, so any language a mod is named in shows. A look's face is used only when Windows has it and
/// it has every letter of the text; otherwise Segoe UI, which borrows letters it lacks from other fonts.
#[cfg(windows)]
mod gdi {
    use super::Font;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use windows_sys::Win32::Foundation::{LPARAM, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, DrawTextW, EnumFontFamiliesExW, GdiFlush, GetGlyphIndicesW,
        SelectObject, SetBkMode, SetTextCharacterExtra, SetTextColor, ANTIALIASED_QUALITY, BITMAPINFO, BITMAPINFOHEADER, DEFAULT_CHARSET,
        DIB_RGB_COLORS, DT_CALCRECT, DT_CENTER, DT_END_ELLIPSIS, DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER, GGI_MARK_NONEXISTING_GLYPHS, HDC, HFONT,
        LOGFONTW, OUT_TT_PRECIS, TEXTMETRICW, TRANSPARENT,
    };

    const FALLBACK: &str = "Segoe UI";

    /// Whether Windows has a font family by this name. Asked once per name.
    fn has_face(face: &str) -> bool {
        static SEEN: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
        let seen = SEEN.get_or_init(Default::default);
        if let Some(&v) = seen.lock().unwrap_or_else(|e| e.into_inner()).get(face) { return v; }
        unsafe extern "system" fn found(_: *const LOGFONTW, _: *const TEXTMETRICW, _: u32, hit: LPARAM) -> i32 {
            // SAFETY: `hit` is the address of the bool in `has_face`, alive for the whole enumeration.
            unsafe { *(hit as *mut bool) = true };
            0
        }
        let mut hit = false;
        // SAFETY: the DC is freed before returning; `lf` and `hit` outlive the enumeration.
        unsafe {
            let dc = CreateCompatibleDC(std::ptr::null_mut());
            if !dc.is_null() {
                let mut lf: LOGFONTW = std::mem::zeroed();
                lf.lfCharSet = DEFAULT_CHARSET;
                for (d, c) in lf.lfFaceName.iter_mut().zip(face.encode_utf16().take(31)) { *d = c; }
                EnumFontFamiliesExW(dc, &lf, Some(found), &mut hit as *mut bool as LPARAM, 0);
                DeleteDC(dc);
            }
        }
        seen.lock().unwrap_or_else(|e| e.into_inner()).insert(face.to_string(), hit);
        hit
    }

    fn make(face: &str, f: &Font) -> HFONT {
        let name: Vec<u16> = face.encode_utf16().chain([0]).collect();
        // SAFETY: `name` is NUL-terminated and outlives the call.
        unsafe {
            CreateFontW(-(f.size as i32), 0, 0, 0, f.weight as i32, f.italic as u32, 0, 0, DEFAULT_CHARSET as _, OUT_TT_PRECIS as _, 0,
                ANTIALIASED_QUALITY as _, 0, name.as_ptr())
        }
    }

    /// The font for `wide`: the look's face when Windows has it and it has every letter, else the fallback.
    fn font_for(dc: HDC, wide: &[u16], f: &Font) -> HFONT {
        if f.face != FALLBACK && has_face(f.face) {
            let font = make(f.face, f);
            if !font.is_null() {
                let mut glyphs = vec![0u16; wide.len()];
                // SAFETY: `dc` and `font` are live, and `glyphs` has one entry per unit of `wide`.
                let whole = unsafe {
                    let old = SelectObject(dc, font);
                    let n = GetGlyphIndicesW(dc, wide.as_ptr(), wide.len() as i32, glyphs.as_mut_ptr(), GGI_MARK_NONEXISTING_GLYPHS);
                    SelectObject(dc, old);
                    n != u32::MAX && !glyphs.contains(&0xFFFF)
                };
                if whole { return font; }
                // SAFETY: the font isn't selected into any DC.
                unsafe { DeleteObject(font) };
            }
        }
        make(FALLBACK, f)
    }

    /// How much of each pixel of a `w` by `h` box the text covers (0 to 255), centred top to bottom, and left
    /// aligned or centred.
    pub fn text_mask(s: &str, w: u32, h: u32, f: &Font, center: bool) -> Option<Vec<u8>> {
        let wide: Vec<u16> = s.encode_utf16().collect();
        // SAFETY: every handle is checked before use and freed before returning; `bits` is `w * h * 4` bytes owned
        // by the bitmap, read only while the bitmap is alive.
        unsafe {
            let dc = CreateCompatibleDC(std::ptr::null_mut());
            if dc.is_null() { return None; }
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = w as i32;
            info.bmiHeader.biHeight = -(h as i32);
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let bmp = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, std::ptr::null_mut(), 0);
            if bmp.is_null() || bits.is_null() { DeleteDC(dc); return None; }
            let old_bmp = SelectObject(dc, bmp);
            let font = font_for(dc, &wide, f);
            let old_font = SelectObject(dc, font);
            SetBkMode(dc, TRANSPARENT as _);
            SetTextColor(dc, 0x00FF_FFFF);
            SetTextCharacterExtra(dc, f.track);
            let mut rc = RECT { left: 0, top: 0, right: w as i32, bottom: h as i32 };
            let align = if center { DT_CENTER } else { 0 };
            DrawTextW(dc, wide.as_ptr(), wide.len() as i32, &mut rc, DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX | DT_END_ELLIPSIS | align);
            GdiFlush();
            let px = std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize);
            // white text on black: any channel is the coverage
            let mask: Vec<u8> = px.chunks_exact(4).map(|p| p[0].max(p[1]).max(p[2])).collect();
            SelectObject(dc, old_font);
            if !font.is_null() { DeleteObject(font); }
            SelectObject(dc, old_bmp);
            DeleteObject(bmp);
            DeleteDC(dc);
            Some(mask)
        }
    }

    /// How wide the text is in pixels.
    pub fn text_width(s: &str, f: &Font) -> Option<u32> {
        let wide: Vec<u16> = s.encode_utf16().collect();
        // SAFETY: the DC and font are freed before returning.
        unsafe {
            let dc = CreateCompatibleDC(std::ptr::null_mut());
            if dc.is_null() { return None; }
            let font = font_for(dc, &wide, f);
            let old = SelectObject(dc, font);
            SetTextCharacterExtra(dc, f.track);
            let mut rc = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            let ok = DrawTextW(dc, wide.as_ptr(), wide.len() as i32, &mut rc, DT_CALCRECT | DT_SINGLELINE | DT_NOPREFIX);
            SelectObject(dc, old);
            if !font.is_null() { DeleteObject(font); }
            DeleteDC(dc);
            (ok != 0).then(|| (rc.right - rc.left).max(0) as u32)
        }
    }
}

#[cfg(not(windows))]
mod gdi {
    use super::Font;
    pub fn text_mask(_s: &str, _w: u32, _h: u32, _f: &Font, _center: bool) -> Option<Vec<u8>> { None }
    pub fn text_width(_s: &str, _f: &Font) -> Option<u32> { None }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pages() -> Vec<IniPage> { vec![IniPage { n: 2, slots: vec![1, 4] }, IniPage { n: 7, slots: vec![3] }] }

    const LOOKS: [Look; 7] = [Look::Zzz, Look::Genshin, Look::StarRail, Look::Wuwa, Look::Hi3, Look::Endfield, Look::Plain];

    /// The keys a menu starts with. `open`: the game binds the menu key itself; `pad`: with a controller's buttons.
    fn keys(open: bool, pad: bool) -> Keys {
        let b = |key: &[&str], xb: &[&str]| key.iter().chain(if pad { xb } else { &[] }).map(|s| s.to_string()).collect::<Vec<_>>();
        let menu_key: &[&str] = if open { &["no_modifiers VK_F7"] } else { &[] };
        Keys {
            open: b(menu_key, if open { &["XB_LEFT_THUMB XB_RIGHT_THUMB"] } else { &[] }),
            up: b(&["VK_UP"], &["XB_DPAD_UP"]), down: b(&["VK_DOWN"], &["XB_DPAD_DOWN"]),
            show: if pad { b(&["VK_RIGHT", "XB_DPAD_RIGHT", "VK_RETURN", "XB_A"], &[]) } else { b(&["VK_RIGHT", "VK_RETURN"], &[]) },
            back: b(&["VK_LEFT"], &["XB_DPAD_LEFT"]), close: b(&[], &["XB_B"]),
        }
    }

    #[test]
    fn ini_has_the_menu_and_balanced_ifs() {
        let l = Layout::new(1080);
        let t = sections(&pages(), &l, Some(&keys(true, true)), None);
        assert!(t.contains("[CommandListSeen2]\r\n$s2 = 1\r\n"));
        // a keyboard key and a controller button share a section, and more keys for one thing get the next one
        assert!(t.contains("[KeyMenuShow]\r\ncondition = $open == 1\r\nkey = VK_RIGHT\r\nkey = XB_DPAD_RIGHT\r\nrun = CommandListMenuShow\r\n"));
        assert!(t.contains("[KeyMenuShow2]\r\ncondition = $open == 1\r\nkey = VK_RETURN\r\nkey = XB_A\r\nrun = CommandListMenuShow\r\n"));
        // keys the player picked, and a thing with no key at all
        let own = Keys { up: vec!["W".into()], down: vec!["S".into(), "ctrl VK_J".into(), "XB_LEFT_SHOULDER".into()], close: vec![], ..keys(false, false) };
        let t2 = sections(&pages(), &l, Some(&own), None);
        assert!(t2.contains("[KeyMenuUp]\r\ncondition = $open == 1\r\nkey = W\r\nrun = CommandListMenuUp\r\n") && !t2.contains("VK_UP"));
        assert!(t2.contains("[KeyMenuDown]\r\ncondition = $open == 1\r\nkey = S\r\nkey = ctrl VK_J\r\nrun = CommandListMenuDown\r\n"));
        assert!(t2.contains("[KeyMenuDown2]\r\ncondition = $open == 1\r\nkey = XB_LEFT_SHOULDER\r\nrun = CommandListMenuDown\r\n"));
        assert!(!t2.contains("[KeyMenuClose]") && !t2.contains("[KeyMenuOpen]"));
        balanced(&t2, &constants(&pages(), true, false));
        assert!(t.contains("[KeyMenuOpen]\r\nkey = no_modifiers VK_F7\r\nkey = XB_LEFT_THUMB XB_RIGHT_THUMB\r\nrun = CommandListMenuToggle\r\n"));
        // row 2 of the first character is slot 4
        assert!(t.contains("  if $char == 0\r\n    if $sel == 0\r\n      $g2 = 0\r\n    endif\r\n    if $sel == 1\r\n      $g2 = 1\r\n    endif\r\n    if $sel == 2\r\n      $g2 = 4\r\n    endif\r\n  endif"));
        // page 2 lists the two characters: a row there opens that character, left goes back to it
        assert!(t.contains("[CommandListMenuShow]\r\n; on the list of characters a row opens that character\r\nif $char == 2\r\n  $at = $sel\r\n  run = CommandListMenuWho\r\n  $char = $who\r\n  run = CommandListMenuTurn\r\nelse\r\n"));
        assert!(t.contains("if $char == 2\r\n  $rows = 2\r\n  $act = $here\r\n") && t.contains("[ResourceMenuList]\r\nfilename = menu0.dds\r\n"));
        assert!(t.contains("[KeyMenuList]\r\ncondition = $open == 1\r\nkey = VK_LEFT\r\nkey = XB_DPAD_LEFT\r\nrun = CommandListMenuList\r\n"));
        assert!(t.contains("[ResourceMenuPage7]\r\nfilename = menu7.dds\r\n"));
        assert!(t.contains("post $s7 = 0\r\n"));
        assert!(!t.contains("Keys"), "no key list asked for");
        balanced(&t, &constants(&pages(), true, false));
    }

    #[test]
    fn ini_draws_the_picked_row_and_marks_from_the_pictures() {
        for look in LOOKS {
            let l = Layout::with_look(1440, look);
            let t = sections(&pages(), &l, Some(&keys(false, false)), None);
            let (w, head, row, foot) = (l.w, l.head, l.row, l.foot);
            // the picked row comes from the same row of the picture's right half
            assert!(t.contains(&format!("$qy = $y0 + {head} + ($sel - $top) * {row}\r\n$qw = {w}\r\n$qh = {row}\r\n$qu = {w}\r\n$qv = {head} + $who * {row}\r\n")));
            // and the back button under the mouse from its header
            assert!(t.contains(&format!("if $zone == 2\r\n$qx = {}\r\n$qy = $y0\r\n$qw = {w}\r\n$qh = {head}\r\n$qu = {w}\r\n$qv = 0\r\n", l.x0)));
            // the check, in the picked row's colours when it is that row
            let chk = format!("$qx = $cx\r\n$qy = $y0 + {} + ($act - $top) * {row}\r\n$qw = {c}\r\n$qh = {c}\r\n", head + (row - l.chk) / 2, c = l.chk);
            assert!(t.contains(&format!("if $act == $sel\r\n{chk}$qu = {}\r\n$qv = {foot}\r\n", l.chk_u(true))));
            assert!(t.contains(&format!("else\r\n{chk}$qu = {}\r\n$qv = {foot}\r\n", l.chk_u(false))));
            // the check moves in with the rows when the bar shows
            assert!(t.contains(&format!("$cx = {}\r\nif $rows > $vis\r\n  $cx = {}\r\nendif\r\n", l.x0 + l.chk_x, l.x0 + l.chk_x - l.room)));
            // the down arrow lit under the mouse, on the list's bottom edge
            let (_, down_y) = l.arrow_y();
            assert!(t.contains(&format!("if $zone == 5\r\n$qx = {}\r\n$qy = $y0 + {down_y} + $vis * {row}\r\n$qw = {}\r\n$qh = {}\r\n$qu = {}\r\n", l.x0 + l.arrow_x(), l.arw, l.arh, l.arrow_u(true, true))));
            // the footer has no scroll buttons any more: nothing is drawn from the middle strip at the footer's height
            assert!(!t.contains(&format!("$qy = $y0 + {head} + $vis * {row}\r\n$qw = {}\r\n", l.arw)));
            assert!(t.contains("$qflat = 1"));
            balanced(&t, &constants(&pages(), true, false));
        }
    }

    /// Every section closes the ifs it opens, every list it runs is there, and every variable it uses is declared.
    fn balanced(t: &str, consts: &str) {
        let mut depth = 0i32;
        let mut names = Vec::new();
        for line in t.lines() {
            let s = line.trim();
            if let Some(n) = s.strip_prefix('[') { assert_eq!(depth, 0, "{s}"); names.push(n.trim_end_matches(']').to_string()); }
            if s.starts_with("if ") { depth += 1; }
            if s == "endif" { depth -= 1; }
            assert!(depth >= 0);
        }
        assert_eq!(depth, 0);
        for line in t.lines() {
            let Some(target) = line.trim().strip_prefix("run = ") else { continue };
            assert!(target.starts_with("BuiltIn") || names.iter().any(|n| n == target), "{target} is missing");
        }
        for v in t.split(|c: char| !(c.is_ascii_alphanumeric() || c == '$' || c == '_')).filter(|w| w.starts_with('$')) {
            assert!(v.starts_with("$g") || consts.contains(&format!("global {v} = 0")) || consts.contains(&format!("global persist {v} = 0")), "{v} isn't declared");
        }
    }

    /// For each line that reads `line`, the conditions of the ifs around it in its section.
    fn under(t: &str, line: &str) -> Vec<Vec<String>> {
        let (mut stack, mut out) = (Vec::<String>::new(), Vec::new());
        for s in t.lines().map(str::trim) {
            if s.starts_with('[') { stack.clear(); }
            if s == line { out.push(stack.clone()); }
            if let Some(c) = s.strip_prefix("if ") { stack.push(c.to_string()); }
            if s == "endif" { stack.pop(); }
        }
        out
    }

    #[test]
    fn the_scroll_bar_shows_only_on_a_long_list() {
        for look in LOOKS {
            for h in [720, 1080, 2160] {
                let l = Layout::with_look(h, look);
                let t = sections(&pages(), &l, Some(&keys(false, false)), None);
                // every flat rectangle is the bar's, and the thumb, the track's zones and the room for it all wait on a long list
                let mut lines = vec!["$qflat = 1".to_string(), "$zone = 6".into(), "$zone = 7".into(), format!("$th = {} / $rows", l.track() * l.vis), format!("$cx = {}", l.x0 + l.chk_x - l.room)];
                if l.cap_h() > 0 {
                    for (thumb, bottom) in [(false, false), (false, true), (true, false), (true, true)] { lines.push(format!("$qu = {}", l.cap_u(thumb, bottom))); }
                } else {
                    assert!(!t.contains(&format!("$qu = {}", l.cap_u(false, false))), "{look:?} {h}");
                }
                for line in &lines {
                    let found = under(&t, line);
                    assert!(!found.is_empty(), "{look:?} {h}: {line}");
                    assert!(found.iter().all(|c| c.iter().any(|c| c == "$rows > $vis")), "{look:?} {h}: {line} {found:?}");
                }
                // two flat pieces: the track and the thumb, each in the look's own colours
                let ((track, ta), (thumb, ha)) = look.bar();
                let rgb = |c: Rgb, a: f32| format!("$qflat = 1\r\n$qa = {a:.3}\r\n$qr = {:.3}\r\n$qg = {:.3}\r\n$qb = {:.3}\r\n", c[0] as f32 / 255.0, c[1] as f32 / 255.0, c[2] as f32 / 255.0);
                assert_eq!(t.matches("$qflat = 1").count(), 2, "{look:?} {h}");
                assert!(t.contains(&rgb(track, ta)) && t.contains(&rgb(thumb, ha)), "{look:?} {h}");
                // the thumb's place follows $top and never runs past the track
                assert!(t.contains(&format!("  $ty = $y0 + {} + ({} - $th) * $top / ($rows - $vis)\r\n", l.head + l.bar_in, l.track())));
                assert!(l.thumb_min() < l.track() && l.bar_x + l.bar_w < l.w, "{look:?} {h}");
                balanced(&t, &constants(&pages(), true, false));
            }
        }
    }

    #[test]
    fn the_arrows_show_when_rows_are_out_of_view() {
        for look in LOOKS {
            let l = Layout::with_look(1080, look);
            let t = sections(&pages(), &l, Some(&keys(false, false)), None);
            let (up_y, down_y) = l.arrow_y();
            let up = format!("$qy = $y0 + {up_y}");
            let down = format!("$qy = $y0 + {down_y} + $vis * {}", l.row);
            // the plain one and the lit one each
            for (line, cond) in [(&up, "$top > 0"), (&down, "$top + $vis < $rows"), (&"$zone = 4".to_string(), "$top > 0"), (&"$zone = 5".to_string(), "$top + $vis < $rows")] {
                let found = under(&t, line);
                assert!(!found.is_empty(), "{look:?}: {line}");
                assert!(found.iter().all(|c| c.iter().any(|c| c == cond)), "{look:?}: {line} {found:?}");
            }
            assert_eq!(under(&t, &up).len(), 2);
            assert_eq!(under(&t, &down).len(), 2);
            // where the mouse lights an arrow is where it is drawn
            let ax = l.x0 + l.arrow_x();
            assert!(t.contains(&format!("    if $mx >= {ax} && $mx < {}\r\n      if $top > 0\r\n        if $my >= $y0 + {up_y} && $my < $y0 + {}\r\n", ax + l.arw, up_y + l.arh)));
            assert!(t.contains(&format!("        if $my >= $y0 + {down_y} + $vis * {r} && $my < $y0 + {} + $vis * {r}\r\n          $zone = 5\r\n", down_y + l.arh, r = l.row)));
            // on the list's edges: partly over the header and the footer, mostly over the first and the last row
            assert!(up_y < l.head && up_y + l.arh > l.head && down_y < l.head && down_y + l.arh > l.head, "{look:?}");
        }
    }

    #[test]
    fn a_click_on_an_arrow_or_the_track_pages_the_list() {
        let l = Layout::new(1080);
        let t = sections(&pages(), &l, Some(&keys(false, false)), None);
        // the same lists the footer's scroll buttons ran: a page less one row, the picked row kept in view
        for (zone, run) in [(4, "PageUp"), (5, "PageDown"), (6, "PageUp"), (7, "PageDown")] {
            assert!(t.contains(&format!("if $zone == {zone}\r\n  run = CommandListMenu{run}\r\nendif\r\n")), "{zone}");
        }
        assert!(t.contains("[CommandListMenuPageUp]\r\n$top = $top - $vis + 1\r\nif $top < 0\r\n  $top = 0\r\nendif\r\n"));
        assert!(t.contains("[CommandListMenuPageDown]\r\n$top = $top + $vis - 1\r\nif $top > $rows - $vis\r\n  $top = $rows - $vis\r\nendif\r\n"));
        // only the left button clicks, and only on something
        assert!(t.contains("[KeyMenuClick]\r\ncondition = $open == 1 && $zone > 0\r\nkey = VK_LBUTTON\r\nrun = CommandListMenuClick\r\n"));
        // the thumb itself is no zone, so a click on it doesn't pick the row under it
        assert!(t.contains("      $zone = 0\r\n      if $my < $ty\r\n        $zone = 6\r\n      endif\r\n      if $my >= $ty + $th\r\n        $zone = 7\r\n"));
    }

    #[test]
    fn every_look_draws_at_small_and_large_sizes() {
        let (hint, list_hint) = hints(&HintKeys::standard("F7"), true);
        for look in LOOKS {
            for h in [720, 2160] {
                let l = Layout::with_look(h, look);
                // the middle strip of menu.dds holds four arrows, two checks and four round ends
                assert!(l.cap_u(true, true) + l.bar_w <= l.w && l.arh <= l.foot && l.cap_h() <= l.foot, "{look:?} {h}");
                let chrome = render_chrome(&l, &hint, &list_hint);
                assert_eq!((chrome.w, chrome.h), (l.w, 3 * l.foot + 2 * l.round));
                for n in [3usize, 12] {
                    let rows: Vec<Row> = (0..n).map(|i| Row { name: format!("Skin {i}"), preview: None }).collect();
                    let p = render_page(&Page { n: 1, character: "Ellen".into(), rows }, &l, true);
                    let total = n as u32 + 1;
                    assert_eq!((p.w, p.h), (2 * l.w, l.head + total * l.row), "{look:?} {h}");
                    if total > l.vis {
                        // the picked rows (the right half, nothing under them) leave the bar's column clear
                        for y in l.head..p.h {
                            for x in l.bar_x.saturating_sub(1)..(l.bar_x + l.bar_w + 1).min(l.w) {
                                assert_eq!(p.px[((y * p.w + l.w + x) * 4 + 3) as usize], 0, "{look:?} {h} ({x}, {y})");
                            }
                        }
                    }
                    // laid out as live.ini does, scrolled to each end
                    let max_top = total.saturating_sub(l.vis);
                    for top in [0, max_top] {
                        let m = mock(&p, &chrome, &l, total, top, top, 0, 4, 0);
                        assert!(m.w > l.w && m.h > l.head);
                    }
                }
                let cast: Vec<Page> = (0..10).map(|i| Page { n: i + 1, character: format!("Character {i}"), rows: vec![] }).collect();
                let list = render_list(&cast, &l);
                assert_eq!(list.h, l.head + 10 * l.row);
                mock(&list, &chrome, &l, 10, 2, 5, 1, 5, 2 * l.foot);
            }
        }
    }

    #[test]
    fn one_character_has_no_arrows_and_off_keeps_the_flags() {
        let l = Layout::new(1080);
        let one = vec![IniPage { n: 1, slots: vec![1, 2] }];
        let t = sections(&one, &l, Some(&keys(false, false)), None);
        assert!(!t.contains("CommandListMenuList") && !t.contains("ResourceMenuList") && !t.contains("[KeyMenuOpen]") && !t.contains("XB_"));
        assert!(!t.contains("$zone == 2"), "no back button to light");
        assert!(t.contains("[CommandListMenuShow]\r\n; show the row the keys are on: row 0 is none of them\r\nif $char == 0\r\n  if $sel == 0\r\n    $g1 = 0\r\n"));
        // the app opens it, and a controller still moves in it
        let t = sections(&one, &l, Some(&keys(false, true)), None);
        assert!(!t.contains("[KeyMenuOpen]") && t.contains("key = XB_DPAD_UP") && t.contains("[KeyMenuClose]"));
        let off = sections(&one, &l, None, None);
        assert!(off.contains("[CommandListSeen1]") && off.contains("[CommandListOnScreen]") && !off.contains("$here") && !off.contains("CommandListMenu"));
        assert!(constants(&one, false, false).contains("global $open = 0") && constants(&one, false, false).contains("global $s1 = 0"));
    }

    #[test]
    fn games_get_their_look_and_every_look_keeps_to_its_layout() {
        assert_eq!([Look::of("zzz"), Look::of("gi"), Look::of("hsr"), Look::of("ww"), Look::of("hi3"), Look::of("ef")], LOOKS[..6]);
        assert_eq!(Look::of("pgr"), Look::Plain);
        assert_eq!(Layout::for_game(1080, "zzz").look, Look::Zzz);
        for look in LOOKS {
            for h in [720, 1080, 1440, 2160] {
                let l = Layout::with_look(h, look);
                // the middle strip of menu.dds holds two pairs of arrows, two checks and the bar's round ends
                assert!(l.cap_u(true, true) + l.bar_w <= l.w && l.chk <= l.foot, "{look:?} {h}");
                // a row: picture, name, then the check, with room for the name when the rows move in for the bar
                assert!(l.thumb < l.row && l.text_x() + l.s(120) < l.chk_x - l.room && l.chk_x + l.chk < l.w, "{look:?} {h}");
                // the check stays left of the bar
                assert!(l.chk_x - l.room + l.chk < l.bar_x, "{look:?} {h}");
            }
            let l = Layout::with_look(1080, look);
            let rows: Vec<Row> = (0..9).map(|i| Row { name: format!("Skin {i}"), preview: None }).collect();
            let p = render_page(&Page { n: 1, character: "Ellen".into(), rows }, &l, true);
            assert_eq!((p.w, p.h), (2 * l.w, l.head + 10 * l.row), "{look:?}");
            // the right half's header holds only the back button under the mouse
            let bx = l.w + l.pad + back_size(&l) as u32 + l.s(4);
            assert!((bx..2 * l.w).all(|x| p.px[((l.head / 2 * p.w + x) * 4 + 3) as usize] == 0), "{look:?}");
            let (hint, list_hint) = hints(&HintKeys::standard("F7"), true);
            let c = render_chrome(&l, &hint, &list_hint);
            assert_eq!((c.w, c.h), (l.w, 3 * l.foot + 2 * l.round));
            // round corners fit between the header's bar and the first pill, and only where there is a margin
            assert!(l.round == 0 || (l.gut > 0 && l.round >= l.gut && l.round < l.row), "{look:?}");
            let k = KeyLayout::of(&l);
            let s = render_sheet(&Sheet { n: 1, slot: 1, name: "Maid".into(), rows: vec![row("Jacket", "cycle", 3)] }, &l, &key_hints("F8").0);
            assert_eq!((s.w, s.h), (k.w, k.sheet_h(1)));
        }
    }

    #[cfg(windows)]
    #[test]
    fn text_in_any_language_draws_in_every_look() {
        for look in LOOKS {
            for s in ["夏日泳装", "Été", "Лето", "ELLEN"] {
                let f = look.row_font(18, true);
                let mask = gdi::text_mask(s, 200, 30, &f, false).unwrap();
                assert!(mask.iter().filter(|&&v| v > 128).count() > 20, "{look:?} {s}");
                assert!(text_w(s, f) > 10);
            }
        }
        // a face Windows doesn't have falls back
        let f = Font { face: "No Such Face 9", size: 18, weight: 400, italic: false, track: 0 };
        assert!(gdi::text_mask("Maid", 120, 30, &f, false).unwrap().iter().any(|&v| v > 128));
    }

    fn key_list(key: Option<&str>, pad: bool) -> KeyListIni {
        KeyListIni { sheets: vec![IniSheet { n: 2, slot: 4, h: 200 }, IniSheet { n: 7, slot: 3, h: 104 }], key: key.map(str::to_string), menu: if pad { vec!["XB_Y".into()] } else { vec![] } }
    }

    #[test]
    fn key_list_draws_a_sheet_per_skin_on_screen() {
        let l = Layout::new(1080);
        let k = KeyLayout::of(&l);
        let keys = keys(false, true);
        let t = sections(&pages(), &l, Some(&keys), Some(&key_list(None, true)));
        assert!(t.contains("[Present]\r\nif $keys == 1\r\n  run = CommandListKeysFrame\r\nendif\r\n"));
        // a sheet shows while its character is on screen wearing that skin, and the next one goes under it
        assert!(t.contains(&format!("  if $s2 == 1 && $g2 == 4\r\n    ps-t100 = ResourceKeys2_4\r\n$qx = $kx\r\n$qy = $ky\r\n$qw = {}\r\n$qh = 200\r\n", k.w)));
        assert!(t.contains(&format!("    $ky = $ky + {}\r\n  endif\r\n  if $s7 == 1 && $g7 == 3\r\n", 200 + k.gap)));
        assert!(t.contains(&format!("  $kx = $ww / $k - {}\r\n  $ky = {}\r\n", k.margin + k.w, k.margin)));
        assert!(t.contains(&format!("  if $ky == {}\r\n    ps-t100 = ResourceKeysNone\r\n", k.margin)) && t.contains("[ResourceKeysNone]\r\nfilename = menukeys.dds\r\n"));
        assert!(t.contains("[ResourceKeys7_3]\r\nfilename = menuk7_3.dds\r\n"));
        assert!(t.contains("[CommandListKeysToggle]\r\n$keys = 1 - $keys\r\n"));
        // the app holds the key, and Y shows it from the skin menu
        assert!(!t.contains("[KeyGachamodKeys]"));
        assert!(t.contains("[KeyMenuKeys]\r\ncondition = $open == 1\r\nkey = XB_Y\r\nrun = CommandListKeysToggle\r\n"));
        balanced(&t, &constants(&pages(), true, true));
        // the game binds the key itself, and without a controller there is no Y
        let t = sections(&pages(), &l, Some(&keys), Some(&key_list(Some("no_modifiers VK_F8"), false)));
        assert!(t.contains("[KeyGachamodKeys]\r\nkey = no_modifiers VK_F8\r\nrun = CommandListKeysToggle\r\n") && !t.contains("XB_Y"));
        balanced(&t, &constants(&pages(), true, true));
        // no sheet, or the menu off: nothing of the key list
        let none = KeyListIni { sheets: vec![], key: Some("no_modifiers VK_F8".into()), menu: vec!["XB_Y".into()] };
        assert!(!sections(&pages(), &l, Some(&keys), Some(&none)).contains("Keys"));
        assert!(!sections(&pages(), &l, None, Some(&key_list(Some("no_modifiers VK_F8"), true))).contains("Keys"));
    }

    fn row(what: &str, kind: &str, options: u32) -> crate::keylist::KeyRow {
        crate::keylist::KeyRow { keys: vec!["F6".into()], what: what.into(), kind: kind.into(), options, on_screen: true, ..Default::default() }
    }

    #[test]
    fn key_sheets_are_written_once_and_removed() {
        let dir = tempfile::tempdir().unwrap();
        let l = Layout::new(1080);
        let k = KeyLayout::of(&l);
        let sheets = vec![Sheet { n: 3, slot: 1, name: "Maid".into(), rows: vec![row("Jacket", "cycle", 3), row("Glow", "hold", 0)] }];
        assert!(write_key_assets(dir.path(), &sheets, &l, "F8").unwrap());
        assert!(dir.path().join("menuk3_1.dds").is_file() && dir.path().join("menukeys.dds").is_file() && dir.path().join("menukeys.json").is_file());
        assert!(!write_key_assets(dir.path(), &sheets, &l, "F8").unwrap());
        // another key in the footer makes it again
        assert!(write_key_assets(dir.path(), &sheets, &l, "F9").unwrap());
        // so does another game's look
        assert!(write_key_assets(dir.path(), &sheets, &Layout::for_game(1080, "zzz"), "F9").unwrap());
        // a long list is cut, and its picture is as high as the ini says
        let many: Vec<_> = (0..20).map(|i| row(&format!("Part {i}"), "toggle", 2)).collect();
        assert_eq!(render_sheet(&Sheet { n: 3, slot: 1, name: "Maid".into(), rows: many.clone() }, &l, &key_hints("F8").0).h, k.sheet_h(many.len()));
        assert_eq!(k.sheet_h(many.len()), k.head + 14 * k.row + k.foot);
        // a sheet that's gone loses its picture, and no sheets take every key list file away
        let other = vec![Sheet { n: 4, slot: 2, name: "Coat".into(), rows: many }];
        assert!(write_key_assets(dir.path(), &other, &l, "F8").unwrap());
        assert!(!dir.path().join("menuk3_1.dds").exists() && dir.path().join("menuk4_2.dds").is_file());
        // the menu's own pictures are left alone
        std::fs::write(dir.path().join("menu4.dds"), b"x").unwrap();
        assert!(write_key_assets(dir.path(), &[], &l, "F8").unwrap());
        let left: Vec<String> = std::fs::read_dir(dir.path()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert_eq!(left, vec!["menu4.dds".to_string()]);
        assert_eq!(key_note(&row("Jacket", "cycle", 2)), "");
        assert_eq!(key_note(&row("Jacket", "cycle", 5)), "5 options");
    }

    #[test]
    fn dds_reads_back() {
        let mut c = Canvas::new(3, 2, [10, 20, 30, 255]);
        c.fill(1, 1, 1, 1, [200, 100, 50, 128]);
        let bytes = dds(&c);
        let d = image_dds::ddsfile::Dds::read(&bytes[..]).unwrap();
        let img = image_dds::image_from_dds(&d, 0).unwrap();
        assert_eq!((img.width(), img.height()), (3, 2));
        assert_eq!(img.get_pixel(0, 0).0, [10, 20, 30, 255]);
        assert_eq!(img.get_pixel(1, 1).0, [200, 100, 50, 128]);
    }

    #[test]
    fn files_are_written_once() {
        let dir = tempfile::tempdir().unwrap();
        let l = Layout::new(1080);
        let pages = vec![Page { n: 3, character: "Ellen".into(), rows: vec![Row { name: "Maid".into(), preview: None }] }];
        assert!(write_assets(dir.path(), &pages, &l, &HintKeys::standard("F7")).unwrap());
        assert!(dir.path().join("menu.hlsl").is_file() && dir.path().join("menu3.dds").is_file() && dir.path().join("menu.dds").is_file());
        assert!(!write_assets(dir.path(), &pages, &l, &HintKeys::standard("F7")).unwrap());
        assert!(!dir.path().join("menu0.dds").exists(), "one character has no list of characters");
        // a renamed skin makes its page again; a character that left loses its picture
        let renamed = vec![Page { n: 4, character: "Ellen".into(), rows: vec![Row { name: "Maid 2".into(), preview: None }] }];
        assert!(write_assets(dir.path(), &renamed, &l, &HintKeys::standard("F7")).unwrap());
        assert!(!dir.path().join("menu3.dds").exists() && dir.path().join("menu4.dds").is_file());
        // a second character brings the list, and leaving takes it away again
        let two = vec![Page { n: 4, character: "Ellen".into(), rows: vec![] }, Page { n: 5, character: "Anby".into(), rows: vec![] }];
        assert!(write_assets(dir.path(), &two, &l, &HintKeys::standard("F7")).unwrap() && dir.path().join("menu0.dds").is_file());
        assert!(write_assets(dir.path(), &renamed, &l, &HintKeys::standard("F7")).unwrap() && !dir.path().join("menu0.dds").exists());
        assert!(clear(dir.path()));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    /// A rectangle the menu drew: where, how big, and from where in the bound picture.
    #[derive(Debug, Clone, Copy)]
    struct Quad { y: f64, w: f64, h: f64, u: f64, v: f64 }

    /// Runs live.ini's lists the way 3DMigoto does for the lines the menu writes: assignments, ifs, runs and `post`.
    /// Variables are kept without their `$`; the loader's own values (`cursor_x`, `window_width`) go in by name.
    struct Sim { secs: HashMap<String, Vec<String>>, vars: HashMap<String, f64>, quads: Vec<Quad>, post: Vec<String> }

    impl Sim {
        fn new(ini: &str) -> Self {
            let (mut secs, mut cur) = (HashMap::<String, Vec<String>>::new(), String::new());
            for s in ini.lines().map(str::trim) {
                if let Some(n) = s.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
                    secs.insert(n.to_string(), Vec::new());
                    cur = n.to_string();
                } else if !s.is_empty() && !s.starts_with(';') {
                    if let Some(v) = secs.get_mut(&cur) { v.push(s.to_string()); }
                }
            }
            let mut sim = Sim { secs, vars: HashMap::new(), quads: Vec::new(), post: Vec::new() };
            sim.set("window_width", 1920.0);
            sim.set("window_height", 1080.0);
            sim
        }
        fn get(&self, v: &str) -> f64 { self.vars.get(v).copied().unwrap_or(0.0) }
        fn set(&mut self, v: &str, x: f64) { self.vars.insert(v.to_string(), x); }
        fn run(&mut self, name: &str) {
            let lines = self.secs.get(name).unwrap_or_else(|| panic!("no [{name}]")).clone();
            // each open if: whether the lines around it run, whether a branch was taken, whether this branch runs
            let mut stack: Vec<(bool, bool, bool)> = Vec::new();
            for s in &lines {
                let on = stack.last().is_none_or(|f| f.2);
                if let Some(c) = s.strip_prefix("if ") {
                    let a = on && self.eval(c) != 0.0;
                    stack.push((on, a, a));
                } else if let Some(c) = s.strip_prefix("else if ") {
                    let (p, t, _) = *stack.last().unwrap();
                    let a = p && !t && self.eval(c) != 0.0;
                    *stack.last_mut().unwrap() = (p, t || a, a);
                } else if s == "else" {
                    let (p, t, _) = *stack.last().unwrap();
                    *stack.last_mut().unwrap() = (p, true, p && !t);
                } else if s == "endif" {
                    stack.pop();
                } else if !on {
                } else if let Some(p) = s.strip_prefix("post ") {
                    self.post.push(p.to_string());
                } else if let Some(t) = s.strip_prefix("run = ") {
                    if t == "CustomShaderMenuQuad" {
                        self.quads.push(Quad { y: self.get("qy"), w: self.get("qw"), h: self.get("qh"), u: self.get("qu"), v: self.get("qv") });
                    } else if !t.starts_with("BuiltIn") {
                        self.run(t);
                    }
                } else {
                    self.assign(s);
                }
            }
            assert!(stack.is_empty(), "[{name}] leaves an if open");
        }
        fn assign(&mut self, s: &str) {
            let Some((name, e)) = s.strip_prefix('$').and_then(|v| v.split_once('=')) else { return };
            let x = self.eval(e);
            self.set(name.trim(), x);
        }
        /// One frame: [Present], then its `post` lines.
        fn frame(&mut self) {
            self.post.clear();
            self.run("Present");
            for p in std::mem::take(&mut self.post) { self.assign(&p); }
        }
        fn eval(&self, e: &str) -> f64 {
            let mut toks = Vec::new();
            let cs: Vec<char> = e.chars().collect();
            let mut i = 0;
            while i < cs.len() {
                let c = cs[i];
                if c.is_whitespace() { i += 1; continue; }
                let two: String = cs[i..(i + 2).min(cs.len())].iter().collect();
                if ["==", "!=", "<=", ">=", "&&", "||"].contains(&two.as_str()) { toks.push(two); i += 2; continue; }
                let start = i;
                if c.is_ascii_alphanumeric() || c == '$' || c == '_' || c == '.' {
                    while i < cs.len() && (cs[i].is_ascii_alphanumeric() || cs[i] == '$' || cs[i] == '_' || cs[i] == '.') { i += 1; }
                } else {
                    i += 1;
                }
                toks.push(cs[start..i].iter().collect());
            }
            let mut at = 0;
            let v = self.or(&toks, &mut at);
            assert_eq!(at, toks.len(), "can't read {e}");
            v
        }
        fn or(&self, t: &[String], i: &mut usize) -> f64 {
            let mut v = self.and(t, i);
            while t.get(*i).is_some_and(|s| s == "||") { *i += 1; let r = self.and(t, i); v = (v != 0.0 || r != 0.0) as u8 as f64; }
            v
        }
        fn and(&self, t: &[String], i: &mut usize) -> f64 {
            let mut v = self.cmp(t, i);
            while t.get(*i).is_some_and(|s| s == "&&") { *i += 1; let r = self.cmp(t, i); v = (v != 0.0 && r != 0.0) as u8 as f64; }
            v
        }
        fn cmp(&self, t: &[String], i: &mut usize) -> f64 {
            let a = self.add(t, i);
            let Some(op) = t.get(*i).filter(|s| ["==", "!=", "<", "<=", ">", ">="].contains(&s.as_str())).cloned() else { return a };
            *i += 1;
            let b = self.add(t, i);
            let r = match op.as_str() { "==" => a == b, "!=" => a != b, "<" => a < b, "<=" => a <= b, ">" => a > b, _ => a >= b };
            r as u8 as f64
        }
        fn add(&self, t: &[String], i: &mut usize) -> f64 {
            let mut v = self.mul(t, i);
            while let Some(op) = t.get(*i).filter(|s| *s == "+" || *s == "-").cloned() {
                *i += 1;
                let r = self.mul(t, i);
                v = if op == "+" { v + r } else { v - r };
            }
            v
        }
        fn mul(&self, t: &[String], i: &mut usize) -> f64 {
            let mut v = self.atom(t, i);
            while let Some(op) = t.get(*i).filter(|s| *s == "*" || *s == "/").cloned() {
                *i += 1;
                let r = self.atom(t, i);
                v = if op == "*" { v * r } else { v / r };
            }
            v
        }
        fn atom(&self, t: &[String], i: &mut usize) -> f64 {
            let s = t[*i].clone();
            *i += 1;
            match s.as_str() {
                "-" => -self.atom(t, i),
                "(" => { let v = self.or(t, i); assert_eq!(t[*i], ")"); *i += 1; v }
                _ => s.parse::<f64>().unwrap_or_else(|_| self.get(s.trim_start_matches('$'))),
            }
        }
    }

    #[test]
    fn the_flags_are_there_with_the_menu_off_and_on() {
        let l = Layout::new(1080);
        for menu in [None, Some(keys(false, false))] {
            let t = sections(&pages(), &l, menu.as_ref(), None);
            let c = constants(&pages(), menu.is_some(), false);
            // saved, so the app can read it; the frame's flag and the count are not
            assert!(c.contains("global persist $o2 = 0\r\n") && c.contains("global persist $o7 = 0\r\n") && c.contains("global $h7 = 0\r\n"));
            assert!(!c.contains("global persist $s") && !c.contains("global persist $h"));
            assert!(t.contains("[Present]\r\n") && t.contains("run = CommandListOnScreen\r\npost $s2 = 0\r\npost $s7 = 0\r\n"), "{t}");
            assert!(t.contains("[CommandListOnScreen]\r\n; o<group>") &&t.contains(&format!("if $s7 == $o7\r\n  $h7 = 0\r\nelse\r\n  $h7 = $h7 + 1\r\n  if $h7 >= {HOLD}\r\n    $o7 = $s7\r\n")));
            balanced(&t, &c);
        }
    }

    #[test]
    fn on_screen_follows_the_flag_after_the_hold() {
        let l = Layout::new(1080);
        for menu in [None, Some(keys(false, false))] {
            let mut sim = Sim::new(&sections(&pages(), &l, menu.as_ref(), None));
            let seen = |sim: &mut Sim, frames: u32| for _ in 0..frames { sim.set("s7", 1.0); sim.frame(); };
            let gone = |sim: &mut Sim, frames: u32| for _ in 0..frames { sim.frame(); };
            seen(&mut sim, HOLD - 1);
            assert_eq!(sim.get("o7"), 0.0, "not yet");
            assert_eq!(sim.get("s7"), 0.0, "the flag clears after each frame");
            seen(&mut sim, 1);
            assert_eq!(sim.get("o7"), 1.0);
            assert_eq!(sim.get("o2"), 0.0);
            // a few frames out of view change nothing, and the count starts again when it's back
            gone(&mut sim, HOLD - 1);
            seen(&mut sim, 1);
            gone(&mut sim, HOLD - 1);
            assert_eq!(sim.get("o7"), 1.0);
            gone(&mut sim, 1);
            assert_eq!(sim.get("o7"), 0.0);
            if menu.is_some() { assert_eq!(sim.get("here"), 1.0, "the menu still knows who was seen last"); }
        }
    }

    /// What the list of characters shows: the character on each row in view (from the picture's rows), the row with the
    /// picked row's art and the character in it, and the rows with a check (true: in the picked row's colours).
    fn list_view(sim: &mut Sim, l: &Layout) -> (Vec<u32>, Option<(u32, u32)>, Vec<(u32, bool)>) {
        sim.quads.clear();
        sim.run("CommandListMenuFrame");
        let (y0, head, row) = (sim.get("y0"), l.head as f64, l.row as f64);
        let body = |q: &Quad| q.y >= y0 + head && q.y < y0 + head + sim.get("vis") * row;
        let mut rows: Vec<(f64, u32)> = Vec::new();
        let (mut pick, mut checks) = (None, Vec::new());
        for q in sim.quads.iter().filter(|q| body(q)) {
            let at = ((q.y - y0 - head) / row).floor() as u32;
            if q.w == l.w as f64 && q.u == 0.0 && q.v >= head {
                for i in 0..(q.h / row) as u32 { rows.push((q.y + i as f64 * row, ((q.v - head) / row) as u32 + i)); }
            } else if q.w == l.w as f64 && q.u == l.w as f64 {
                pick = Some((at, ((q.v - head) / row) as u32));
            } else if q.w == l.chk as f64 {
                checks.push((at, q.u == l.chk_u(true) as f64));
            }
        }
        rows.sort_by(|a, b| a.0.total_cmp(&b.0));
        (rows.into_iter().map(|r| r.1).collect(), pick, checks)
    }

    #[test]
    fn characters_on_screen_come_first_on_the_list() {
        let l = Layout::new(1080);
        let cast = vec![IniPage { n: 2, slots: vec![1, 2] }, IniPage { n: 5, slots: vec![1] }, IniPage { n: 7, slots: vec![3, 4] }, IniPage { n: 9, slots: vec![1] }];
        let t = sections(&cast, &l, Some(&keys(false, false)), None);
        balanced(&t, &constants(&cast, true, false));
        let mut sim = Sim::new(&t);

        // two on screen (pages 1 and 3): the menu opens on the list, with them first and checked, on the first of them
        sim.set("o5", 1.0);
        sim.set("o9", 1.0);
        sim.run("CommandListMenuToggle");
        assert_eq!((sim.get("open"), sim.get("char"), sim.get("seen"), sim.get("sel")), (1.0, 4.0, 2.0, 0.0));
        assert_eq!(list_view(&mut sim, &l), (vec![1, 3, 0, 2], Some((0, 1)), vec![(0, true), (1, false)]));
        sim.run("CommandListMenuDown");
        assert_eq!(list_view(&mut sim, &l), (vec![1, 3, 0, 2], Some((1, 3)), vec![(0, false), (1, true)]));
        // the second row opens the character on it, and back on the list the rows haven't moved though the game's
        // flags did, with the keys on that character
        sim.set("o5", 0.0);
        sim.set("o7", 1.0);
        sim.run("CommandListMenuShow");
        assert_eq!(sim.get("char"), 3.0);
        sim.run("CommandListMenuList");
        assert_eq!((sim.get("char"), sim.get("sel")), (4.0, 1.0));
        assert_eq!(list_view(&mut sim, &l).0, vec![1, 3, 0, 2]);
        // a click on the third row opens the character drawn there
        let y = (sim.get("y0") + (l.head + 2 * l.row + l.row / 2) as f64) / 1080.0;
        sim.set("cursor_x", (l.x0 + 100) as f64 / 1920.0);
        sim.set("cursor_y", y);
        assert_eq!(list_view(&mut sim, &l).1, Some((2, 0)), "the mouse picks the row under it");
        assert_eq!((sim.get("zone"), sim.get("hover")), (1.0, 2.0));
        sim.run("CommandListMenuClick");
        assert_eq!(sim.get("char"), 0.0);

        // one on screen: its skins, as before
        sim.run("CommandListMenuToggle");
        assert_eq!(sim.get("open"), 0.0);
        sim.set("o9", 0.0);
        sim.run("CommandListMenuToggle");
        assert_eq!((sim.get("char"), sim.get("seen")), (2.0, 1.0));

        // none: the character seen last, and the list in its usual order with the check on them
        sim.run("CommandListMenuToggle");
        sim.set("o7", 0.0);
        sim.set("here", 3.0);
        sim.run("CommandListMenuToggle");
        assert_eq!((sim.get("char"), sim.get("seen")), (3.0, 0.0));
        sim.run("CommandListMenuList");
        assert_eq!(sim.get("sel"), 3.0);
        assert_eq!(list_view(&mut sim, &l), (vec![0, 1, 2, 3], Some((3, 3)), vec![(3, true)]));
        sim.run("CommandListMenuShow");
        assert_eq!(sim.get("char"), 3.0);
    }

    #[test]
    fn a_long_list_scrolls_with_characters_on_screen_first() {
        let l = Layout::new(1080);
        let cast: Vec<IniPage> = (1..=10).map(|n| IniPage { n, slots: vec![1] }).collect();
        let t = sections(&cast, &l, Some(&keys(false, false)), None);
        balanced(&t, &constants(&cast, true, false));
        let mut sim = Sim::new(&t);
        // pages 7 and 9 on screen
        sim.set("o8", 1.0);
        sim.set("o10", 1.0);
        sim.run("CommandListMenuToggle");
        assert_eq!(list_view(&mut sim, &l).0, vec![7, 9, 0, 1, 2, 3, 4, 5]);
        // up from the top goes to the last row, and the list scrolls to it
        sim.run("CommandListMenuUp");
        let (rows, pick, checks) = list_view(&mut sim, &l);
        assert_eq!((rows, pick, checks), (vec![0, 1, 2, 3, 4, 5, 6, 8], Some((7, 8)), vec![]));
        assert_eq!(sim.get("top"), 2.0);
        sim.run("CommandListMenuShow");
        assert_eq!(sim.get("char"), 8.0);
        // back on the list, on that character's row, then a page up shows the marked ones again
        sim.run("CommandListMenuList");
        assert_eq!(sim.get("sel"), 9.0);
        sim.run("CommandListMenuPageUp");
        assert_eq!(list_view(&mut sim, &l).2, vec![(0, false), (1, false)]);
    }

    /// Pictures side by side with a gap, for one file per look.
    fn side_by_side(cs: &[Canvas]) -> Canvas {
        let gap = 16;
        let w = cs.iter().map(|c| c.w + gap).sum::<u32>() - gap;
        let mut out = Canvas::new(w, cs.iter().map(|c| c.h).max().unwrap_or(1), [40, 40, 40, 255]);
        let mut x0 = 0;
        for c in cs {
            for y in 0..c.h {
                for x in 0..c.w {
                    let i = ((y * c.w + x) * 4) as usize;
                    out.over((x0 + x) as i32, y as i32, [c.px[i], c.px[i + 1], c.px[i + 2]], c.px[i + 3] as f32 / 255.0);
                }
            }
            x0 += c.w + gap;
        }
        out
    }

    /// Set GACHAMOD_MENU_PNG to a folder to get a picture of each look's menu as the game would draw it, and
    /// GACHAMOD_MENU_THUMB to a picture to use for every skin.
    #[test]
    fn mock_picture() {
        let Some(out) = std::env::var_os("GACHAMOD_MENU_PNG") else { return };
        let out = std::path::Path::new(&out);
        let pic = std::env::var("GACHAMOD_MENU_THUMB").ok();
        let names = ["Beach day", "School uniform (long sleeves, with the jacket off)", "夏日泳装", "Maid", "Casual", "Winter coat", "Idol", "Gym", "Pyjamas"];
        for look in LOOKS {
            let l = Layout::with_look(1080, look);
            let rows: Vec<Row> = names.iter().map(|n| Row { name: n.to_string(), preview: pic.clone() }).collect();
            let n = rows.len() as u32 + 1;
            let (hint, list_hint) = hints(&HintKeys::standard("F7"), true);
            let chrome = render_chrome(&l, &hint, &list_hint);
            let page = render_page(&Page { n: 1, character: "Ellen Joe".into(), rows }, &l, true);
            // a character's skins scrolled down one, the keys on row 3 and the mouse on the up button; the check on
            // row 2. Then the list of characters with the keys on the one with the check.
            let skins = mock(&page, &chrome, &l, n, 1, 3, 2, 4, 0);
            let cast: Vec<Page> = ["Anby Demara", "Burnice White", "Ellen Joe", "Hoshimi Miyabi", "Jane Doe"].iter().enumerate()
                .map(|(i, c)| Page { n: i as u32 + 1, character: c.to_string(), rows: vec![Row { name: String::new(), preview: pic.clone() }] }).collect();
            let list = mock(&render_list(&cast, &l), &chrome, &l, cast.len() as u32, 0, 2, 2, 0, 2 * l.foot);
            // the back button under the mouse
            let back = mock(&page, &chrome, &l, n, 0, 0, 0, 2, 0);
            let mut rows = vec![row("Jacket", "cycle", 3), row("Glow", "hold", 0), row("Hat", "toggle", 2)];
            rows[1].keys = vec!["Ctrl+H".into(), "Pad LB+Pad A".into()];
            rows.extend((0..14).map(|i| row(&format!("Accessory {i}"), "toggle", 2)));
            let (khint, none_hint) = key_hints("F8");
            let sheet = render_sheet(&Sheet { n: 1, slot: 1, name: "Ellen Joe: Maid (School uniform)".into(), rows }, &l, &khint);
            let none = render_no_keys(&l, &none_hint);
            let all = side_by_side(&[skins, list, back, sheet, none]);
            let name = format!("menu-{}.png", format!("{look:?}").to_lowercase());
            image::RgbaImage::from_raw(all.w, all.h, all.px).unwrap().save(out.join(name)).unwrap();
        }
        // and the sections as they go into live.ini, to read through
        let keys = keys(true, true);
        let text = format!("[Constants]\r\n{}{}", constants(&pages(), true, true), sections(&pages(), &Layout::for_game(1080, "zzz"), Some(&keys), Some(&key_list(None, true))));
        std::fs::write(out.join("menu-sections.ini"), text).unwrap();
    }
}
