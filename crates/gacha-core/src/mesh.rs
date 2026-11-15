//! A mod's model for the 3D preview: what its .ini draws with its toggles as they are now, read from the mod's own
//! buffers (`.ib`, `Position.buf`, `Texcoord.buf`) and diffuse textures (`.dds`, decoded and shrunk). Nothing here
//! needs the game: it is the mod's replacement mesh, not the whole character, so parts the mod doesn't replace are
//! missing. Owner: MODTOOLS area.
//!
//! How it reads an ini: `[TextureOverride*]` sections with `ib = Resource...` and `drawindexed = count, first, base`
//! (or `auto`), following `run = CommandList...` and `if / elif / else / endif` with the mod's variables (their saved
//! values, else the `[Constants]` defaults). A draw's vertex buffer is the position resource whose name shares the
//! longest start with the index buffer's and that holds every index it uses.

use crate::error::{Error, Result};
use crate::ini::VarValue;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// One vertex buffer: little-endian f32 arrays, base64.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MeshBuffer {
    pub name: String,
    pub count: u32,
    /// x, y, z per vertex.
    pub positions: String,
    /// x, y, z per vertex; None when the buffer has none (the viewer computes them).
    pub normals: Option<String>,
    /// u, v per vertex; None when no texcoord buffer was readable.
    pub uvs: Option<String>,
}

/// One draw: a range of an index buffer (u32, base64) over one vertex buffer, with its diffuse texture.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MeshPart {
    pub name: String,
    pub buffer: u32,
    pub indices: String,
    pub texture: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModMesh {
    pub buffers: Vec<MeshBuffer>,
    pub parts: Vec<MeshPart>,
    /// JPEG data URLs.
    pub textures: Vec<String>,
    /// "z" when the model stands along z (ZZZ), else "y".
    pub up: String,
    pub triangles: u32,
    /// What couldn't be shown, in words ("2 parts use a buffer that isn't in the mod").
    pub notes: Vec<String>,
}

const MAX_VERTS: usize = 1_500_000;
const MAX_TEX: usize = 12;
const TEX_SIZE: u32 = 1024;

// ── the ini, loosely ──

#[derive(Debug, Default)]
struct Ini { sections: Vec<(String, Vec<String>)> }

fn parse(text: &str) -> Ini {
    let mut ini = Ini::default();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') { continue; }
        if let Some(rest) = line.strip_prefix('[') {
            let name = rest.find(']').map(|i| &rest[..i]).unwrap_or(rest).trim().to_string();
            ini.sections.push((name, Vec::new()));
            continue;
        }
        if let Some((_, lines)) = ini.sections.last_mut() { lines.push(line.to_string()); }
    }
    ini
}

fn kv(line: &str) -> (String, Option<String>) {
    match line.split_once('=') {
        Some((k, v)) => (k.trim().to_ascii_lowercase(), Some(v.trim().to_string())),
        None => (line.trim().to_ascii_lowercase(), None),
    }
}

/// `$name` without namespaces, lower case: `$\mods\a\b.ini\swap` and `$swap` are the same variable here.
fn var_key(s: &str) -> String { s.trim_start_matches('$').rsplit('\\').next().unwrap_or_default().to_ascii_lowercase() }

// ── conditions: numbers, $vars, comparisons, && || !, + - * /, parentheses ──

struct Expr<'a> { t: Vec<String>, i: usize, vars: &'a HashMap<String, f64> }

fn tokens(s: &str) -> Vec<String> {
    let c: Vec<char> = s.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < c.len() {
        let ch = c[i];
        if ch.is_whitespace() { i += 1; continue; }
        let two: String = c[i..(i + 2).min(c.len())].iter().collect();
        if ["==", "!=", "<=", ">=", "&&", "||"].contains(&two.as_str()) { out.push(two); i += 2; continue; }
        if "()!<>+-*/".contains(ch) { out.push(ch.to_string()); i += 1; continue; }
        let start = i;
        while i < c.len() && !c[i].is_whitespace() && !"()!<>=&|+*/".contains(c[i]) && !(c[i] == '-' && i > start) { i += 1; }
        if i == start { i += 1; continue; }
        out.push(c[start..i].iter().collect());
    }
    out
}

impl Expr<'_> {
    fn peek(&self) -> Option<&str> { self.t.get(self.i).map(String::as_str) }
    fn eat(&mut self, s: &str) -> bool { if self.peek() == Some(s) { self.i += 1; true } else { false } }
    fn or(&mut self) -> f64 { let mut a = self.and(); while self.eat("||") { let b = self.and(); a = f64::from(a != 0.0 || b != 0.0); } a }
    fn and(&mut self) -> f64 { let mut a = self.cmp(); while self.eat("&&") { let b = self.cmp(); a = f64::from(a != 0.0 && b != 0.0); } a }
    fn cmp(&mut self) -> f64 {
        let a = self.sum();
        for op in ["==", "!=", "<=", ">=", "<", ">"] {
            if self.eat(op) {
                let b = self.sum();
                return f64::from(match op { "==" => (a - b).abs() < 1e-6, "!=" => (a - b).abs() >= 1e-6, "<=" => a <= b, ">=" => a >= b, "<" => a < b, _ => a > b });
            }
        }
        a
    }
    fn sum(&mut self) -> f64 {
        let mut a = self.mul();
        loop { if self.eat("+") { a += self.mul(); } else if self.eat("-") { a -= self.mul(); } else { return a; } }
    }
    fn mul(&mut self) -> f64 {
        let mut a = self.unary();
        loop {
            if self.eat("*") { a *= self.unary(); } else if self.eat("/") { let b = self.unary(); a = if b == 0.0 { 0.0 } else { a / b }; } else { return a; }
        }
    }
    fn unary(&mut self) -> f64 {
        if self.eat("!") { return f64::from(self.unary() == 0.0); }
        if self.eat("-") { return -self.unary(); }
        if self.eat("(") { let v = self.or(); self.eat(")"); return v; }
        let Some(t) = self.peek().map(String::from) else { return 0.0 };
        self.i += 1;
        if t.starts_with('$') { return self.vars.get(&var_key(&t)).copied().unwrap_or(0.0); }
        // DRAW_TYPE and other 3DMigoto words: a plain draw
        t.parse::<f64>().unwrap_or(if t.eq_ignore_ascii_case("draw_type") { 1.0 } else { 0.0 })
    }
}

fn truth(expr: &str, vars: &HashMap<String, f64>) -> bool {
    let mut e = Expr { t: tokens(expr), i: 0, vars };
    e.or() != 0.0
}

// ── following the draws ──

#[derive(Debug, Clone)]
struct Draw { section: String, ib: String, count: Option<u32>, first: u32, base: i64, tex: HashMap<String, String> }

struct Walk<'a> { ini: &'a Ini, vars: HashMap<String, f64>, draws: Vec<Draw>, vb0: Vec<String> }

impl Walk<'_> {
    fn lines_of(&self, name: &str) -> Option<&Vec<String>> {
        self.ini.sections.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, l)| l)
    }

    /// Run a section's lines. `ib` and textures carry into command lists it runs, as in 3DMigoto.
    fn run(&mut self, name: &str, top: &str, ib: &mut Option<String>, tex: &mut HashMap<String, String>, depth: u32) {
        if depth > 12 { return; }
        let Some(lines) = self.lines_of(name).cloned() else { return };
        // (a branch was taken, this branch is live)
        let mut stack: Vec<(bool, bool)> = Vec::new();
        for line in &lines {
            let low = line.to_ascii_lowercase();
            // a live switching gate (live.rs): the preview shows the mod as if it were picked
            if low.starts_with("if $\\gachamod\\live\\") { stack.push((true, true)); continue; }
            if let Some(c) = low.strip_prefix("if ") { let v = truth(&line[line.len() - c.len()..], &self.vars); stack.push((v, v)); continue; }
            if let Some(c) = low.strip_prefix("elif ").or_else(|| low.strip_prefix("else if ")) {
                let c = &line[line.len() - c.len()..];
                if let Some(t) = stack.last_mut() { if t.0 { t.1 = false; } else { let v = truth(c, &self.vars); *t = (v, v); } }
                continue;
            }
            if low == "else" { if let Some(t) = stack.last_mut() { t.1 = !t.0; t.0 = true; } continue; }
            if low == "endif" { stack.pop(); continue; }
            if !stack.iter().all(|s| s.1) { continue; }
            let (k, v) = kv(line);
            let Some(v) = v else { continue };
            if k.starts_with('$') {
                // a variable set while drawing
                if let Ok(n) = v.parse::<f64>() { self.vars.insert(var_key(&k), n); }
                continue;
            }
            match k.as_str() {
                "ib" => { *ib = (!v.eq_ignore_ascii_case("null")).then(|| v.to_ascii_lowercase()); }
                "vb0" => { let r = v.trim_start_matches("ref ").trim().to_ascii_lowercase(); if !self.vb0.contains(&r) { self.vb0.push(r); } }
                "run" => { let target = v.clone(); self.run(&target, top, ib, tex, depth + 1); }
                "drawindexed" => {
                    let Some(ibn) = ib.clone() else { continue };
                    let nums: Vec<&str> = v.split(',').map(str::trim).collect();
                    let (count, first, base) = if v.trim().eq_ignore_ascii_case("auto") {
                        (None, 0, 0)
                    } else {
                        (nums.first().and_then(|n| n.parse().ok()), nums.get(1).and_then(|n| n.parse().ok()).unwrap_or(0), nums.get(2).and_then(|n| n.parse().ok()).unwrap_or(0))
                    };
                    if count == Some(0) { continue; }
                    self.draws.push(Draw { section: top.to_string(), ib: ibn, count, first, base, tex: tex.clone() });
                }
                _ if k.starts_with("ps-t") || (k.starts_with("resource\\") && k.contains("diffuse")) || k.ends_with("\\diffuse") => {
                    let r = v.trim_start_matches("ref ").trim().to_ascii_lowercase();
                    tex.insert(k.clone(), r);
                }
                _ => {}
            }
        }
    }
}

// ── buffers ──

#[derive(Debug, Clone, Default)]
struct Res { file: Option<PathBuf>, stride: usize, format: String }

fn resources(ini: &Ini, base: &Path) -> HashMap<String, Res> {
    let mut out = HashMap::new();
    for (name, lines) in &ini.sections {
        if !name.to_ascii_lowercase().starts_with("resource") { continue; }
        let mut r = Res::default();
        for l in lines {
            let (k, v) = kv(l);
            let Some(v) = v else { continue };
            match k.as_str() {
                "filename" => {
                    let rel = v.trim_matches('"').replace('\\', "/");
                    let p = base.join(rel.trim_start_matches("./"));
                    if p.is_file() { r.file = Some(p); }
                }
                "stride" => r.stride = v.parse().unwrap_or(0),
                "format" => r.format = v.to_ascii_uppercase(),
                _ => {}
            }
        }
        out.insert(name.to_ascii_lowercase(), r);
    }
    out
}

fn f32s(b: &[u8], off: usize, n: usize) -> Option<Vec<f32>> {
    let s = b.get(off..off + 4 * n)?;
    Some(s.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

fn half(h: u16) -> f32 {
    let s = if h & 0x8000 != 0 { -1.0 } else { 1.0 };
    let e = ((h >> 10) & 0x1f) as i32;
    let m = (h & 0x3ff) as f32;
    match e {
        0 => s * m * 2f32.powi(-24),
        31 => if m == 0.0 { s * f32::INFINITY } else { f32::NAN },
        _ => s * (1.0 + m / 1024.0) * 2f32.powi(e - 15),
    }
}

/// Texture coordinates: the first layout among (offset 4, f32), (offset 4, f16), (offset 0, f32), (offset 0, f16)
/// whose values look like UVs on a sample of vertices.
fn read_uvs(b: &[u8], stride: usize, n: usize) -> Option<Vec<f32>> {
    if stride == 0 || b.len() < stride * n { return None; }
    let at = |i: usize, off: usize, f16: bool| -> Option<(f32, f32)> {
        let p = i * stride + off;
        if f16 {
            let u = u16::from_le_bytes([*b.get(p)?, *b.get(p + 1)?]);
            let v = u16::from_le_bytes([*b.get(p + 2)?, *b.get(p + 3)?]);
            Some((half(u), half(v)))
        } else {
            let f = f32s(b, p, 2)?;
            Some((f[0], f[1]))
        }
    };
    let sample: Vec<usize> = (0..n).step_by((n / 200).max(1)).collect();
    for (off, f16) in [(4, false), (4, true), (0, false), (0, true)] {
        if off + if f16 { 4 } else { 8 } > stride { continue; }
        let ok = sample.iter().all(|&i| at(i, off, f16).is_some_and(|(u, v)| u.is_finite() && v.is_finite() && (-4.0..5.0).contains(&u) && (-4.0..5.0).contains(&v)));
        // half floats read as f32 come out as tiny numbers (under 0.01), so UVs must spread across the texture
        let spread = |k: usize| {
            let vals = sample.iter().filter_map(|&i| at(i, off, f16)).map(|p| if k == 0 { p.0 } else { p.1 });
            let (lo, hi) = vals.fold((f32::MAX, f32::MIN), |(lo, hi), x| (lo.min(x), hi.max(x)));
            hi - lo
        };
        let varied = spread(0) > 0.05 || spread(1) > 0.05;
        if ok && varied {
            return Some((0..n).flat_map(|i| { let (u, v) = at(i, off, f16).unwrap_or((0.0, 0.0)); [u, v] }).collect());
        }
    }
    None
}

struct Vb { name: String, n: usize, pos: Vec<f32>, nrm: Option<Vec<f32>>, uv: Option<Vec<f32>> }

fn f3(b: &[u8], p: usize) -> [f32; 3] {
    let f = |o: usize| f32::from_le_bytes([b[p + o], b[p + o + 1], b[p + o + 2], b[p + o + 3]]);
    [f(0), f(4), f(8)]
}

fn load_vb(name: &str, res: &HashMap<String, Res>) -> Option<Vb> {
    let r = res.get(name)?;
    let bytes = std::fs::read(r.file.as_ref()?).ok()?;
    let stride = if r.stride >= 12 { r.stride } else { 40 };
    let n = bytes.len() / stride;
    if n == 0 || n > MAX_VERTS { return None; }
    let mut pos = Vec::with_capacity(n * 3);
    let mut nrm = Vec::with_capacity(if stride >= 24 { n * 3 } else { 0 });
    let mut unit = 0usize;
    for i in 0..n {
        pos.extend_from_slice(&f3(&bytes, i * stride));
        if stride >= 24 {
            let v = f3(&bytes, i * stride + 12);
            let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
            if (0.9..1.1).contains(&l) { unit += 1; }
            nrm.extend_from_slice(&v);
        }
    }
    if pos.iter().any(|v| !v.is_finite() || v.abs() > 1e5) { return None; }
    let nrm = (stride >= 24 && unit * 10 >= n * 9).then_some(nrm);
    // the texcoord buffer next to it: "...Position..." -> "...Texcoord...", else the texcoord buffer with as many
    // vertices whose name shares the most with this one (a mod that blends PositionBase and PositionAlt)
    let same = name.rfind("position").map(|i| format!("{}texcoord{}", &name[..i], &name[i + 8..])).filter(|t| res.contains_key(t));
    let tc = same.or_else(|| {
        res.iter()
            .filter(|(k, t)| k.contains("texcoord") && t.file.as_ref().and_then(|f| f.metadata().ok()).is_some_and(|m| t.stride > 0 && m.len() as usize == t.stride * n))
            .max_by_key(|(k, _)| common_start(k, name)).map(|(k, _)| k.clone())
    });
    let uv = tc.and_then(|t| res.get(&t)).and_then(|t| {
        let b = std::fs::read(t.file.as_ref()?).ok()?;
        read_uvs(&b, if t.stride > 0 { t.stride } else { b.len() / n }, n)
    });
    Some(Vb { name: name.to_string(), n, pos, nrm, uv })
}

fn read_ib(r: &Res) -> Option<Vec<u32>> {
    let b = std::fs::read(r.file.as_ref()?).ok()?;
    Some(if r.format.contains("R16") {
        b.chunks_exact(2).map(|c| u32::from(u16::from_le_bytes([c[0], c[1]]))).collect()
    } else {
        b.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
    })
}

fn common_start(a: &str, b: &str) -> usize { a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count() }

/// A DDS (or PNG/JPG) at most TEX_SIZE across, as a JPEG data URL. A DDS is read from its smallest mip level that
/// is still TEX_SIZE or more, so a 4K texture isn't decoded in full.
fn texture(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    let img: image::RgbaImage = if ext == "dds" {
        let mut f = std::io::BufReader::new(std::fs::File::open(path).ok()?);
        let dds = image_dds::ddsfile::Dds::read(&mut f).ok()?;
        let (w, levels) = (dds.get_width().max(dds.get_height()), dds.get_num_mipmap_levels().max(1));
        let mut mip = 0;
        while mip + 1 < levels && (w >> (mip + 1)) >= TEX_SIZE { mip += 1; }
        image_dds::image_from_dds(&dds, mip).or_else(|_| image_dds::image_from_dds(&dds, 0)).ok()?
    } else {
        image::open(path).ok()?.to_rgba8()
    };
    let (w, h) = img.dimensions();
    let k = (TEX_SIZE as f32 / w.max(h) as f32).min(1.0);
    // DynamicImage's own methods: they run the image crate's optimised code even in a dev build
    let img = image::DynamicImage::ImageRgba8(img);
    let img = if k < 1.0 { img.resize_exact(((w as f32 * k) as u32).max(1), ((h as f32 * k) as u32).max(1), image::imageops::FilterType::Triangle) } else { img };
    // the alpha of a character diffuse is a mask for the shader (emission, outline), not see-through: dropped
    let rgb = image::DynamicImage::ImageRgb8(img.to_rgb8());
    let mut jpg = Vec::new();
    rgb.write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg, 88)).ok()?;
    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpg)))
}

/// Which bound resource is the colour texture: a slot or resource named diffuse, else a bound file named so, else
/// slot ps-t0 (the colour slot in older GIMI mods) when its file isn't named as another kind of map.
fn diffuse_of(tex: &HashMap<String, String>, res: &HashMap<String, Res>) -> Option<String> {
    let file = |v: &String| res.get(v).and_then(|r| r.file.as_ref()).map(|f| f.file_name().unwrap_or_default().to_string_lossy().to_ascii_lowercase());
    let named = tex.iter().find(|(k, _)| k.contains("diffuse")).map(|(_, v)| v.clone());
    let by_file = || tex.values().find(|v| file(v).is_some_and(|f| f.contains("diffuse") || f.contains("albedo") || f.contains("basecolor"))).cloned();
    let other = ["normal", "light", "material", "shadow", "mask", "ramp", "metal", "emission", "glow", "sdf"];
    let slot0 = || tex.get("ps-t0").filter(|v| file(v).is_some_and(|f| !other.iter().any(|o| f.contains(o)))).cloned();
    named.or_else(by_file).or_else(slot0).filter(|v| file(v).is_some())
}

fn b64_f32(v: &[f32]) -> String { base64::engine::general_purpose::STANDARD.encode(v.iter().flat_map(|f| f.to_le_bytes()).collect::<Vec<u8>>()) }
fn b64_u32(v: &[u32]) -> String { base64::engine::general_purpose::STANDARD.encode(v.iter().flat_map(|f| f.to_le_bytes()).collect::<Vec<u8>>()) }

/// The model one mod folder draws. `saved` are the mod's saved variable values (its toggles as they are now).
pub fn read(dir: &Path, saved: &[VarValue]) -> Result<ModMesh> {
    let mut out = ModMesh::default();
    let mut buffers: HashMap<String, usize> = HashMap::new();
    let mut textures: HashMap<PathBuf, Option<u32>> = HashMap::new();
    let mut missing = 0u32;
    let mut verts = 0usize;
    let mut bbox = [[f32::MAX; 3], [f32::MIN; 3]];
    for (abs, rel) in crate::ini::mod_inis(dir) {
        let Ok(bytes) = std::fs::read(&abs) else { continue };
        let ini = parse(&crate::ini::decode(&bytes));
        let base = abs.parent().unwrap_or(dir).to_path_buf();
        let res = resources(&ini, &base);
        // variables: [Constants] defaults, then the saved values for this ini
        let mut vars: HashMap<String, f64> = HashMap::new();
        for (name, lines) in &ini.sections {
            if !name.eq_ignore_ascii_case("constants") { continue; }
            for l in lines {
                let (k, v) = kv(l);
                let Some(var) = k.split_whitespace().last().filter(|w| w.starts_with('$')) else { continue };
                vars.insert(var_key(var), v.and_then(|v| v.parse().ok()).unwrap_or(0.0));
            }
        }
        for s in saved.iter().filter(|s| s.ini.eq_ignore_ascii_case(&rel)) {
            if let Ok(n) = s.value.parse() { vars.insert(var_key(&s.var), n); }
        }
        let mut walk = Walk { ini: &ini, vars, draws: Vec::new(), vb0: Vec::new() };
        for (name, _) in &ini.sections {
            if !name.to_ascii_lowercase().starts_with("textureoverride") { continue; }
            let (mut ib, mut tex) = (None, HashMap::new());
            let before = walk.draws.len();
            walk.run(name, name, &mut ib, &mut tex, 0);
            // an `ib =` with no draw of its own: the game's draw call runs on the whole replacement buffer (older GIMI mods)
            if walk.draws.len() == before {
                if let Some(ib) = ib { walk.draws.push(Draw { section: name.clone(), ib, count: None, first: 0, base: 0, tex }); }
            }
        }
        // position buffers: resources with a Position file, or bound to vb0
        let positions: Vec<String> = res.iter()
            .filter(|(n, r)| r.file.as_ref().is_some_and(|f| f.to_string_lossy().to_ascii_lowercase().ends_with("position.buf")) || n.contains("position") || walk.vb0.contains(n))
            .filter(|(_, r)| r.file.is_some())
            .map(|(n, _)| n.clone()).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
        let mut vbs: Vec<Vb> = Vec::new();
        let mut ibs: HashMap<String, Option<Vec<u32>>> = HashMap::new();
        for d in &walk.draws {
            let Some(r) = res.get(&d.ib) else { missing += 1; continue };
            let idx = ibs.entry(d.ib.clone()).or_insert_with(|| read_ib(r)).clone();
            let Some(idx) = idx else { missing += 1; continue };
            let first = d.first as usize;
            let count = d.count.map(|c| c as usize).unwrap_or(idx.len().saturating_sub(first));
            let Some(slice) = idx.get(first..first + count) else { missing += 1; continue };
            let slice: Vec<u32> = slice.iter().map(|&i| (i64::from(i) + d.base).max(0) as u32).collect();
            let top = slice.iter().copied().max().unwrap_or(0) as usize;
            // the position buffer whose name shares the most with the index buffer's, holding every index used
            let mut cands = positions.clone();
            // buffers the active sections bind as vb0 come first (merged mods hold one per variant)
            cands.sort_by_key(|p| (std::cmp::Reverse(walk.vb0.contains(p)), std::cmp::Reverse(common_start(p, &d.ib))));
            let mut vb_at = None;
            for c in &cands {
                let have = vbs.iter().position(|v| v.name == *c);
                let i = match have {
                    Some(i) => i,
                    None => {
                        if verts > MAX_VERTS { break; }
                        let Some(vb) = load_vb(c, &res) else { continue };
                        verts += vb.n;
                        vbs.push(vb);
                        vbs.len() - 1
                    }
                };
                if top < vbs[i].n { vb_at = Some(i); break; }
            }
            let Some(vi) = vb_at else { missing += 1; continue };
            let key = format!("{}|{}", abs.display(), vbs[vi].name);
            let buf = *buffers.entry(key).or_insert_with(|| {
                let vb = &vbs[vi];
                for p in vb.pos.chunks_exact(3) { for k in 0..3 { bbox[0][k] = bbox[0][k].min(p[k]); bbox[1][k] = bbox[1][k].max(p[k]); } }
                out.buffers.push(MeshBuffer {
                    name: vb.name.clone(), count: vb.n as u32, positions: b64_f32(&vb.pos),
                    normals: vb.nrm.as_deref().map(b64_f32), uvs: vb.uv.as_deref().map(b64_f32),
                });
                out.buffers.len() - 1
            });
            let tex = diffuse_of(&d.tex, &res).and_then(|t| res.get(&t)?.file.clone()).and_then(|path| {
                if let Some(t) = textures.get(&path) { return *t; }
                let t = (out.textures.len() < MAX_TEX).then(|| texture(&path)).flatten().map(|url| { out.textures.push(url); (out.textures.len() - 1) as u32 });
                textures.insert(path, t);
                t
            });
            out.triangles += (slice.len() / 3) as u32;
            out.parts.push(MeshPart { name: d.section.clone(), buffer: buf as u32, indices: b64_u32(&slice), texture: tex });
        }
    }
    if out.parts.is_empty() {
        return Err(Error::Invalid("This mod doesn't draw a model gachamod can read (it may only change textures or effects)".into()));
    }
    if missing > 0 { out.notes.push(format!("{missing} {} of the model couldn't be read", if missing == 1 { "part" } else { "parts" })); }
    let ext = |k: usize| bbox[1][k] - bbox[0][k];
    out.up = if ext(2) > ext(1) * 1.2 { "z".into() } else { "y".into() };
    Ok(out)
}

/// Where a library mod's model comes from: its folder and its toggles as they are now (saved values, else what the
/// game last wrote). Quick, so the database isn't held while the model is read.
pub fn source(db: &crate::db::Db, game: &str, id: &str) -> Result<(PathBuf, Vec<VarValue>)> {
    let m = crate::library::get(db, game, id)?;
    let dir = PathBuf::from(&m.path);
    if !dir.is_dir() { return Err(Error::Invalid(format!("{}'s folder isn't there any more. Rescan to update the list", m.name))); }
    let mut saved = crate::library::saved_vars(db, game, id).unwrap_or_default();
    if saved.is_empty() && m.loaded() {
        if let Ok(imp) = crate::games::importer_dir(db, game) { saved = crate::ini::user_vars(&imp, &m.rel_path).unwrap_or_default(); }
    }
    Ok((dir, saved))
}

/// A library mod's model with its toggles as they are now.
pub fn for_mod(db: &crate::db::Db, game: &str, id: &str) -> Result<ModMesh> {
    let (dir, saved) = source(db, game, id)?;
    read(&dir, &saved)
}

#[cfg(test)]
mod real {
    /// `GACHAMOD_REAL_DB=<path to a copy of gachamod.sqlite> cargo test -p gacha-core mesh::real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_library() {
        let Some(p) = std::env::var_os("GACHAMOD_REAL_DB") else { return };
        let db = crate::db::Db::open(std::path::Path::new(&p)).unwrap();
        for g in ["zzz", "ww", "hsr", "gi", "ef"] {
            let Ok(mods) = crate::library::list(&db, g) else { continue };
            let (mut ok, mut failed) = (0, 0);
            for m in mods.iter().take(40) {
                let t = std::time::Instant::now();
                match super::for_mod(&db, g, &m.id) {
                    Ok(x) => {
                        ok += 1;
                        let kb: usize = x.buffers.iter().map(|b| b.positions.len() + b.uvs.as_ref().map_or(0, String::len)).sum::<usize>() + x.textures.iter().map(String::len).sum::<usize>();
                        println!("  {g} {} : {} parts, {} tris, {} bufs ({} with uv), {} tex, up {}, {} KB, {:?} {:?}", m.name, x.parts.len(), x.triangles, x.buffers.len(),
                            x.buffers.iter().filter(|b| b.uvs.is_some()).count(), x.textures.len(), x.up, kb / 1024, t.elapsed(), x.notes);
                    }
                    Err(e) => { failed += 1; println!("  {g} {} : {e}", m.name); }
                }
            }
            println!("{g}: {ok} read, {failed} not");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conditions_follow_the_toggles() {
        let vars: HashMap<String, f64> = [("swap".to_string(), 1.0), ("jacket".to_string(), 0.0)].into_iter().collect();
        assert!(truth("$swap == 1", &vars));
        assert!(!truth("$swap == 1 && $jacket == 1", &vars));
        assert!(truth("($swap == 0 || $jacket == 0) && !$jacket", &vars));
        assert!(truth("$\\mods\\velina\\velina.ini\\swap >= 1", &vars));
        assert!(!truth("$unknown", &vars));
        assert!(truth("-1 < $jacket", &vars));
    }

    #[test]
    fn halves_read_right() {
        assert_eq!(half(0x3c00), 1.0);
        assert_eq!(half(0x3800), 0.5);
        assert_eq!(half(0xc000), -2.0);
        assert_eq!(half(0), 0.0);
    }

    #[test]
    fn a_small_mod_reads_with_its_toggle() {
        let dir = std::env::temp_dir().join(format!("gachamod-mesh-{}", crate::library::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        // two triangles over four vertices: stride 40 (pos, normal, tangent), texcoord stride 12 (colour + f32 uv)
        let mut pos = Vec::new();
        let mut tc = Vec::new();
        for (x, y, z) in [(0.0f32, 0.0f32, 0.0f32), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (1.0, 1.0, 0.0)] {
            for f in [x, y, z, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0] { pos.extend(f.to_le_bytes()); }
            tc.extend([255u8, 255, 255, 255]);
            for f in [x * 0.5 + 0.1, y * 0.5 + 0.2] { tc.extend(f.to_le_bytes()); }
        }
        let ib: Vec<u8> = [0u32, 1, 2, 1, 3, 2].iter().flat_map(|i| i.to_le_bytes()).collect();
        std::fs::write(dir.join("BodyPosition.buf"), &pos).unwrap();
        std::fs::write(dir.join("BodyTexcoord.buf"), &tc).unwrap();
        std::fs::write(dir.join("Body.ib"), &ib).unwrap();
        std::fs::write(dir.join("mod.ini"), "[Constants]\nglobal persist $top = 0\n\n[TextureOverrideBody]\nhash = 12345678\nib = ResourceBodyIB\nrun = CommandListBody\n\n\
[CommandListBody]\nif $top == 1\n  drawindexed = 3, 3, 0\nelse\n  drawindexed = 3, 0, 0\nendif\n\n\
[ResourceBodyIB]\ntype = Buffer\nformat = DXGI_FORMAT_R32_UINT\nfilename = Body.ib\n\n\
[ResourceBodyPosition]\ntype = Buffer\nstride = 40\nfilename = BodyPosition.buf\n\n\
[ResourceBodyTexcoord]\ntype = Buffer\nstride = 12\nfilename = BodyTexcoord.buf\n").unwrap();
        let m = read(&dir, &[]).unwrap();
        assert_eq!(m.parts.len(), 1);
        assert_eq!(m.triangles, 1);
        assert!(m.buffers[0].uvs.is_some() && m.buffers[0].normals.is_some());
        let idx = base64::engine::general_purpose::STANDARD.decode(&m.parts[0].indices).unwrap();
        assert_eq!(idx, [0u32, 1, 2].iter().flat_map(|i| i.to_le_bytes()).collect::<Vec<u8>>());
        // with the toggle on, the other triangle
        let m = read(&dir, &[VarValue { ini: "mod.ini".into(), var: "top".into(), value: "1".into() }]).unwrap();
        let idx = base64::engine::general_purpose::STANDARD.decode(&m.parts[0].indices).unwrap();
        assert_eq!(idx, [1u32, 3, 2].iter().flat_map(|i| i.to_le_bytes()).collect::<Vec<u8>>());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
