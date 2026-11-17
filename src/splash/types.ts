// What an intro is (splash/splash.ts runs them; one file per game in splash/intros). Owner: SHELL area.

export interface IntroCtx {
  /** The opening screen: fixed over the whole window, above everything, in the intro's solid colour. Holds the tip and
      anything the intro adds. Removed by the shell when the intro ends. */
  stage: HTMLElement;
  /** The tip, centred in the stage: <div class="splash-tip" data-tip="<id>"> holding an icon (svg.splash-tip-i, a
      24x24 line icon drawn with stroke) over a line of text (span.splash-tip-t, with <kbd>s for keys). Take it away as
      part of the intro. */
  tip: HTMLElement;
  /** The app's root (#root), rendered and ready behind the stage. Animate it in if the intro needs to. The shell
      cancels its animations and clears its inline style afterwards. */
  app: HTMLElement;
  /** The scheme the app shows in. */
  scheme: "dark" | "light";
  /** The game's colour, as a hex value. */
  accent: string;
  /** Aborted when the user skips: stop any loops (requestAnimationFrame, timers). */
  signal: AbortSignal;
}

export interface Intro {
  /** The hold screen's solid colour and the tip's colour. index.html paints `bg` before any script runs, so the two
      must match. Left out: the plain colours of the current scheme. */
  bg?: string;
  ink?: string;
  /** Add static pieces to the stage for the hold screen (called once, before the app renders). Optional. */
  build?(ctx: IntroCtx): void;
  /** Reveal the app. Resolve once the app shows fully; the shell then removes the stage. Keep it under two seconds. */
  play(ctx: IntroCtx): Promise<void>;
}
