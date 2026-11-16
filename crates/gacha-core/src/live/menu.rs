//! The skin menu the game draws by itself (docs/ingame.md, "The menu inside the game"). It needs nothing but
//! 3DMigoto, so it also shows in exclusive fullscreen, where gachamod's own window can't.
//!
//! gachamod writes three kinds of file next to live.ini: `menu.hlsl` (a shader that draws one rectangle),
//! `menu<group>.dds` (one picture per character: a header and a row per skin, text already drawn) and `menu.dds`
//! (the footer and the small marks). The sections added to live.ini keep the menu's state in variables, move it with
//! keys, a controller or the mouse, and draw the rectangles each frame while it is open. Picking a row sets the
//! group's number, the same number the gates in the mod inis read, so the skin changes in that frame.
//!
//! The key list the game draws (keylist.rs) rides on the same window size and shader: `menuk<group>_<slot>.dds` is one
//! picture per live skin with its keys, drawn in the top right corner while that skin's character is on screen.
//!
//! Every size is in menu pixels: the pictures are made for the screen's height, and the shader scales them when the
//! game's window is another size. Owner: INGAME area.

use crate::error::Result;
use std::collections::HashMap;
use std::path::Path;

/// Bump when the pictures or the ini change shape, so files made by an older version are made again.
const VERSION: u32 = 4;
/// The number the app sends with no group to open or close the menu.
pub(crate) const TOGGLE: u32 = 1;
/// The number the app sends with no group to show or hide the key list the game draws.
pub(crate) const KEYS: u32 = 2;
const NL: &str = "\r\n";

const BG: [u8; 4] = [0x13, 0x16, 0x1d, 255];
const BAND: [u8; 4] = [0x1a, 0x1e, 0x27, 255];
const LINE: [u8; 4] = [0x23, 0x28, 0x35, 255];
const BOX: [u8; 4] = [0x23, 0x28, 0x35, 255];
const TEXT: [u8; 3] = [0xee, 0xf0, 0xf5];
const DIM: [u8; 3] = [0xb3, 0xbb, 0xc9];
const ACCENT: [u8; 3] = [0x8b, 0x7c, 0xff];

/// Sizes in menu pixels, for a screen `gen_h` pixels high (the same numbers at 1080 are in `new`).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Layout {
    pub gen_h: u32,
    pub w: u32,
    pub head: u32,
    pub row: u32,
    pub thumb: u32,
    pub pad: u32,
    pub foot: u32,
    /// Width of a header arrow and of a scroll button.
    pub arw: u32,
    pub bar: u32,
    pub chk: u32,
    /// Gap between the screen's left edge and the menu.
    pub x0: u32,
    /// Rows shown at once.
    pub vis: u32,
}

impl Layout {
    pub fn new(screen_h: u32) -> Self {
        let gen_h = screen_h.clamp(720, 2160);
        let s = |v: u32| ((v * gen_h) as f32 / 1080.0).round() as u32;
        Layout { gen_h, w: s(440), head: s(60), row: s(68), thumb: s(52), pad: s(12), foot: s(36), arw: s(44), bar: s(4).max(2), chk: s(24), x0: s(40), vis: 8 }
    }
    fn s(&self, v: u32) -> u32 { ((v * self.gen_h) as f32 / 1080.0).round() as u32 }
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
/// 3DMigoto binding when the game binds it itself; `pad`: Y shows it from the skin menu.
pub(crate) struct KeyListIni { pub sheets: Vec<IniSheet>, pub key: Option<String>, pub pad: bool }

/// The menu's keys. `open` is a 3DMigoto binding ("no_modifiers VK_F7") and `pad_open` both sticks pressed in; both
/// are left out when the app holds the key and opens the menu itself. `pad`: a controller moves and picks in it.
pub(crate) struct Keys { pub open: Option<String>, pub pad_open: bool, pub pad: bool }

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
    /// A flat rectangle.
    fn flat(&mut self, x: impl AsRef<str>, y: impl AsRef<str>, w: impl AsRef<str>, h: impl AsRef<str>, rgb: [u8; 3], alpha: f32) {
        self.l(format!("$qx = {}", x.as_ref()));
        self.l(format!("$qy = {}", y.as_ref()));
        self.l(format!("$qw = {}", w.as_ref()));
        self.l(format!("$qh = {}", h.as_ref()));
        self.l("$qflat = 1");
        self.l(format!("$qa = {alpha}"));
        self.l(format!("$qr = {:.3}", rgb[0] as f32 / 255.0));
        self.l(format!("$qg = {:.3}", rgb[1] as f32 / 255.0));
        self.l(format!("$qb = {:.3}", rgb[2] as f32 / 255.0));
        self.l("run = CustomShaderMenuQuad");
    }
}

const VARS: &[&str] = &["char", "here", "fv", "sel", "top", "rows", "vis", "act", "zone", "hover", "lx", "ly", "mx", "my", "ww", "wh",
    "k", "y0", "qx", "qy", "qw", "qh", "qu", "qv", "qflat", "qa", "qr", "qg", "qb"];
/// The IniParams the shader reads. Other mods may use them too, so the menu puts back what was there.
const SLOTS: [u32; 4] = [86, 87, 88, 89];
const XYZW: [char; 4] = ['x', 'y', 'z', 'w'];

/// The lines for live.ini's [Constants]. `$open` and the on-screen flags are always there: the gated mod inis read
/// them whether the menu is on or not. `key_list`: the key list's own variables too.
pub(crate) fn constants(pages: &[IniPage], on: bool, key_list: bool) -> String {
    let mut o = Out::default();
    o.l("global $open = 0");
    for p in pages { o.l(format!("global $s{} = 0", p.n)); }
    if on {
        for v in VARS { o.l(format!("global ${v} = 0")); }
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
    let Some(keys) = keys else { return o.0 };
    let many = pages.len() > 1;
    let list = pages.len();
    let (w, head, row, foot, arw, x0, vis) = (l.w, l.head, l.row, l.foot, l.arw, l.x0, l.vis);
    let right = x0 + w;

    o.l("");
    o.l("; ── the menu the game draws ──");
    o.section("Present");
    let key_list = key_list.filter(|k| !k.sheets.is_empty());
    if key_list.is_some() {
        // the on-screen flags are still set here: `post` clears them after the frame
        o.l("if $keys == 1");
        o.l("  run = CommandListKeysFrame");
        o.l("endif");
    }
    for (k, p) in pages.iter().enumerate() {
        o.l(format!("if $s{} == 1", p.n));
        o.l(format!("  $here = {k}"));
        o.l("endif");
    }
    for p in pages { o.l(format!("post $s{} = 0", p.n)); }
    o.l("if $open == 1");
    o.l("  run = CommandListMenuFrame");
    o.l("endif");

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
        o.l("; the list of characters: the check is on the one on screen");
        o.l(format!("if $char == {list}"));
        o.l(format!("  $rows = {list}"));
        o.l("  $act = $here");
        o.l(format!("  $fv = {}", 2 * foot));
        o.l("endif");
    }
    o.l("$vis = $rows");
    o.l(format!("if $vis > {vis}"));
    o.l(format!("  $vis = {vis}"));
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
    o.l("; where the menu sits, and what the mouse is over: 1 a row, 2 a character's header (back to the list), 4 and 5 the scroll buttons");
    o.l(format!("$k = $wh / {}", l.gen_h));
    o.l(format!("$y0 = ({} - $vis * {row}) / 2", l.gen_h - head - foot));
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
    o.l(format!("    if $my >= $y0 + {head} + $vis * {row} && $my < $y0 + {} + $vis * {row}", head + foot));
    o.l(format!("      if $mx >= {}", right - 2 * arw));
    o.l("        $zone = 4");
    o.l("      endif");
    o.l(format!("      if $mx >= {}", right - arw));
    o.l("        $zone = 5");
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
    o.quad(x0.to_string(), format!("$y0 + {head}"), w.to_string(), format!("$vis * {row}"), "0", format!("{head} + $top * {row}"));
    o.quad(x0.to_string(), "$y0", w.to_string(), head.to_string(), "0", "0");
    o.l("; the row the keys are on");
    o.l("if $sel >= $top && $sel < $top + $vis");
    o.flat(x0.to_string(), format!("$y0 + {head} + ($sel - $top) * {row}"), w.to_string(), row.to_string(), [255, 255, 255], 0.09);
    o.flat(x0.to_string(), format!("$y0 + {head} + ($sel - $top) * {row}"), l.bar.to_string(), row.to_string(), ACCENT, 1.0);
    o.l("endif");
    o.l("ps-t100 = ResourceMenuChrome");
    o.quad(x0.to_string(), format!("$y0 + {head} + $vis * {row}"), w.to_string(), foot.to_string(), "0", "$fv");
    o.l("; a check on the skin that is showing");
    o.l("if $act >= $top && $act < $top + $vis");
    o.quad((right - l.pad - l.chk).to_string(), format!("$y0 + {} + ($act - $top) * {row}", head + (row - l.chk) / 2),
        l.chk.to_string(), l.chk.to_string(), (2 * arw).to_string(), foot.to_string());
    o.l("endif");
    o.l("; scroll buttons when the list is longer than the menu");
    o.l("if $rows > $vis");
    o.quad((right - 2 * arw).to_string(), format!("$y0 + {head} + $vis * {row}"), arw.to_string(), foot.to_string(), "0", foot.to_string());
    o.quad((right - arw).to_string(), format!("$y0 + {head} + $vis * {row}"), arw.to_string(), foot.to_string(), arw.to_string(), foot.to_string());
    o.l("endif");
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
    o.l("; opening goes to the character on screen");
    o.l("$open = 1 - $open");
    o.l("if $open == 1");
    o.l("  $char = $here");
    o.l("  run = CommandListMenuTurn");
    o.l("endif");

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
        o.l("  $sel = $char");
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
        o.l("  $char = $sel");
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
    o.l("if $zone == 4");
    o.l("  run = CommandListMenuPageUp");
    o.l("endif");
    o.l("if $zone == 5");
    o.l("  run = CommandListMenuPageDown");
    o.l("endif");

    if keys.open.is_some() || keys.pad_open {
        o.section("KeyMenuOpen");
        if let Some(k) = &keys.open { o.l(format!("key = {k}")); }
        if keys.pad_open { o.l("key = XB_LEFT_THUMB XB_RIGHT_THUMB"); }
        o.l("run = CommandListMenuToggle");
    }
    let mut key = |name: &str, keyboard: &str, pad: &str, cond: &str, run: &str| {
        o.section(name);
        o.l(format!("condition = {cond}"));
        o.l(format!("key = {keyboard}"));
        if keys.pad && !pad.is_empty() { o.l(format!("key = {pad}")); }
        o.l(format!("run = {run}"));
    };
    key("KeyMenuUp", "VK_UP", "XB_DPAD_UP", "$open == 1", "CommandListMenuUp");
    key("KeyMenuDown", "VK_DOWN", "XB_DPAD_DOWN", "$open == 1", "CommandListMenuDown");
    if many {
        key("KeyMenuList", "VK_LEFT", "XB_DPAD_LEFT", "$open == 1", "CommandListMenuList");
    }
    // right is the key the hints name: games open their chat on Enter, which still works but isn't shown
    key("KeyMenuShow", "VK_RIGHT", "XB_DPAD_RIGHT", "$open == 1", "CommandListMenuShow");
    key("KeyMenuEnter", "VK_RETURN", "XB_A", "$open == 1", "CommandListMenuShow");
    key("KeyMenuClick", "VK_LBUTTON", "", "$open == 1 && $zone > 0", "CommandListMenuClick");
    if keys.pad {
        o.section("KeyMenuClose");
        o.l("condition = $open == 1");
        o.l("key = XB_B");
        o.l("run = CommandListMenuToggle");
    }
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
    if kl.pad {
        o.section("KeyMenuKeys");
        o.l("condition = $open == 1");
        o.l("key = XB_Y");
        o.l("run = CommandListKeysToggle");
    }
}

/// The words under a character's skins and under the list of characters. `key` is the menu key as the player
/// reads it ("F7").
pub(crate) fn hints(key: &str, many: bool) -> (String, String) {
    let skins = format!("\u{2191} \u{2193} choose   \u{2192} show{}   {key} close", if many { "   \u{2190} characters" } else { "" });
    (skins, format!("\u{2191} \u{2193} choose   \u{2192} open   {key} close"))
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

pub(crate) struct Canvas { pub w: u32, pub h: u32, pub px: Vec<u8> }

impl Canvas {
    fn new(w: u32, h: u32, fill: [u8; 4]) -> Self {
        let mut px = Vec::with_capacity((w * h * 4) as usize);
        for _ in 0..w * h { px.extend_from_slice(&fill); }
        Canvas { w, h, px }
    }
    fn fill(&mut self, x: u32, y: u32, w: u32, h: u32, c: [u8; 4]) {
        for yy in y..(y + h).min(self.h) {
            for xx in x..(x + w).min(self.w) {
                let i = ((yy * self.w + xx) * 4) as usize;
                self.px[i..i + 4].copy_from_slice(&c);
            }
        }
    }
    /// Lay a colour over a pixel with `cov` (0 to 1) of it covered.
    fn over(&mut self, x: i32, y: i32, rgb: [u8; 3], cov: f32) {
        if x < 0 || y < 0 || x >= self.w as i32 || y >= self.h as i32 || cov <= 0.0 { return; }
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
    /// A line through `pts`, `width` pixels thick, with smooth edges.
    fn stroke(&mut self, pts: &[(f32, f32)], width: f32, rgb: [u8; 3]) {
        let r = width / 2.0;
        let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for &(x, y) in pts { x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y); }
        for y in (y0 - r - 1.0).floor() as i32..=(y1 + r + 1.0).ceil() as i32 {
            for x in (x0 - r - 1.0).floor() as i32..=(x1 + r + 1.0).ceil() as i32 {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                let mut d = f32::MAX;
                for s in pts.windows(2) {
                    let ((ax, ay), (bx, by)) = (s[0], s[1]);
                    let (vx, vy) = (bx - ax, by - ay);
                    let len = vx * vx + vy * vy;
                    let t = if len > 0.0 { (((px - ax) * vx + (py - ay) * vy) / len).clamp(0.0, 1.0) } else { 0.0 };
                    let (cx, cy) = (ax + vx * t - px, ay + vy * t - py);
                    d = d.min((cx * cx + cy * cy).sqrt());
                }
                self.over(x, y, rgb, (r + 0.5 - d).clamp(0.0, 1.0));
            }
        }
    }
    fn image(&mut self, x: u32, y: u32, img: &image::RgbaImage) {
        for (ix, iy, p) in img.enumerate_pixels() {
            self.over((x + ix) as i32, (y + iy) as i32, [p[0], p[1], p[2]], p[3] as f32 / 255.0);
        }
    }
    /// One line of text in a box, cut with "..." when it is too long.
    #[allow(clippy::too_many_arguments)]
    fn text(&mut self, x: u32, y: u32, w: u32, h: u32, s: &str, size: u32, bold: bool, rgb: [u8; 3]) {
        if w == 0 || h == 0 || s.is_empty() { return; }
        let Some(mask) = gdi::text_mask(s, w, h, size, bold) else { return };
        for yy in 0..h {
            for xx in 0..w {
                let cov = mask[(yy * w + xx) as usize];
                if cov > 0 { self.over((x + xx) as i32, (y + yy) as i32, rgb, cov as f32 / 255.0); }
            }
        }
    }
}

/// A mod's preview, cut square. None for a remote picture or one that can't be read.
fn thumb(preview: &str, size: u32) -> Option<image::RgbaImage> {
    if preview.contains("://") { return None; }
    let img = image::ImageReader::open(preview).ok()?.with_guessed_format().ok()?.decode().ok()?;
    Some(img.resize_to_fill(size, size, image::imageops::FilterType::Triangle).to_rgba8())
}

pub(crate) fn render_page(p: &Page, l: &Layout, many: bool) -> Canvas {
    let rows = p.rows.len() as u32 + 1;
    let mut c = Canvas::new(l.w, l.head + l.row * rows, BG);
    c.fill(0, 0, l.w, l.head, BAND);
    // with more characters, an arrow before the name: left (or a click here) goes back to the list of them
    let back = if many { l.s(24) } else { 0 };
    if many {
        let (mid, a, t) = (l.head as f32 / 2.0, l.s(7) as f32, (l.s(2) as f32).max(1.5));
        let x = (l.pad + l.bar) as f32 + a / 2.0 + 1.0;
        c.stroke(&[(x + a / 2.0, mid - a), (x - a / 2.0, mid), (x + a / 2.0, mid + a)], t, DIM);
    }
    c.text(l.pad + l.bar + back, 0, l.w.saturating_sub(2 * l.pad + l.bar + back), l.head, &p.character, l.s(22), true, TEXT);
    let text_x = l.pad + l.bar + l.thumb + l.pad;
    let text_w = l.w.saturating_sub(text_x + l.pad + l.chk + l.pad);
    for i in 0..rows {
        let y = l.head + i * l.row;
        let (tx, ty) = (l.pad + l.bar, y + (l.row - l.thumb) / 2);
        c.fill(tx, ty, l.thumb, l.thumb, BOX);
        if i == 0 {
            // an empty box with a line through it: none of these skins
            let (a, b) = (l.thumb as f32 * 0.3, l.thumb as f32 * 0.7);
            c.stroke(&[(tx as f32 + a, ty as f32 + b), (tx as f32 + b, ty as f32 + a)], (l.s(2) as f32).max(1.5), DIM);
            c.text(text_x, y, text_w, l.row, "None", l.s(17), false, DIM);
        } else {
            let r = &p.rows[i as usize - 1];
            if let Some(img) = r.preview.as_deref().and_then(|p| thumb(p, l.thumb)) { c.image(tx, ty, &img); }
            c.text(text_x, y, text_w, l.row, &r.name, l.s(17), false, TEXT);
        }
        c.fill(0, y + l.row - 1, l.w, 1, LINE);
    }
    c
}

/// The list of characters: a row each, with a picture of one of the character's skins.
pub(crate) fn render_list(pages: &[Page], l: &Layout) -> Canvas {
    let mut c = Canvas::new(l.w, l.head + l.row * pages.len() as u32, BG);
    c.fill(0, 0, l.w, l.head, BAND);
    c.text(l.pad + l.bar, 0, l.w.saturating_sub(2 * l.pad + l.bar), l.head, "Characters", l.s(22), true, TEXT);
    let text_x = l.pad + l.bar + l.thumb + l.pad;
    let text_w = l.w.saturating_sub(text_x + l.pad + l.chk + l.pad);
    for (i, p) in pages.iter().enumerate() {
        let y = l.head + i as u32 * l.row;
        let (tx, ty) = (l.pad + l.bar, y + (l.row - l.thumb) / 2);
        c.fill(tx, ty, l.thumb, l.thumb, BOX);
        if let Some(img) = p.rows.iter().find_map(|r| r.preview.as_deref()).and_then(|p| thumb(p, l.thumb)) { c.image(tx, ty, &img); }
        c.text(text_x, y, text_w, l.row, &p.character, l.s(17), false, TEXT);
        c.fill(0, y + l.row - 1, l.w, 1, LINE);
    }
    c
}

/// Three strips: the footer under a character's skins, then the two scroll buttons and the check drawn on the row
/// that is showing, then the footer under the list of characters.
pub(crate) fn render_chrome(l: &Layout, hint: &str, list_hint: &str) -> Canvas {
    let mut c = Canvas::new(l.w, l.foot * 3, [0, 0, 0, 0]);
    c.fill(0, 0, l.w, l.foot, BAND);
    c.text(l.pad + l.bar, 0, l.w.saturating_sub(2 * l.pad + 2 * l.arw), l.foot, hint, l.s(13), false, DIM);
    c.fill(0, 2 * l.foot, l.w, l.foot, BAND);
    c.text(l.pad + l.bar, 2 * l.foot, l.w.saturating_sub(2 * l.pad + 2 * l.arw), l.foot, list_hint, l.s(13), false, DIM);
    c.fill(0, l.foot, 2 * l.arw, l.foot, BAND);
    let (mid, a, t) = (l.foot as f32 * 1.5, l.s(6) as f32, (l.s(2) as f32).max(1.5));
    let (up, down) = (l.arw as f32 / 2.0, l.arw as f32 * 1.5);
    c.stroke(&[(up - a, mid + a / 2.0), (up, mid - a / 2.0), (up + a, mid + a / 2.0)], t, DIM);
    c.stroke(&[(down - a, mid - a / 2.0), (down, mid + a / 2.0), (down + a, mid - a / 2.0)], t, DIM);
    let (x, y, s) = ((2 * l.arw) as f32, l.foot as f32, l.chk as f32);
    c.stroke(&[(x + s * 0.2, y + s * 0.52), (x + s * 0.42, y + s * 0.74), (x + s * 0.82, y + s * 0.28)], (l.s(3) as f32).max(2.0), ACCENT);
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

/// The words in a sheet's footer, and in the picture that says no character on screen has keys. `key` is the key
/// list key as the player reads it ("F8").
pub(crate) fn key_hints(key: &str) -> (String, String) { (format!("{key} hide keys"), format!("{key} hide this")) }

/// A sheet: the mod's name, one row per key (the key, what it changes, a note), and the key that hides it.
pub(crate) fn render_sheet(s: &Sheet, l: &Layout, hint: &str) -> Canvas {
    let k = KeyLayout::of(l);
    let mut c = Canvas::new(k.w, k.sheet_h(s.rows.len()), BG);
    c.fill(0, 0, k.w, k.head, BAND);
    c.fill(0, 0, l.bar, k.head, [ACCENT[0], ACCENT[1], ACCENT[2], 255]);
    c.text(k.pad + l.bar, 0, k.w.saturating_sub(2 * k.pad + l.bar), k.head, &s.name, l.s(17), true, TEXT);
    let cut = s.rows.len() > KEY_ROWS;
    let shown = if cut { KEY_ROWS - 1 } else { s.rows.len() };
    let what_x = k.pad + k.key_w;
    let what_w = k.w.saturating_sub(what_x + k.note_w + k.pad);
    for (i, r) in s.rows.iter().take(shown).enumerate() {
        let y = k.head + i as u32 * k.row;
        c.text(k.pad, y, k.key_w.saturating_sub(l.s(8)), k.row, &r.keys.join(", "), l.s(15), true, ACCENT);
        c.text(what_x, y, what_w, k.row, &r.what, l.s(15), false, TEXT);
        c.text(k.w - k.pad - k.note_w + l.s(8), y, k.note_w - l.s(8), k.row, &key_note(r), l.s(13), false, DIM);
        c.fill(k.pad, y + k.row - 1, k.w - 2 * k.pad, 1, LINE);
    }
    if cut {
        let y = k.head + shown as u32 * k.row;
        c.text(k.pad, y, k.w - 2 * k.pad, k.row, &format!("{} more keys", s.rows.len() - shown), l.s(14), false, DIM);
    }
    let fy = k.head + s.rows.len().min(KEY_ROWS) as u32 * k.row;
    c.fill(0, fy, k.w, k.foot, BAND);
    c.text(k.pad, fy, k.w - 2 * k.pad, k.foot, hint, l.s(13), false, DIM);
    c
}

/// The picture drawn when none of the characters on screen has a sheet.
pub(crate) fn render_no_keys(l: &Layout, hint: &str) -> Canvas {
    let k = KeyLayout::of(l);
    let mut c = Canvas::new(k.w, k.none_h(), BG);
    c.text(k.pad, 0, k.w - 2 * k.pad, k.head, "No mod keys for the characters on screen", l.s(15), false, TEXT);
    c.fill(0, k.head, k.w, k.foot, BAND);
    c.text(k.pad, k.head, k.w - 2 * k.pad, k.foot, hint, l.s(13), false, DIM);
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
        let base = format!("{VERSION}:{}", l.gen_h);
        let (hint, none_hint) = key_hints(key);
        let mark = stamp(&[base.clone(), none_hint.clone()]);
        let file = dir.join("menukeys.dds");
        if old.get("none") != Some(&mark) || !file.is_file() {
            crate::xxmi::write_atomic(&file, &dds(&render_no_keys(l, &none_hint)))?;
            changed = true;
        }
        new.insert("none".into(), mark);
        files.push("menukeys.dds".into());
        for s in sheets {
            let mut parts = vec![base.clone(), hint.clone(), s.name.clone()];
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

/// The menu as the shader lays it out, for a look at it without the game.
#[cfg(test)]
pub(crate) fn mock(page: &Canvas, chrome: &Canvas, l: &Layout, rows: u32, top: u32, sel: u32, act: u32) -> Canvas {
    let vis = rows.min(l.vis);
    let mut c = Canvas::new(l.w, l.head + vis * l.row + l.foot, BG);
    let copy = |c: &mut Canvas, from: &Canvas, dx: u32, dy: u32, w: u32, h: u32, u: u32, v: u32| {
        for y in 0..h {
            for x in 0..w {
                let i = (((v + y) * from.w + u + x) * 4) as usize;
                c.over((dx + x) as i32, (dy + y) as i32, [from.px[i], from.px[i + 1], from.px[i + 2]], from.px[i + 3] as f32 / 255.0);
            }
        }
    };
    copy(&mut c, page, 0, l.head, l.w, vis * l.row, 0, l.head + top * l.row);
    copy(&mut c, page, 0, 0, l.w, l.head, 0, 0);
    if sel >= top && sel < top + vis {
        let y = l.head + (sel - top) * l.row;
        for yy in y..y + l.row {
            for xx in 0..l.w { c.over(xx as i32, yy as i32, [255, 255, 255], 0.09); }
        }
        c.fill(0, y, l.bar, l.row, [ACCENT[0], ACCENT[1], ACCENT[2], 255]);
    }
    copy(&mut c, chrome, 0, l.head + vis * l.row, l.w, l.foot, 0, 0);
    if act >= top && act < top + vis {
        copy(&mut c, chrome, l.w - l.pad - l.chk, l.head + (act - top) * l.row + (l.row - l.chk) / 2, l.chk, l.chk, 2 * l.arw, l.foot);
    }
    if rows > vis {
        copy(&mut c, chrome, l.w - 2 * l.arw, l.head + vis * l.row, 2 * l.arw, l.foot, 0, l.foot);
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
pub(crate) fn write_assets(dir: &Path, pages: &[Page], l: &Layout, key: &str) -> Result<bool> {
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
    let base = format!("{VERSION}:{}", l.gen_h);
    let (hint, list_hint) = hints(key, many);

    let mark = stamp(&[base.clone(), hint.clone(), list_hint.clone()]);
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

/// Text drawn by Windows, so any language a mod is named in shows (Windows picks a font that has the letters).
#[cfg(windows)]
mod gdi {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, DrawTextW, GdiFlush, SelectObject, SetBkMode, SetTextColor,
        ANTIALIASED_QUALITY, BITMAPINFO, BITMAPINFOHEADER, DEFAULT_CHARSET, DIB_RGB_COLORS, DT_END_ELLIPSIS, DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER,
        TRANSPARENT,
    };

    /// How much of each pixel of a `w` by `h` box the text covers (0 to 255), left aligned and centred top to bottom.
    pub fn text_mask(s: &str, w: u32, h: u32, size: u32, bold: bool) -> Option<Vec<u8>> {
        let wide: Vec<u16> = s.encode_utf16().collect();
        let face: Vec<u16> = "Segoe UI\0".encode_utf16().collect();
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
            let font = CreateFontW(-(size as i32), 0, 0, 0, if bold { 600 } else { 400 }, 0, 0, 0, DEFAULT_CHARSET as _, 0, 0, ANTIALIASED_QUALITY as _, 0, face.as_ptr());
            let old_font = SelectObject(dc, font);
            SetBkMode(dc, TRANSPARENT as _);
            SetTextColor(dc, 0x00FF_FFFF);
            let mut rc = RECT { left: 0, top: 0, right: w as i32, bottom: h as i32 };
            DrawTextW(dc, wide.as_ptr(), wide.len() as i32, &mut rc, DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX | DT_END_ELLIPSIS);
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
}

#[cfg(not(windows))]
mod gdi {
    pub fn text_mask(_s: &str, _w: u32, _h: u32, _size: u32, _bold: bool) -> Option<Vec<u8>> { None }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pages() -> Vec<IniPage> { vec![IniPage { n: 2, slots: vec![1, 4] }, IniPage { n: 7, slots: vec![3] }] }

    #[test]
    fn ini_has_the_menu_and_balanced_ifs() {
        let l = Layout::new(1080);
        let t = sections(&pages(), &l, Some(&Keys { open: Some("no_modifiers VK_F7".into()), pad_open: true, pad: true }), None);
        assert!(t.contains("[CommandListSeen2]\r\n$s2 = 1\r\n"));
        assert!(t.contains("[KeyMenuOpen]\r\nkey = no_modifiers VK_F7\r\nkey = XB_LEFT_THUMB XB_RIGHT_THUMB\r\nrun = CommandListMenuToggle\r\n"));
        // row 2 of the first character is slot 4
        assert!(t.contains("  if $char == 0\r\n    if $sel == 0\r\n      $g2 = 0\r\n    endif\r\n    if $sel == 1\r\n      $g2 = 1\r\n    endif\r\n    if $sel == 2\r\n      $g2 = 4\r\n    endif\r\n  endif"));
        // page 2 lists the two characters: a row there opens that character, left goes back to it
        assert!(t.contains("[CommandListMenuShow]\r\n; on the list of characters a row opens that character\r\nif $char == 2\r\n  $char = $sel\r\n  run = CommandListMenuTurn\r\nelse\r\n"));
        assert!(t.contains("if $char == 2\r\n  $rows = 2\r\n  $act = $here\r\n") && t.contains("[ResourceMenuList]\r\nfilename = menu0.dds\r\n"));
        assert!(t.contains("[KeyMenuList]\r\ncondition = $open == 1\r\nkey = VK_LEFT\r\nkey = XB_DPAD_LEFT\r\nrun = CommandListMenuList\r\n"));
        assert!(t.contains("[ResourceMenuPage7]\r\nfilename = menu7.dds\r\n"));
        assert!(t.contains("post $s7 = 0\r\n"));
        assert!(!t.contains("Keys"), "no key list asked for");
        balanced(&t, &constants(&pages(), true, false));
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
            assert!(v.starts_with("$g") || consts.contains(&format!("global {v} = 0")), "{v} isn't declared");
        }
    }

    #[test]
    fn one_character_has_no_arrows_and_off_keeps_the_flags() {
        let l = Layout::new(1080);
        let one = vec![IniPage { n: 1, slots: vec![1, 2] }];
        let t = sections(&one, &l, Some(&Keys { open: None, pad_open: false, pad: false }), None);
        assert!(!t.contains("CommandListMenuList") && !t.contains("ResourceMenuList") && !t.contains("[KeyMenuOpen]") && !t.contains("XB_"));
        assert!(t.contains("[CommandListMenuShow]\r\n; show the row the keys are on: row 0 is none of them\r\nif $char == 0\r\n  if $sel == 0\r\n    $g1 = 0\r\n"));
        // the app opens it, and a controller still moves in it
        let t = sections(&one, &l, Some(&Keys { open: None, pad_open: false, pad: true }), None);
        assert!(!t.contains("[KeyMenuOpen]") && t.contains("key = XB_DPAD_UP") && t.contains("[KeyMenuClose]"));
        let off = sections(&one, &l, None, None);
        assert!(off.contains("[CommandListSeen1]") && !off.contains("[Present]"));
        assert!(constants(&one, false, false).contains("global $open = 0") && constants(&one, false, false).contains("global $s1 = 0"));
    }

    fn key_list(key: Option<&str>, pad: bool) -> KeyListIni {
        KeyListIni { sheets: vec![IniSheet { n: 2, slot: 4, h: 200 }, IniSheet { n: 7, slot: 3, h: 104 }], key: key.map(str::to_string), pad }
    }

    #[test]
    fn key_list_draws_a_sheet_per_skin_on_screen() {
        let l = Layout::new(1080);
        let k = KeyLayout::of(&l);
        let keys = Keys { open: None, pad_open: false, pad: true };
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
        let none = KeyListIni { sheets: vec![], key: Some("no_modifiers VK_F8".into()), pad: true };
        assert!(!sections(&pages(), &l, Some(&keys), Some(&none)).contains("Keys"));
        assert!(!sections(&pages(), &l, None, Some(&key_list(Some("no_modifiers VK_F8"), true))).contains("Keys"));
    }

    fn row(what: &str, kind: &str, options: u32) -> crate::keylist::KeyRow {
        crate::keylist::KeyRow { keys: vec!["F6".into()], what: what.into(), kind: kind.into(), options, on_screen: true }
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
        // a long list is cut, and its picture is as high as the ini says
        let many: Vec<_> = (0..20).map(|i| row(&format!("Part {i}"), "toggle", 2)).collect();
        assert_eq!(render_sheet(&Sheet { n: 3, slot: 1, name: "Maid".into(), rows: many.clone() }, &l, "F8 hide keys").h, k.sheet_h(many.len()));
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
        assert!(write_assets(dir.path(), &pages, &l, "F7").unwrap());
        assert!(dir.path().join("menu.hlsl").is_file() && dir.path().join("menu3.dds").is_file() && dir.path().join("menu.dds").is_file());
        assert!(!write_assets(dir.path(), &pages, &l, "F7").unwrap());
        assert!(!dir.path().join("menu0.dds").exists(), "one character has no list of characters");
        // a renamed skin makes its page again; a character that left loses its picture
        let renamed = vec![Page { n: 4, character: "Ellen".into(), rows: vec![Row { name: "Maid 2".into(), preview: None }] }];
        assert!(write_assets(dir.path(), &renamed, &l, "F7").unwrap());
        assert!(!dir.path().join("menu3.dds").exists() && dir.path().join("menu4.dds").is_file());
        // a second character brings the list, and leaving takes it away again
        let two = vec![Page { n: 4, character: "Ellen".into(), rows: vec![] }, Page { n: 5, character: "Anby".into(), rows: vec![] }];
        assert!(write_assets(dir.path(), &two, &l, "F7").unwrap() && dir.path().join("menu0.dds").is_file());
        assert!(write_assets(dir.path(), &renamed, &l, "F7").unwrap() && !dir.path().join("menu0.dds").exists());
        assert!(clear(dir.path()));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    /// Set GACHAMOD_MENU_PNG to a folder to get a picture of the menu as the game would draw it.
    #[test]
    fn mock_picture() {
        let Some(out) = std::env::var_os("GACHAMOD_MENU_PNG") else { return };
        let l = Layout::new(1080);
        let names = ["Beach day", "School uniform (long sleeves, with the jacket off)", "夏日泳装", "Maid", "Casual", "Winter coat", "Idol", "Gym", "Pyjamas"];
        let rows: Vec<Row> = names.iter().map(|n| Row { name: n.to_string(), preview: std::env::var("GACHAMOD_MENU_THUMB").ok() }).collect();
        let n = rows.len() as u32 + 1;
        let (hint, list_hint) = hints("F7", true);
        let ellen = Page { n: 1, character: "Ellen Joe".into(), rows };
        let page = render_page(&ellen, &l, true);
        // the list of characters, drawn the same way with its own footer
        let cast: Vec<Page> = ["Anby Demara", "Burnice White", "Ellen Joe", "Hoshimi Miyabi", "Jane Doe"].iter().enumerate()
            .map(|(i, c)| Page { n: i as u32 + 1, character: c.to_string(), rows: vec![Row { name: String::new(), preview: std::env::var("GACHAMOD_MENU_THUMB").ok() }] }).collect();
        let list = render_list(&cast, &l);
        let mut both = render_chrome(&l, &hint, &list_hint);
        both.px.copy_within((2 * l.foot * l.w * 4) as usize..(3 * l.foot * l.w * 4) as usize, 0);
        let lm = mock(&list, &both, &l, cast.len() as u32, 0, 2, 2);
        image::RgbaImage::from_raw(lm.w, lm.h, lm.px).unwrap().save(std::path::Path::new(&out).join("menu-list.png")).unwrap();
        let chrome = render_chrome(&l, &hint, &list_hint);
        let m = mock(&page, &chrome, &l, n, 1, 3, 2);
        image::RgbaImage::from_raw(m.w, m.h, m.px).unwrap().save(std::path::Path::new(&out).join("menu.png")).unwrap();
        // and the sections as they go into live.ini, to read through
        let keys = Keys { open: Some("no_modifiers VK_F7".into()), pad_open: true, pad: true };
        let text = format!("[Constants]
{}{}", constants(&pages(), true, true), sections(&pages(), &l, Some(&keys), Some(&key_list(None, true))));
        std::fs::write(std::path::Path::new(&out).join("menu-sections.ini"), text).unwrap();
        // a key sheet, cut after its rows run out, and the picture shown when no one on screen has keys
        let mut rows = vec![row("Jacket", "cycle", 3), row("Glow", "hold", 0), row("Hat", "toggle", 2)];
        rows[1].keys = vec!["Ctrl+H".into(), "Pad LB+Pad A".into()];
        rows.extend((0..14).map(|i| row(&format!("Accessory {i}"), "toggle", 2)));
        let (hint, none_hint) = key_hints("F8");
        let s = render_sheet(&Sheet { n: 1, slot: 1, name: "Ellen Joe: Maid (School uniform)".into(), rows }, &l, &hint);
        image::RgbaImage::from_raw(s.w, s.h, s.px).unwrap().save(std::path::Path::new(&out).join("menu-keys.png")).unwrap();
        let s = render_no_keys(&l, &none_hint);
        image::RgbaImage::from_raw(s.w, s.h, s.px).unwrap().save(std::path::Path::new(&out).join("menu-no-keys.png")).unwrap();
    }
}
