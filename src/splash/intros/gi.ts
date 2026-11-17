// Genshin Impact's opening: a night sky over Teyvat. The tip waits on deep indigo with a few faint stars. Then the
// sky wakes: stars fade in and twinkle, the tip breaks up into gold dust from left to right, a constellation links
// itself up in gold round the middle and a gold astrolabe blooms there and turns. The sky then opens from the centre of
// the astrolabe through a widening circle with a soft gold edge, the stars drifting outward, and the app settles in
// behind it. The sky is one canvas, drawn once for the hold and every frame only while the intro plays.
// Owner: SHELL area.
import type { Intro, IntroCtx } from "../types";

const BG = "#0d1328";
const INK = "#ece5d8";

/** When each part runs, in ms from the start of play. */
const T = {
  tip: [40, 600],     // the tip's dissolve sweeps across it
  link: 150,          // the constellation starts linking up
  linkFor: 680,       // and takes this long along its main line
  astro: [300, 900],  // the astrolabe draws itself
  open: [860, 1860],  // the sky opens
} as const;

const TAU = Math.PI * 2;
const GOLD = "211, 188, 142";
const HI = "241, 227, 194";
const COLS = ["246, 243, 255", "198, 214, 255", "255, 236, 204"]; // star colours: white, blue, warm

/** A constellation: stars in fractions of an ellipse round the middle (the third number is a star's size), the
    links between them, and how many stars make the main line (the rest are its branch). */
interface Shape { nodes: [number, number, number][]; links: [number, number][]; chain: number }

/** A new constellation each start. A line of 7 to 10 stars runs part way round a ring that keeps clear of the tip and
    of the window's edges, starting anywhere and going either way, with jittered spacing and depth. One or two stars
    branch off a middle star, sideways and in or out wherever there's room. Links run in order, each from a star
    already lit, so the branch grows while the main line goes on. */
function constellation(rnd = Math.random): Shape {
  const m = 7 + Math.floor(rnd() * 4);
  const dir = rnd() < 0.5 ? 1 : -1;
  const step = (Math.PI * (1.05 + rnd() * 0.5)) / (m - 1);
  const start = rnd() * TAU;
  const at = (ang: number, rho: number, size: number): [number, number, number] =>
    [clamp(Math.cos(ang) * rho, -0.97, 0.97), clamp(Math.sin(ang) * rho, -0.97, 0.97), size];
  const nodes: [number, number, number][] = [];
  const rhos: number[] = [];
  for (let i = 0; i < m; i++) {
    const ang = start + dir * (i * step + (i > 0 && i < m - 1 ? (rnd() - 0.5) * 0.5 * step : 0));
    const rho = 0.74 + rnd() * 0.3;
    rhos.push(rho);
    nodes.push(at(ang, rho, 0.7 + rnd() * 0.4));
  }
  // two brighter stars somewhere along it
  for (let k = 0; k < 2; k++) nodes[Math.floor(rnd() * m)]![2] = 1.2 + rnd() * 0.12;
  const links: [number, number][] = [];
  for (let i = 0; i < m - 1; i++) links.push([i, i + 1]);
  // the branch, linked right after its star lights
  const from = 2 + Math.floor(rnd() * (m - 4));
  const lean = (rnd() < 0.5 ? 1 : -1) * step * (0.45 + rnd() * 0.3);
  const out = rhos[from]! < 0.9 ? 0.2 : -0.17;
  const base = Math.atan2(nodes[from]![1], nodes[from]![0]);
  const extra = rnd() < 0.5 ? 2 : 1;
  const branch: [number, number][] = [];
  for (let k = 1; k <= extra; k++) {
    nodes.push(at(base + lean * k, Math.max(0.7, rhos[from]! + out * k), 0.65 + rnd() * 0.35));
    branch.push([k === 1 ? from : m + k - 2, m + k - 1]);
  }
  links.splice(from, 0, ...branch);
  return { nodes, links, chain: m };
}

type G = CanvasRenderingContext2D;
interface Star { u: number; v: number; z: number; r: number; a: number; tw: number; ph: number; deep: number; col: number; at: number; hold: number; spark: boolean }
interface Mote { x: number; y: number; at: number; life: number; vx: number; vy: number; r: number; ph: number; gold: boolean }

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const smooth = (x: number) => x * x * (3 - 2 * x);
const outCubic = (x: number) => 1 - (1 - x) ** 3;
const inOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const rgba = (rgb: string, a: number) => `rgba(${rgb}, ${a})`;

/** The same sky every time (a seeded random). */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sprite(size: number, paint: (g: G, s: number) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (g) paint(g, size);
  return c;
}
/** A soft round glow. */
const glowSprite = (rgb: string) => sprite(64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, rgba(rgb, 1)); gr.addColorStop(0.18, rgba(rgb, 0.5)); gr.addColorStop(0.5, rgba(rgb, 0.12)); gr.addColorStop(1, rgba(rgb, 0));
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});
/** The Teyvat theme's four-point star over a faint glow. */
const STAR = new Path2D("M12 0C12.9 7.6 16.4 11.1 24 12C16.4 12.9 12.9 16.4 12 24C11.1 16.4 7.6 12.9 0 12C7.6 11.1 11.1 7.6 12 0Z");
const sparkSprite = (rgb: string) => sprite(96, (g, s) => {
  g.globalAlpha = 0.55; g.drawImage(glowSprite(rgb), s * 0.3, s * 0.3, s * 0.4, s * 0.4); g.globalAlpha = 1;
  g.scale(s / 24, s / 24);
  const gr = g.createRadialGradient(12, 12, 0, 12, 12, 12);
  gr.addColorStop(0, "rgba(255, 252, 240, 1)"); gr.addColorStop(0.16, rgba(rgb, 0.95)); gr.addColorStop(0.55, rgba(rgb, 0.35)); gr.addColorStop(1, rgba(rgb, 0));
  g.fillStyle = gr; g.fill(STAR);
});

function makeStars(n: number): Star[] {
  const rnd = seeded(11);
  const stars: Star[] = [];
  // a third of them crowd along a faint band (the galaxy), the rest anywhere
  const bc = Math.cos(-0.42), bs = Math.sin(-0.42);
  for (let i = 0; i < n; i++) {
    let u = rnd(), v = rnd();
    if (rnd() < 0.34) {
      const along = rnd() * 2.2 - 1.1, off = (rnd() + rnd() + rnd() - 1.5) * 0.075;
      u = 0.56 + along * bc - off * bs; v = 0.44 + along * bs + off * bc;
    }
    const z = rnd() ** 1.7;
    const spark = z > 0.72 && rnd() < 0.5;
    const pick = rnd();
    stars.push({ u, v, z, r: 0.42 + z * 1.0 + (rnd() < 0.05 ? 0.4 : 0), a: 0.35 + 0.65 * rnd() * (0.55 + 0.45 * z),
      tw: 1.4 + rnd() * 3.2, ph: rnd() * TAU, deep: rnd() < 0.3 ? 0.65 : 0.22, col: pick < 0.16 ? 1 : pick < 0.3 ? 2 : 0,
      at: rnd() * 620, hold: 0, spark });
  }
  // the hold shows a few of the brightest, spread out and clear of the tip
  const held: Star[] = [];
  for (const s of [...stars].sort((p, q) => q.r * q.a - p.r * p.a)) {
    if (held.length >= 16) break;
    if (Math.abs(s.u - 0.5) < 0.28 && Math.abs(s.v - 0.5) < 0.18) continue;
    if (s.u < 0.03 || s.u > 0.97 || s.v < 0.04 || s.v > 0.96) continue;
    if (held.some((p) => Math.hypot((p.u - s.u) * 1.6, p.v - s.v) < 0.16)) continue;
    s.hold = 0.45 + 0.25 * rnd();
    held.push(s);
  }
  return stars;
}

class Sky {
  readonly canvas = document.createElement("canvas");
  private readonly g: G;
  private readonly light: boolean;
  private stars: Star[];
  private motes: Mote[] = [];
  private W = 0; private H = 0; private dpr = 1;
  /** The constellation in px from the centre, and when each star lights and each link draws. */
  private pts: [number, number][] = [];
  private lit: number[] = [];
  private links: { a: number; b: number; t0: number; t1: number }[] = [];
  private playing = false;
  private readonly glow = COLS.map(glowSprite);
  private readonly spark = COLS.map(sparkSprite);
  private readonly glowGold = glowSprite(GOLD);
  private readonly sparkGold = sparkSprite(GOLD);
  /** This start's constellation (kept through a resize). */
  private readonly shape = constellation();

  constructor(ctx: IntroCtx) {
    this.canvas.className = "gi-sky";
    this.canvas.setAttribute("aria-hidden", "true");
    this.g = this.canvas.getContext("2d")!;
    this.light = ctx.scheme === "light";
    ctx.stage.prepend(this.canvas);
    this.size();
    this.stars = makeStars(Math.round(clamp((this.W * this.H) / 4200, 140, 380)));
    this.frame(0);
    window.addEventListener("resize", () => { this.size(); if (!this.playing) this.frame(0); }, { signal: ctx.signal });
  }

  private size() {
    this.W = Math.max(1, innerWidth); this.H = Math.max(1, innerHeight);
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    // the constellation: an ellipse that keeps clear of the tip and of the window's edges
    const U = Math.min(this.W, this.H);
    const ax = Math.min(this.W * 0.42, U * 0.74), ay = Math.min(this.H * 0.4, U * 0.42);
    const { nodes, links, chain } = this.shape;
    this.pts = nodes.map(([x, y]) => [x * ax, y * ay]);
    const len = (a: number, b: number) => Math.hypot(this.pts[b]![0] - this.pts[a]![0], this.pts[b]![1] - this.pts[a]![1]);
    const main = links.filter(([a, b]) => b === a + 1 && b < chain).reduce((n, [a, b]) => n + len(a, b), 0);
    const speed = main / T.linkFor;
    this.lit = nodes.map(() => Infinity);
    this.lit[0] = T.link;
    this.links = links.map(([a, b]) => {
      const t0 = this.lit[a]!, t1 = t0 + len(a, b) / speed;
      this.lit[b] = t1;
      return { a, b, t0, t1 };
    });
  }

  /** The tip turns to gold dust where its dissolve passes (read once, when play starts). */
  private dust(tip: HTMLElement) {
    const box = tip.getBoundingClientRect();
    if (!box.width) return;
    const rects = [...(tip.querySelector(".splash-tip-t")?.getClientRects() ?? [])];
    const icon = tip.querySelector(".splash-tip-i")?.getBoundingClientRect();
    const area = rects.reduce((n, r) => n + r.width * r.height, 0);
    const n = Math.round(clamp(area / 150, 50, 150));
    const rnd = Math.random;
    for (let i = 0; i < n; i++) {
      let x: number, y: number;
      const r = rects[Math.floor(rnd() * rects.length)];
      if (icon && (rnd() < 0.14 || !r)) {
        const a = rnd() * TAU, d = icon.width * (0.25 + rnd() * 0.75);
        x = icon.left + icon.width / 2 + Math.cos(a) * d; y = icon.top + icon.height / 2 + Math.sin(a) * d;
      } else if (r) {
        x = r.left + rnd() * r.width; y = r.top + r.height * (0.25 + rnd() * 0.55);
      } else continue;
      // the sweep's soft edge passes a point a fraction u across the tip at (u + 0.25) / 1.5 of its run
      const u = clamp((x - box.left) / box.width);
      const at = T.tip[0] + (T.tip[1] - T.tip[0]) * ((u + 0.25) / 1.5) + (rnd() - 0.5) * 70;
      const out = (x - this.W / 2) / this.W;
      this.motes.push({ x, y, at, life: 650 + rnd() * 550, vx: (rnd() - 0.5) * 26 + out * 40, vy: -(14 + rnd() * 38),
        r: 0.45 + rnd() * 0.9, ph: rnd() * TAU, gold: rnd() < 0.7 });
    }
  }

  play(ctx: IntroCtx): Promise<void> {
    const { stage, tip, app, signal } = ctx;
    this.playing = true;
    this.canvas.getAnimations().forEach((a) => a.finish());
    this.dust(tip);
    this.frame(0);
    stage.style.background = "transparent"; // the canvas is the sky from here, so it can open

    // a soft edge sweeps across the tip from the left, and the dust rises where it passes
    const sweep = "linear-gradient(90deg, transparent 40%, #000 60%)";
    tip.animate([
      { maskImage: sweep, maskSize: "250% 100%", maskRepeat: "no-repeat", maskPosition: "100% 0", transform: "none", filter: "blur(0)", opacity: 1 },
      { opacity: 1, offset: 0.75 },
      { maskImage: sweep, maskSize: "250% 100%", maskRepeat: "no-repeat", maskPosition: "0% 0", transform: "translateY(-5px)", filter: "blur(1.2px)", opacity: 0 },
    ], { duration: T.tip[1] - T.tip[0], delay: T.tip[0], easing: "linear", fill: "both" });

    // the app comes up out of the night and settles from slightly near
    const [o0, o1] = T.open;
    const shown = app.animate([
      { transform: "scale(1.045)", opacity: this.light ? 0.6 : 0.4 },
      { transform: "none", opacity: 1 },
    ], { duration: o1 - o0, delay: o0, easing: "cubic-bezier(.45, .05, .25, 1)", fill: "both" });

    // the canvas keeps time by an empty animation, so it stays in step with the others (and pauses with them)
    const clock = this.canvas.animate(null, { duration: o1 });
    const sky = new Promise<void>((done) => {
      if (signal.aborted) return done();
      let raf = 0;
      const tick = () => {
        const t = clamp(Number(clock.currentTime) || 0, 0, o1);
        this.frame(t);
        if (t >= o1) return done();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      signal.addEventListener("abort", () => { cancelAnimationFrame(raf); done(); }, { once: true });
    });
    return Promise.all([sky, shown.finished.catch(() => {})]).then(() => {});
  }

  /** One frame of the sky at t ms into play (0 is the hold). */
  private frame(t: number) {
    const { g, W, H, dpr } = this;
    const cx = W / 2, cy = H / 2, U = Math.min(W, H);
    const [o0, o1] = T.open;
    const tau = span(t, o0, o1);
    const open = inOutCubic(tau);
    const drift = tau * tau; // the stars head outward faster as the sky opens
    const turn = 0.05 * (t / 1000); // and the whole sky turns slowly round the middle
    const cr = Math.cos(turn), sr = Math.sin(turn);
    const wake = smooth(span(t, 0, 900));

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = BG;
    g.fillRect(0, 0, W, H);

    // the galaxy's band and a glow behind the astrolabe
    if (wake > 0) {
      g.save();
      g.translate(cx, cy); g.rotate(turn); g.scale(1 + 0.6 * drift, 1 + 0.6 * drift); g.translate(-cx, -cy);
      g.scale(W, H); g.translate(0.56, 0.44); g.rotate(-0.42); g.scale(1, 0.15);
      const band = g.createRadialGradient(0, 0, 0, 0, 0, 0.85);
      band.addColorStop(0, `rgba(118, 128, 206, ${0.12 * wake})`); band.addColorStop(0.5, `rgba(92, 100, 178, ${0.05 * wake})`); band.addColorStop(1, "rgba(92, 100, 178, 0)");
      g.fillStyle = band; g.fillRect(-1, -1, 2, 2);
      g.restore();
      const n = 0.62 * U, neb = wake * (1 - open);
      const core = g.createRadialGradient(cx, cy, 0, cx, cy, n);
      core.addColorStop(0, `rgba(80, 98, 172, ${0.26 * neb})`); core.addColorStop(0.45, `rgba(52, 66, 134, ${0.11 * neb})`); core.addColorStop(1, "rgba(52, 66, 134, 0)");
      g.fillStyle = core; g.fillRect(cx - n, cy - n, 2 * n, 2 * n);
    }

    // stars
    for (const s of this.stars) {
      const rise = smooth(span(t, s.at, s.at + 420)), show = s.hold + (1 - s.hold) * rise;
      if (show <= 0.002) continue;
      const tw = 1 - s.deep * (0.5 + 0.5 * Math.sin(s.ph + t * s.tw * 0.001));
      const dx = (s.u - 0.5) * W, dy = (s.v - 0.5) * H, k = 1 + s.z * 1.8 * drift;
      const x = cx + (dx * cr - dy * sr) * k, y = cy + (dx * sr + dy * cr) * k;
      if (x < -24 || x > W + 24 || y < -24 || y > H + 24) continue;
      const r = s.r * (1 + 0.6 * s.z * drift), a = s.a * show * tw;
      // the hold keeps to plain points; the sparkles come out as the sky wakes
      const sp = s.spark ? rise : 0;
      if (sp > 0) { g.globalAlpha = a * sp; g.drawImage(this.spark[s.col]!, x - r * 6, y - r * 6, r * 12, r * 12); }
      if (r > 0.95 && sp < 1) { g.globalAlpha = a * 0.45 * (1 - sp); g.drawImage(this.glow[s.col]!, x - r * 3.5, y - r * 3.5, r * 7, r * 7); }
      g.globalAlpha = a;
      g.fillStyle = `rgb(${COLS[s.col]})`;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }

    this.constellation(t, cx, cy, cr, sr, 1 + 1.15 * drift, 1 - smooth(span(tau, 0.3, 0.85)));
    this.astrolabe(t, cx, cy, U, open, tau);
    this.drawDust(t);

    // the sky opens: a soft-edged hole from the centre, lit gold round its rim
    if (open > 0) {
      const r = this.reach() * open, f = 16 + 0.08 * r;
      g.globalCompositeOperation = "destination-out";
      g.globalAlpha = 1;
      const hole = g.createRadialGradient(cx, cy, Math.max(0, r - f), cx, cy, r);
      hole.addColorStop(0, "#000"); hole.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.fillStyle = hole; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      g.globalCompositeOperation = "source-over";
      const rim = smooth(span(tau, 0, 0.08)) * (1 - smooth(span(tau, 0.7, 1)));
      if (rim > 0) {
        const hi = this.light ? "190, 152, 88" : HI;
        const r0 = Math.max(0, r - 2.6 * f), r1 = r + 0.5 * f;
        const at = (x: number) => clamp((x - r0) / (r1 - r0));
        const edge = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
        edge.addColorStop(0, rgba(GOLD, 0));
        edge.addColorStop(at(r - 1.2 * f), rgba(GOLD, (this.light ? 0.22 : 0.13) * rim));
        edge.addColorStop(at(r - 0.55 * f), rgba(hi, (this.light ? 0.55 : 0.5) * rim));
        edge.addColorStop(at(r - 0.1 * f), rgba(GOLD, 0.2 * rim));
        edge.addColorStop(1, rgba(GOLD, 0));
        g.fillStyle = edge; g.fillRect(cx - r1, cy - r1, 2 * r1, 2 * r1);
        g.globalAlpha = 0.6 * rim; g.strokeStyle = `rgb(${hi})`; g.lineWidth = 1;
        g.beginPath(); g.arc(cx, cy, Math.max(0, r - 0.55 * f), 0, TAU); g.stroke();
      }
    }
    // the astrolabe's centre star flares as the sky opens round it, then goes
    const a0 = T.astro[0];
    const core = smooth(span(t, a0 + 300, a0 + 520)) * (1 - smooth(span(tau, 0.08, 0.4)));
    if (core > 0) {
      const sz = 26 + 30 * smooth(span(tau, 0, 0.2));
      g.globalAlpha = core;
      g.drawImage(this.sparkGold, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    g.globalAlpha = 1;
  }

  /** How far the hole must open to clear the corners, edge and all. */
  private reach() { return (Math.hypot(this.W / 2, this.H / 2) + 22) / 0.92; }

  private constellation(t: number, cx: number, cy: number, cr: number, sr: number, k: number, fade: number) {
    const { g } = this;
    if (fade <= 0) return;
    const P = this.pts.map(([x, y]) => [cx + (x * cr - y * sr) * k, cy + (x * sr + y * cr) * k] as const);
    // the links, drawn as a pen moving from star to star, stopping short of each star's ring
    g.beginPath();
    const heads: [number, number][] = [];
    for (const l of this.links) {
      const p = span(t, l.t0, l.t1);
      if (p <= 0) continue;
      const [ax, ay] = P[l.a]!, [bx, by] = P[l.b]!;
      const len = Math.hypot(bx - ax, by - ay), gap = 7;
      if (len < gap * 2) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len, run = (len - gap * 2) * p;
      g.moveTo(ax + ux * gap, ay + uy * gap);
      g.lineTo(ax + ux * (gap + run), ay + uy * (gap + run));
      if (p < 1) heads.push([ax + ux * (gap + run), ay + uy * (gap + run)]);
    }
    g.lineCap = "round";
    g.strokeStyle = `rgb(${GOLD})`;
    g.globalAlpha = 0.14 * fade; g.lineWidth = 3.2; g.stroke();
    g.globalAlpha = 0.78 * fade; g.lineWidth = 1; g.stroke();
    for (const [x, y] of heads) { g.globalAlpha = fade; g.drawImage(this.glowGold, x - 8, y - 8, 16, 16); }

    // the stars: faint white before their link reaches them, then gold, ringed, with a flare
    const seen = 0.32 + 0.4 * smooth(span(t, 0, 400));
    this.shape.nodes.forEach(([, , size], i) => {
      const [x, y] = P[i]!, at = this.lit[i]!;
      const on = smooth(span(t, at - 30, at + 140));
      const flare = t >= at ? Math.exp(-(t - at) / 240) : 0;
      if (on < 1) {
        g.globalAlpha = seen * (1 - on) * fade;
        const s = 9 * size;
        g.drawImage(this.spark[0]!, x - s / 2, y - s / 2, s, s);
      }
      if (on <= 0) return;
      const s = (15 + 7 * size) * (1 + 1.3 * flare);
      g.globalAlpha = on * fade;
      g.drawImage(this.sparkGold, x - s / 2, y - s / 2, s, s);
      g.globalAlpha = 0.55 * on * fade; g.lineWidth = 0.9;
      g.beginPath(); g.arc(x, y, 4.8 + 0.6 * size, 0, TAU); g.stroke();
      g.globalAlpha = on * fade; g.fillStyle = `rgb(${HI})`;
      g.beginPath(); g.arc(x, y, 1.3 + 0.3 * size, 0, TAU); g.fill();
    });
  }

  /** Thin gold rings with ticks, a dotted ring, two crossed squares and two short arcs, each drawing itself in, the
      outer and inner parts turning against each other. */
  private astrolabe(t: number, cx: number, cy: number, U: number, open: number, tau: number) {
    const { g } = this;
    const [a0, a1] = T.astro;
    const rel = t - a0;
    const A = smooth(span(rel, 0, 200)) * (1 - smooth(span(tau, 0.15, 0.7)));
    if (A <= 0) return;
    const R = U * 0.25 * (0.9 + 0.1 * outCubic(span(t, a0, a1 + 200))) * (1 + 1.3 * open);
    const p = (d0: number, d1: number) => smooth(span(rel, d0, d1));
    const settle = Math.exp(-Math.max(0, rel) / 380);
    const outer = -1.1 * settle + 0.12 * (rel / 1000) - Math.PI / 2;
    const inner = 0.9 * settle - 0.16 * (rel / 1000);
    const arcs = 1.3 * (rel / 1000);
    const ring = (r: number, prog: number, from: number, back: boolean, alpha: number, width = 1) => {
      if (prog <= 0) return;
      g.globalAlpha = alpha * A; g.lineWidth = width;
      g.beginPath(); g.arc(0, 0, r, from, from + (back ? -1 : 1) * TAU * prog, back); g.stroke();
    };

    g.save();
    g.translate(cx, cy);
    g.strokeStyle = `rgb(${GOLD})`; g.fillStyle = `rgb(${GOLD})`; g.lineCap = "round";

    // outer ring with its glow, and the tick band inside it
    const pA = p(0, 420);
    ring(R, pA, outer, false, 0.1, 4);
    ring(R, pA, outer, false, 0.78);
    g.beginPath();
    for (let i = 0; i < 72 && i / 72 < pA; i++) {
      const ang = outer + (i / 72) * TAU, c = Math.cos(ang), s = Math.sin(ang);
      const r0 = R * (i % 6 === 0 ? 0.86 : i % 2 === 0 ? 0.92 : 0.95);
      g.moveTo(c * r0, s * r0); g.lineTo(c * R * 0.985, s * R * 0.985);
    }
    g.globalAlpha = 0.55 * A; g.lineWidth = 0.8; g.stroke();
    ring(R * 0.9, p(60, 480), outer + Math.PI, true, 0.42, 0.8);

    // four diamonds just outside, at the quarters
    const pD = p(380, 600);
    if (pD > 0) {
      g.globalAlpha = A * pD;
      for (let q = 0; q < 4; q++) {
        const ang = outer + (q * TAU) / 4, c = Math.cos(ang), s = Math.sin(ang), r = R * 1.065, d = 3.6 * pD;
        g.beginPath();
        g.moveTo(c * (r - d), s * (r - d)); g.lineTo(c * r - s * d * 0.6, s * r + c * d * 0.6);
        g.lineTo(c * (r + d), s * (r + d)); g.lineTo(c * r + s * d * 0.6, s * r - c * d * 0.6);
        g.closePath(); g.fill();
      }
    }

    // the dotted ring, turning the other way
    const pC = p(120, 520);
    if (pC > 0) {
      g.beginPath();
      for (let i = 0; i < 96 && i / 96 < pC; i++) {
        const ang = inner + Math.PI / 2 - (i / 96) * TAU;
        g.moveTo(Math.cos(ang) * R * 0.75 + 0.8, Math.sin(ang) * R * 0.75);
        g.arc(Math.cos(ang) * R * 0.75, Math.sin(ang) * R * 0.75, 0.8, 0, TAU);
      }
      g.globalAlpha = 0.6 * A; g.fill();
    }

    // middle ring, the two crossed squares inside it, and two short arcs riding outside it
    const rD = R * 0.58;
    ring(rD, p(160, 540), inner, false, 0.62);
    const pR = p(260, 700);
    if (pR > 0) {
      const side = rD * Math.SQRT2, per = side * 4;
      g.setLineDash([per * pR, per]);
      for (const off of [0, Math.PI / 4]) {
        g.beginPath();
        for (let v = 0; v <= 4; v++) {
          const ang = inner + off + (v * Math.PI) / 2;
          if (v === 0) g.moveTo(Math.cos(ang) * rD, Math.sin(ang) * rD); else g.lineTo(Math.cos(ang) * rD, Math.sin(ang) * rD);
        }
        g.globalAlpha = 0.3 * A; g.lineWidth = 0.8; g.stroke();
      }
      g.setLineDash([]);
    }
    const pArc = p(300, 620);
    if (pArc > 0) {
      for (const off of [0, Math.PI]) {
        g.globalAlpha = 0.7 * A * pArc; g.lineWidth = 2;
        g.beginPath(); g.arc(0, 0, R * 0.66, arcs + off, arcs + off + 0.75 * pArc); g.stroke();
      }
    }

    // inner ring with short ticks pointing in
    const pE = p(200, 520);
    ring(R * 0.34, pE, inner + Math.PI, true, 0.55, 0.9);
    if (pE > 0) {
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = inner + (i * TAU) / 8, c = Math.cos(ang), s = Math.sin(ang);
        g.moveTo(c * R * 0.34, s * R * 0.34); g.lineTo(c * R * (i % 2 ? 0.31 : 0.28), s * R * (i % 2 ? 0.31 : 0.28));
      }
      g.globalAlpha = 0.55 * A * pE; g.lineWidth = 0.9; g.stroke();
    }

    // small bodies riding three of the rings
    const pB = p(420, 680);
    if (pB > 0) {
      g.globalAlpha = A * pB;
      for (const [r, ang, size] of [[R * 0.9, -arcs * 0.6 + 0.8, 2.2], [rD, inner + 2.4, 2.6], [R * 0.34, arcs * 1.4 + 4, 1.8]] as const) {
        g.beginPath(); g.arc(Math.cos(ang) * r, Math.sin(ang) * r, size, 0, TAU); g.fill();
      }
    }
    g.restore();
  }

  private drawDust(t: number) {
    const { g } = this;
    for (const m of this.motes) {
      const age = t - m.at, p = age / m.life;
      if (p <= 0 || p >= 1) continue;
      const a = Math.sin(Math.PI * p) ** 0.7 * (0.65 + 0.35 * Math.sin(m.ph + t * 0.02));
      const s = age / 1000, x = m.x + m.vx * s, y = m.y + m.vy * s - 18 * s * s;
      g.globalAlpha = a * 0.55;
      g.drawImage(m.gold ? this.glowGold : this.glow[2]!, x - m.r * 4, y - m.r * 4, m.r * 8, m.r * 8);
      g.globalAlpha = a;
      g.fillStyle = `rgb(${m.gold ? HI : COLS[0]})`;
      g.beginPath(); g.arc(x, y, m.r * 0.8, 0, TAU); g.fill();
    }
  }
}

const skies = new WeakMap<HTMLElement, Sky>();

export const intro: Intro = {
  bg: BG,
  ink: INK,
  build(ctx) { skies.set(ctx.stage, new Sky(ctx)); },
  play(ctx) { return (skies.get(ctx.stage) ?? new Sky(ctx)).play(ctx); },
};
