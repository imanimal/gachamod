// Zenless Zone Zero: an old TV turning on. The tip glitches like a channel change and collapses to a point of light,
// the point stretches into a line across the screen, and the line opens into the picture (the app, squashed and
// blown out at first) through a burst of static. The picture overshoots, settles, catches one last vertical roll,
// and the scanlines and curved glass fade away. Owner: SHELL area.
import type { Intro, IntroCtx } from "../types";

/** The whole opening, in ms. */
const D = 1700;
/** The picture's height before it opens, as a fraction of the window: a line a couple of pixels tall. */
const S0 = 0.003;
const RED = "rgb(255 36 84 / .85)";
const CYAN = "rgb(0 226 255 / .8)";
/** The set glows Fairy's blue, whatever the game's accent: the dot, the line's edges, the flash and the static tint. */
const GLOW = "#3cc8ff";

type Frame = Record<string, string | number>;

/** One animation on the shared timeline: keys at absolute ms, each easing to the next. */
function tl(el: Element, keys: [number, Frame, string?][]): Animation {
  return el.animate(keys.map(([ms, f, easing]) => ({ ...f, offset: ms / D, easing: easing ?? "linear" })), { duration: D, fill: "both" });
}

function div(cls: string, parent: HTMLElement) {
  const e = document.createElement("div");
  e.className = cls;
  parent.append(e);
  return e;
}

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) || h.length < 6 ? [255, 122, 28] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A few tiles of grey static with a little of the accent in it. */
function staticTiles(acc: [number, number, number], count = 3, size = 160): HTMLCanvasElement[] {
  const k = 0.22;
  return Array.from({ length: count }, () => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    const img = g.createImageData(size, size);
    const px = new Uint32Array(img.data.buffer);
    for (let i = 0; i < px.length; i++) {
      // pushed toward black and white, like real snow
      const u = Math.random();
      const v = (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)) * 255;
      const r = v * (1 - k + (k * acc[0]) / 255), gg = v * (1 - k + (k * acc[1]) / 255), b = v * (1 - k + (k * acc[2]) / 255);
      px[i] = (255 << 24) | ((b | 0) << 16) | ((gg | 0) << 8) | (r | 0);
    }
    g.putImageData(img, 0, 0);
    return c;
  });
}

/** Static on a canvas from `from` to `to` ms into the opening, about 30 frames a second, until the intro is skipped. */
function runStatic(canvas: HTMLCanvasElement, accent: string, signal: AbortSignal, from: number, to: number) {
  // grains of 1.5 css px: two rows to each scanline of .zz-scan (3 px), so the two never beat
  const w = (canvas.width = Math.ceil(window.innerWidth / 1.5));
  const h = (canvas.height = Math.ceil(window.innerHeight / 1.5));
  canvas.style.height = `${h * 1.5}px`;
  const g = canvas.getContext("2d", { alpha: false });
  if (!g) return;
  const pats = staticTiles(rgb(accent)).map((t) => g.createPattern(t, "repeat")!);
  const t0 = performance.now();
  let last = -1e9, raf = 0;
  const draw = (t: number) => {
    const p = pats[(Math.random() * pats.length) | 0]!;
    p.setTransform(new DOMMatrix().translate(Math.random() * 160, Math.random() * 160));
    g.fillStyle = p;
    g.fillRect(0, 0, w, h);
    // thin bright streaks and a dark band that rolls down, like a set between channels
    for (let i = 0; i < 4; i++) {
      g.fillStyle = `rgb(255 255 255 / ${(Math.random() * 0.22).toFixed(2)})`;
      g.fillRect(0, Math.random() * h, w, 1 + Math.random() * 2);
    }
    const y = (((t - from) / 650) % 1) * h * 1.5 - h * 0.25;
    const band = g.createLinearGradient(0, y - h * 0.12, 0, y + h * 0.12);
    band.addColorStop(0, "rgb(0 0 0 / 0)");
    band.addColorStop(0.5, "rgb(0 0 0 / .45)");
    band.addColorStop(1, "rgb(0 0 0 / 0)");
    g.fillStyle = band;
    g.fillRect(0, y - h * 0.12, w, h * 0.24);
  };
  draw(from);
  const tick = () => {
    if (signal.aborted) return;
    const t = performance.now() - t0;
    if (t > to) return;
    if (t >= from - 40 && t - last >= 30) { last = t; draw(t); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  signal.addEventListener("abort", () => cancelAnimationFrame(raf), { once: true });
}

export const intro: Intro = {
  bg: "#000",
  ink: "#f2f2f2",

  build({ stage }: IntroCtx) {
    stage.style.setProperty("--zz-acc", GLOW);
    div("zz-hold", stage);
  },

  async play({ stage, tip, app, scheme, signal }: IntroCtx) {
    const light = scheme === "light";
    const accent = GLOW;
    stage.style.setProperty("--zz-acc", accent);

    // the set: static, the white of the beam, scanlines, the curved glass, a rolling bar, and black above and below
    // the picture that follows its edges (so the window around it stays black on a light app too)
    const noise = document.createElement("canvas");
    noise.className = "zz-noise";
    stage.append(noise);
    const flash = div("zz-flash", stage);
    const scan = div("zz-scan", stage);
    const roll = div("zz-roll", stage);
    const glass = div("zz-glass", stage);
    const top = div("zz-bar zz-bar-t", stage);
    const bot = div("zz-bar zz-bar-b", stage);
    const edges = [div("zz-edge", top), div("zz-edge", bot)];
    const dot = div("zz-dot", stage);
    const beam = div("zz-beam", stage);
    const hold = stage.querySelector<HTMLElement>(".zz-hold");
    stage.dataset.on = "";

    const anims: Animation[] = [];
    const add = (a: Animation) => { anims.push(a); return a; };

    // 1. the tip: two glitchy jumps with the colours split, a blink, then it squashes to a white line and shrinks to
    // a point in the middle
    const glitch = (x: number, sk: number, sx: number, sy: number, d: number, b: number, o: number): Frame => ({
      transform: `translateX(${x}px) skewX(${sk}deg) scale(${sx}, ${sy})`,
      filter: `drop-shadow(${-d}px 0 0 ${RED}) drop-shadow(${d}px 0 0 ${CYAN}) brightness(${b})`,
      opacity: o,
    });
    add(tl(tip, [
      [0, glitch(0, 0, 1, 1, 0, 1, 1), "steps(1, end)"],
      [40, glitch(-9, -7, 1, 1, 4, 1.15, 0.8), "steps(1, end)"],
      [75, glitch(7, 5, 1.02, 0.92, -3, 1.3, 1), "steps(1, end)"],
      [100, glitch(0, 0, 1, 1, 0, 1, 0.3), "steps(1, end)"],
      [120, glitch(0, 0, 1, 1, 0, 1.5, 1), "cubic-bezier(.55, 0, .85, .4)"],
      [210, { ...glitch(0, 0, 1.12, 0.022, 0, 6, 1) }, "cubic-bezier(.6, 0, .9, .5)"],
      [285, glitch(0, 0, 0, 0.022, 0, 6, 1), "steps(1, end)"],
      [300, glitch(0, 0, 0, 0.022, 0, 6, 0)],
      [D, glitch(0, 0, 0, 0.022, 0, 6, 0)],
    ]));
    add(tl(tip, [[0, { backgroundColor: "rgb(255 255 255 / 0)" }], [140, { backgroundColor: "rgb(255 255 255 / 0)" }], [205, { backgroundColor: "rgb(255 255 255 / 1)" }], [D, { backgroundColor: "rgb(255 255 255 / 1)" }]]));
    if (hold) add(tl(hold, [[0, { opacity: 1 }], [60, { opacity: 1 }], [280, { opacity: 0 }], [D, { opacity: 0 }]]));

    // 2. a point of light where the tip went, then a line that runs out to both sides
    add(tl(dot, [
      [0, { transform: "scale(0)", opacity: 0 }],
      [265, { transform: "scale(0)", opacity: 0 }, "cubic-bezier(.2, .8, .3, 1)"],
      [320, { transform: "scale(1.6)", opacity: 1 }, "ease-in-out"],
      [390, { transform: "scale(1)", opacity: 1 }],
      [470, { transform: "scale(1.2)", opacity: 1 }, "ease-out"],
      [515, { transform: "scale(.4)", opacity: 0 }],
      [D, { transform: "scale(.4)", opacity: 0 }],
    ]));
    add(tl(beam, [
      [0, { transform: "scale(.004, 1)", opacity: 0 }],
      [350, { transform: "scale(.004, 1)", opacity: 0 }, "steps(1, end)"],
      [360, { transform: "scale(.004, 1)", opacity: 1 }, "cubic-bezier(.3, .7, .2, 1)"],
      [470, { transform: "scale(1, 1)", opacity: 1 }, "ease-out"],
      [510, { transform: "scale(1, 1)", opacity: 0 }],
      [D, { transform: "scale(1, 1)", opacity: 0 }],
    ]));

    // 3. the picture opens from that line: the app scales up from a sliver with an overshoot, settles, then slips a
    // few pixels as the vertical hold catches. The black above and below follows its edges exactly.
    const OPEN: [number, number, number, string][] = [
      [0, S0, 0, "linear"],
      [470, S0, 0, "cubic-bezier(.2, .85, .3, 1)"],
      [820, 1.025, 0, "cubic-bezier(.45, 0, .55, 1)"],
      [950, 0.993, 0, "cubic-bezier(.45, 0, .55, 1)"],
      [1060, 1, 0, "linear"],
      [1140, 1, 0, "cubic-bezier(.3, 0, .5, 1)"],
      [1175, 1, -7, "cubic-bezier(.3, 0, .5, 1)"],
      [1225, 1, 3, "cubic-bezier(.3, 0, .5, 1)"],
      [1270, 1, -1, "ease-out"],
      [1320, 1, 0, "linear"],
      [D, 1, 0, "linear"],
    ];
    add(tl(app, OPEN.map(([ms, s, y, e]) => [ms, { transform: `translateY(${y}px) scale(1, ${s})` }, e])));
    add(tl(top, OPEN.map(([ms, s, y, e]) => [ms, { transform: `translateY(calc(${-s * 100}% + ${y}px))` }, e])));
    add(tl(bot, OPEN.map(([ms, s, y, e]) => [ms, { transform: `translateY(calc(${s * 100}% + ${y}px))` }, e])));

    // blown out and washed of colour as it opens, a little too bright and saturated, then normal
    const fx = (b: number, c: number, s: number) => ({ filter: `brightness(${b}) contrast(${c}) saturate(${s})` });
    const hot = light ? fx(1.6, 1.25, 0.4) : fx(3, 1.5, 0.3);
    add(tl(app, [
      [0, hot], [470, hot, "cubic-bezier(.3, .6, .4, 1)"],
      [820, light ? fx(1.1, 1.08, 1.15) : fx(1.5, 1.15, 1.25)],
      [1175, light ? fx(0.97, 1.04, 1.05) : fx(1.12, 1.04, 1.08), "ease-out"],
      [1500, fx(1, 1, 1)],
      [D, fx(1, 1, 1)],
    ]));

    // the beam's two edges carry its glow out to the top and bottom; the picture starts white and full of static
    for (const e of edges) add(tl(e, [[0, { opacity: 0 }], [455, { opacity: 0 }], [470, { opacity: 1 }, "ease-in"], [780, { opacity: 0 }], [D, { opacity: 0 }]]));
    add(tl(flash, [[0, { opacity: 1 }], [470, { opacity: 1 }, "cubic-bezier(.25, .6, .4, 1)"], [740, { opacity: 0 }], [D, { opacity: 0 }]]));
    add(tl(noise, [[0, { opacity: 0.95 }], [520, { opacity: 0.9 }, "cubic-bezier(.4, 0, .6, 1)"], [780, { opacity: 0.45 }, "ease-out"], [1080, { opacity: 0 }], [D, { opacity: 0 }]]));
    runStatic(noise, accent, signal, 440, 1090);

    // 4. a lighter bar rolls down once, and the scanlines and the curved glass fade off
    add(tl(roll, [[0, { transform: "translateY(-100%)", opacity: 0 }], [960, { transform: "translateY(-100%)", opacity: 1 }, "cubic-bezier(.4, 0, .7, 1)"], [1420, { transform: "translateY(640%)", opacity: 1 }], [D, { transform: "translateY(640%)", opacity: 0 }]]));
    add(tl(scan, [[0, { opacity: 1 }], [900, { opacity: 0.85 }, "ease-in-out"], [1620, { opacity: 0 }], [D, { opacity: 0 }]]));
    add(tl(glass, [[0, { opacity: 1 }], [1080, { opacity: 1 }, "cubic-bezier(.4, 0, .2, 1)"], [1660, { opacity: 0 }], [D, { opacity: 0 }]]));

    const aborted = new Promise<void>((res) => signal.addEventListener("abort", () => res(), { once: true }));
    await Promise.race([Promise.all(anims.map((a) => a.finished)).then(() => {}, () => {}), aborted]);
  },
};
