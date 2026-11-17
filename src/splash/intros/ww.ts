// Wuthering Waves: the look of sound, with nothing played. The hold screen is a cold near-black with the tip over a
// flat trace, like an idle oscilloscope. On play the trace wakes into a layered waveform with mirrored spectrum bars
// around it, the tip shimmers away and the line rises to the centre, where it curls up around the gold mark into a
// ring (a round equalizer) as it builds to a peak. A resonance pulse then fires from the mark: the opening onto the app
// grows from the centre and carries the ring out with it, ringing down as it goes, with thin gold and white rings
// following. Owner: SHELL area.
import type { Intro, IntroCtx } from "../types";

const BG = "#080b13";
const INK = "#eceef2";
/** The game's own colour, for when this intro is previewed over another game. */
const GOLD = "#e9d58a";

/** Milliseconds from the start of play. */
const T = {
  sweep: 100, sweepFor: 620, // the shimmer crosses the tip, left to right
  rise: 470, riseFor: 460, // the trace moves up to the centre
  bend: 640, bendFor: 480, // the line curls into a ring around the centre mark
  pulse: 1150, // the resonance pulse
  openFor: 820, // the first ring reaches the far corner
  end: 2020,
};

/** Rings after the first: start and length (ms after the pulse), reach (share of the first ring's), gold, width, alpha. */
const RINGS: [number, number, number, boolean, number, number][] = [
  [45, 790, 0.95, true, 1.25, 0.85],
  [105, 740, 0.88, false, 1, 0.55],
  [185, 680, 0.8, true, 1, 0.5],
  [290, 575, 0.7, false, 0.8, 0.32],
];

type Rgb = [number, number, number];
const rgb = (c: string): Rgb | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${a < 0 ? 0 : a > 1 ? 1 : +a.toFixed(3)})`;
const shade = ([r, g, b]: Rgb, k: number): Rgb => [Math.round(r * k), Math.round(g * k), Math.round(b * k)];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (p: number) => p * p * (3 - 2 * p);
const inOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const out = (p: number) => 1 - (1 - p) ** 3;

/** A CSS-style cubic-bezier easing. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (s: number) => ((ax * s + bx) * s + cx) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let s = p;
    for (let i = 0; i < 8; i++) {
      const e = x(s) - p, d = dx(s);
      if (Math.abs(e) < 1e-5) break;
      if (Math.abs(d) < 1e-6) { s = p; break; }
      s = clamp01(s - e / d);
    }
    return ((ay * s + by) * s + cy) * s;
  };
}
/** The rings: off fast like a struck note, then a long settle. */
const ringEase = bezier(0.2, 0.55, 0.25, 1);

/** The game's accent when this is its own intro and the accent is known (the shell falls back to #8b7cff). */
const gold = (accent: string) => (document.documentElement.dataset.game === "ww" && rgb(accent) && accent.toLowerCase() !== "#8b7cff" ? accent : GOLD);

const PI = Math.PI;
/** The waveform's three layers, each a few harmonics travelling along the line. `c` is a clock that runs faster as the
    energy builds; `h` is how much of the highest harmonic shows (more near the peak). Every harmonic is a whole number
    of half turns across u = -1..1, so the two ends meet without a seam once the line closes into a ring. */
const LAYERS = [
  (u: number, c: number, h: number) => 0.6 * Math.sin(3 * PI * u - 7.5 * c) + 0.28 * Math.sin(7 * PI * u + 11 * c + 1.1) + h * Math.sin(15 * PI * u - 21 * c + 0.4),
  (u: number, c: number, h: number) => 0.5 * Math.sin(4 * PI * u + 6 * c + 2.2) + 0.3 * Math.sin(9 * PI * u - 13 * c + 0.7) + 0.8 * h * Math.sin(19 * PI * u + 25 * c),
  (u: number, c: number, h: number) => 0.58 * Math.sin(3 * PI * u - 7.5 * c + 0.9) + 0.26 * Math.sin(6 * PI * u - 10 * c + 2.6) + 0.7 * h * Math.sin(13 * PI * u + 17 * c + 1.9),
];

export const intro: Intro = {
  bg: BG,
  ink: INK,

  build({ stage, tip, accent }: IntroCtx) {
    stage.style.setProperty("--ww-gold", gold(accent));
    const trace = document.createElement("div");
    trace.className = "ww-trace";
    trace.setAttribute("aria-hidden", "true");
    for (const k of ["ticks", "line", "d ww-trace-l", "d ww-trace-r", "c"]) {
      const i = document.createElement("i");
      i.className = `ww-trace-${k}`;
      trace.append(i);
    }
    tip.append(trace);
  },

  play({ stage, tip, app, scheme, accent, signal }: IntroCtx) {
    // every layout read happens here, once, before anything moves
    const W = stage.clientWidth, H = stage.clientHeight;
    const trace = stage.querySelector<HTMLElement>(".ww-trace");
    const lineBox = stage.querySelector(".ww-trace-line")?.getBoundingClientRect();
    const tipBox = tip.getBoundingClientRect();
    const text = tip.querySelector<HTMLElement>(".splash-tip-t");
    const textBox = text?.getBoundingClientRect();
    const keys = [...tip.querySelectorAll<HTMLElement>("kbd")].map((el) => {
      const b = el.getBoundingClientRect();
      return { el, f: textBox && textBox.width ? (b.left + b.width / 2 - textBox.left) / textBox.width : 0.5 };
    });
    const appBox = app.getBoundingClientRect();

    const ok = !!lineBox && lineBox.width > 40;
    const span = ok ? lineBox.width : Math.min(640, W * 0.86);
    const x0 = ok ? lineBox.left : (W - span) / 2;
    const y0 = ok ? lineBox.top + lineBox.height / 2 : tipBox.bottom + 24;
    const half = span / 2, cx = x0 + half, cy = H / 2;
    const R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 64;
    /** The ring the line closes into: its length stays the same, so the radius is span / 2π. */
    const rho = half / PI;

    const ink = rgb(INK)!, bg = rgb(BG)!, au = rgb(gold(accent))!;
    const lineGold = rgb("#ceb99c")!;
    // what the rings look like over the app: light lines on a dark app, darker ones on a light app
    const light = scheme === "light";
    const overInk: Rgb = light ? [27, 30, 38] : ink;
    const overGold: Rgb = light ? shade(au, 0.55) : au;

    // ── the tip: a bright band crosses it and takes the words with it, keys and icon as it passes ──
    const sweep = { delay: T.sweep, duration: T.sweepFor, easing: "linear", fill: "both" } as const;
    // background-position 80% to 15% moves the band from just off the left edge to past the right (see ww.css)
    text?.animate([{ backgroundPosition: "80% 0" }, { backgroundPosition: "15% 0" }], sweep);
    for (const { el, f } of keys) {
      const at = T.sweep + T.sweepFor * ((clamp01(f) + 0.28) / 1.3);
      el.animate([{ opacity: 1 }, { opacity: 0 }], { delay: at - 70, duration: 130, easing: "ease-in", fill: "both" });
    }
    const icon = tip.querySelector(".splash-tip-i");
    icon?.animate([
      { opacity: 0.6, color: "currentColor", transform: "none", filter: "blur(0)" },
      { opacity: 1, color: rgba(au, 1), transform: "none", filter: "blur(0)", offset: 0.3 },
      { opacity: 0, color: rgba(au, 1), transform: "translateY(-5px)", filter: "blur(2px)" },
    ], { delay: T.sweep + T.sweepFor * 0.36, duration: 340, easing: "ease-out", fill: "both" });
    // the drawn trace takes over from the static one
    trace?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "linear", fill: "forwards" });

    // ── the app settles in from slightly large as the pulse passes ──
    const origin = `${cx - appBox.left}px ${cy - appBox.top}px`;
    app.animate([{ transform: "scale(1.035)", transformOrigin: origin }, { transform: "none", transformOrigin: origin }], {
      delay: T.pulse, duration: T.end - T.pulse - 10, easing: "cubic-bezier(.16,.7,.2,1)", fill: "backwards",
    });

    // ── the canvas ──
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement("canvas");
    cv.className = "ww-scope";
    cv.setAttribute("aria-hidden", "true");
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    const g = cv.getContext("2d");
    if (!g) {
      return stage.animate([{ opacity: 1 }, { opacity: 0 }], { delay: 500, duration: 420, easing: "ease-out", fill: "forwards" }).finished.then(() => {});
    }
    stage.append(cv);

    /** A colour along the line that fades toward both ends (`edge` is how much is left there, like the static line),
        solid once the line is a ring. */
    const along = (c: Rgb, mid: number, edge: number): CanvasGradient | string => {
      if (edge > 0.995) return rgba(c, mid);
      const l = g.createLinearGradient(x0, 0, x0 + span, 0);
      l.addColorStop(0, rgba(c, mid * edge));
      l.addColorStop(0.5, rgba(c, mid));
      l.addColorStop(1, rgba(c, mid * edge));
      return l;
    };

    const N = Math.max(48, Math.round(span / 7));
    const B = Math.max(31, Math.round(span / 9) | 1);
    const bars = new Float32Array(B), caps = new Float32Array(B);
    const seed = Array.from({ length: B }, () => [Math.random() * 6.3, 4 + Math.random() * 7, Math.random() * 6.3, 3 + Math.random() * 5]);
    const amp = Math.min(62, H * 0.08);
    const bw = Math.min(2, (span / B) * 0.3);
    let clock = 0;

    const energy = (t: number) => (t < T.pulse
      ? 0.1 * smooth(clamp01(t / 220)) + 0.9 * clamp01(t / T.pulse) ** 2.3
      : 1.1 * Math.exp(-(t - T.pulse) / 240));

    // Where the line runs this frame. Flat at first, then bent through a half-angle `ga` (π once its ends meet) on a
    // circle of radius `gr`, kept centred on (cx, gy) so it curls up around the centre mark; after the pulse, a ring of
    // radius `gr` that grows with the opening. `dyc` is the bend's centre below that point, and the whole shape turns
    // by the angle whose cosine and sine are `rc` and `rs`.
    let gy = y0, ga = 0, gr = 0, dyc = 0, rc = 1, rs = 0;
    // the point place() found, and the way out from the line there
    let bx = 0, by = 0, nx = 0, ny = 1;
    /** The point on the line at u (-1 at the left end, 1 at the right). */
    const place = (u: number) => {
      let x: number, yy: number, mx: number, my: number;
      if (ga < 1e-3) { x = u * half; yy = 0; mx = 0; my = 1; }
      else { const f = ga * u; mx = Math.sin(f); my = Math.cos(f); x = gr * mx; yy = dyc + gr * my; }
      bx = cx + x * rc - yy * rs; by = gy + x * rs + yy * rc;
      nx = mx * rc - my * rs; ny = mx * rs + my * rc;
    };

    /** One layer of the waveform; `flat` lifts the fade at the ends (1 on a ring, where there are no ends). */
    const wave = (layer: number, a: number, h: number, flat: number) => {
      const fn = LAYERS[layer];
      const n = Math.min(360, Math.max(N, Math.round((ga < 1e-3 ? span : 2 * ga * gr) / 7)));
      g.beginPath();
      let px = 0, py = 0;
      for (let i = 0; i <= n; i++) {
        const u = -1 + (2 * i) / n;
        const bell = (1 - u * u) ** 2;
        const o = a * (bell + (1 - bell) * flat) * fn(u, clock, h);
        place(u);
        const x = bx + nx * o, yy = by + ny * o;
        if (i === 0) g.moveTo(x, yy);
        else g.quadraticCurveTo(px, py, (px + x) / 2, (py + yy) / 2);
        px = x; py = yy;
      }
      g.lineTo(px, py);
    };
    /** A diamond at (x, y) with two of its points on the axis (tx, ty). */
    const diamond = (x: number, y: number, s: number, tx = 1, ty = 0) => {
      g.moveTo(x - tx * s, y - ty * s); g.lineTo(x + ty * s, y - tx * s); g.lineTo(x + tx * s, y + ty * s); g.lineTo(x - ty * s, y + tx * s); g.closePath();
    };

    const draw = (t: number, dt: number) => {
      const e = energy(t);
      clock += dt * (0.7 + 1.9 * Math.min(1, e));
      const h = 0.05 + 0.32 * Math.min(1, e);
      const y = y0 + (cy - y0) * inOut(clamp01((t - T.rise) / T.riseFor));
      const d = t - T.pulse;
      const p = clamp01(d / T.openFor);
      const r = d >= 0 ? R * ringEase(p) : -1;
      const feather = 18 + Math.max(0, r) * 0.05;

      // the line's shape: it curls into a ring, turning a little as it goes, and after the pulse the ring rides just
      // ahead of the opening (the hypot eases it from standing still to the opening's speed)
      const bend = inOut(clamp01((t - T.bend) / T.bendFor));
      const ring = smooth(clamp01(bend / 0.85)); // the ends fill out to full height before they meet
      const turn = -0.7 * smooth(clamp01((t - T.bend) / (T.bendFor + 700)));
      rc = Math.cos(turn); rs = Math.sin(turn);
      if (d < 0) {
        gy = y; ga = PI * bend;
        gr = ga < 1e-3 ? 0 : half / ga;
        dyc = ga < 1e-3 ? 0 : (-gr * Math.sin(ga)) / ga;
      } else {
        gy = cy; ga = PI; gr = Math.hypot(rho, r); dyc = 0;
      }

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.globalAlpha = 1;

      // after the pulse the canvas is the backdrop, with a soft-edged hole that opens onto the app
      if (d >= 0) {
        const r1 = Math.max(r, 1), r0 = Math.max(0, r1 - feather);
        const hole = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
        hole.addColorStop(0, rgba(bg, 0));
        hole.addColorStop(0.6, rgba(bg, 0.45));
        hole.addColorStop(1, rgba(bg, 1));
        g.fillStyle = hole;
        g.fillRect(0, 0, W, H);
      }

      const fadeIn = smooth(clamp01(t / 180));
      const fadeOut = d < 0 ? 1 : 1 - smooth(clamp01((d - 140) / 460));

      // what sits on the dark stage is cut where the hole is
      g.save();
      if (d >= 0) {
        g.beginPath();
        g.rect(0, 0, W, H);
        g.arc(cx, cy, Math.max(0, r - feather * 0.5), 0, PI * 2, true);
        g.clip("evenodd");
      }

      // mirrored spectrum bars: quick to rise, slow to fall, each with a peak mark that drifts back down. On the ring
      // they stand out from it like a round equalizer, never reaching the centre.
      const ka = 1 - Math.exp(-dt / 0.035), kr = 1 - Math.exp(-dt / 0.16);
      const barH = amp * 1.15 * Math.min(1, e);
      const lim = ga < 1e-3 ? Infinity : gr * 0.8;
      g.beginPath();
      for (let i = 0; i < B; i++) {
        const u = -1 + (2 * i + 1) / B;
        const s = seed[i];
        const m = 0.5 + 0.5 * Math.sin(clock * s[1] + s[0]) * Math.cos(clock * s[3] + s[2]);
        const shape = (1 - u * u) ** 1.2;
        const want = barH * (shape + (1 - shape) * ring) * (0.22 + 0.45 * Math.abs(LAYERS[0](u, clock, h)) + 0.33 * m);
        bars[i] += (want - bars[i]) * (want > bars[i] ? ka : kr);
        caps[i] = Math.max(bars[i], caps[i] - dt * 60);
        if (bars[i] > 0.6) {
          const l = Math.min(bars[i], lim);
          place(u);
          g.moveTo(bx - nx * l, by - ny * l);
          g.lineTo(bx + nx * l, by + ny * l);
        }
      }
      g.globalAlpha = fadeOut;
      g.lineCap = "butt";
      g.lineWidth = bw;
      g.strokeStyle = along(ink, 0.17, ring);
      g.stroke();
      g.beginPath();
      for (let i = 0; i < B; i++) {
        if (caps[i] < 3) continue;
        const c = Math.min(caps[i], lim) + 2.5;
        place(-1 + (2 * i + 1) / B);
        const tx = (ny * bw) / 2, ty = (-nx * bw) / 2;
        for (const o of [-c, c]) {
          const px = bx + nx * o, py = by + ny * o;
          g.moveTo(px - tx, py - ty);
          g.lineTo(px + tx, py + ty);
        }
      }
      g.lineWidth = 1;
      g.strokeStyle = along(ink, 0.5, 0.19 + 0.81 * ring);
      g.stroke();

      // the waveform: a soft wide pass, a faint second voice, the gold voice, then the main line
      const lines = (inkStyle: CanvasGradient | string, goldStyle: CanvasGradient | string) => {
        const a = amp * e;
        const on = Math.min(1, e * 3);
        g.lineCap = "round";
        g.lineJoin = "round";
        wave(0, a, h, ring);
        g.strokeStyle = inkStyle; g.lineWidth = 6; g.globalAlpha = 0.06 * on * fadeOut;
        g.stroke();
        wave(1, a * 0.8, h, ring);
        g.lineWidth = 1; g.globalAlpha = 0.3 * on * fadeOut;
        g.stroke();
        wave(2, a * 0.9, h, ring);
        g.strokeStyle = goldStyle; g.lineWidth = 1; g.globalAlpha = 0.8 * on * fadeOut;
        g.stroke();
        wave(0, a, h, ring);
        g.strokeStyle = inkStyle; g.lineWidth = 1 + 0.4 * on; g.globalAlpha = (0.62 + 0.36 * on) * fadeIn * fadeOut;
        g.stroke();
      };
      const edge = 0.19 + 0.81 * ring;
      lines(along(ink, 1, edge), along(au, 1, edge));

      // the diamonds at the ends ride them up as the line curls and fade before they meet
      const ends = fadeIn * (1 - smooth(clamp01((bend - 0.3) / 0.45)));
      if (ends > 0) {
        g.beginPath();
        place(-1);
        diamond(bx - ny * 3.5, by + nx * 3.5, 3.5, ny, -nx);
        place(1);
        diamond(bx + ny * 3.5, by - nx * 3.5, 3.5, ny, -nx);
        g.strokeStyle = rgba(lineGold, 0.85 * ends);
        g.globalAlpha = 1;
        g.lineWidth = 1;
        g.stroke();
      }
      g.restore();

      // over the app: what is left of the ring rings down in colours that read on it
      if (d >= 0 && fadeOut > 0) {
        g.save();
        g.beginPath();
        g.arc(cx, cy, Math.max(0, r - feather * 0.5), 0, PI * 2);
        g.clip();
        lines(rgba(overInk, 1), rgba(overGold, 1));
        g.restore();
      }

      g.globalAlpha = 1;
      if (d < 0) {
        // the centre mark brightens and swells as the peak nears, with the ring closing around it
        const k = smooth(clamp01((t - (T.pulse - 400)) / 400));
        g.beginPath();
        diamond(cx, y, 2.8 + 1.6 * k);
        g.fillStyle = rgba(au, fadeIn * (0.9 + 0.1 * k));
        g.fill();
        if (k > 0) {
          g.beginPath();
          diamond(cx, y, 6 + 5 * k);
          g.strokeStyle = rgba(au, 0.45 * k);
          g.lineWidth = 1;
          g.stroke();
        }
        return;
      }

      // the rings that follow the first, gold and white
      for (const [at, len, reach, isGold, width, alpha] of RINGS) {
        const q = (d - at) / len;
        if (q <= 0 || q >= 1) continue;
        const rr = R * reach * ringEase(q);
        g.beginPath();
        g.arc(cx, cy, rr, 0, PI * 2);
        g.strokeStyle = rgba(isGold ? overGold : overInk, alpha * (1 - q) ** 1.4 * Math.min(1, q * 10));
        g.lineWidth = width;
        g.stroke();
      }

      // the first ring: a white hairline on the hole's edge with a gold one just outside it
      if (p < 1) {
        g.beginPath();
        g.arc(cx, cy, Math.max(0, r - 0.5), 0, PI * 2);
        g.strokeStyle = rgba(ink, 0.95 * (1 - p ** 3));
        g.lineWidth = 1.3;
        g.stroke();
        g.beginPath();
        g.arc(cx, cy, r + 4.5, 0, PI * 2);
        g.strokeStyle = rgba(au, 0.5 * (1 - p ** 2));
        g.lineWidth = 1;
        g.stroke();
      }

      // the flash at the centre as it fires
      const f = d / 280;
      if (f < 1) {
        g.beginPath();
        g.arc(cx, cy, 4 + 30 * out(f), 0, PI * 2);
        g.strokeStyle = rgba(overGold, (1 - f) ** 1.6);
        g.lineWidth = 0.6 + 1.6 * (1 - f);
        g.stroke();
        g.beginPath();
        g.arc(cx, cy, 4.5 * (1 - f) ** 0.6, 0, PI * 2);
        g.fillStyle = rgba(au, 1 - f);
        g.fill();
      }
    };

    // the canvas keeps time with an animation of its own, so it stays in step with the tip and the app (and pausing
    // every animation freezes it too)
    const time = cv.animate([{ opacity: 1 }, { opacity: 1 }], { duration: T.end, fill: "forwards" });
    const now = () => { const c = time.currentTime; return typeof c === "number" ? c : 0; };

    return new Promise<void>((resolve) => {
      let last = 0, raf = 0, open = false;
      const stop = () => { cancelAnimationFrame(raf); resolve(); };
      signal.addEventListener("abort", stop, { once: true });
      const tick = () => {
        if (signal.aborted) return;
        const t = now();
        const dt = Math.min(0.05, Math.abs(t - last) / 1000);
        last = t;
        // from the pulse on the canvas paints the backdrop, so the stage drops its own colour in the same frame
        if (open !== t >= T.pulse) { open = t >= T.pulse; stage.style.background = open ? "transparent" : ""; }
        draw(t, dt);
        if (t >= T.end) { signal.removeEventListener("abort", stop); resolve(); return; }
        raf = requestAnimationFrame(tick);
      };
      draw(0, 0);
      raf = requestAnimationFrame(tick);
    });
  },
};
