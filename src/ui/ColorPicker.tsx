// A colour picker that floats by its button: preset swatches, hue, saturation and lightness, and a #hex field. It is
// the app's own instead of the system's, so it opens in the webview and works with a controller: each slider has
// - and + buttons, and the swatches are buttons. Any colour is allowed, black and white too; the preview shows how
// text in the colour will read (lib/theme-info.ts readableOn moves it just far enough when it wouldn't).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { contrastOf, onColor, readableOn } from "../lib/theme-info";
import { t } from "../lib/i18n";
import { IconButton } from "./kit";
import { Popover } from "./Popover";

const PRESETS = ["#000000", "#3a3a3a", "#8a8a8a", "#ffffff", "#e5484d", "#ff8a1f", "#ffd21a", "#46c25b", "#14b8a6", "#3b82f6", "#8b7cff", "#ec4899"];
const DARK_PANEL = "#1c1d22", LIGHT_PANEL = "#f4f4f2";

type Hsl = [number, number, number];
function toHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round((h * 60 + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}
function toHex([h, s, l]: Hsl): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (k: number) => { const x = (k + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(x - 3, 9 - x, 1)); };
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}
const isHex = (v: string) => /^#?[0-9a-f]{6}$/i.test(v.trim());

/** `value` is the colour now; `onPick` gets each change as #rrggbb (a slider being dragged sends at most one every
 *  120 ms, and the last one always). */
export function ColorPicker({ anchor, value, onPick, onClose, label }: { anchor: HTMLElement | null; value: string; onPick: (hex: string) => void; onClose: () => void; label: string }) {
  const [hex, setHex] = useState(value.toLowerCase());
  const [hsl, setHsl] = useState<Hsl>(() => toHsl(value));
  const [text, setText] = useState(value.toLowerCase());
  const timer = useRef(0);
  const last = useRef(value.toLowerCase());
  const send = useRef(onPick);
  send.current = onPick;
  useEffect(() => () => { window.clearTimeout(timer.current); if (last.current !== value.toLowerCase()) send.current(last.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (h: string, from?: Hsl) => {
    h = h.toLowerCase();
    setHex(h);
    setText(h);
    setHsl(from ?? toHsl(h));
    last.current = h;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => send.current(h), 120);
  };
  const setPart = (i: 0 | 1 | 2, v: number) => {
    const next = [...hsl] as Hsl;
    next[i] = Math.max(0, Math.min(i === 0 ? 359 : 100, Math.round(v)));
    pick(toHex(next), next);
  };

  const onDark = readableOn(hex, DARK_PANEL), onLight = readableOn(hex, LIGHT_PANEL);
  const moved = onDark !== hex || onLight !== hex;
  const faint = contrastOf(hex, DARK_PANEL) < 1.6 || contrastOf(hex, LIGHT_PANEL) < 1.6;
  const rows: Array<{ i: 0 | 1 | 2; name: string; step: number; max: number; track: string }> = [
    { i: 0, name: t("Hue"), step: 10, max: 359, track: "linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" },
    { i: 1, name: t("Saturation"), step: 5, max: 100, track: `linear-gradient(90deg, ${toHex([hsl[0], 0, hsl[2]])}, ${toHex([hsl[0], 100, hsl[2]])})` },
    { i: 2, name: t("Lightness"), step: 5, max: 100, track: `linear-gradient(90deg, #000, ${toHex([hsl[0], hsl[1], 50])}, #fff)` },
  ];

  return (
    <Popover anchor={anchor} onClose={onClose} label={label} width="19em">
      <div className="cpick">
        <div className="cpick-prev">
          <span className="cpick-fill" style={{ background: hex, color: onColor(hex) } as CSSProperties}>Aa</span>
          <span className="cpick-ink cpick-dark" style={{ color: onDark }}>Aa</span>
          <span className="cpick-ink cpick-light" style={{ color: onLight }}>Aa</span>
        </div>
        {(moved || faint) && (
          <p className="hint cpick-note">
            {moved ? t("Text in this colour is shown a shade lighter or darker where it would be hard to read") : t("Buttons in this colour get a thin edge so they stand out")}
          </p>
        )}
        <div className="cpick-presets" role="group" aria-label={t("Colours")}>
          {PRESETS.map((p) => (
            <button key={p} type="button" className={`swatch cpick-sw${p === hex ? " on" : ""}`} style={{ "--c": p } as CSSProperties}
              title={p} aria-label={p} aria-pressed={p === hex} onClick={() => pick(p)} />
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.i} className="cpick-row">
            <span className="cpick-l">{r.name}</span>
            <IconButton size="sm" icon="minus" label={t("Less {what}", { what: r.name.toLowerCase() })} onClick={() => setPart(r.i, hsl[r.i] - r.step)} />
            <input type="range" className="cpick-range" min={0} max={r.max} value={hsl[r.i]} aria-label={r.name} style={{ "--track": r.track } as CSSProperties}
              onChange={(e) => setPart(r.i, +e.target.value)} />
            <IconButton size="sm" icon="plus" label={t("More {what}", { what: r.name.toLowerCase() })} onClick={() => setPart(r.i, hsl[r.i] + r.step)} />
          </div>
        ))}
        <label className="cpick-hex field mono">
          <span className="cpick-l">{t("Hex")}</span>
          <input value={text} spellCheck={false} maxLength={7} aria-label={t("Colour as #rrggbb")}
            onChange={(e) => { const v = e.target.value; setText(v); if (isHex(v)) pick(v.trim().startsWith("#") ? v.trim() : `#${v.trim()}`); }}
            onBlur={() => setText(hex)} />
        </label>
      </div>
    </Popover>
  );
}
