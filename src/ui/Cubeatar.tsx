// A GameBanana member's Cubeatar: their HD avatar on every face of a cube that spins the way it does on GameBanana.
// GameBanana subtracts speed * 0.01 * axis from the cube's x, y and z rotation every frame (x, then y, then z), so at
// 60 frames a second an axis turns speed * 0.6 * axis radians a second. Here each axis is its own nested layer with a
// plain CSS rotation: the nesting gives the same x, y, z order, and the browser runs it with no script per frame.
// With interface animations off the cube stands still at a three-quarter view (cubeatar.css).
import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import "./cubeatar.css";

export interface CubeatarProps {
  src: string;
  /** `_aCubeatar.Speed`. Negative spins the other way, 0 stands still. */
  speed: number;
  /** `_aCubeatar.SpinAxes`: how much x, y and z each turn, like [1, 0, 0]. All zero stands still. */
  axes: [number, number, number];
  /** The square box it takes in the layout, in pixels. Corners can reach 5% of it past each edge while it spins. */
  size: number;
  alt?: string;
  title?: string;
  className?: string;
  /** The picture didn't load, so the caller can show the flat avatar instead. Called once per src. */
  onError?: () => void;
}

/** The viewer's distance from the cube's centre, in cube edges. */
const DEPTH = 3.5;
/** How far from the centre the cube may reach on screen, as a share of the box: half of it plus 5%. */
const REACH = 0.55;
/** The still cube's view: tipped to show the top, turned to show the right side. */
const POSE_X = -24;
const POSE_Y = -36;
/** Spinning layers start a tenth of a turn in, so a cube paused on arrival still looks like a cube. */
const PHASE = 0.1;
/** No axis turns faster than once a second, whatever the speed. */
const MIN_TURN = 1;

type Vec = [number, number, number];
type Mat = [Vec, Vec, Vec];

function turn(axis: number, deg: number): Mat {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  if (axis === 0) return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 1) return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

const apply = (m: Mat, v: Vec): Vec => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) as Vec;
const times = (a: Mat, b: Mat): Mat => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j])) as Mat;

const CORNERS: Vec[] = [];
for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) CORNERS.push([x, y, z]);

/** How far the cube reaches across or down from its centre on screen, in cube edges, turned by m and seen in
 *  perspective (CSS axes: y points down, z toward the viewer). */
function reach(m: Mat): number {
  let most = 0;
  for (const v of CORNERS) {
    const [x, y, z] = apply(m, v);
    most = Math.max(most, (Math.max(Math.abs(x), Math.abs(y)) * DEPTH) / (DEPTH - z));
  }
  return most;
}

/** The most the cube reaches over a whole turn around one axis. */
const AXIS_REACH = [0, 1, 2].map((axis) => {
  let most = 0;
  for (let d = 0; d < 360; d += 2) most = Math.max(most, reach(turn(axis, d)));
  return most;
});
/** Turning on more than one axis can reach any angle, so it's held to the sphere around the cube's corners. */
const SPHERE = (() => { const r = Math.sqrt(3) / 2; return (r * DEPTH) / Math.sqrt(DEPTH * DEPTH - r * r); })();
const POSE_REACH = reach(times(turn(0, POSE_X), turn(1, POSE_Y)));

interface Spin { secs: number; up: boolean }

function plan(speed: number, axes: Vec, size: number) {
  const s = Number.isFinite(speed) ? speed : 0;
  // CSS has y pointing down, which flips the sense of x and z turns: GameBanana's x and z count down, so here they
  // count up, and y counts down in both
  const rates = axes.map((a, i) => {
    const r = (Number.isFinite(a) ? a : 0) * s * 0.6;
    return i === 1 ? -r : r;
  });
  const secs = rates.map((r) => (r === 0 ? 0 : (2 * Math.PI) / Math.abs(r)));
  const fastest = Math.min(...secs.filter((t) => t > 0));
  const slow = fastest < MIN_TURN ? MIN_TURN / fastest : 1;
  const spins = rates.map((r, i): Spin | null => (r === 0 ? null : { secs: secs[i] * slow, up: r > 0 }));
  const turning = rates.filter((r) => r !== 0).length;
  const most = turning === 0 ? POSE_REACH : turning === 1 ? AXIS_REACH[rates.findIndex((r) => r !== 0)] : SPHERE;
  return {
    spins,
    still: turning === 0,
    edge: (REACH * size) / most,
    // the still view reaches further than a one-axis spin, so it shrinks to take the same room
    scale: Math.min(1, most / POSE_REACH),
  };
}

function Layer({ axis, spin, children }: { axis: "x" | "y" | "z"; spin: Spin | null; children: ReactNode }) {
  const style = spin
    ? ({ "--t": `${spin.secs.toFixed(3)}s`, "--at": `${(-spin.secs * PHASE).toFixed(3)}s`, "--dir": spin.up ? "normal" : "reverse" } as CSSProperties)
    : undefined;
  return <span className={`cubeatar-r cubeatar-r${axis}${spin ? " is-spin" : ""}`} style={style}>{children}</span>;
}

const FACES = ["front", "back", "right", "left", "top", "bottom"] as const;

export function Cubeatar({ src, speed, axes, size, alt, title, className, onError }: CubeatarProps) {
  const [ax, ay, az] = axes;
  const p = useMemo(() => plan(speed, [ax, ay, az], size), [speed, ax, ay, az, size]);
  const failed = useRef<string | null>(null);
  const fail = () => {
    if (failed.current === src) return;
    failed.current = src;
    onError?.();
  };
  const style = {
    width: size,
    height: size,
    perspective: `${(DEPTH * p.edge).toFixed(2)}px`,
    "--cube": `${p.edge.toFixed(2)}px`,
    "--cube-k": p.scale.toFixed(3),
    "--cube-pose": `rotateX(${POSE_X}deg) rotateY(${POSE_Y}deg)`,
  } as CSSProperties;
  return (
    <span className={["cubeatar", p.still && "is-still", className].filter(Boolean).join(" ")} style={style} title={title}
      role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
      <Layer axis="x" spin={p.spins[0]}>
        <Layer axis="y" spin={p.spins[1]}>
          <Layer axis="z" spin={p.spins[2]}>
            {FACES.map((f) => (
              <img key={f} className={`cubeatar-face cubeatar-${f}`} src={src} alt="" draggable={false} decoding="async" onError={fail} />
            ))}
          </Layer>
        </Layer>
      </Layer>
    </span>
  );
}
