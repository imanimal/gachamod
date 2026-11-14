//! Tests on inis shaped like the ones mods ship (GIMI, ZZMI, WWMI, SRMI and merged mods, pad keys, namespaces,
//! odd encodings). Every write is checked by its exact text, and every undo by comparing bytes with the original.
use super::*;
use std::fs;

fn temp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("gachamod-keys-{name}-{}", crate::library::new_id()));
    fs::create_dir_all(&d).unwrap();
    d
}

fn doc(text: &str) -> Doc { Doc::from_bytes(text.as_bytes()) }

fn idoc(rel: &str, text: &str) -> IniDoc {
    IniDoc { rel: rel.into(), abs: PathBuf::from(rel), raw: text.as_bytes().to_vec(), doc: doc(text) }
}

fn text(d: &IniDoc) -> String { String::from_utf8(d.doc.to_bytes()).unwrap() }

/// A plain toggle mod made by hand: no on-screen check, CRLF, a pad binding next to a keyboard one.
const PLAIN: &str = "; Ayaka swimsuit\r\n; Down cycles the outfit, H takes the hat off\r\n\r\n[Constants]\r\nglobal persist $swapvar = 0\r\nglobal persist $hat = 1\r\n\r\n\
[KeySwap]\r\nkey = VK_DOWN\r\nback = VK_UP\r\ntype = cycle\r\n$swapvar = 0,1,2\r\n\r\n\
[KeyHat]\r\nkey = no_modifiers h\r\nkey = XB_LEFT_SHOULDER XB_A\r\ntype = toggle\r\n$hat = 0\r\n\r\n\
[TextureOverrideAyakaPosition]\r\nhash = 1a2b3c4d\r\nvb0 = ResourceAyakaPosition\r\n\r\n\
[TextureOverrideAyakaBlend]\r\nhash = 2b3c4d5e\r\nvb1 = ResourceAyakaBlend\r\nhandling = skip\r\ndraw = 21000,0\r\n\r\n\
[TextureOverrideAyakaVertexLimitRaise]\r\nhash = 3c4d5e6f\r\noverride_vertex_count = 21000\r\n\r\n\
[TextureOverrideAyakaIB]\r\nhash = 4d5e6f70\r\nhandling = skip\r\n\r\n\
[TextureOverrideAyakaHead]\r\nhash = 4d5e6f70\r\nmatch_first_index = 0\r\nib = ResourceAyakaHeadIB\r\nps-t0 = ResourceAyakaHeadDiffuse\r\n\r\n\
[ResourceAyakaPosition]\r\ntype = Buffer\r\nstride = 40\r\nfilename = AyakaPosition.buf\r\n";

/// ZZMI style: the mod tracks `$active` itself and its menu keys hang off `$menu`. LF endings, two [Constants].
const OWN: &str = "[KeyMenu]\ncondition = $active == 1\nkey = no_modifiers /\ntype = cycle\n$menu = 0,1\n\n[Constants]\nglobal $window_width = 1920\n\n\
[KeyMenu.Up]\ncondition = $menu == 1\nkey = no_alt no_shift ctrl VK_UP\ntype = hold\n\n[Constants]\nglobal $active\nglobal $menu = 0\n\n\
[Present]\nif $active\n\tif $menu\n\t\trun = CommandListMenu\n\tendif\nendif\n\npost $active = 0\n\n\
[TextureOverrideEllenBlend]\nhash = c06c0417\nhandling = skip\nvb2 = ResourceEllenBlend\nif DRAW_TYPE == 1\n\tvb0 = ResourceEllenPosition\n\tdraw = 35688,0\nendif\n$active = 1\n";

/// WWMI style: `$object_detected` is set by the component draws and cleared in [Present] inside an if, but the
/// keys only check `$mod_enabled`, which stays 1 once the mod registered. So the keys work off screen.
const WWMI: &str = "[KeyMenu]\ncondition = $mod_enabled == 1\nkey = no_modifiers VK_OEM_2\nkey = XB_RIGHT_THUMB\ntype = cycle\n$menu = 0,1\n\n\
[Constants]\nglobal $mod_enabled = 0\nglobal $object_detected = 0\nglobal $menu = 0\n\n\
[Present]\nif $object_detected\n    if $mod_enabled\n        post $object_detected = 0\n    else\n        run = CommandListRegisterMod\n    endif\nendif\n\n\
[CommandListRegisterMod]\n$mod_enabled = 1\n\n\
[TextureOverrideComponent0]\nhash = 5b33088a\nmatch_first_index = 0\nmatch_index_count = 14832\n$object_detected = 1\nif $mod_enabled\n    drawindexed = 14832, 0, 0\nendif\n\n\
[TextureOverrideComponent1]\nhash = 5b33088a\nmatch_first_index = 14832\nmatch_index_count = 900\n$object_detected = 1\n\n\
[TextureOverrideTexture0]\nhash = 9a8b7c6d\nif $object_detected\n    this = ResourceTexture0\nendif\n";

fn rt(rel: &str, original: &str, change: impl FnOnce(&mut [IniDoc])) -> String {
    let mut docs = vec![idoc(rel, original)];
    change(&mut docs);
    let changed = text(&docs[0]);
    // the way back: stripping gives the original bytes
    let mut back = vec![idoc(rel, &changed)];
    strip_on_screen(&mut back[0].doc);
    reset_doc(&mut back[0].doc);
    assert_eq!(text(&back[0]), original, "undoing from the file alone gives the original");
    changed
}

#[test]
fn lines_and_endings_survive() {
    for t in ["", "a", "a\n", "a\r\nb", "a\r\nb\n\nc\r\n", "[x]\r\n\r\n"] {
        assert_eq!(String::from_utf8(doc(t).to_bytes()).unwrap(), t);
    }
    assert_eq!(doc("a\r\nb\r\nc\n").nl, "\r\n");
    assert_eq!(doc("a\nb\n").nl, "\n");
    // BOMs and UTF-16 come back byte for byte
    let bom = b"\xEF\xBB\xBF[KeyA]\r\nkey = x\r\n".to_vec();
    assert_eq!(Doc::from_bytes(&bom).to_bytes(), bom);
    let utf16: Vec<u8> = [0xFF, 0xFE].into_iter().chain("[KeyA]\r\nkey = x\r\n".encode_utf16().flat_map(|u| u.to_le_bytes())).collect();
    assert_eq!(Doc::from_bytes(&utf16).to_bytes(), utf16);
    // GBK comments (not UTF-8) are kept exactly, also after an edit
    let gbk = b"; \xb0\xb4\xbc\xfc\xc7\xd0\xbb\xbb\r\n[KeySwap]\r\nkey = VK_DOWN\r\n".to_vec();
    let mut d = Doc::from_bytes(&gbk);
    assert_eq!(d.enc, Enc::Bytes);
    rebind_doc(&mut d, "a.ini", &KeyTarget { ini: "a.ini".into(), section: "KeySwap".into(), field: "key".into(), index: 0 }, "VK_F6").unwrap();
    let out = d.to_bytes();
    assert!(out.starts_with(b"; \xb0\xb4\xbc\xfc\xc7\xd0\xbb\xbb\r\n[KeySwap]\r\n"));
    assert!(out.ends_with(b"; gachamod changed this key. It was: key = VK_DOWN\r\nkey = VK_F6\r\n"));
}

#[test]
fn composes_bindings_in_the_lines_style() {
    let c = |old: &str, new: &str| compose(old, new).unwrap();
    assert_eq!(c("no_modifiers h", "VK_F6"), "no_modifiers VK_F6");
    assert_eq!(c("no_modifiers h", "ctrl VK_J"), "no_alt no_shift ctrl J");
    assert_eq!(c("NO_MODIFIERS h", "f6"), "NO_MODIFIERS VK_F6");
    assert_eq!(c("CTRL 1", "ctrl 2"), "CTRL 2");
    assert_eq!(c("ALT VK_NUMPAD1", "alt shift VK_NUMPAD2"), "ALT shift VK_NUMPAD2");
    assert_eq!(c("no_ctrl no_alt VK_F5", "ctrl VK_F6"), "no_alt ctrl VK_F6");
    assert_eq!(c("no_alt no_ctrl no_shift right", "left"), "no_alt no_ctrl no_shift VK_LEFT");
    assert_eq!(c("VK_DOWN", "XB_LEFT_SHOULDER xb_a"), "XB_LEFT_SHOULDER XB_A");
    assert_eq!(c("no_modifiers h", "XB_B"), "XB_B");
    assert_eq!(c("x", "/"), "VK_OEM_2");
    assert_eq!(c("x", "alt shift r"), "alt shift R");
    assert_eq!(c("x", "shift alt 0x41"), "alt shift A");
    assert_eq!(c("x", "0x7b"), "0x7B");
    assert_eq!(c("x", "no_ctrl VK_UP"), "no_ctrl VK_UP");
    assert_eq!(c("x", "ctrl VK_F10"), "ctrl VK_F10");
    for bad in ["", "ctrl", "VK_F10", "ctrl alt VK_F10", "VK_NOPE", "XB_Z"] { assert!(compose("x", bad).is_err(), "{bad}"); }
}

#[test]
fn rebinds_and_puts_back() {
    let t = |section: &str, field: &str, index: u32| KeyTarget { ini: "a.ini".into(), section: section.into(), field: field.into(), index };
    let out = rt("a.ini", PLAIN, |d| {
        rebind_doc(&mut d[0].doc, "a.ini", &t("KeySwap", "key", 0), "VK_F6").unwrap();
        rebind_doc(&mut d[0].doc, "a.ini", &t("keyhat", "key", 1), "XB_RIGHT_SHOULDER XB_Y").unwrap();
        // a second change keeps the author's line in the marker
        rebind_doc(&mut d[0].doc, "a.ini", &t("KeySwap", "key", 0), "VK_F7").unwrap();
    });
    assert!(out.contains("[KeySwap]\r\n; gachamod changed this key. It was: key = VK_DOWN\r\nkey = VK_F7\r\nback = VK_UP\r\n"), "{out}");
    assert!(out.contains("key = no_modifiers h\r\n; gachamod changed this key. It was: key = XB_LEFT_SHOULDER XB_A\r\nkey = XB_RIGHT_SHOULDER XB_Y\r\n"), "{out}");
    // binding the author's key again drops the marker: the file is as it was
    let mut d = vec![idoc("a.ini", &out)];
    rebind_doc(&mut d[0].doc, "a.ini", &t("KeySwap", "key", 0), "VK_DOWN").unwrap();
    rebind_doc(&mut d[0].doc, "a.ini", &t("KeyHat", "key", 1), "XB_LEFT_SHOULDER XB_A").unwrap();
    assert_eq!(text(&d[0]), PLAIN);
    // lines that aren't there
    assert!(rebind_doc(&mut d[0].doc, "a.ini", &t("KeySwap", "key", 1), "VK_F6").is_err());
    assert!(rebind_doc(&mut d[0].doc, "a.ini", &t("KeyNope", "key", 0), "VK_F6").is_err());
    assert!(rebind_doc(&mut d[0].doc, "a.ini", &t("TextureOverrideAyakaIB", "key", 0), "VK_F6").is_err());
}

#[test]
fn turns_keys_off_and_on() {
    let out = rt("a.ini", PLAIN, |d| {
        set_off_doc(&mut d[0].doc, "a.ini", "KeySwap", true).unwrap();
    });
    assert!(out.contains("[KeySwap]\r\n; gachamod turned this key off: key = VK_DOWN\r\n; gachamod turned this key off: back = VK_UP\r\ntype = cycle\r\n"), "{out}");
    let mut d = vec![idoc("a.ini", &out)];
    let k = read_keys("m", &d);
    let swap = k.keys.iter().find(|e| e.section == "KeySwap").unwrap();
    assert!(swap.off && swap.lines.iter().all(|l| l.off));
    assert!(k.changed);
    // can't rebind while off; on again gives the original
    let t = KeyTarget { ini: "a.ini".into(), section: "KeySwap".into(), field: "key".into(), index: 0 };
    assert!(rebind_doc(&mut d[0].doc, "a.ini", &t, "VK_F6").is_err());
    set_off_doc(&mut d[0].doc, "a.ini", "KeySwap", false).unwrap();
    assert_eq!(text(&d[0]), PLAIN);
    // a changed key that is off comes back as the author's key and on
    let mut d = vec![idoc("a.ini", PLAIN)];
    rebind_doc(&mut d[0].doc, "a.ini", &t, "ctrl VK_F6").unwrap();
    set_off_doc(&mut d[0].doc, "a.ini", "KeySwap", true).unwrap();
    assert!(text(&d[0]).contains("; gachamod changed this key. It was: key = VK_DOWN\r\n; gachamod turned this key off: key = ctrl VK_F6\r\n"));
    reset_doc(&mut d[0].doc);
    assert_eq!(text(&d[0]), PLAIN);
}

#[test]
fn lists_keys_with_readable_names() {
    let k = read_keys("m", &[idoc("a.ini", PLAIN)]);
    assert_eq!(k.keys.len(), 2);
    let swap = &k.keys[0];
    assert_eq!((swap.section.as_str(), swap.kind.as_str(), swap.name.as_str()), ("KeySwap", "cycle", "Swap"));
    assert_eq!(swap.lines.iter().map(|l| (l.field.as_str(), l.label.as_str())).collect::<Vec<_>>(), vec![("key", "Down"), ("back", "Up")]);
    assert_eq!(swap.vars[0].values, vec!["0", "1", "2"]);
    let hat = &k.keys[1];
    assert_eq!(hat.name, "Hat");
    assert_eq!(hat.lines.iter().map(|l| (l.label.as_str(), l.pad)).collect::<Vec<_>>(), vec![("H", false), ("Pad LB+Pad A", true)]);
    assert!(!hat.on_screen && hat.condition.is_none());
    assert_eq!(k.on_screen, "off");
    assert!(!k.changed);
    // after a rebind the original shows
    let mut d = vec![idoc("a.ini", PLAIN)];
    rebind_doc(&mut d[0].doc, "a.ini", &KeyTarget { ini: "a.ini".into(), section: "KeyHat".into(), field: "key".into(), index: 0 }, "ctrl VK_F6").unwrap();
    let d = vec![idoc("a.ini", &text(&d[0]))];
    let hat = read_keys("m", &d).keys.into_iter().find(|e| e.section == "KeyHat").unwrap();
    assert_eq!(hat.lines[0].label, "Ctrl+F6");
    assert_eq!(hat.lines[0].value, "no_alt no_shift ctrl VK_F6");
    assert_eq!(hat.lines[0].original_label.as_deref(), Some("H"));
    assert_eq!(hat.lines[1].original, None);
}

#[test]
fn on_screen_for_a_plain_mod() {
    let out = rt("a.ini", PLAIN, |d| {
        assert!(on_screen_docs(d, None).is_empty());
    });
    let want = "; Ayaka swimsuit\r\n; Down cycles the outfit, H takes the hat off\r\n\r\n[Constants]\r\n\
; gachamod added the next line (keys only while on screen)\r\nglobal $gachamod_onscreen = 0\r\nglobal persist $swapvar = 0\r\nglobal persist $hat = 1\r\n\r\n\
[KeySwap]\r\n; gachamod added the next line (keys only while on screen)\r\ncondition = $gachamod_onscreen == 1\r\nkey = VK_DOWN\r\nback = VK_UP\r\ntype = cycle\r\n$swapvar = 0,1,2\r\n\r\n\
[KeyHat]\r\n; gachamod added the next line (keys only while on screen)\r\ncondition = $gachamod_onscreen == 1\r\nkey = no_modifiers h\r\nkey = XB_LEFT_SHOULDER XB_A\r\ntype = toggle\r\n$hat = 0\r\n\r\n\
[TextureOverrideAyakaPosition]\r\nhash = 1a2b3c4d\r\n; gachamod added the next line (keys only while on screen)\r\n$gachamod_onscreen = 1\r\nvb0 = ResourceAyakaPosition\r\n\r\n\
[TextureOverrideAyakaBlend]\r\nhash = 2b3c4d5e\r\n; gachamod added the next line (keys only while on screen)\r\n$gachamod_onscreen = 1\r\nvb1 = ResourceAyakaBlend\r\nhandling = skip\r\ndraw = 21000,0\r\n\r\n\
[TextureOverrideAyakaVertexLimitRaise]\r\nhash = 3c4d5e6f\r\noverride_vertex_count = 21000\r\n\r\n[TextureOverrideAyakaIB]\r\nhash = 4d5e6f70\r\nhandling = skip\r\n\r\n";
    assert!(out.starts_with(want), "{out}");
    assert!(out.ends_with("filename = AyakaPosition.buf\r\n; gachamod added this section (keys only while on screen)\r\n[Present]\r\npost $gachamod_onscreen = 0\r\n"), "{out}");
    let k = read_keys("m", &[idoc("a.ini", &out)]);
    assert_eq!(k.on_screen, "on");
    assert!(k.keys.iter().all(|e| e.on_screen && e.condition.is_none()));
    // a second time changes nothing
    let mut again = vec![idoc("a.ini", &out)];
    on_screen_docs(&mut again, None);
    assert!(!again[0].changed());
}

#[test]
fn leaves_mods_that_do_it_themselves() {
    let mut d = vec![idoc("Ellen.ini", OWN)];
    let k = read_keys("m", &d);
    assert_eq!(k.on_screen, "own");
    assert!(k.keys[0].on_screen, "the menu key checks $active");
    assert!(k.keys[1].on_screen, "the menu's keys need $menu, which only the gated menu key opens");
    on_screen_docs(&mut d, None);
    assert!(!d[0].changed());
    // when something else can open the menu too, its keys work any time
    let open = format!("{OWN}\n[KeyMenuAnywhere]\nkey = F6\n$menu = 1\n");
    let k = read_keys("m", &[idoc("Ellen.ini", &open)]);
    assert!(!k.keys[1].on_screen);
    let open = format!("{OWN}\n[CommandListOpen]\n$menu = 1\n");
    assert!(!read_keys("m", &[idoc("Ellen.ini", &open)]).keys[1].on_screen);
    // keys in the same mod: no clash with each other (same mod), and KeyMenu reads as "Menu"
    assert_eq!(k.keys[0].name, "Menu");
    assert_eq!(k.keys[1].lines[0].label, "Ctrl+Up");
}

#[test]
fn on_screen_wwmi_keeps_the_authors_condition() {
    let out = rt("mod.ini", WWMI, |d| { assert!(on_screen_docs(d, None).is_empty()); });
    assert!(out.starts_with("[KeyMenu]\n; gachamod changed the next line (keys only while on screen). It was: condition = $mod_enabled == 1\n\
condition = ($mod_enabled == 1) && $gachamod_onscreen == 1\nkey = no_modifiers VK_OEM_2\n"), "{out}");
    // the flag goes where the mod sets its own "drawn" variable: both components, not the texture
    assert!(out.contains("[TextureOverrideComponent0]\nhash = 5b33088a\n; gachamod added the next line (keys only while on screen)\n$gachamod_onscreen = 1\nmatch_first_index = 0\n"), "{out}");
    assert!(out.contains("[TextureOverrideComponent1]\nhash = 5b33088a\n; gachamod added the next line (keys only while on screen)\n$gachamod_onscreen = 1\n"), "{out}");
    assert!(!out.contains("[TextureOverrideTexture0]\nhash = 9a8b7c6d\n; gachamod"), "{out}");
    assert!(out.contains("[Present]\n; gachamod added the next line (keys only while on screen)\npost $gachamod_onscreen = 0\nif $object_detected\n"), "{out}");
    assert!(out.contains("[Constants]\n; gachamod added the next line (keys only while on screen)\nglobal $gachamod_onscreen = 0\nglobal $mod_enabled = 0\n"), "{out}");
    let k = read_keys("m", &[idoc("mod.ini", &out)]);
    assert_eq!(k.on_screen, "on");
    assert_eq!(k.keys[0].condition.as_deref(), Some("$mod_enabled == 1"));
}

#[test]
fn multi_ini_mods_share_the_flag_by_namespace() {
    let main = "namespace = AyakaMain\r\n\r\n[Constants]\r\nglobal persist $swapvar = 0\r\n\r\n[Present]\r\n\r\n[TextureOverrideAyakaPosition]\r\nhash = 1a2b3c4d\r\nvb0 = ResourceAyakaPosition\r\n";
    let keys = "[KeyHair]\r\nkey = ctrl 1\r\n$\\AyakaMain\\swapvar = 0,1\r\n";
    let mut d = vec![idoc("Ayaka.ini", main), idoc("Toggles/hair.ini", keys)];
    assert_eq!(read_keys("m", &d).on_screen, "off");
    assert!(on_screen_docs(&mut d, None).is_empty());
    assert_eq!(text(&d[1]), "[KeyHair]\r\n; gachamod added the next line (keys only while on screen)\r\ncondition = $\\AyakaMain\\gachamod_onscreen == 1\r\nkey = ctrl 1\r\n$\\AyakaMain\\swapvar = 0,1\r\n");
    let m = text(&d[0]);
    assert!(m.contains("[Present]\r\n; gachamod added the next line (keys only while on screen)\r\npost $gachamod_onscreen = 0\r\n"), "{m}");
    assert!(m.contains("hash = 1a2b3c4d\r\n; gachamod added the next line (keys only while on screen)\r\n$gachamod_onscreen = 1\r\n"), "{m}");
    let after: Vec<IniDoc> = d.iter().map(|x| idoc(&x.rel, &text(x))).collect();
    let k = read_keys("m", &after);
    assert_eq!(k.on_screen, "on");
    assert!(k.keys[0].on_screen);
    // without a namespace the keys' ini can't reach the other one's flag
    let plain_main = main.replacen("namespace = AyakaMain\r\n", "", 1);
    let mut d = vec![idoc("Ayaka.ini", &plain_main), idoc("Toggles/hair.ini", keys)];
    assert_eq!(read_keys("m", &d).on_screen, "cant");
    assert_eq!(on_screen_docs(&mut d, None), vec!["Toggles/hair.ini".to_string()]);
    assert!(!d[0].changed() && !d[1].changed());
}

#[test]
fn finds_flags_set_elsewhere() {
    // reset in a command list that [Present] runs (the menu template some Endfield mods use)
    let via_list = "[KeyMenu]\ncondition = $active == 1\nkey = /\n$menu = 0,1\n\n[Present]\nrun = CommandListMain\n\n\
[CommandListMain]\nif $active\n\trun = CommandListDraw\nendif\npost $active = 0\n\n[CommandListDraw]\n$x = 1\n\n\
[TextureOverrideBody]\nhash = 01020304\nvb0 = ResourceBody\n$active = 1\n";
    assert_eq!(read_keys("m", &[idoc("mod.ini", via_list)]).on_screen, "own");
    // the same reset in a command list nothing runs from [Present] isn't a reset
    let unused = via_list.replace("[Present]\nrun = CommandListMain\n", "[Present]\n");
    assert_eq!(read_keys("m", &[idoc("mod.ini", &unused)]).on_screen, "off");
    // a menu's command list setting $hovering isn't the character being drawn (nothing drawn runs it)
    let menu = "[KeyHold]\ncondition = $hovering == 0\nkey = VK_LBUTTON\n\n[Present]\npost $hovering = 0\n\n\
[CommandListArrows]\n$hovering = 1\n\n[TextureOverrideBody]\nhash = 01020304\nvb0 = ResourceBody\n";
    assert_eq!(read_keys("m", &[idoc("mod.ini", menu)]).on_screen, "off");
    // the same list run from the body override is
    let drawn = menu.replace("vb0 = ResourceBody\n", "vb0 = ResourceBody\nrun = CommandListArrows\n");
    assert_eq!(read_keys("m", &[idoc("mod.ini", &drawn)]).on_screen, "own");
    // a part's ini sets the main ini's flag through its namespace
    let main = "namespace = Beacons\\Master\n\n[KeyStyle]\ncondition = $chest_detected == 1\nkey = VK_UP\n$style = 0,1\n\n\
[Present]\npost $chest_detected = 0\n";
    let part = "[TextureOverrideChest]\nhash = 0a0b0c0d\n$\\Beacons\\Master\\chest_detected = 1\n";
    assert_eq!(read_keys("m", &[idoc("mod.ini", main), idoc("Chests/mod.ini", part)]).on_screen, "own");
    assert_eq!(read_keys("m", &[idoc("mod.ini", main)]).on_screen, "global");
}

#[test]
fn merged_mods_flag_every_skin() {
    // the merge script's shape: one ini, the skins picked by $swapvar inside command lists, $active already there
    let merged = "[Constants]\r\nglobal persist $swapvar = 0\r\nglobal $active\r\n\r\n[KeySwap]\r\ncondition = $active == 1\r\nkey = VK_DOWN\r\ntype = cycle\r\n$swapvar = 0,1\r\n\r\n\
[Present]\r\npost $active = 0\r\n\r\n[TextureOverrideKiraraPosition]\r\nhash = 11112222\r\nrun = CommandListKiraraPosition\r\n$active = 1\r\n\r\n\
[CommandListKiraraPosition]\r\nif $swapvar == 0\r\n\tvb0 = ResourceKiraraPosition.0\r\nelse if $swapvar == 1\r\n\tvb0 = ResourceKiraraPosition.1\r\nendif\r\n";
    assert_eq!(read_keys("m", &[idoc("merged.ini", merged)]).on_screen, "own");
    // the same without $active: several characters' position overrides all set the flag
    let bare = "[KeySwap]\r\nkey = VK_DOWN\r\ntype = cycle\r\n$swapvar = 0,1\r\n\r\n[TextureOverrideKiraraPosition]\r\nhash = 11112222\r\nvb0 = ResourceA\r\n\r\n\
[TextureOverrideQiqiPosition]\r\nhash = 33334444\r\nvb0 = ResourceB\r\n\r\n[TextureOverrideQiqiIB]\r\nhash = 55556666\r\nhandling = skip\r\n";
    let out = rt("merged.ini", bare, |d| { on_screen_docs(d, None); });
    assert_eq!(out.matches("$gachamod_onscreen = 1").count(), 2, "{out}");
    assert!(out.starts_with("; gachamod added this section (keys only while on screen)\r\n[Constants]\r\nglobal $gachamod_onscreen = 0\r\n\r\n[KeySwap]\r\n"), "{out}");
}

#[test]
fn ui_and_texture_mods() {
    let ui = "[KeyHideHud]\nkey = no_modifiers VK_F11\ntype = toggle\n$hide = 1\n\n[ShaderOverrideHud]\nhash = 0123456789abcdef\nif $hide\n\thandling = skip\nendif\n";
    assert_eq!(read_keys("m", &[idoc("hud.ini", ui)]).on_screen, "global");
    let tex = "[KeyColor]\nkey = ctrl c\ntype = cycle\n$color = 0,1,2\n\n[TextureOverrideHairDiffuse]\nhash = 0a0b0c0d\nthis = ResourceHair\n";
    let mut d = vec![idoc("hair.ini", tex)];
    assert_eq!(read_keys("m", &d).on_screen, "cant");
    assert!(!on_screen_docs(&mut d, None).is_empty());
    // the AI helper (or the user) names the section, and it works
    let pick = [DrawRef { ini: "hair.ini".into(), section: "TextureOverrideHairDiffuse".into() }];
    let mut d = vec![idoc("hair.ini", tex)];
    assert!(on_screen_docs(&mut d, Some(&pick)).is_empty());
    let out = text(&d[0]);
    assert!(out.contains("[TextureOverrideHairDiffuse]\nhash = 0a0b0c0d\n; gachamod added the next line (keys only while on screen)\n$gachamod_onscreen = 1\n"), "{out}");
    assert_eq!(read_keys("m", &[idoc("hair.ini", &out)]).on_screen, "on");
    let mut back = vec![idoc("hair.ini", &out)];
    strip_on_screen(&mut back[0].doc);
    assert_eq!(text(&back[0]), tex);
}

#[test]
fn rebinds_and_on_screen_undo_separately() {
    let t = KeyTarget { ini: "a.ini".into(), section: "KeySwap".into(), field: "key".into(), index: 0 };
    let mut d = vec![idoc("a.ini", PLAIN)];
    on_screen_docs(&mut d, None);
    rebind_doc(&mut d[0].doc, "a.ini", &t, "VK_F6").unwrap();
    set_off_doc(&mut d[0].doc, "a.ini", "KeyHat", true).unwrap();
    // keys back: the on-screen part stays
    let mut a = vec![idoc("a.ini", &text(&d[0]))];
    reset_doc(&mut a[0].doc);
    let ka = read_keys("m", &[idoc("a.ini", &text(&a[0]))]);
    assert_eq!(ka.on_screen, "on");
    assert!(!ka.changed);
    // on screen off: the key changes stay
    let mut b = vec![idoc("a.ini", &text(&d[0]))];
    strip_on_screen(&mut b[0].doc);
    let kb = read_keys("m", &[idoc("a.ini", &text(&b[0]))]);
    assert_eq!(kb.on_screen, "off");
    assert!(kb.changed);
    assert_eq!(kb.keys[0].lines[0].label, "F6");
    reset_doc(&mut b[0].doc);
    assert_eq!(text(&b[0]), PLAIN);
}

#[test]
fn utf16_inis_are_edited_in_utf16() {
    let src = "[KeySwap]\r\nkey = VK_DOWN\r\n\r\n[TextureOverrideBodyPosition]\r\nhash = 1a2b3c4d\r\nvb0 = ResourceBody\r\n";
    let bytes: Vec<u8> = [0xFF, 0xFE].into_iter().chain(src.encode_utf16().flat_map(|u| u.to_le_bytes())).collect();
    let mut d = vec![IniDoc { rel: "a.ini".into(), abs: PathBuf::from("a.ini"), raw: bytes.clone(), doc: Doc::from_bytes(&bytes) }];
    on_screen_docs(&mut d, None);
    let out = d[0].doc.to_bytes();
    assert_eq!(&out[..2], &[0xFF, 0xFE]);
    let back = Doc::from_bytes(&out);
    assert!(back.text().contains("condition = $gachamod_onscreen == 1\r\n"));
    let mut b = back.clone();
    strip_on_screen(&mut b);
    assert_eq!(b.to_bytes(), bytes);
}

#[test]
fn clash_rules() {
    let c = |s: &str| combo(s).unwrap();
    assert!(overlap(&c("VK_UP"), &c("up")));
    assert!(overlap(&c("VK_UP"), &c("ctrl VK_UP")), "Ctrl+Up fires a plain Up binding too");
    assert!(!overlap(&c("no_modifiers VK_UP"), &c("ctrl VK_UP")));
    assert!(!overlap(&c("no_ctrl 1"), &c("CTRL 1")));
    assert!(overlap(&c("no_alt 1"), &c("CTRL 1")));
    assert!(overlap(&c("no_modifiers /"), &c("VK_OEM_2")));
    assert!(overlap(&c("XB_A"), &c("XB2_A")));
    assert!(!overlap(&c("XB_A"), &c("XB_LEFT_SHOULDER XB_A")));
    assert!(overlap(&c("0x41"), &c("a")));
    assert!(!overlap(&c("VK_UP"), &c("VK_DOWN")));
}

fn mod_at(dir: &Path, id: &str, character: Option<&str>) -> ModEntry {
    ModEntry {
        id: id.into(), name: format!("Mod {id}"), path: dir.to_string_lossy().into_owned(), enabled: true,
        character: character.map(String::from), has_keys: true, ..Default::default()
    }
}

#[test]
fn finds_real_clashes_only() {
    let base = temp("clash");
    let write = |name: &str, text: &str| { let d = base.join(name); fs::create_dir_all(&d).unwrap(); fs::write(d.join("m.ini"), text).unwrap(); d };
    let plain = |key: &str| format!("[KeySwap]\nkey = {key}\ntype = cycle\n$swapvar = 0,1\n\n[TextureOverrideXPosition]\nhash = 1a2b3c4d\nvb0 = ResourceX\n");
    let gated = |key: &str| format!("[Constants]\nglobal $active\n[Present]\npost $active = 0\n[KeySwap]\ncondition = $active == 1\nkey = {key}\ntype = cycle\n$swapvar = 0,1\n\n[TextureOverrideXPosition]\nhash = 1a2b3c4d\nvb0 = ResourceX\n$active = 1\n");
    let a = write("a", &plain("VK_DOWN"));
    let b = write("b", &gated("no_modifiers VK_DOWN"));
    let c = write("c", &gated("VK_DOWN"));
    let d = write("d", &gated("VK_DOWN"));
    let e = write("e", &plain("ctrl VK_DOWN"));
    let f = write("f", &plain("no_ctrl VK_UP"));
    let g = write("g", &plain("ctrl VK_UP"));
    // a (any time) clashes with b, c, d and e; c and d are the same character; b and c aren't; f and g never fire together
    let mods = vec![mod_at(&a, "a", Some("Ellen")), mod_at(&b, "b", Some("Miyabi")), mod_at(&c, "c", Some("Ellen")),
        mod_at(&d, "d", Some("Ellen")), mod_at(&e, "e", None), mod_at(&f, "f", None), mod_at(&g, "g", None)];
    let found = find_clashes(&mods);
    assert_eq!(found.len(), 1, "{found:?}");
    let ids: Vec<&str> = found[0].keys.iter().map(|k| k.mod_id.as_str()).collect();
    assert_eq!(ids, vec!["a", "b", "c", "d", "e"]);
    assert!(found[0].keys[0].fixable && !found[0].keys[1].fixable);
    // only gated mods for different characters: nothing
    let found = find_clashes(&[mod_at(&b, "b", Some("Miyabi")), mod_at(&c, "c", Some("Ellen"))]);
    assert!(found.is_empty());
    // off mods and off keys don't count
    let mut off = mod_at(&a, "a", None);
    off.enabled = false;
    assert!(find_clashes(&[off, mod_at(&e, "e", None)]).is_empty());
    let _ = fs::remove_dir_all(base);
}

#[test]
fn outline_for_the_ai_helper() {
    let o = outline_docs(&[idoc("a.ini", PLAIN)]);
    assert_eq!(o.len(), 1);
    assert_eq!(o[0].keys, vec!["KeySwap", "KeyHat"]);
    let pos = o[0].sections.iter().find(|s| s.section == "TextureOverrideAyakaPosition").unwrap();
    assert_eq!(pos.lines, vec!["hash = 1a2b3c4d", "vb0 = ResourceAyakaPosition"]);
    assert!(o[0].sections.iter().all(|s| !s.section.starts_with("Resource")));
}

#[test]
fn edits_through_the_library_with_backups() {
    let root = temp("lib");
    let mods = root.join("Mods");
    let dir = mods.join("Ayaka").join("Swimsuit");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("Ayaka.ini"), PLAIN).unwrap();
    let db = crate::db::Db::memory().unwrap();
    crate::games::save_paths(&db, "gi", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into_owned()), ..Default::default() }).unwrap();
    let m = crate::library::add_folder(&db, "gi", &dir, None).unwrap();

    let t = KeyTarget { ini: "Ayaka.ini".into(), section: "KeySwap".into(), field: "key".into(), index: 0 };
    let e = rebind(&db, "gi", &m.id, &t, "ctrl VK_F6").unwrap();
    let b = e.backup.expect("a backup");
    assert_eq!(b.files, vec!["Ayaka.ini"]);
    assert_eq!(e.keys.keys[0].lines[0].label, "Ctrl+F6");
    assert!(fs::read_to_string(dir.join("Ayaka.ini")).unwrap().contains("key = ctrl VK_F6\r\n"));
    // the same binding again changes nothing and takes no backup
    assert!(rebind(&db, "gi", &m.id, &t, "ctrl VK_F6").unwrap().backup.is_none());

    let e = on_screen(&db, "gi", &m.id, true, None).unwrap();
    assert_eq!(e.keys.on_screen, "on");
    let os = e.backup.unwrap();
    let e = set_off(&db, "gi", &m.id, "Ayaka.ini", "KeyHat", true).unwrap();
    assert!(e.keys.keys[1].off);
    // one click takes every change out
    let e = put_back(&db, "gi", &m.id).unwrap();
    assert!(!e.keys.changed && e.keys.on_screen == "off");
    assert!(e.backup.is_some(), "and can be undone");
    assert_eq!(fs::read_to_string(dir.join("Ayaka.ini")).unwrap(), PLAIN);
    assert!(put_back(&db, "gi", &m.id).unwrap().backup.is_none(), "nothing left to put back");

    // Undo of the on-screen step puts that file state back; its "before" backup redoes the undo
    let before = backups::restore(&db, &os.id).unwrap();
    assert!(fs::read_to_string(dir.join("Ayaka.ini")).unwrap().contains("key = ctrl VK_F6\r\n"));
    assert!(!fs::read_to_string(dir.join("Ayaka.ini")).unwrap().contains("gachamod_onscreen"));
    backups::restore(&db, &before.id).unwrap();
    assert_eq!(fs::read_to_string(dir.join("Ayaka.ini")).unwrap(), PLAIN);
    backups::restore(&db, &b.id).unwrap();
    assert_eq!(fs::read_to_string(dir.join("Ayaka.ini")).unwrap(), PLAIN);

    // the outline and errors for files that aren't there
    assert_eq!(outline(&db, "gi", &m.id).unwrap()[0].ini, "Ayaka.ini");
    assert!(set_off(&db, "gi", &m.id, "Nope.ini", "KeyHat", true).is_err());
    let _ = fs::remove_dir_all(root);
}

/// A library with one mod made of PLAIN.
fn library_mod(name: &str) -> (PathBuf, PathBuf, crate::db::Db, ModEntry) {
    let root = temp(name);
    let mods = root.join("Mods");
    let dir = mods.join("Ayaka").join("Swimsuit");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("Ayaka.ini"), PLAIN).unwrap();
    let db = crate::db::Db::memory().unwrap();
    crate::games::save_paths(&db, "gi", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into_owned()), ..Default::default() }).unwrap();
    let m = crate::library::add_folder(&db, "gi", &dir, None).unwrap();
    (root, dir, db, m)
}

#[test]
fn taking_on_screen_out_writes_the_kept_original() {
    let (root, dir, db, m) = library_mod("orig");
    let ini = dir.join("Ayaka.ini");
    assert!(on_screen_mods(&db, "gi").unwrap().is_empty());
    on_screen(&db, "gi", &m.id, true, None).unwrap();
    assert_eq!(on_screen_mods(&db, "gi").unwrap().iter().map(|o| o.mod_id.clone()).collect::<Vec<_>>(), vec![m.id.clone()]);
    assert_eq!(originals::original(&db, "gi", &m.id, "Ayaka.ini", &fs::read(&ini).unwrap()).as_deref(), Some(PLAIN.as_bytes()));

    // pretend taking the check out by its markers misses a line: the kept copy still gives back the exact file
    let gated = fs::read(&ini).unwrap();
    let missed = String::from_utf8(gated.clone()).unwrap().replace("global persist $hat = 1\r\n", "global persist $hat = 1\r\nglobal $leftover = 1\r\n");
    originals::keep(&db, "gi", &m.id, &[originals::Write { rel: "Ayaka.ini", before: &gated, clean: PLAIN.as_bytes(), after: missed.as_bytes() }]).unwrap();
    fs::write(&ini, &missed).unwrap();
    let e = on_screen(&db, "gi", &m.id, false, None).unwrap();
    assert_eq!(e.keys.on_screen, "off");
    assert_eq!(fs::read_to_string(&ini).unwrap(), PLAIN);
    assert!(on_screen_mods(&db, "gi").unwrap().is_empty());

    // a rebind stays when only the check comes out, and rebinding back gives the original bytes again
    let t = KeyTarget { ini: "Ayaka.ini".into(), section: "KeySwap".into(), field: "key".into(), index: 0 };
    on_screen(&db, "gi", &m.id, true, None).unwrap();
    rebind(&db, "gi", &m.id, &t, "VK_F7").unwrap();
    on_screen(&db, "gi", &m.id, false, None).unwrap();
    assert!(fs::read_to_string(&ini).unwrap().contains("key = VK_F7\r\n"));
    rebind(&db, "gi", &m.id, &t, "VK_DOWN").unwrap();
    assert_eq!(fs::read_to_string(&ini).unwrap(), PLAIN);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn an_update_or_a_hand_edit_is_never_rolled_back() {
    let (root, dir, db, m) = library_mod("stale");
    let ini = dir.join("Ayaka.ini");
    on_screen(&db, "gi", &m.id, true, None).unwrap();
    // the user adds a line by hand: taking the check out keeps it, since the kept copy is out of date
    let hand = fs::read_to_string(&ini).unwrap().replace("; Ayaka swimsuit\r\n", "; Ayaka swimsuit\r\n; my note\r\n");
    fs::write(&ini, &hand).unwrap();
    on_screen(&db, "gi", &m.id, false, None).unwrap();
    assert_eq!(fs::read_to_string(&ini).unwrap(), PLAIN.replace("; Ayaka swimsuit\r\n", "; Ayaka swimsuit\r\n; my note\r\n"));

    // the mod is updated to a new version: the next change keeps that version, and putting back gives it, not v1
    let v2 = PLAIN.replace("type = cycle", "type = cycle\r\n; v2");
    fs::write(&ini, &v2).unwrap();
    on_screen(&db, "gi", &m.id, true, None).unwrap();
    put_back(&db, "gi", &m.id).unwrap();
    assert_eq!(fs::read_to_string(&ini).unwrap(), v2);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn turns_on_after_install_when_asked() {
    let root = temp("install");
    let mods = root.join("Mods");
    let dir = mods.join("Ayaka").join("Swimsuit");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("Ayaka.ini"), PLAIN).unwrap();
    let db = crate::db::Db::memory().unwrap();
    crate::games::save_paths(&db, "gi", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into_owned()), ..Default::default() }).unwrap();
    let m = crate::library::add_folder(&db, "gi", &dir, None).unwrap();
    let shared = std::sync::Arc::new(std::sync::Mutex::new(db));
    let mut notes = Vec::new();
    after_install(&shared, "gi", std::slice::from_ref(&m), &mut notes);
    assert!(notes.is_empty(), "off unless the setting is on");
    assert_eq!(fs::read_to_string(dir.join("Ayaka.ini")).unwrap(), PLAIN);
    shared.lock().unwrap().set_setting("keys.onScreenOnInstall", "1").unwrap();
    after_install(&shared, "gi", std::slice::from_ref(&m), &mut notes);
    assert_eq!(notes.len(), 1);
    assert!(fs::read_to_string(dir.join("Ayaka.ini")).unwrap().contains("condition = $gachamod_onscreen == 1"));
    // and for all mods: off again, then on
    let r = on_screen_all(&shared, "gi", false).unwrap();
    assert_eq!(r.changed.len(), 1);
    assert_eq!(fs::read_to_string(dir.join("Ayaka.ini")).unwrap(), PLAIN);
    let r = on_screen_all(&shared, "gi", true).unwrap();
    assert_eq!((r.changed.len(), r.skipped.len()), (1, 0));
    let r = on_screen_all(&shared, "gi", true).unwrap();
    assert_eq!((r.changed.len(), r.already), (0, 1));
    let _ = fs::remove_dir_all(root);
}

/// Runs the readers and writers over real mods in a folder given by GACHAMOD_REAL_MODS (each mod copied to a temp
/// folder first) and writes what changed into GACHAMOD_REAL_OUT. `cargo test -p gacha-core real_mods -- --ignored`
#[test]
#[ignore]
fn real_mods() {
    let Ok(src) = std::env::var("GACHAMOD_REAL_MODS") else { return };
    let out = PathBuf::from(std::env::var("GACHAMOD_REAL_OUT").unwrap_or_else(|_| std::env::temp_dir().join("gachamod-real-out").to_string_lossy().into_owned()));
    let _ = fs::remove_dir_all(&out);
    fs::create_dir_all(&out).unwrap();
    let mut report = String::new();
    let mut entries: Vec<_> = fs::read_dir(&src).unwrap().flatten().filter(|e| e.path().is_dir()).collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name().to_string_lossy().into_owned();
        let x = e.path().join("x");
        if !x.is_dir() { continue; }
        // each mod root: folders with an ini, the way the library finds them
        let roots = crate::install::find_roots(&x).unwrap_or_default();
        for (n, r) in roots.iter().enumerate() {
            let from = if r.key.is_empty() { x.clone() } else { x.join(&r.key) };
            let work = temp(&format!("real-{n}"));
            copy(&from, &work);
            let original: Vec<(String, Vec<u8>)> = ini::mod_inis(&work).into_iter().map(|(a, rel)| (rel, fs::read(a).unwrap())).collect();
            let k = keys_in("m", &work);
            report += &format!("{name} [{}] inis {} keys {} state {} {}\n", r.key, k.inis.len(), k.keys.len(), k.on_screen, k.on_screen_note.clone().unwrap_or_default());
            for e in k.keys.iter().take(40) {
                let lines: Vec<String> = e.lines.iter().map(|l| format!("{}{}={}({})", if l.off { "off " } else { "" }, l.field, l.value, l.label)).collect();
                report += &format!("    {} [{}] {} '{}' {} cond={:?} {}\n", e.ini, e.section, e.kind, e.name, if e.on_screen { "ONSCREEN" } else { "" }, e.condition, lines.join(" | "));
            }
            // on screen, then a rebind of the first key, then everything back
            let mut docs = load(&work);
            let missing = on_screen_docs(&mut docs, None);
            if let Some(first) = k.keys.iter().find(|e| e.lines.iter().any(|l| !l.off)) {
                let l = first.lines.iter().find(|l| !l.off).unwrap();
                let t = KeyTarget { ini: first.ini.clone(), section: first.section.clone(), field: l.field.clone(), index: l.index };
                let d = docs.iter_mut().find(|d| d.rel == first.ini).unwrap();
                if let Err(err) = rebind_doc(&mut d.doc, &d.rel.clone(), &t, "ctrl alt VK_F7") { report += &format!("    rebind failed: {err}\n"); }
            }
            report += &format!("    on screen missing {missing:?}, changed files {:?}\n", docs.iter().filter(|d| d.changed()).map(|d| d.rel.clone()).collect::<Vec<_>>());
            for d in docs.iter().filter(|d| d.changed()) {
                let safe = format!("{name}-{n}-{}", d.rel.replace(['/', '\\'], "_"));
                fs::write(out.join(format!("{safe}.before")), &d.raw).unwrap();
                fs::write(out.join(format!("{safe}.after")), d.doc.to_bytes()).unwrap();
                write_file(&d.abs, &d.doc.to_bytes()).unwrap();
            }
            let after = keys_in("m", &work);
            report += &format!("    after: state {} changed {}\n", after.on_screen, after.changed);
            // undo from the files alone
            let mut docs = load(&work);
            for d in docs.iter_mut() { strip_on_screen(&mut d.doc); reset_doc(&mut d.doc); }
            for (rel, bytes) in &original {
                let d = docs.iter().find(|d| &d.rel == rel).unwrap();
                if &d.doc.to_bytes() != bytes { report += &format!("    NOT EXACT after undo: {rel}\n"); }
            }
            let _ = fs::remove_dir_all(&work);
        }
    }
    fs::write(out.join("report.txt"), report).unwrap();
}

fn copy(from: &Path, to: &Path) {
    for e in walkdir::WalkDir::new(from).into_iter().flatten() {
        let rel = e.path().strip_prefix(from).unwrap();
        let dst = to.join(rel);
        if e.file_type().is_dir() { fs::create_dir_all(&dst).unwrap(); } else if e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("ini")) {
            fs::copy(e.path(), &dst).unwrap();
        }
    }
}

#[test]
fn shared_key_settings_make_the_same_file() {
    // the sender's copy: a rebind, a key turned off and "only while on screen"
    let a = temp("share-a");
    let mut d = vec![IniDoc { rel: "a.ini".into(), abs: a.join("a.ini"), raw: PLAIN.as_bytes().to_vec(), doc: doc(PLAIN) }];
    let t = KeyTarget { ini: "a.ini".into(), section: "KeySwap".into(), field: "key".into(), index: 0 };
    rebind_doc(&mut d[0].doc, "a.ini", &t, "ctrl VK_F6").unwrap();
    set_off_doc(&mut d[0].doc, "a.ini", "KeyHat", true).unwrap();
    on_screen_docs(&mut d, None);
    fs::write(a.join("a.ini"), d[0].doc.to_bytes()).unwrap();
    let (changes, on_screen) = shared_changes(&a);
    assert!(on_screen);
    assert_eq!(changes.len(), 2, "{changes:?}");
    assert!(matches!(&changes[0], KeyChange::Set { value, original, .. } if value == "ctrl VK_F6" && original == "VK_DOWN"), "{changes:?}");
    // the list survives JSON
    let json = serde_json::to_string(&changes).unwrap();
    assert!(json.contains("\"kind\":\"set\"") && json.contains("\"kind\":\"off\""), "{json}");
    let back: Vec<KeyChange> = serde_json::from_str(&json).unwrap();
    // a fresh copy gets the same file
    let mut fresh = vec![idoc("a.ini", PLAIN)];
    assert_eq!(apply_shared_docs(&mut fresh, &back, true), 0);
    assert_eq!(text(&fresh[0]), String::from_utf8(d[0].doc.to_bytes()).unwrap());
    // a section the copy doesn't have is counted, the rest still happens
    let mut other = vec![idoc("a.ini", PLAIN)];
    let missing = [KeyChange::Off { ini: "a.ini".into(), section: "KeyNope".into() }, KeyChange::Off { ini: "b.ini".into(), section: "KeySwap".into() }, back[1].clone()];
    assert_eq!(apply_shared_docs(&mut other, &missing, false), 2);
    assert!(other[0].changed());
    let _ = fs::remove_dir_all(&a);
}
