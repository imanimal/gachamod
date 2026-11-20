//! A game's quickstart icon: the game's own icon cut to the same rounded tile as gachamod's icons, with a round
//! quickstart badge (quickstart.ico's purple and play mark, with speed lines when there's room) set into a notch in
//! the bottom right corner. Every size is drawn on its own, with each shape measured per pixel, so edges stay sharp
//! at 16 px instead of being shrunk from 256.
use image::imageops::{self, FilterType};
use image::{Rgba, RgbaImage};

/// The sizes Windows draws desktop and Explorer icons at.
pub const SIZES: [u32; 6] = [256, 64, 48, 32, 24, 16];
/// quickstart.ico's tile and play mark.
const PURPLE: [f32; 3] = [139.0, 124.0, 255.0];
const MARK: [f32; 3] = [244.0, 242.0, 255.0];
/// Behind a game icon with see-through parts, when its edges have no colour to take.
const PLATE: [u8; 3] = [22, 20, 31];

type P = (f32, f32);

/// How much of a pixel a shape covers when the pixel's centre is `d` px outside it (negative: inside).
fn cover(d: f32) -> f32 { (0.5 - d).clamp(0.0, 1.0) }

fn rounded_square(p: P, lo: f32, hi: f32, r: f32) -> f32 {
    let (c, h) = ((lo + hi) / 2.0, (hi - lo) / 2.0 - r);
    let (qx, qy) = ((p.0 - c).abs() - h, (p.1 - c).abs() - h);
    qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - r
}

fn circle(p: P, c: P, r: f32) -> f32 { (p.0 - c.0).hypot(p.1 - c.1) - r }

fn segment(p: P, a: P, b: P) -> f32 {
    let (ab, ap) = ((b.0 - a.0, b.1 - a.1), (p.0 - a.0, p.1 - a.1));
    let t = ((ap.0 * ab.0 + ap.1 * ab.1) / (ab.0 * ab.0 + ab.1 * ab.1)).clamp(0.0, 1.0);
    (ap.0 - ab.0 * t).hypot(ap.1 - ab.1 * t)
}

fn triangle(p: P, v: [P; 3]) -> f32 {
    let d = segment(p, v[0], v[1]).min(segment(p, v[1], v[2])).min(segment(p, v[2], v[0]));
    let side = |a: P, b: P| (b.0 - a.0) * (p.1 - a.1) - (b.1 - a.1) * (p.0 - a.0);
    let s = [side(v[0], v[1]), side(v[1], v[2]), side(v[2], v[0])];
    let inside = s.iter().all(|&x| x >= 0.0) || s.iter().all(|&x| x <= 0.0);
    if inside { -d } else { d }
}

/// The triangle `v` with its corners rounded by `r`: drawn smaller by `r` towards its incentre, then grown by `r`.
fn rounded_triangle(p: P, v: [P; 3], r: f32) -> f32 {
    let len = |a: P, b: P| (b.0 - a.0).hypot(b.1 - a.1);
    let (a, b, c) = (len(v[1], v[2]), len(v[2], v[0]), len(v[0], v[1]));
    let per = a + b + c;
    let inc = ((a * v[0].0 + b * v[1].0 + c * v[2].0) / per, (a * v[0].1 + b * v[1].1 + c * v[2].1) / per);
    let area = ((v[1].0 - v[0].0) * (v[2].1 - v[0].1) - (v[2].0 - v[0].0) * (v[1].1 - v[0].1)).abs() / 2.0;
    let k = (1.0 - r / (2.0 * area / per)).max(0.0);
    let small = v.map(|q| (inc.0 + (q.0 - inc.0) * k, inc.1 + (q.1 - inc.1) * k));
    triangle(p, small) - r
}

/// The game's icon fitted to a `t` px tile: its own see-through margin cut away, then centred on the colour of its
/// edges, so the tile is always solid and the rounded corners are the tile's.
fn fit(game: &RgbaImage, t: u32) -> RgbaImage {
    let (w, h) = game.dimensions();
    let solid = |x: u32, y: u32| game.get_pixel(x, y)[3] > 128;
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0, 0);
    for y in 0..h { for x in 0..w { if solid(x, y) { x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x + 1); y1 = y1.max(y + 1); } } }
    let crop = if x1 > x0 && y1 > y0 { imageops::crop_imm(game, x0, y0, x1 - x0, y1 - y0).to_image() } else { game.clone() };
    let (cw, ch) = crop.dimensions();
    let band = (cw.min(ch) / 16).max(1);
    let (mut sum, mut n) = ([0f64; 3], 0f64);
    for (x, y, px) in crop.enumerate_pixels() {
        if px[3] > 200 && (x < band || y < band || x >= cw - band || y >= ch - band) {
            for i in 0..3 { sum[i] += f64::from(px[i]); }
            n += 1.0;
        }
    }
    let edge = if n > 0.0 { sum.map(|v| (v / n).round() as u8) } else { PLATE };
    let scale = t as f32 / cw.max(ch) as f32;
    let (nw, nh) = (((cw as f32 * scale).round() as u32).clamp(1, t), ((ch as f32 * scale).round() as u32).clamp(1, t));
    let art = imageops::resize(&crop, nw, nh, FilterType::Lanczos3);
    let mut out = RgbaImage::from_pixel(t, t, Rgba([edge[0], edge[1], edge[2], 255]));
    imageops::overlay(&mut out, &art, i64::from((t - nw) / 2), i64::from((t - nh) / 2));
    out
}

/// A canvas of premultiplied colour, painted one shape at a time.
struct Canvas { s: u32, px: Vec<[f32; 4]> }

impl Canvas {
    fn over(&mut self, x: u32, y: u32, rgb: [f32; 3], a: f32) {
        if a <= 0.0 { return; }
        let c = &mut self.px[(y * self.s + x) as usize];
        for i in 0..3 { c[i] = c[i] * (1.0 - a) + rgb[i] * a; }
        c[3] = c[3] * (1.0 - a) + a;
    }
    fn keep(&mut self, x: u32, y: u32, k: f32) {
        if k >= 1.0 { return; }
        for v in &mut self.px[(y * self.s + x) as usize] { *v *= k; }
    }
    fn image(self) -> RgbaImage {
        RgbaImage::from_fn(self.s, self.s, |x, y| {
            let [r, g, b, a] = self.px[(y * self.s + x) as usize];
            if a <= 0.0 { return Rgba([0, 0, 0, 0]); }
            let ch = |v: f32| (v / a).round().clamp(0.0, 255.0) as u8;
            Rgba([ch(r), ch(g), ch(b), (a * 255.0).round().clamp(0.0, 255.0) as u8])
        })
    }
}

/// The quickstart icon for `game` (its own icon, any size) at `s` px.
pub fn draw(game: &RgbaImage, s: u32) -> RgbaImage {
    let sf = s as f32;
    // the tile: the margin and corners of gachamod's icons, edge to edge at 16 px where every pixel counts
    let m = if s <= 16 { 0 } else { ((sf * 8.0 / 256.0).round() as u32).max(1) };
    let t = s - 2 * m;
    let (lo, hi, r) = (m as f32, (s - m) as f32, t as f32 * 0.24);
    let art = fit(game, t);
    // the badge: over half the icon when it's small, so the play mark still reads
    let k = match s { 0..=16 => 0.66, 17..=24 => 0.6, 25..=32 => 0.56, 33..=48 => 0.5, _ => 0.42 };
    let br = sf * k / 2.0;
    let bc = (sf - br, sf - br);
    let gap = (sf * 0.04).max(1.0);
    // the play mark in the badge's units (-1 to 1 across), moved right to make room for speed lines
    let lines = s >= 48;
    let dx = if lines { 0.17 } else { 0.07 };
    let u = |x: f32, y: f32| (bc.0 + x * br, bc.1 + y * br);
    let play = [u(-0.3 + dx, -0.44), u(0.46 + dx, 0.0), u(-0.3 + dx, 0.44)];
    let streaks = [(u(-0.62, -0.24), u(-0.36, -0.24)), (u(-0.78, 0.0), u(-0.36, 0.0)), (u(-0.62, 0.24), u(-0.36, 0.24))];
    let thick = 0.075 * br;
    let mut c = Canvas { s, px: vec![[0.0; 4]; (s * s) as usize] };
    for y in 0..s {
        for x in 0..s {
            let p = (x as f32 + 0.5, y as f32 + 0.5);
            let tile = cover(rounded_square(p, lo, hi, r));
            if tile > 0.0 {
                let a = art.get_pixel((x.max(m) - m).min(t - 1), (y.max(m) - m).min(t - 1));
                c.over(x, y, [f32::from(a[0]), f32::from(a[1]), f32::from(a[2])], tile * f32::from(a[3]) / 255.0);
            }
            // the notch the badge sits in, so it reads on any game's colours
            c.keep(x, y, 1.0 - cover(circle(p, bc, br + gap)));
            c.over(x, y, PURPLE, cover(circle(p, bc, br)));
            let mut d = rounded_triangle(p, play, 0.09 * br);
            if lines { for (a, b) in streaks { d = d.min(segment(p, a, b) - thick); } }
            c.over(x, y, MARK, cover(d));
        }
    }
    c.image()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rounded_tile_with_the_badge_in_a_notch() {
        let green = Rgba([10, 200, 30, 255]);
        let img = draw(&RgbaImage::from_pixel(256, 256, green), 256);
        assert_eq!(img.dimensions(), (256, 256));
        // the tile is the game's, with rounded corners
        assert_eq!(*img.get_pixel(40, 128), green);
        assert_eq!(img.get_pixel(9, 9)[3], 0);
        // round the badge (centre 202, 202, radius 54): its purple, then the see-through notch
        let (c, br) = (256.0 - 256.0 * 0.21, 256.0 * 0.21);
        let at = |d: f32| { let v = c - d / std::f32::consts::SQRT_2; *img.get_pixel(v as u32, v as u32) };
        assert_eq!(at(br - 4.0).0, [139, 124, 255, 255]);
        assert_eq!(at(br + 5.0)[3], 0);
        // the play mark at the badge's middle
        assert_eq!(img.get_pixel((c + 0.1 * br) as u32, c as u32).0, [244, 242, 255, 255]);
    }

    #[test]
    fn see_through_margins_are_cut_away() {
        let mut game = RgbaImage::new(256, 256);
        for y in 64..192 { for x in 64..192 { game.put_pixel(x, y, Rgba([200, 40, 40, 255])); } }
        let img = draw(&game, 64);
        // the red square fills the tile instead of floating in its middle
        assert_eq!(img.get_pixel(8, 32).0, [200, 40, 40, 255]);
    }

    /// For a look while changing the drawing: `GACHAMOD_ICON_PREVIEW=<a game icon .png> cargo test -p gacha-core
    /// shortcuts::icon::tests::preview -- --ignored` writes every size to the temp folder as gachamod-quickstart-<size>.png.
    #[test]
    #[ignore]
    fn preview() {
        let Ok(path) = std::env::var("GACHAMOD_ICON_PREVIEW") else { return };
        let game = image::open(path).unwrap().to_rgba8();
        for s in SIZES { draw(&game, s).save(std::env::temp_dir().join(format!("gachamod-quickstart-{s}.png"))).unwrap(); }
    }

    #[test]
    fn every_size_draws() {
        let game = RgbaImage::from_pixel(256, 256, Rgba([10, 200, 30, 255]));
        for s in SIZES { assert_eq!(draw(&game, s).dimensions(), (s, s)); }
    }
}
