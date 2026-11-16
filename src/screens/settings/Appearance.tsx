// Settings > Appearance (theme per game, light or dark, accent, layout, text size, animations) and Custom themes.
// Owner: SETTINGS/AI area. Applying themes is lib/theme.ts (THEMES area); saving custom ones is ./customThemes.ts.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { currentGame, go, useGame } from "../../lib/store";
import { shareTheme } from "../../lib/extensions";
import { aiShown, askAi, useAiShow } from "../../lib/ai";
import {
  THEMES, THEME_TOKENS, accentPick, applyCustomTheme, currentLayout, customThemesPref, darkShade, onColor, ownSchemeChoice, setAccentPick, setLayout, setMotion,
  setScheme, setSchemeMode, setThemePick, subscribeTheme, themeAttrs, themePick, useTheme, validateCustomTheme,
  type CustomTheme, type LayoutPrefs, type Scheme, type SchemeChoice, type SchemeMode,
} from "../../lib/theme";
import { SIZES, getTextSize, setTextSize } from "../../lib/zoom";
import { Button, Card, IconButton, Panel, Segmented, Select, TextField, Toggle } from "../../ui/kit";
import { WithMenu, openMenu, type MenuEntry } from "../../ui/ContextMenu";
import { toast } from "../../ui/toast";
import { SetRow } from "./parts";
import { RenderLogRow } from "./Feedback";
import { hiddenThemePref } from "../../lib/fun";
import { addThemes, copyTheme, deleteTheme, duplicateOf, readThemes, saveTheme, themeText } from "./customThemes";
import { hintsOnPref } from "../../shell/hints";
import { about, errorText } from "../../lib/api";
import { pref } from "../../lib/prefs";

const SCHEME_OPTIONS: Array<{ value: SchemeChoice; label: string; icon?: "moon" | "sun" }> = [
  { value: "dark", label: "Dark", icon: "moon" }, { value: "light", label: "Light", icon: "sun" }, { value: "system", label: "System" },
];
const LIGHT_NATIVE = THEMES.filter((t) => t.native === "light" && !t.hidden).map((t) => t.name);
// the Light tip teases a little, and gives up once it's picked
const modeOptions = (mode: SchemeMode): Array<{ value: SchemeMode; label: string; icon?: "moon" | "sun" | "controller"; title?: string }> => [
  { value: "game", label: "Game's own", icon: "controller", title: `Each theme as its game draws its menus: ${LIGHT_NATIVE.join(" and ")} light, the rest dark` },
  { value: "dark", label: "Dark", icon: "moon", title: "Every theme dark" },
  { value: "light", label: "Light", icon: "sun", title: mode === "light" ? "You did this to yourself..." : "Every theme light, even the one set in space. We won't ask" },
  { value: "system", label: "System", title: "Dark or light as Windows is set" },
];

export function AppearanceSection() {
  const game = useGame();
  const theme = useTheme();
  const [pick, setPick] = useState(() => (game ? themePick(game.id) : "auto"));
  const found = hiddenThemePref.use();
  const [size, setSize] = useState(getTextSize());
  useEffect(() => { setPick(game ? themePick(game.id) : "auto"); }, [game?.id, theme.custom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: Event) => setSize((e as CustomEvent<number>).detail);
    window.addEventListener("pm-text-size", h);
    return () => window.removeEventListener("pm-text-size", h);
  }, []);

  const choose = (id: string) => { if (!game) return; setThemePick(game, id); setPick(id); };
  const defaultFor = THEMES.find((t) => t.id === (game?.theme || "default")) ?? THEMES[0]!;
  const themeInfo = THEMES.find((t) => t.id === theme.id);
  const accents = themeInfo?.accents ?? [];
  const themeName = themeInfo?.name ?? "the theme";
  const [accent, setAccent] = useState(() => accentPick(theme.id));
  useEffect(() => { setAccent(accentPick(theme.id)); }, [theme.id]);

  return (
    <Panel title="Appearance" icon="palette" id="appearance">
      <div className="field-l">Theme {game ? `for ${game.name}` : ""}</div>
      <div className="set-themes">
        <ThemeCard id={defaultFor.id} name="Game's own" description={`${defaultFor.name}, the one ${game?.short ?? "the game"} uses`} on={pick === "auto"} onClick={() => choose("auto")} disabled={!game} />
        {THEMES.filter((t) => !t.hidden || found || pick === t.id).map((t) => <ThemeCard key={t.id} id={t.id} name={t.name} description={t.description} on={pick === t.id} onClick={() => choose(t.id)} disabled={!game} />)}
      </div>
      <div className="set-rows">
        {accents.length > 1 && !theme.custom && (
          <SetRow id="set-accent" label="Accent" hint={`The colour ${themeName} uses for what is picked or on`}>
            <span className="set-accents" role="radiogroup" aria-label="Accent">
              {accents.map((a) => (
                <button key={a.id} type="button" role="radio" aria-checked={accent === a.id} className={`swatch${accent === a.id ? " on" : ""}`} title={a.name} aria-label={a.name}
                  style={{ "--c": a.color } as CSSProperties} onClick={() => { setAccentPick(theme.id, a.id, currentGame()); setAccent(a.id); }} />
              ))}
            </span>
          </SetRow>
        )}
        {theme.custom ? (
          <SetRow id="set-scheme" label="Light or dark" hint="Saved in your custom theme">
            <Segmented<SchemeChoice> value={theme.choice} onChange={(v) => setScheme(v, currentGame())} label="Light or dark" options={SCHEME_OPTIONS} />
          </SetRow>
        ) : (
          <>
            <SetRow id="set-scheme" label="Light or dark" hint={theme.mode === "game" ? `Like each game's menus: ${LIGHT_NATIVE.join(" and ")} are light, the rest dark` : theme.mode === "system" ? "Follows Windows, for every theme" : `Every theme is ${theme.mode}`}>
              <Segmented<SchemeMode> value={theme.mode} onChange={(v) => setSchemeMode(v, currentGame())} label="Light or dark" options={modeOptions(theme.mode)} />
            </SetRow>
            {theme.mode === "game" && (
              <SetRow label={`Just ${themeName}`} hint={`Its game's menus are ${themeInfo?.native ?? "dark"}. A pick here counts only for ${themeName}`}>
                <Segmented<SchemeChoice> value={ownSchemeChoice(theme.id)} onChange={(v) => setScheme(v, currentGame())} label={`Light or dark for ${themeName}`} options={SCHEME_OPTIONS} size="sm" />
              </SetRow>
            )}
          </>
        )}
        <LayoutRows />
        <SetRow id="set-text-size" label="Text size" hint="Ctrl+= and Ctrl+- work anywhere, Ctrl+0 resets">
          <Segmented value={String(size)} onChange={(v) => { setTextSize(Number(v)); setSize(Number(v)); }} label="Text size"
            options={SIZES.map((s) => ({ value: String(s), label: String(s) }))} size="sm" />
        </SetRow>
        <SetRow id="set-motion" label="Animations" hint="Off keeps every change instant">
          <Toggle checked={theme.motion} onChange={(v) => setMotion(v, currentGame())} />
        </SetRow>
        <SetRow id="set-hints" label="First-start hints" hint="Right after setup, Browse, Install and Downloads look faintly selected until you've used them once">
          <HintsSwitch />
        </SetRow>
        <SetRow id="set-gpu" label="Hardware acceleration" hint="Draws gachamod with the graphics card. Turn it off if the window goes black or flickers. Counts from the next start"
          tip="When the window is too broken to reach this, start gachamod.exe with --disable-gpu to turn it off">
          <GpuSwitch />
        </SetRow>
        <RenderLogRow />
      </div>
    </Panel>
  );
}

/** Hardware acceleration (src-tauri lib.rs reads "app.gpu" before the window opens). */
const gpuPref = pref<boolean>("app.gpu", true, (r) => (r === "0" ? false : r === "1" ? true : undefined), (v) => (v ? "1" : "0"));

function GpuSwitch() {
  const on = gpuPref.use();
  const change = async (v: boolean) => {
    try { await gpuPref.set(v); } catch (e) { toast(errorText(e), true); return; }
    toast(`Hardware acceleration turns ${v ? "on" : "off"} when gachamod restarts`, false,
      { label: "Restart", run: () => void about.relaunch().catch((e) => toast(errorText(e), true)) });
  };
  return <Toggle checked={on} label="Hardware acceleration" onChange={(v) => void change(v)} />;
}

function HintsSwitch() {
  const on = hintsOnPref.use();
  return <Toggle checked={on} label="First-start hints" onChange={(v) => void hintsOnPref.set(v, v ? "Turned first-start hints on" : "Turned first-start hints off")} />;
}

// ── layout ──

const NOT_SET = { value: "", label: "Not set" };
const LAYOUT_ROWS: Array<{ key: keyof LayoutPrefs; id?: string; label: string; hint?: string; options: Array<{ value: string; label: string }> }> = [
  { key: "density", id: "set-layout", label: "Spacing", hint: "Compact fits more on screen",
    options: [{ value: "compact", label: "Compact" }, { value: "cozy", label: "Cozy" }, { value: "roomy", label: "Roomy" }] },
  { key: "sidebar", label: "Sidebar side", options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }] },
  { key: "nav", label: "Views in the sidebar", hint: "Grid puts two on each row", options: [{ value: "list", label: "List" }, { value: "grid", label: "Grid" }] },
  { key: "corners", label: "Corners", options: [{ value: "sharp", label: "Sharp" }, { value: "soft", label: "Soft" }, { value: "round", label: "Round" }] },
  { key: "buttons", label: "Buttons", hint: "Icons only keeps each name as the button's tip. Buttons in dialogs and menus keep their names",
    options: [{ value: "both", label: "Icon and name" }, { value: "icons", label: "Icons only" }, { value: "text", label: "Names only" }] },
];

function LayoutRows() {
  const game = useGame();
  const [lay, setLay] = useState(() => currentLayout(currentGame()));
  useEffect(() => subscribeTheme(() => setLay(currentLayout(currentGame()))), []);
  useEffect(() => { setLay(currentLayout(game)); }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {LAYOUT_ROWS.map((r) => (
        <SetRow key={r.key} id={r.id} label={r.label} hint={lay.fromTheme.includes(r.key) ? `Set by your theme ${lay.themeName}` : r.hint}>
          <Segmented value={lay.layout[r.key]} onChange={(v) => setLayout({ [r.key]: v } as LayoutPrefs, currentGame())} label={r.label} options={r.options} size="sm" />
        </SetRow>
      ))}
    </>
  );
}

// ── theme cards ──

function ThemeCard({ id, name, description, on, onClick, disabled, scheme, tokens }:
  { id: string; name: string; description: string; on: boolean; onClick: () => void; disabled?: boolean; scheme?: Scheme; tokens?: Record<string, string> }) {
  return (
    <Card className="theme-card" selected={on} onClick={onClick} disabled={disabled} title={description}>
      <span className="theme-preview" {...themeAttrs(id, scheme)} style={tokens as CSSProperties | undefined} aria-hidden="true">
        <span className="theme-preview-rail" />
        <span className="theme-preview-body">
          <span className="theme-preview-line" />
          <span className="theme-preview-line short" />
          <span className="theme-preview-btn" />
        </span>
      </span>
      <span className="theme-card-t"><b>{name}</b><span className="hint">{description}</span></span>
    </Card>
  );
}

const schemeOf = (c: SchemeChoice): Scheme | undefined => (c === "system" ? undefined : c);
const baseName = (id: string) => THEMES.find((t) => t.id === id)?.name ?? id;

// ── custom themes ──

export function CustomThemesSection() {
  const game = useGame();
  const saved = customThemesPref.use();
  const aiShow = useAiShow();
  const theme = useTheme();
  const [edit, setEdit] = useState<{ theme: CustomTheme; isNew: boolean; note?: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const list = saved.map((t) => validateCustomTheme(t).theme).filter((t): t is CustomTheme => !!t);
  const inUse = game ? themePick(game.id) : "";

  const use = (t: CustomTheme) => { if (game) setThemePick(game, t.id); };
  const startNew = () => setEdit({ theme: { id: "custom:my-theme", name: "My theme", base: theme.id, scheme: theme.choice, tokens: {}, layout: {} }, isNew: true });
  const importText = async (text: string) => {
    const { themes, problems } = readThemes(text);
    if (!themes.length) { toast(problems[0] ?? "That isn't a theme", true); return; }
    // something was left out: open it so the reasons show before it's saved
    if (themes.length === 1 && problems.length) { setEdit({ theme: themes[0]!, isNew: true, note: problems }); return; }
    await addThemes(themes);
  };
  const fromClipboard = () => {
    navigator.clipboard.readText().then(importText).catch(() => toast("Couldn't read the clipboard. Import from a file instead", true));
  };
  const importMenu = (el: Element) => openMenu(el, [
    { label: "From a file", icon: "file", onClick: () => file.current?.click() },
    { label: "From the clipboard", icon: "paste", title: "Text someone shared with Copy as text", onClick: fromClipboard },
  ]);
  const items = (t: CustomTheme): MenuEntry[] => [
    !!game && { label: `Use for ${game.name}`, icon: "check", disabled: inUse === t.id, onClick: () => use(t) },
    { label: "Edit", icon: "edit", onClick: () => setEdit({ theme: t, isNew: false }) },
    { label: "Duplicate", icon: "copy", onClick: () => setEdit({ theme: duplicateOf(t, list), isNew: true }) },
    { label: "Copy as text", icon: "share", title: "To share it: whoever gets it imports it here", onClick: () => copyTheme(t) },
    !t.pkg && { label: "Share to the theme list", icon: "upload", title: "Saves it as a package and opens the page where you send it in, so anyone can install it from Extensions", onClick: () => void shareTheme(t) },
    !!t.pkg && { label: "View in Extensions", icon: "puzzle", title: "This theme came from a package", onClick: () => go({ view: "extensions", tab: "installed" }) },
    "-",
    { label: "Delete", icon: "trash", danger: true, onClick: () => { if (edit?.theme.id === t.id) setEdit(null); void deleteTheme(t); } },
  ];

  return (
    <Panel title="Custom themes" icon="wand" id="themes">
      {list.length > 0 && (
        <div className="set-themes">
          {list.map((t) => (
            <WithMenu key={t.id} items={() => items(t)} className="ctheme">
              <ThemeCard id={t.base} name={t.name} scheme={schemeOf(t.scheme)} tokens={t.tokens} on={inUse === t.id} disabled={!game}
                description={`On ${baseName(t.base)}. ${game ? (inUse === t.id ? `In use for ${game.name}` : `Click to use it for ${game.name}`) : ""}`} onClick={() => use(t)} />
              <IconButton className="ctheme-more" icon="more" label="More (or right-click)" size="sm" onClick={(e) => openMenu(e.currentTarget, items(t))} />
            </WithMenu>
          ))}
        </div>
      )}
      {!list.length && !edit && <p className="hint ctheme-intro">Your own colours, corners and spacing on top of any theme in Appearance. Themes other people share can be imported here.</p>}
      {edit
        ? <ThemeEditor key={`${edit.theme.id}:${edit.isNew}`} start={edit.theme} isNew={edit.isNew} note={edit.note} onClose={() => setEdit(null)} />
        : (
          <div className="ctheme-row">
            <Button icon="plus" onClick={startNew} title="Starts from the theme you're using now">New theme</Button>
            <Button variant="ghost" icon="import" onClick={(e) => importMenu(e.currentTarget)} title="From a file, or text someone shared">Import</Button>
            <Button variant="ghost" icon="puzzle" onClick={() => go({ view: "extensions", section: "themes" })} title="Themes other people made, one click to install">Get more themes</Button>
            {aiShown("useful", aiShow) && <Button variant="ghost" icon="ai" onClick={() => askAi({ kind: "theme", game: game?.id })} title="Describe a look and your chatbot writes the theme">Describe it to your chatbot</Button>}
          </div>
        )}
      <input ref={file} type="file" accept=".json,.txt,application/json,text/plain" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void f.text().then(importText); }} />
    </Panel>
  );
}

// ── the editor ──

/** A colour the editor sets, and the tokens that follow from it so text and fills stay readable. */
const COLORS: Array<{ token: string; label: string; tip: string; derive: (hex: string, scheme: Scheme) => Record<string, string> }> = [
  { token: "--accent", label: "Accent", tip: "Picked items, primary buttons, toggles",
    derive: (h, s) => ({ "--accent": h, "--on-accent": onColor(h), "--accent-soft": `color-mix(in srgb, ${h} 18%, transparent)`, "--accent-ink": s === "light" ? darkShade(h) : h, "--ring": h }) },
  { token: "--bg", label: "Background", tip: "The window behind everything",
    derive: (h) => ({ "--bg": h, "--bg-2": `color-mix(in srgb, ${h} 86%, #000)` }) },
  { token: "--surface", label: "Panels", tip: "Panels, cards and lists",
    derive: (h) => ({ "--surface": h, "--surface-2": `color-mix(in srgb, ${h} 92%, var(--text))`, "--surface-3": `color-mix(in srgb, ${h} 85%, var(--text))`, "--raised": `color-mix(in srgb, ${h} 88%, var(--text))` }) },
  { token: "--text", label: "Text", tip: "Main text. Fainter text is mixed from it",
    derive: (h) => ({ "--text": h, "--text-2": `color-mix(in srgb, ${h} 78%, var(--surface))`, "--text-3": `color-mix(in srgb, ${h} 62%, var(--surface))` }) },
];

/** A token's colour on screen now as #rrggbb, for a colour picker. */
function hexOf(token: string): string {
  const el = document.createElement("span");
  el.style.color = `var(${token})`;
  document.body.appendChild(el);
  const c = getComputedStyle(el).color;
  el.remove();
  const to = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c);
  if (rgb) return `#${to(+rgb[1]!)}${to(+rgb[2]!)}${to(+rgb[3]!)}`;
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(c);
  if (srgb) return `#${to(+srgb[1]! * 255)}${to(+srgb[2]! * 255)}${to(+srgb[3]! * 255)}`;
  return "#808080";
}

const editable = (t: CustomTheme) => themeText(t);

function ThemeEditor({ start, isNew, note, onClose }: { start: CustomTheme; isNew: boolean; note?: string[]; onClose: () => void }) {
  const game = useGame();
  const live = useTheme();
  const [t, setT] = useState<CustomTheme>(start);
  const [problems, setProblems] = useState<string[]>([]);
  const [text, setText] = useState(() => editable(start));
  const [textErr, setTextErr] = useState<string | null>(null);
  const typing = useRef(false);

  // the whole app shows the draft while editing; closing the editor puts the game's theme back
  useEffect(() => {
    const h = window.setTimeout(() => setProblems(applyCustomTheme(t)), 100);
    if (!typing.current) setText(editable(t));
    return () => window.clearTimeout(h);
  }, [t]);
  useEffect(() => () => { applyCustomTheme(null); }, []);

  const patch = (p: Partial<CustomTheme>) => setT((x) => ({ ...x, ...p }));
  const setTokens = (add: Record<string, string>, drop: string[] = []) => setT((x) => {
    const tokens = { ...x.tokens, ...add };
    for (const k of drop) delete tokens[k];
    return { ...x, tokens };
  });
  const setLay = (k: keyof LayoutPrefs, v: string) => setT((x) => {
    const layout = { ...x.layout } as Record<string, string>;
    if (v) layout[k] = v; else delete layout[k];
    return { ...x, layout: layout as LayoutPrefs };
  });
  const onText = (v: string) => {
    setText(v);
    let raw: unknown;
    try { raw = JSON.parse(v); } catch { setTextErr("Not valid JSON yet"); return; }
    const r = validateCustomTheme(raw);
    if (!r.theme) { setTextErr(r.problems[0] ?? "Not a theme"); return; }
    setTextErr(null);
    setT({ ...r.theme, id: t.id });
  };
  const save = async () => {
    const { theme } = validateCustomTheme(t);
    if (!theme) { toast("Give the theme a name", true); return; }
    // a new theme's id comes from its name ("custom:green-night"); an edited one keeps its id
    const id = isNew ? (validateCustomTheme({ ...t, id: undefined }).theme?.id ?? t.id) : t.id;
    try { await saveTheme({ ...theme, id }, isNew, game); onClose(); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), true); }
  };

  return (
    <div className="ctheme-ed" role="group" aria-label={isNew ? "New theme" : `Edit ${start.name}`}>
      <div className="ctheme-ed-top">
        <TextField label="Name" value={t.name} onChange={(v) => patch({ name: v })} autoFocus={isNew} />
        <Select label="Based on" value={t.base} onChange={(v) => patch({ base: v })} options={THEMES.map((b) => ({ value: b.id, label: b.name }))} />
      </div>
      <div className="ctheme-line">
        <span className="field-l">Light or dark</span>
        <Segmented<SchemeChoice> value={t.scheme} onChange={(v) => patch({ scheme: v })} label="Light or dark" options={SCHEME_OPTIONS} size="sm" />
      </div>
      <div className="ctheme-line">
        <span className="field-l">Colours</span>
        <div className="ctheme-colors">
          {COLORS.map((c) => {
            const set = !!t.tokens[c.token];
            const val = /^#[0-9a-f]{6}$/i.test(t.tokens[c.token] ?? "") ? t.tokens[c.token]! : hexOf(c.token);
            return (
              <span key={c.token} className={`ctheme-color${set ? " set" : ""}`} title={c.tip}>
                <label><input type="color" value={val} onChange={(e) => setTokens(c.derive(e.target.value, live.scheme))} aria-label={c.label} /><span>{c.label}</span></label>
                {set && <IconButton icon="x" size="sm" label={`Use ${baseName(t.base)}'s ${c.label.toLowerCase()}`} onClick={() => setTokens({}, Object.keys(c.derive("#000000", live.scheme)))} />}
              </span>
            );
          })}
        </div>
      </div>
      <div className="ctheme-layout">
        {LAYOUT_ROWS.map((r) => (
          <div key={r.key} className="ctheme-line">
            <span className="field-l" title={r.key === "density" ? "Not set keeps what you picked in Appearance" : undefined}>{r.label}</span>
            <Segmented value={t.layout[r.key] ?? ""} onChange={(v) => setLay(r.key, v)} label={r.label} options={[NOT_SET, ...r.options]} size="sm" />
          </div>
        ))}
      </div>
      <details className="ctheme-adv">
        <summary>Edit as text</summary>
        <label className="field mono">
          <span className="field-l">Theme</span>
          <textarea value={text} rows={12} spellCheck={false} onChange={(e) => onText(e.target.value)}
            onFocus={() => { typing.current = true; }} onBlur={() => { typing.current = false; setText(editable(t)); setTextErr(null); }} />
          {textErr ? <span className="hint ctheme-err">{textErr}</span> : <span className="hint">"tokens" takes any name below, "css" takes extra CSS for anything tokens can't say</span>}
        </label>
        <details>
          <summary>Tokens you can set</summary>
          <dl className="ctheme-tokens">
            {Object.entries(THEME_TOKENS).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v.meaning}</dd></div>)}
          </dl>
        </details>
      </details>
      {(note?.length || problems.length) ? (
        <ul className="ctheme-probs">
          {[...(note ?? []), ...problems].slice(0, 8).map((p, i) => <li key={i}>Left out: {p}</li>)}
        </ul>
      ) : null}
      <div className="ctheme-ed-foot">
        <span className="hint">You're seeing it now. Cancel puts your theme back.</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="check" onClick={() => void save()} title={isNew && game ? `Saves it and uses it for ${game.name}` : undefined}>{isNew ? "Save and use" : "Save"}</Button>
      </div>
    </div>
  );
}
