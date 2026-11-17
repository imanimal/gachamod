// Arknights: Endfield's opening, an industrial boot-up. The hold screen is charcoal with the tip inside four yellow
// corner marks. On play the tip steps aside and slides off, the marks fly out to the window corners, and a yellow scan
// bar sweeps across, leaving a hairline grid on four rows of shutters that meet at a hazard-striped seam. Row by row
// the shutters unlock and slide apart while the app settles in behind them, then the marks run along the edges into a
// yellow frame that blinks and fades. Everything moves with transforms on the stage; #root only scales. Owner: SHELL area.
import type { Intro } from "../types";

const BG = "#1b1b1b";
const INK = "#ebeae6";

/** Total length of the opening (ms). Every piece runs on this one timeline, with keyframes at absolute times. */
const T = 1720;
/** When the shutters start to move, and the gap between rows. */
const DOORS = 700;
const ROW_GAP = 60;
const ROWS = 4;
/** Each row's seam, from the middle of the window (px). Alternating, so the seam steps like interlocking teeth. */
const JOG = [-30, 30, -30, 30];
/** Corner marks: inset from the window edges, arm length (px, scaled from there), distance from the tip's box. Keep
    in step with ef.css. */
const M = 20;
const ARM = 10;
const OX = 14;
const OY = 16;

/** The tip's size per stage, kept by a ResizeObserver so the marks hug it while fonts load or the window changes. */
const tipSize = new WeakMap<HTMLElement, { w: number; h: number }>();

const add = (parent: HTMLElement, cls: string, tag = "div") => {
  const e = document.createElement(tag);
  e.className = cls;
  parent.append(e);
  return e;
};

type Key = [ms: number, frame: Keyframe];
/** One element's whole part, as keyframes at absolute times on the shared timeline. The last keyframe holds to the
    end (left open, the browser would ease back to the element's own style). */
const track = (target: Element, keys: Key[]) => {
  const frames: Keyframe[] = keys.map(([ms, f]) => ({ ...f, offset: ms / T }));
  const last = keys[keys.length - 1];
  if (last && last[0] < T) frames.push({ ...last[1], easing: "linear", offset: 1 });
  return target.animate(frames, { duration: T, fill: "both" });
};

const CORNERS = [["tl", 1, 1], ["tr", -1, 1], ["bl", 1, -1], ["br", -1, -1]] as const;

export const intro: Intro = {
  bg: BG,
  ink: INK,

  build({ stage, tip, signal }) {
    const doors = add(stage, "ef-doors");
    for (let i = 0; i < ROWS; i++) {
      for (const side of ["l", "r"]) {
        const d = add(doors, "ef-door");
        d.dataset.side = side;
        d.dataset.row = String(i);
        d.style.setProperty("--i", String(i));
        d.style.setProperty("--jog", `${JOG[i]}px`);
        add(d, "ef-haz", "i");
        if (side === "l") add(d, "ef-num", "span").textContent = `0${i + 1}`;
      }
    }
    add(add(stage, "ef-cover"), "ef-scan");
    const crop = add(stage, "ef-crop");
    for (const [c] of CORNERS) {
      const k = add(crop, "ef-c");
      k.dataset.c = c;
      add(k, "ef-h", "i");
      add(k, "ef-v", "i");
    }

    const size = { w: 0, h: 0 };
    tipSize.set(stage, size);
    const ro = new ResizeObserver(([e]) => {
      const box = e?.borderBoxSize?.[0];
      if (!box) return;
      size.w = box.inlineSize;
      size.h = box.blockSize;
      stage.style.setProperty("--ef-tw", `${size.w}px`);
      stage.style.setProperty("--ef-th", `${size.h}px`);
    });
    ro.observe(tip);
    signal.addEventListener("abort", () => ro.disconnect(), { once: true });
  },

  async play({ stage, tip, app }) {
    const W = innerWidth;
    const H = innerHeight;
    const size = tipSize.get(stage) ?? { w: 0, h: 0 };
    // where the marks sit around the tip, measured from their places at the window corners
    const dx = W / 2 - size.w / 2 - OX - M;
    const dy = H / 2 - size.h / 2 - OY - M;
    const out = 2.6; // arm length at the window corners, as a multiple of ARM
    const sx = (W / 2 + 2) / ARM; // arm length as half an edge, for the frame
    const sy = (H / 2 + 2) / ARM;
    const ease = "cubic-bezier(.65,0,.25,1)";
    const all: Animation[] = [];
    const q = <E extends Element | null>(sel: string) => stage.querySelector(sel) as E;

    // the tip: a short step back, a beat, then off to the right as its left side is cut away
    all.push(track(tip, [
      [0, { transform: "none", opacity: 1, clipPath: "inset(0 0 0 0)", easing: "cubic-bezier(.2,.9,.3,1)" }],
      [80, { transform: "translateX(-10px)", opacity: 1, clipPath: "inset(0 0 0 0)" }],
      [150, { transform: "translateX(-10px)", opacity: 1, clipPath: "inset(0 0 0 0)", easing: "cubic-bezier(.7,0,.9,.5)" }],
      [370, { transform: "translateX(84px)", opacity: 0, clipPath: "inset(0 0 0 100%)" }],
    ]));

    // the marks leave the tip for the window corners, then reach along the edges into a frame
    for (const [c, kx, ky] of CORNERS) {
      const k = q<HTMLElement>(`.ef-c[data-c="${c}"]`);
      if (!k) continue;
      all.push(track(k, [
        [0, { transform: `translate(${kx * dx}px, ${ky * dy}px)` }],
        [130, { transform: `translate(${kx * dx}px, ${ky * dy}px)`, easing: ease }],
        [430, { transform: "translate(0px, 0px)" }],
        [1290, { transform: "translate(0px, 0px)", easing: ease }],
        [1430, { transform: `translate(${-kx * M}px, ${-ky * M}px)` }],
      ]));
      const h = k.querySelector(".ef-h");
      const v = k.querySelector(".ef-v");
      if (h) all.push(track(h, [
        [0, { transform: "scale(1, 1)" }],
        [130, { transform: "scale(1, 1)", easing: ease }],
        [430, { transform: `scale(${out}, 1)` }],
        [1290, { transform: `scale(${out}, 1)`, easing: ease }],
        [1430, { transform: `scale(${sx}, 2)` }],
      ]));
      if (v) all.push(track(v, [
        [0, { transform: "scale(1, 1)" }],
        [130, { transform: "scale(1, 1)", easing: ease }],
        [430, { transform: `scale(1, ${out})` }],
        [1290, { transform: `scale(1, ${out})`, easing: ease }],
        [1430, { transform: `scale(2, ${sy})` }],
      ]));
    }
    const crop = q<HTMLElement>(".ef-crop");
    if (crop) all.push(track(crop, [
      [0, { opacity: 1 }],
      [1440, { opacity: 1, easing: "step-end" }],
      [1475, { opacity: 0.3, easing: "step-end" }],
      [1510, { opacity: 1 }],
      [1540, { opacity: 1, easing: "cubic-bezier(.4,0,.7,1)" }],
      [T, { opacity: 0 }],
    ]));

    // the scan: the cover slides off to the right with the yellow bar on its edge, showing the shutters under it
    const cover = q<HTMLElement>(".ef-cover");
    if (cover) all.push(track(cover, [
      [0, { transform: "translateX(0)" }],
      [190, { transform: "translateX(0)", easing: "cubic-bezier(.45,0,.3,1)" }],
      [660, { transform: "translateX(100%)" }],
    ]));

    // the stage's own colour goes as the shutters start to move; from there they are all that covers the app
    all.push(track(stage, [
      [0, { backgroundColor: BG }],
      [DOORS, { backgroundColor: BG, easing: "step-end" }],
      [DOORS + 1, { backgroundColor: "rgb(27 27 27 / 0)" }],
    ]));

    // the shutters, row by row from the top, like a ratchet: a short jolt apart, a step to a third open, then out
    stage.querySelectorAll<HTMLElement>(".ef-door").forEach((d) => {
      const at = DOORS + Number(d.dataset.row) * ROW_GAP;
      const dir = d.dataset.side === "l" ? -1 : 1;
      all.push(track(d, [
        [0, { transform: "translateX(0px)" }],
        [at, { transform: "translateX(0px)", easing: "cubic-bezier(.2,.9,.25,1)" }],
        [at + 70, { transform: `translateX(${dir * 14}px)` }],
        [at + 140, { transform: `translateX(${dir * 14}px)`, easing: "cubic-bezier(.3,.7,.2,1)" }],
        [at + 290, { transform: `translateX(${dir * 30}%)` }],
        [at + 330, { transform: `translateX(${dir * 30}%)`, easing: "cubic-bezier(.55,0,.75,.3)" }],
        [at + 540, { transform: `translateX(calc(${dir * 100}% + ${dir * 40}px))` }],
      ]));
    });

    // the app settles from a little close to its place as the shutters open
    all.push(track(app, [
      [0, { transform: "scale(1.03)" }],
      [DOORS, { transform: "scale(1.03)", easing: "cubic-bezier(.2,.7,.2,1)" }],
      [DOORS + 820, { transform: "none" }],
    ]));

    await Promise.all(all.map((a) => a.finished.catch(() => {})));
  },
};
