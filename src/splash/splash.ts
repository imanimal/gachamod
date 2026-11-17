// The opening screen: a solid colour with a one-line tip (splash/tips.ts) while the app renders and reads its games
// behind it, then an intro reveals the app (a TV turning on for New Eridu, one file per theme in splash/intros). By
// default it's the intro of the theme in use, which comes from the game's own theme unless another is picked;
// Settings, Appearance can pick any intro or turn it off ("gm.intro"). index.html paints the colour before any script
// runs (html[data-splash]); App calls splashReady() once the games are read. A click, Escape, Enter, Space or a
// controller button skips it; the Konami code's keys don't, so the code can be tried right there. With Animations
// off the tip still shows and the screen just fades. Owner: SHELL area.
import "./splash.css";
import { konamiBusy } from "../lib/fun";
import { pickTip, tipNodes } from "./tips";
import type { Intro, IntroCtx } from "./types";
import { intro as plain } from "./intros/plain";
import { intro as zzz } from "./intros/zzz";
import { intro as gi } from "./intros/gi";
import { intro as hsr } from "./intros/hsr";
import { intro as ww } from "./intros/ww";
import { intro as ef } from "./intros/ef";
import "./intros/zzz.css";
import "./intros/gi.css";
import "./intros/hsr.css";
import "./intros/ww.css";
import "./intros/ef.css";

const INTROS: Record<string, Intro> = { plain, zzz, gi, hsr, ww, ef };
/** Every intro by name, for Settings. Each theme with one shares its id. */
export const INTRO_LIST: Array<{ id: string; name: string }> = [
  { id: "zzz", name: "New Eridu" }, { id: "gi", name: "Teyvat" },
  { id: "hsr", name: "Astral Express" }, { id: "ww", name: "Solaris" },
  { id: "ef", name: "Talos-II" }, { id: "plain", name: "Default" },
];
/** An intro id as given, else the plain one. */
export const introFor = (id: string | null | undefined) => (id && id in INTROS ? id : "plain");

/** Longest the opening screen waits on the app before playing anyway (it has its own loading lines). */
const MAX_HOLD = 5000;
/** Longest an intro may take before the shell takes the screen away itself. */
const MAX_PLAY = 4000;

// "gm.intro": "0" off, missing or "theme" the theme's own, else an intro id (index.html reads it too)
const KEY = "gm.intro";
export type IntroPick = "off" | "theme" | string;
export function introPick(): IntroPick {
  let v: string | null = null;
  try { v = localStorage.getItem(KEY); } catch { /* no storage */ }
  return v === "0" ? "off" : v && v in INTROS ? v : "theme";
}
export function setIntroPick(p: IntroPick) {
  try { if (p === "theme") localStorage.removeItem(KEY); else localStorage.setItem(KEY, p === "off" ? "0" : p); } catch { /* no storage */ }
}
/** The intro the theme in use has (a custom theme counts as its base; html[data-theme] is the base). */
export const themeIntro = () => introFor(document.documentElement.dataset.theme);
/** The intro that plays now: the one picked, else the theme's. */
const introNow = () => { const p = introPick(); return p === "off" || p === "theme" ? themeIntro() : introFor(p); };

// ── the app says it's ready ──

let appReady = false;
const waiters = new Set<() => void>();
/** The games are read and the first screen has rendered (App). */
export function splashReady() { appReady = true; waiters.forEach((f) => f()); waiters.clear(); }
const whenReady = () => (appReady ? Promise.resolve() : new Promise<void>((res) => waiters.add(res)));

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
const frame = () => new Promise<void>((res) => requestAnimationFrame(() => res()));
const reduced = () => document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;

let showing = false;

/** At start, before the app renders (main.tsx): show the opening screen if index.html marked one. */
export function startSplash() {
  const id = document.documentElement.dataset.splash;
  if (id) void run(introFor(id), false);
}

/** Play the opening over the running app (Settings, "Play it"): the one picked, else the theme's. */
export function replaySplash() {
  if (!showing) void run(introNow(), true);
}

/** Whatever goes wrong, the screen goes away and the app takes clicks again. */
async function run(id: string, replay: boolean) {
  try { await show(id, replay); } catch (e) { console.error("opening screen", e); } finally {
    document.querySelectorAll(".splash").forEach((s) => s.remove());
    delete document.documentElement.dataset.splash;
    showing = false;
  }
}

async function show(id: string, replay: boolean) {
  showing = true;
  const r = document.documentElement;
  const intro = INTROS[id] ?? plain;
  const app = document.getElementById("root")!;
  const ac = new AbortController();
  const t0 = performance.now();

  const stage = document.createElement("div");
  stage.className = "splash";
  stage.dataset.intro = id;
  if (intro.bg) stage.style.setProperty("--splash-bg", intro.bg);
  if (intro.ink) stage.style.setProperty("--splash-ink", intro.ink);
  const pick = pickTip();
  const tip = document.createElement("div");
  tip.className = "splash-tip";
  tip.setAttribute("role", "status");
  tip.dataset.tip = pick.id;
  tip.append(...tipNodes(pick));
  stage.append(tip);
  document.body.append(stage);
  r.dataset.splash = "hold";

  const accent = getComputedStyle(r).getPropertyValue("--game-accent").trim() || "#8b7cff";
  const ctx: IntroCtx = { stage, tip, app, scheme: r.dataset.scheme === "light" ? "light" : "dark", accent, signal: ac.signal };
  try { intro.build?.(ctx); } catch (e) { console.error("opening screen", e); }
  // the tip shows once its fonts are in (never in a stand-in font), or after 600 ms at most
  tip.dataset.wait = "";
  const fonts = [tip.querySelector(".splash-tip-t"), tip.querySelector("kbd")].filter((el): el is Element => !!el)
    .map((el) => { const s = getComputedStyle(el); return document.fonts.load(`${s.fontStyle} ${s.fontWeight} 16px ${s.fontFamily}`, el.textContent ?? ""); });
  void Promise.race([Promise.all(fonts), sleep(600)]).catch(() => {}).then(() => { delete tip.dataset.wait; });

  // skipping: a click, Escape, Enter, Space or a controller button (not the Konami code's keys)
  let skip!: () => void;
  const skipped = new Promise<"skip">((res) => { skip = () => res("skip"); });
  const KONAMI_KEYS = /^(Arrow(Up|Down|Left|Right)|[abAB]|Shift|Control|Alt|Meta)$/;
  const onKey = (e: KeyboardEvent) => {
    if (KONAMI_KEYS.test(e.key)) return;
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopImmediatePropagation(); }
    skip();
  };
  const onPointer = (e: Event) => { e.preventDefault(); e.stopPropagation(); skip(); };
  window.addEventListener("keydown", onKey, true);
  stage.addEventListener("pointerdown", onPointer);
  stage.addEventListener("contextmenu", onPointer);
  // controller: any button down now that wasn't down at the start; the D-pad, A and B only while no Konami code is going
  const downAt = new Set<string>();
  const pads = () => (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p);
  for (const p of pads()) p.buttons.forEach((b, i) => { if (b.pressed) downAt.add(`${p.index}:${i}`); });
  let raf = 0;
  const poll = () => {
    for (const p of pads()) p.buttons.forEach((b, i) => {
      const k = `${p.index}:${i}`;
      if (!b.pressed) { downAt.delete(k); return; }
      if (downAt.has(k)) return;
      downAt.add(k);
      if (i >= 12 && i <= 15) return;
      if ((i === 0 || i === 1) && konamiBusy()) return;
      skip();
    });
    raf = requestAnimationFrame(poll);
  };
  raf = requestAnimationFrame(poll);

  const finish = () => {
    ac.abort();
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey, true);
    stage.remove();
    delete r.dataset.splash;
    app.getAnimations().forEach((a) => a.cancel());
    app.removeAttribute("style");
    showing = false;
  };

  try {
    // hold: long enough to read the tip, and until the app has its games and its first screen
    const minHold = pick.hold ?? Math.min(2600, Math.max(1300, 700 + pick.text.length * 26));
    const held = import.meta.env.DEV && new URLSearchParams(location.search).has("hold");
    const ready = (async () => {
      await Promise.all([replay ? null : whenReady(), sleep(minHold)]);
      while (document.querySelector(".app .view .waiting") && performance.now() - t0 < MAX_HOLD) await sleep(80);
      await frame(); await frame();
    })();
    const went = await Promise.race([skipped, ...(held ? [] : [ready, sleep(Math.max(MAX_HOLD, minHold))])]);

    // a window nobody can see (minimized, or started in the background) skips the show
    if (went !== "skip" && document.visibilityState === "hidden") { finish(); return; }
    if (went !== "skip") {
      r.dataset.splash = "play";
      const playing = reduced()
        ? stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: "ease-out", fill: "forwards" }).finished.then(() => {})
        : intro.play(ctx);
      const end = await Promise.race([playing.then(() => "done" as const, (e) => { console.error("opening screen", e); return "done" as const; }), skipped, sleep(MAX_PLAY)]);
      if (end === "done") { finish(); return; }
    }
    // skipped (or the intro took too long): stop it where it is and fade out quickly
    ac.abort();
    r.dataset.splash = "out";
    stage.getAnimations({ subtree: true }).forEach((a) => a.pause());
    app.getAnimations().forEach((a) => a.cancel());
    app.removeAttribute("style");
    await stage.animate([{ opacity: getComputedStyle(stage).opacity }, { opacity: 0 }], { duration: 140, easing: "ease-out", fill: "forwards" }).finished.catch(() => {});
    finish();
  } catch (e) {
    console.error("opening screen", e);
    finish();
  }
}

if (import.meta.env.DEV) (window as unknown as { gmSplash: (id?: string) => void }).gmSplash = (id) => { if (!showing) void run(id ? introFor(id) : introNow(), true); };
