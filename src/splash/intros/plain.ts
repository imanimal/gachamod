// The opening for games without their own: the tip lifts away and the screen fades to the app. Flat, like the
// Default theme. Owner: SHELL area.
import type { Intro } from "../types";

export const intro: Intro = {
  async play({ stage, tip }) {
    await tip.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px)" }],
      { duration: 220, easing: "ease-in", fill: "forwards" }).finished;
    await stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: "ease-out", fill: "forwards" }).finished;
  },
};
