// Honkai: Star Rail's opening. The hold screen is deep space with a few faint stars and the tip. Then the stars rush
// toward you and stretch into warp streaks, two rails of light run from the bottom edge to the vanishing point with
// sleepers ticking past, the tip is pulled into that point, it flashes, and the app flies out of the flash while the
// streaks pass over it. One canvas draws space, rails, stars and the flash; the app is shown through a hole the size
// of #root, whose transform and filter are the only things animated on it. Owner: SHELL area.
import type { Intro, IntroCtx } from "../types";
import { intro as plain } from "./plain";

const BG = "#090b18";
const INK = "#e6e9f6";
const BG_RGB: RGB = [9, 11, 24];

// the sequence, in ms from the start of play
const RAIL_IN = 40;        // the rails start at the bottom edge
const RAIL_AT = 560;       // and reach the vanishing point
const TIP_OUT = 520;       // the tip is pulled in by then
const FLASH = 540;         // the flash at the vanishing point
const APP_IN = 560;        // the app comes out of it
const APP_DUR = 1000;      // and has settled
const LAST_STAR = 1240;    // no new streaks after this
const FADE = 1640;         // and the last are gone
const END = 1720;

// the star field: depth runs from Z1 (far) to Z0 (at the viewer)
const Z0 = 0.07;
const Z1 = 3.2;
// the track: the bottom edge is depth 1 and the rails start just in front of it
const ZN = 0.82;

type RGB = [number, number, number];

interface Star { x: number; y: number; z: number; size: number; a: number; col: number; hold: boolean; dead: boolean }

interface Scene {
  cv: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  W: number; H: number; dpr: number;
  stars: Star[];
  cols: RGB[];
  light: boolean;
  accent: RGB;
  travel: number;
  open: boolean;
  playing: boolean;
}

const scenes = new WeakMap<HTMLElement, Scene>();

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rgba = (c: RGB, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a.toFixed(3)})`;

function hex(h: string): RGB {
  let s = h.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, "$&$&");
  if (!/^[0-9a-f]{6}$/i.test(s)) return [165, 150, 245];
  const n = parseInt(s, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// ── the app's flight: out of the vanishing point, braking all the way in ──

const S0 = 1 / 27;
const SAMPLES = 60;
/** The scale eases in log space (S0 to 1 along an ease-out), so every moment reads as the same kind of zoom: quick
    out of the point, then one long, even slowdown with no late burst before it stops. */
const appScale = (u: number) => S0 ** ((1 - clamp01(u)) ** 3);
/** The blur is gone by halfway, while the app is still small (a blur over the full window is costly to draw). */
const appBlur = (u: number) => 14 * (1 - smooth(0, 0.5, u));
const appBright = (u: number) => 1 + 0.4 * (1 - smooth(0, 0.5, u));
const SCALES = Array.from({ length: SAMPLES + 1 }, (_, i) => appScale(i / SAMPLES));

/** #root's scale at u, as the keyframes interpolate it. */
function scaleAt(u: number) {
  const p = clamp01(u) * SAMPLES;
  const i = Math.min(SAMPLES - 1, Math.floor(p));
  return SCALES[i]! + (SCALES[i + 1]! - SCALES[i]!) * (p - i);
}

function appKeys(): Keyframe[] {
  return SCALES.map((s, i) => {
    const u = i / SAMPLES;
    return { offset: u, transform: `scale(${s.toFixed(5)})`, filter: `blur(${appBlur(u).toFixed(2)}px) brightness(${appBright(u).toFixed(3)})` };
  });
}

// ── speeds ──

/** The star field's speed in depth per second: still, then a drift, then warp. */
function starSpeed(t: number) {
  if (t <= 0) return 0;
  if (t < 150) return 0.35 * smooth(0, 150, t);
  if (t < 700) return 0.35 * Math.exp(Math.log(18 / 0.35) * (t - 150) / 550);
  return 18;
}

/** The train's speed along the track, in sleeper depth per second. */
const trainSpeed = (t: number) => (t <= 0 ? 0 : 0.9 * smooth(0, 160, t) + 14 * clamp01(t / 620) ** 2.2);

// ── the scene ──

function size(sc: Scene) {
  sc.W = Math.max(1, window.innerWidth);
  sc.H = Math.max(1, window.innerHeight);
  sc.dpr = Math.min(2, window.devicePixelRatio || 1);
  sc.cv.width = Math.round(sc.W * sc.dpr);
  sc.cv.height = Math.round(sc.H * sc.dpr);
  sc.g.setTransform(sc.dpr, 0, 0, sc.dpr, 0, 0);
}

const focal = (sc: Scene) => Math.max(sc.W, sc.H) / 2;

function place(sc: Scene, s: Star) {
  const F = focal(sc);
  s.x = (Math.random() * 2 - 1) * 1.15 * sc.W / (2 * F);
  s.y = (Math.random() * 2 - 1) * 1.15 * sc.H / (2 * F);
}

function seed(sc: Scene) {
  const n = Math.round(Math.min(640, Math.max(170, sc.W * sc.H / 2300)));
  const holdN = Math.round(n * 0.13);
  const F = focal(sc);
  sc.stars = [];
  for (let i = 0; i < n; i++) {
    const hold = i < holdN;
    const r = Math.random();
    const s: Star = { x: 0, y: 0, z: 0, size: 0.6 + Math.random() ** 3 * 1.2, a: 0, col: r < 0.66 ? 0 : r < 0.9 ? 1 : 2, hold, dead: false };
    if (hold) {
      // the hold screen's faint stars: on screen, and clear of the tip
      s.a = 0.14 + Math.random() ** 2 * 0.36;
      for (let k = 0; k < 12; k++) {
        place(sc, s);
        s.z = 0.85 + Math.random() * 1.8;
        const dx = s.x / s.z * F, dy = s.y / s.z * F;
        if (Math.abs(dx) < sc.W / 2 - 8 && Math.abs(dy) < sc.H / 2 - 8 && !(Math.abs(dx) < 300 && Math.abs(dy) < 90)) break;
      }
    } else {
      s.a = 0.35 + Math.random() * 0.65;
      place(sc, s);
      s.z = Z0 + 0.1 + Math.random() * (Z1 - Z0 - 0.1);
    }
    sc.stars.push(s);
  }
}

/** Space, everywhere except where the app shows. */
function drawSpace(sc: Scene) {
  sc.g.globalCompositeOperation = "source-over";
  sc.g.fillStyle = BG;
  sc.g.fillRect(0, 0, sc.W, sc.H);
}

function drawTrack(sc: Scene, t: number) {
  const x = clamp01((t - RAIL_IN) / (RAIL_AT - RAIL_IN));
  const fade = 1 - smooth(FLASH + 160, FLASH + 620, t);
  if (x <= 0 || fade <= 0) return;
  const { g, W, H } = sc;
  const cx = W / 2, cy = H / 2;
  const G = Math.min(W * 0.19, H * 0.32);   // half the gauge at the bottom edge
  const hh = H / 2;                          // the bottom edge's distance below the vanishing point
  const u = 1 - (1 - x) ** 2.4;              // how far up the screen the rails have drawn
  const zh = ZN / Math.max(1e-3, 1 - u);     // the depth they've reached
  const ac = sc.accent;

  // sleepers under the rails, as far as the rails reach. Fast ones smear into faint bands
  const vs = trainSpeed(t);
  const gap = 0.3, d0 = 0.045, d = d0 + vs * 0.016;
  const phase = sc.travel % gap;
  const ties = new Path2D();
  for (let k = 0; k < 80; k++) {
    const z1 = ZN - gap + k * gap - phase;
    if (z1 > Math.min(zh, 18)) break;
    const z2 = Math.min(z1 + d, zh);
    const n = Math.max(z1, 0.3);
    if (z2 <= n) continue;
    const xn = G * 1.32 / n, xf = G * 1.32 / z2;
    ties.moveTo(cx - xn, cy + hh / n); ties.lineTo(cx + xn, cy + hh / n);
    ties.lineTo(cx + xf, cy + hh / z2); ties.lineTo(cx - xf, cy + hh / z2); ties.closePath();
  }
  const tieA = 0.42 * fade * (d0 / d) ** 0.55;
  const tg = g.createLinearGradient(0, cy, 0, H);
  tg.addColorStop(0, rgba(ac, 0));
  tg.addColorStop(0.18, rgba(mix(ac, [255, 255, 255], 0.4), tieA * 0.25));
  tg.addColorStop(1, rgba(mix(ac, [255, 255, 255], 0.55), tieA));
  g.globalCompositeOperation = "lighter";
  g.fillStyle = tg;
  g.fill(ties);

  // the rails: a soft glow and a bright core, each a strip on the ground that narrows with depth
  for (const side of [-1, 1]) {
    const nx = cx + side * G / ZN, ny = cy + hh / ZN;
    const grad = g.createLinearGradient(nx, ny, cx, cy);
    grad.addColorStop(0, rgba(ac, 0.85 * fade));
    grad.addColorStop(0.7, rgba(mix(ac, [255, 255, 255], 0.5), 0.95 * fade));
    grad.addColorStop(1, rgba([255, 255, 255], fade));
    const strip = (w: number) => {
      const p = new Path2D();
      p.moveTo(cx + (side * G - w) / ZN, ny); p.lineTo(cx + (side * G + w) / ZN, ny);
      p.lineTo(cx + (side * G + w) / zh, cy + hh / zh); p.lineTo(cx + (side * G - w) / zh, cy + hh / zh); p.closePath();
      return p;
    };
    g.globalAlpha = 0.16;
    g.fillStyle = grad;
    g.fill(strip(9));
    g.globalAlpha = 1;
    g.fill(strip(1.5));

    // the light running up the rail
    const hx = cx + side * G / zh, hy = cy + hh / zh;
    const lead = 1 - smooth(0.82, 1, u);
    if (lead > 0) {
      const r = Math.max(5, Math.min(30, 24 / zh ** 0.8));
      const sp = g.createRadialGradient(hx, hy, 0, hx, hy, r);
      sp.addColorStop(0, rgba([255, 255, 255], 0.95 * lead * fade));
      sp.addColorStop(0.25, rgba(mix(ac, [255, 255, 255], 0.6), 0.55 * lead * fade));
      sp.addColorStop(1, rgba(ac, 0));
      g.fillStyle = sp;
      g.fillRect(hx - r, hy - r, r * 2, r * 2);
      // a bright run behind it
      const tz = zh * 0.62;
      const tx = cx + side * G / tz, ty = cy + hh / tz;
      const run = g.createLinearGradient(tx, ty, hx, hy);
      run.addColorStop(0, rgba([255, 255, 255], 0));
      run.addColorStop(1, rgba([255, 255, 255], 0.9 * lead * fade));
      const p = new Path2D();
      const w = 2.2;
      p.moveTo(cx + (side * G - w) / tz, ty); p.lineTo(cx + (side * G + w) / tz, ty);
      p.lineTo(cx + (side * G + w) / zh, hy); p.lineTo(cx + (side * G - w) / zh, hy); p.closePath();
      g.fillStyle = run;
      g.fill(p);
    }
  }
}

/** The stars: dots while still, tapered streaks as they speed up. */
function drawStars(sc: Scene, t: number, dt: number, holdOnly: boolean, toApp: number) {
  const { g, W, H } = sc;
  const cx = W / 2, cy = H / 2, F = focal(sc);
  const v = starSpeed(t);
  const trail = v * 0.045;
  const boost = 1 + 0.9 * clamp01(v / 8);
  const on = smooth(0, 380, t);
  const out = 1 - smooth(LAST_STAR, FADE, t);
  if (out <= 0) return;
  const LV = 12;
  const paths: Path2D[][] = sc.cols.map(() => Array.from({ length: LV }, () => new Path2D()));
  const used: boolean[][] = sc.cols.map(() => Array<boolean>(LV).fill(false));

  for (const s of sc.stars) {
    if (s.dead || (holdOnly && !s.hold)) continue;
    if (dt > 0) {
      s.z -= v * dt;
      if (s.z < Z0) {
        if (t > LAST_STAR) { s.dead = true; continue; }
        s.z += Z1 - Z0; s.hold = false; place(sc, s);
      }
    }
    const zh = s.z, zt = Math.min(s.z + trail, Z1 + 0.3);
    const hx = cx + s.x / zh * F, hy = cy + s.y / zh * F;
    const tx = cx + s.x / zt * F, ty = cy + s.y / zt * F;
    if ((tx < -30 || tx > W + 30 || ty < -30 || ty > H + 30)) {
      // gone past the edge: bring it back far away, or let it go once the warp is ending
      if (dt > 0) {
        if (t > LAST_STAR) s.dead = true;
        else { s.z = Z1 - Math.random() * 0.3; s.hold = false; place(sc, s); }
      }
      continue;
    }
    const far = clamp01((Z1 - zh) / 0.55);
    const a = Math.min(1, s.a * far * (s.hold ? 1 : on) * boost) * out;
    if (a < 0.02) continue;
    const lv = Math.min(LV - 1, Math.floor(a * LV));
    const p = paths[s.col]![lv]!;
    used[s.col]![lv] = true;
    const w = s.size * Math.min(3.4, Math.max(0.6, 1.25 / zh));
    const dx = hx - tx, dy = hy - ty;
    const len = Math.hypot(dx, dy);
    const r = w / 2;
    if (len > r) {
      const nx = -dy / len * r, ny = dx / len * r;
      p.moveTo(tx, ty); p.lineTo(hx + nx, hy + ny); p.lineTo(hx - nx, hy - ny); p.closePath();
    }
    p.moveTo(hx + r, hy);
    p.arc(hx, hy, r, 0, Math.PI * 2);
  }

  // over a light app the streaks turn to a deeper violet so they still show
  const dark: RGB[] = [[84, 72, 190], mix(sc.accent, [40, 30, 110], 0.55), [150, 108, 40]];
  g.globalCompositeOperation = sc.light ? "source-over" : "lighter";
  for (let c = 0; c < sc.cols.length; c++) {
    const col = sc.light ? mix(sc.cols[c]!, dark[c]!, toApp) : sc.cols[c]!;
    for (let l = 0; l < LV; l++) {
      if (!used[c]![l]) continue;
      g.fillStyle = rgba(col, (l + 0.5) / LV);
      g.fill(paths[c]![l]!);
    }
  }
}

/** The flash where the rails meet: a glow builds, then a bloom with a four-point glint. */
function drawFlash(sc: Scene, t: number) {
  const { g, W, H } = sc;
  const cx = W / 2, cy = H / 2, m = Math.min(W, H);
  const ac = sc.accent;
  const f = t - FLASH;
  const pre = smooth(FLASH - 260, FLASH, t) * (1 - smooth(FLASH, FLASH + 90, t));
  const I = f < 0 ? 0 : f < 70 ? easeOut(f / 70) : Math.exp(-(f - 70) / 190);
  if (I < 0.004 && pre < 0.004) return;
  g.globalCompositeOperation = "lighter";

  if (pre > 0.004) {
    const r = 10 + 40 * pre;
    const gl = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gl.addColorStop(0, rgba([255, 255, 255], 0.85 * pre));
    gl.addColorStop(0.3, rgba(ac, 0.35 * pre));
    gl.addColorStop(1, rgba(ac, 0));
    g.fillStyle = gl;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  if (I < 0.004) return;

  const R = m * (0.1 + 0.42 * easeOut(clamp01(f / 340)));
  const bl = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  bl.addColorStop(0, rgba([255, 255, 255], 0.95 * I));
  bl.addColorStop(0.07, rgba([240, 236, 255], 0.8 * I));
  bl.addColorStop(0.28, rgba(ac, 0.3 * I));
  bl.addColorStop(0.6, rgba(ac, 0.08 * I));
  bl.addColorStop(1, rgba(ac, 0));
  g.fillStyle = bl;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);

  // the glint: long thin points left and right, shorter up and down
  const grow = easeOut(clamp01(f / 150));
  const arm = (lx: number, ly: number, th: number, a: number) => {
    const horiz = lx > ly;
    const gr = horiz ? g.createLinearGradient(cx - lx, cy, cx + lx, cy) : g.createLinearGradient(cx, cy - ly, cx, cy + ly);
    gr.addColorStop(0, rgba(ac, 0));
    gr.addColorStop(0.42, rgba(mix(ac, [255, 255, 255], 0.6), 0.5 * a));
    gr.addColorStop(0.5, rgba([255, 255, 255], a));
    gr.addColorStop(0.58, rgba(mix(ac, [255, 255, 255], 0.6), 0.5 * a));
    gr.addColorStop(1, rgba(ac, 0));
    const p = new Path2D();
    if (horiz) { p.moveTo(cx - lx, cy); p.lineTo(cx, cy - th); p.lineTo(cx + lx, cy); p.lineTo(cx, cy + th); }
    else { p.moveTo(cx, cy - ly); p.lineTo(cx + th, cy); p.lineTo(cx, cy + ly); p.lineTo(cx - th, cy); }
    p.closePath();
    g.fillStyle = gr;
    g.fill(p);
  };
  arm(W * 0.5 * grow, 0, 2 + 3 * I, I);
  arm(0, H * 0.24 * grow, 1.6 + 2.4 * I, 0.85 * I);
  arm(W * 0.2 * grow, 0, 7 * I, 0.35 * I);
}

/** One frame of play at t ms. */
function draw(sc: Scene, stage: HTMLElement, t: number, dt: number) {
  const { g, W, H } = sc;
  const cx = W / 2, cy = H / 2;
  if (dt > 0) sc.travel += trainSpeed(t) * dt;
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, W, H);

  const u = (t - APP_IN) / APP_DUR;
  const s = t < APP_IN ? 0 : scaleAt(u);
  const full = s >= 0.999;
  if (!full) {
    drawSpace(sc);
    drawTrack(sc, t);
  }
  if (t >= APP_IN) {
    if (!sc.open) { sc.open = true; stage.style.background = "transparent"; }
    g.globalCompositeOperation = "source-over";
    if (full) g.clearRect(0, 0, W, H);
    else {
      // the hole sits just inside the app's blurred edge, so nothing behind #root shows through
      const inset = appBlur(clamp01(u)) * s * 1.4;
      const hw = W * s / 2 - inset, hh = H * s / 2 - inset;
      if (hw > 0 && hh > 0) {
        g.clearRect(cx - hw, cy - hh, hw * 2, hh * 2);
        // the app comes up out of the dark, framed by a thin line while it flies
        const veil = 1 - smooth(APP_IN, APP_IN + 280, t);
        if (veil > 0) { g.fillStyle = rgba(BG_RGB, veil); g.fillRect(cx - hw, cy - hh, hw * 2, hh * 2); }
        const edge = 0.6 * (1 - smooth(0.45, 0.95, s)) * smooth(APP_IN + 40, APP_IN + 200, t);
        if (edge > 0.01) {
          g.strokeStyle = rgba(mix(sc.accent, [255, 255, 255], 0.35), edge);
          g.lineWidth = 1;
          g.strokeRect(cx - hw - 0.5, cy - hh - 0.5, hw * 2 + 1, hh * 2 + 1);
        }
      }
    }
  }
  drawStars(sc, t, dt, false, smooth(0.35, 0.85, s));
  drawFlash(sc, t);
  g.globalCompositeOperation = "source-over";
}

function drawHold(sc: Scene) {
  sc.g.globalAlpha = 1;
  sc.g.globalCompositeOperation = "source-over";
  sc.g.clearRect(0, 0, sc.W, sc.H);
  drawSpace(sc);
  drawStars(sc, 0, 0, true, 0);
  sc.g.globalCompositeOperation = "source-over";
}

/** A thin rule through the icon with small gold diamonds at its ends. */
function rule() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "hsr-rule");
  svg.setAttribute("viewBox", "0 0 300 12");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS(NS, "path");
  line.setAttribute("class", "hsr-rule-l");
  line.setAttribute("d", "M11 6H124M176 6H289");
  const dots = document.createElementNS(NS, "path");
  dots.setAttribute("class", "hsr-rule-p");
  dots.setAttribute("d", "M117 6h.01M183 6h.01");
  const ends = document.createElementNS(NS, "path");
  ends.setAttribute("class", "hsr-rule-d");
  ends.setAttribute("d", "M4.5 2.5 8 6 4.5 9.5 1 6ZM295.5 2.5 299 6 295.5 9.5 292 6Z");
  svg.append(line, dots, ends);
  return svg;
}

export const intro: Intro = {
  bg: BG,
  ink: INK,

  build({ stage, tip, accent, scheme, signal }: IntroCtx) {
    tip.prepend(rule());
    const cv = document.createElement("canvas");
    cv.className = "hsr-sky";
    cv.setAttribute("aria-hidden", "true");
    const g = cv.getContext("2d");
    if (!g) return;
    stage.prepend(cv);
    // the game's own colour when Star Rail is the current game, else its usual lavender
    const ac = hex(document.documentElement.dataset.game === "hsr" ? accent : "#a596f5");
    const sc: Scene = {
      cv, g, W: 1, H: 1, dpr: 1, stars: [], light: scheme === "light", accent: ac, travel: 0, open: false, playing: false,
      cols: [[226, 232, 255], mix(ac, [255, 255, 255], 0.25), [240, 218, 168]],
    };
    size(sc);
    seed(sc);
    drawHold(sc);
    scenes.set(stage, sc);
    window.addEventListener("resize", () => { if (scenes.get(stage) !== sc) return; size(sc); if (!sc.playing) drawHold(sc); }, { signal });
  },

  play(ctx: IntroCtx) {
    const { stage, tip, app, signal } = ctx;
    const sc = scenes.get(stage);
    if (!sc) return plain.play(ctx);
    sc.playing = true;

    // the tip gives a little, then is drawn into the vanishing point
    tip.animate([
      { offset: 0, transform: "none", opacity: 1, filter: "blur(0px)", easing: "cubic-bezier(.3,0,.4,1)" },
      { offset: 0.2, transform: "scale(1.03)", opacity: 1, filter: "blur(0px)", easing: "cubic-bezier(.62,0,.92,.42)" },
      { offset: 1, transform: "scale(.012)", opacity: 0, filter: "blur(2px)" },
    ], { duration: TIP_OUT, fill: "forwards" });

    // the app: held small and hidden behind the canvas until the flash, then flies in. Its clock runs the canvas.
    // will-change keeps it on its own layer for the whole flight (the shell clears the style afterwards)
    app.style.willChange = "transform, filter";
    const fly = app.animate(appKeys(), { delay: APP_IN, duration: APP_DUR, endDelay: END - APP_IN - APP_DUR, fill: "backwards" });

    return new Promise<void>((resolve) => {
      let raf = 0;
      let last = 0;
      const done = () => { cancelAnimationFrame(raf); resolve(); };
      signal.addEventListener("abort", done, { once: true });
      const tick = () => {
        if (signal.aborted) return;
        if (fly.playState === "idle") { done(); return; }
        const ct = fly.currentTime;
        const t = typeof ct === "number" ? ct : 0;
        const dt = Math.min(50, Math.max(0, t - last)) / 1000;
        last = t;
        draw(sc, stage, t, dt);
        if (t >= END || fly.playState === "finished") { done(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
  },
};
