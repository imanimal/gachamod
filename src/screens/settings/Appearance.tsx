// Settings > Appearance: Theme and colours (theme per game, accent, light or dark), Layout, text size and animations,
// and Custom themes. Settings > General: Language and startup, and Hardware acceleration and rendering log.
// Owner: SETTINGS/AI area. Applying themes is lib/theme.ts (THEMES area); saving custom ones is ./customThemes.ts.
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { currentGame, go, useGame, useGames } from "../../lib/store";
import { extName, extensionsNow, removeExtension, shareTheme } from "../../lib/extensions";
import { record } from "../../lib/history";
import { aiShown, askAi, useAiShow } from "../../lib/ai";
import {
  THEMES, THEME_TOKENS, accentPick, applyCustomTheme, currentLayout, customThemesPref, darkShade, onColor, ownSchemeChoice, setAccentPick, setLayout, setMotion,
  setScheme, setSchemeMode, setThemePick, setThemePicks, subscribeTheme, themeAttrs, themePick, useTheme, validateCustomTheme,
  type CustomTheme, type LayoutPrefs, type Scheme, type SchemeChoice, type SchemeMode,
} from "../../lib/theme";
import { anatomyText } from "../../lib/theme-anatomy";
import { SIZES, getTextSize, setTextSize } from "../../lib/zoom";
import { Button, Card, IconButton, Panel, Segmented, Select, TextField, Toggle } from "../../ui/kit";
import { WithMenu, openMenu, type MenuEntry } from "../../ui/ContextMenu";
import { toast } from "../../ui/toast";
import { SetRow } from "./parts";
import { FormatPicker } from "./FormatPicker";
import { RenderLogRow } from "./Feedback";
import { hiddenThemePref } from "../../lib/fun";
import { addThemes, copyTheme, deleteTheme, duplicateOf, readThemes, saveTheme, themeText } from "./customThemes";
import { hintsOnPref } from "../../shell/hints";
import { INTRO_LIST, introPick, replaySplash, setIntroPick, themeIntro } from "../../splash/splash";
import { about, errorText } from "../../lib/api";
import { pref } from "../../lib/prefs";
import { LANGS, lang, langChoice, setLangChoice, systemLang, t, type LangChoice } from "../../lib/i18n";
import { settings } from "../../lib/api";
import { gameName, gameShort } from "../../lib/games";

const SCHEME_OPTIONS: Array<{ value: SchemeChoice; label: string; icon?: "moon" | "sun" }> = [
  { value: "dark", label: t("Dark"), icon: "moon" }, { value: "light", label: t("Light"), icon: "sun" }, { value: "system", label: t("System") },
];
const LIGHT_NATIVE = THEMES.filter((th) => th.native === "light" && !th.hidden).map((th) => th.name);
/** The light-native themes as a list in the user's language ("Wuthering Waves and Endfield"). */
const lightNative = () => new Intl.ListFormat(lang, { type: "conjunction" }).format(LIGHT_NATIVE);
// the Light tip teases a little, and gives up once it's picked
const modeOptions = (mode: SchemeMode): Array<{ value: SchemeMode; label: string; icon?: "moon" | "sun" | "controller"; title?: string }> => [
  { value: "game", label: t("Game's own"), icon: "controller", title: t("Each theme as its game draws its menus: {themes} light, the rest dark", { themes: lightNative() }) },
  { value: "dark", label: t("Dark"), icon: "moon", title: t("Every theme dark") },
  { value: "light", label: t("Light"), icon: "sun", title: mode === "light" ? t("You did this to yourself...") : t("Every theme light, even the one set in space. We won't ask") },
  { value: "system", label: t("System"), title: t("Dark or light as Windows is set") },
];

/** The theme for the current game, its accent, and light or dark. */
export function AppearanceSection() {
  const game = useGame();
  const theme = useTheme();
  const [pick, setPick] = useState(() => (game ? themePick(game.id) : "auto"));
  const found = hiddenThemePref.use();
  useEffect(() => { setPick(game ? themePick(game.id) : "auto"); }, [game?.id, theme.custom]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (id: string) => { if (!game) return; setThemePick(game, id); setPick(id); };
  const defaultFor = THEMES.find((th) => th.id === (game?.theme || "default")) ?? THEMES[0]!;
  const themeInfo = THEMES.find((th) => th.id === theme.id);
  const accents = themeInfo?.accents ?? [];
  const themeName = themeInfo?.name ?? t("the theme");
  const [accent, setAccent] = useState(() => accentPick(theme.id));
  useEffect(() => { setAccent(accentPick(theme.id)); }, [theme.id]);

  return (
    <Panel title={t("Theme and colours")} icon="palette" id="appearance">
      <div className="field-l">{game ? t("Theme for {game}", { game: gameName(game) }) : t("Theme")}</div>
      <div className="set-themes">
        <ThemeCard id={defaultFor.id} name={t("Game's own")} description={game ? t("{theme}, the one {game} uses", { theme: defaultFor.name, game: gameShort(game) }) : t("{theme}, the one the game uses", { theme: defaultFor.name })} on={pick === "auto"} onClick={() => choose("auto")} disabled={!game} />
        {THEMES.filter((th) => !th.hidden || found || pick === th.id).map((th) => <ThemeCard key={th.id} id={th.id} name={th.name} description={th.description} on={pick === th.id} onClick={() => choose(th.id)} disabled={!game} />)}
      </div>
      <div className="set-rows">
        {accents.length > 1 && !theme.custom && (
          <SetRow id="set-accent" label={t("Accent")} hint={t("The colour {theme} uses for what is picked or on", { theme: themeName })}>
            <span className="set-accents" role="radiogroup" aria-label={t("Accent")}>
              {accents.map((a) => (
                <button key={a.id} type="button" role="radio" aria-checked={accent === a.id} className={`swatch${accent === a.id ? " on" : ""}`} title={a.name} aria-label={a.name}
                  style={{ "--c": a.color } as CSSProperties} onClick={() => { setAccentPick(theme.id, a.id, currentGame()); setAccent(a.id); }} />
              ))}
            </span>
          </SetRow>
        )}
        {theme.custom ? (
          <SetRow id="set-scheme" label={t("Light or dark")} hint={t("Saved in your custom theme")}>
            <Segmented<SchemeChoice> value={theme.choice} onChange={(v) => setScheme(v, currentGame())} label={t("Light or dark")} options={SCHEME_OPTIONS} />
          </SetRow>
        ) : (
          <>
            <SetRow id="set-scheme" label={t("Light or dark")} hint={theme.mode === "game" ? t("Like each game's menus: {themes} are light, the rest dark", { themes: lightNative() }) : theme.mode === "system" ? t("Follows Windows, for every theme") : theme.mode === "light" ? t("Every theme is light") : t("Every theme is dark")}>
              <Segmented<SchemeMode> value={theme.mode} onChange={(v) => setSchemeMode(v, currentGame())} label={t("Light or dark")} options={modeOptions(theme.mode)} />
            </SetRow>
            {theme.mode === "game" && (
              <SetRow label={t("Just {theme}", { theme: themeName })} hint={themeInfo?.native === "light" ? t("Its game's menus are light. A pick here counts only for {theme}", { theme: themeName }) : t("Its game's menus are dark. A pick here counts only for {theme}", { theme: themeName })}>
                <Segmented<SchemeChoice> value={ownSchemeChoice(theme.id)} onChange={(v) => setScheme(v, currentGame())} label={t("Light or dark for {theme}", { theme: themeName })} options={SCHEME_OPTIONS} size="sm" />
              </SetRow>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

/** The language, the opening screen and the first-start hints (Settings > General). */
export function GeneralSection() {
  return (
    <Panel title={t("Language and startup")} icon="web" id="general">
      <div className="set-rows">
        <SetRow id="set-lang" label={t("Language")} hint={t("Changing it reloads the window")}>
          <LanguagePicker />
        </SetRow>
        <SetRow id="set-intro" label={t("Opening screen")} hint={t("An intro with a one-line tip while gachamod starts. Theme's own plays the one that goes with the theme in use. A click or Escape skips it")}>
          <IntroPicker />
        </SetRow>
        <SetRow id="set-hints" label={t("First-start hints")} hint={t("Right after setup, Browse, Install and Downloads look faintly selected until you've used them once")}>
          <HintsSwitch />
        </SetRow>
      </div>
    </Panel>
  );
}

/** The Mods layout, spacing, the sidebar, corners and buttons, then text size and animations. */
export function LayoutSection() {
  const theme = useTheme();
  const [size, setSize] = useState(getTextSize());
  useEffect(() => {
    const h = (e: Event) => setSize((e as CustomEvent<number>).detail);
    window.addEventListener("pm-text-size", h);
    return () => window.removeEventListener("pm-text-size", h);
  }, []);
  return (
    <Panel title={t("Layout, text size and animations")} icon="layout" id="layout">
      <div className="set-format" id="set-format">
        <div className="field-l">{t("Mods layout")}</div>
        <span className="hint">{t("How Mods and each character's page are laid out, to feel like the mod manager you used before. Every layout has the same features")}</span>
        <FormatPicker />
      </div>
      <div className="set-rows">
        <LayoutRows />
        <SetRow id="set-text-size" label={t("Text size")} hint={t("Ctrl+= and Ctrl+- work anywhere, Ctrl+0 resets")}>
          <Select value={String(size)} onChange={(v) => { setTextSize(Number(v)); setSize(Number(v)); }}
            options={SIZES.map((s) => ({ value: String(s), label: t("{size} px", { size: s }) }))} />
        </SetRow>
        <SetRow id="set-motion" label={t("Animations")} hint={t("Off keeps every change instant")}>
          <Toggle checked={theme.motion} onChange={(v) => setMotion(v, currentGame())} />
        </SetRow>
      </div>
    </Panel>
  );
}

/** The app's language: Windows' own by default. Saved in the settings too, so it travels with a settings export. */
function LanguagePicker() {
  const sys = LANGS.find((l) => l.id === systemLang())!;
  const options: Array<{ value: LangChoice; label: string }> = [
    { value: "auto", label: t("Match Windows ({language})", { language: sys.name }) },
    ...LANGS.map((l) => ({ value: l.id, label: l.name })),
  ];
  return <Select<LangChoice> value={langChoice()} options={options} onChange={(v) => setLangChoice(v, (c) => settings.set("ui.lang", c))} />;
}

/** How the window is drawn, for when it goes black or flickers. The rendering log also shows under Log files. */
export function GraphicsSection() {
  return (
    <Panel title={t("Hardware acceleration and rendering log")} icon="sliders" id="graphics">
      <div className="set-rows">
        <SetRow id="set-gpu" label={t("Hardware acceleration")} hint={t("Draws gachamod with the graphics card. Turn it off if the window goes black or flickers. Counts from the next start")}
          tip={t("When the window is too broken to reach this, start gachamod.exe with --disable-gpu to turn it off")}>
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
    toast(v ? t("Hardware acceleration turns on when gachamod restarts") : t("Hardware acceleration turns off when gachamod restarts"), false,
      { label: t("Restart"), run: () => void about.relaunch().catch((e) => toast(errorText(e), true)) });
  };
  return <Toggle checked={on} ariaLabel={t("Hardware acceleration")} onChange={(v) => void change(v)} />;
}

function IntroPicker() {
  useTheme(); // the "Theme's own" label follows the theme
  const [pick, setPick] = useState(introPick);
  const own = INTRO_LIST.find((i) => i.id === themeIntro())?.name ?? t("Default");
  const options = [
    { value: "theme", label: t("Theme's own ({intro})", { intro: own }) },
    ...INTRO_LIST.map((i) => ({ value: i.id, label: i.name })),
    { value: "off", label: t("Off") },
  ];
  return (
    <>
      <Button size="sm" variant="ghost" icon="play" onClick={replaySplash} disabled={pick === "off"} title={t("Play the opening screen now")}>{t("Play it")}</Button>
      <Select value={pick} options={options} onChange={(v) => { setIntroPick(v); setPick(v); }} />
    </>
  );
}

function HintsSwitch() {
  const on = hintsOnPref.use();
  return <Toggle checked={on} ariaLabel={t("First-start hints")} onChange={(v) => void hintsOnPref.set(v, v ? t("Turned first-start hints on") : t("Turned first-start hints off"))} />;
}

// ── layout ──

const NOT_SET = { value: "", label: t("Not set") };
const LAYOUT_ROWS: Array<{ key: keyof LayoutPrefs; id?: string; label: string; hint?: string; options: Array<{ value: string; label: string }> }> = [
  { key: "density", id: "set-layout", label: t("Spacing"), hint: t("Compact fits more on screen"),
    options: [{ value: "compact", label: t("Compact") }, { value: "cozy", label: t("Cozy") }, { value: "roomy", label: t("Roomy") }] },
  { key: "sidebar", label: t("Sidebar side"), options: [{ value: "left", label: t("Left") }, { value: "right", label: t("Right") }] },
  { key: "nav", label: t("Views in the sidebar"), hint: t("Grid puts two on each row"), options: [{ value: "list", label: t("List") }, { value: "grid", label: t("Grid") }] },
  { key: "corners", label: t("Corners"), options: [{ value: "sharp", label: t("Sharp") }, { value: "soft", label: t("Soft") }, { value: "round", label: t("Round") }] },
  { key: "buttons", label: t("Buttons"), hint: t("Icons only keeps each name as the button's tip. Buttons in dialogs and menus keep their names"),
    options: [{ value: "both", label: t("Icon and name") }, { value: "icons", label: t("Icons only") }, { value: "text", label: t("Names only") }] },
];

function LayoutRows() {
  const game = useGame();
  const [lay, setLay] = useState(() => currentLayout(currentGame()));
  useEffect(() => subscribeTheme(() => setLay(currentLayout(currentGame()))), []);
  useEffect(() => { setLay(currentLayout(game)); }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {LAYOUT_ROWS.map((r) => (
        <SetRow key={r.key} id={r.id} label={r.label} hint={lay.fromTheme.includes(r.key) ? t("Set by your theme {theme}", { theme: lay.themeName ?? "" }) : r.hint}>
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
const baseName = (id: string) => THEMES.find((th) => th.id === id)?.name ?? id;

// ── custom themes ──

export function CustomThemesSection() {
  const game = useGame();
  const games = useGames();
  const saved = customThemesPref.use();
  const aiShow = useAiShow();
  const theme = useTheme();
  const [edit, setEdit] = useState<{ theme: CustomTheme; isNew: boolean; note?: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const list = saved.map((s) => validateCustomTheme(s).theme).filter((s): s is CustomTheme => !!s);
  const inUse = game ? themePick(game.id) : "";

  const use = (th: CustomTheme) => { if (game) setThemePick(game, th.id); };
  const useEverywhere = (th: CustomTheme) => {
    const before = Object.fromEntries(games.map((g) => [g.id, themePick(g.id)]));
    const after = Object.fromEntries(games.map((g) => [g.id, th.id]));
    setThemePicks(after, currentGame());
    record({ label: t("Used the theme {theme} for every game", { theme: th.name }), undo: async () => setThemePicks(before, currentGame()), redo: async () => setThemePicks(after, currentGame()) });
  };
  // a package's themes come back from the package each start, so editing one edits a copy and deleting removes the package
  const pkgOf = (th: CustomTheme) => (th.pkg ? extensionsNow().find((e) => e.id === th.pkg) ?? null : null);
  const remove = (th: CustomTheme) => {
    if (edit?.theme.id === th.id) setEdit(null);
    const ext = pkgOf(th);
    void (ext ? removeExtension(ext) : deleteTheme(th));
  };
  const startNew = () => setEdit({ theme: { id: "custom:my-theme", name: t("My theme"), base: theme.id, scheme: theme.choice, tokens: {}, layout: {} }, isNew: true });
  const importText = async (text: string) => {
    const { themes, problems } = readThemes(text);
    if (!themes.length) { toast(problems[0] ?? t("That isn't a theme"), true); return; }
    // something was left out: open it so the reasons show before it's saved
    if (themes.length === 1 && problems.length) { setEdit({ theme: themes[0]!, isNew: true, note: problems }); return; }
    await addThemes(themes);
  };
  const fromClipboard = () => {
    navigator.clipboard.readText().then(importText).catch(() => toast(t("Couldn't read the clipboard. Import from a file instead"), true));
  };
  const importMenu = (el: Element) => openMenu(el, [
    { label: t("From a file"), icon: "file", onClick: () => file.current?.click() },
    { label: t("From the clipboard"), icon: "paste", title: t("Text someone shared with Copy as text"), onClick: fromClipboard },
  ]);
  const items = (th: CustomTheme): MenuEntry[] => [
    !!game && { label: t("Use for {game}", { game: gameName(game) }), icon: "check", disabled: inUse === th.id, onClick: () => use(th) },
    games.length > 1 && { label: t("Use for every game"), icon: "check", disabled: games.every((g) => themePick(g.id) === th.id), onClick: () => useEverywhere(th) },
    th.pkg ? { label: t("Edit a copy"), icon: "edit", title: t("This theme comes from a package and changes when the package updates, so your edits go in a copy"), onClick: () => setEdit({ theme: duplicateOf(th, list), isNew: true }) }
      : { label: t("Edit"), icon: "edit", onClick: () => setEdit({ theme: th, isNew: false }) },
    !th.pkg && { label: t("Duplicate"), icon: "copy", onClick: () => setEdit({ theme: duplicateOf(th, list), isNew: true }) },
    { label: t("Copy as text"), icon: "share", title: t("To share it: whoever gets it imports it here"), onClick: () => copyTheme(th) },
    !th.pkg && { label: t("Share to the theme list"), icon: "upload", title: t("Saves it as a package and opens the page where you send it in, so anyone can install it from Extensions"), onClick: () => void shareTheme(th) },
    !!th.pkg && { label: t("View in Extensions"), icon: "puzzle", title: t("This theme came from a package"), onClick: () => go({ view: "extensions", tab: "installed" }) },
    "-",
    pkgOf(th) ? { label: t("Remove {name}", { name: extName(pkgOf(th)!) }), icon: "trash", danger: true, title: t("Removes the package this theme came from, with any other themes in it"), onClick: () => remove(th) }
      : { label: t("Delete"), icon: "trash", danger: true, onClick: () => remove(th) },
  ];
  const cardText = (th: CustomTheme) => !game ? t("On {theme}.", { theme: baseName(th.base) })
    : inUse === th.id ? t("On {theme}. In use for {game}", { theme: baseName(th.base), game: gameName(game) })
    : t("On {theme}. Click to use it for {game}", { theme: baseName(th.base), game: gameName(game) });

  return (
    <Panel title={t("Custom themes")} icon="wand" id="themes">
      {list.length > 0 && (
        <div className="set-themes">
          {list.map((th) => (
            <WithMenu key={th.id} items={() => items(th)} className="ctheme">
              <ThemeCard id={th.base} name={th.name} scheme={schemeOf(th.scheme)} tokens={th.tokens} on={inUse === th.id} disabled={!game}
                description={cardText(th)} onClick={() => use(th)} />
              <IconButton className="ctheme-more" icon="more" label={t("More (or right-click)")} size="sm" onClick={(e) => openMenu(e.currentTarget, items(th))} />
            </WithMenu>
          ))}
        </div>
      )}
      {!list.length && !edit && <p className="hint ctheme-intro">{t("Your own colours, corners and spacing on top of any theme above. Themes other people share can be imported here.")}</p>}
      {edit
        ? <ThemeEditor key={`${edit.theme.id}:${edit.isNew}`} start={edit.theme} isNew={edit.isNew} note={edit.note} onClose={() => setEdit(null)} />
        : (
          <div className="ctheme-row">
            <Button icon="plus" onClick={startNew} title={t("Starts from the theme you're using now")}>{t("New theme")}</Button>
            <Button variant="ghost" icon="import" onClick={(e) => importMenu(e.currentTarget)} title={t("From a file, or text someone shared")}>{t("Import")}</Button>
            <Button variant="ghost" icon="puzzle" onClick={() => go({ view: "extensions", section: "themes" })} title={t("Themes other people made, one click to install")}>{t("Get more themes")}</Button>
            {aiShown("useful", aiShow) && <Button variant="ghost" icon="ai" onClick={() => askAi({ kind: "theme", game: game?.id })} title={t("Describe a look and your chatbot writes the theme")}>{t("Describe it to your chatbot")}</Button>}
          </div>
        )}
      <input ref={file} type="file" accept=".json,.txt,application/json,text/plain" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void f.text().then(importText); }} />
    </Panel>
  );
}

// ── the editor ──

/** A colour the editor sets, and the tokens that follow from it so text and fills stay readable. `reset` is the
 *  tip on the button that puts the base theme's colour back. */
const COLORS: Array<{ token: string; label: string; tip: string; reset: (base: string) => string; derive: (hex: string, scheme: Scheme) => Record<string, string> }> = [
  { token: "--accent", label: t("Accent"), tip: t("Picked items, primary buttons, toggles"), reset: (base) => t("Use {theme}'s accent", { theme: base }),
    derive: (h, s) => ({ "--accent": h, "--on-accent": onColor(h), "--accent-soft": `color-mix(in srgb, ${h} 18%, transparent)`, "--accent-ink": s === "light" ? darkShade(h) : h, "--ring": h }) },
  { token: "--bg", label: t("Background"), tip: t("The window behind everything"), reset: (base) => t("Use {theme}'s background", { theme: base }),
    derive: (h) => ({ "--bg": h, "--bg-2": `color-mix(in srgb, ${h} 86%, #000)` }) },
  { token: "--surface", label: t("Panels"), tip: t("Panels, cards and lists"), reset: (base) => t("Use {theme}'s panels", { theme: base }),
    derive: (h) => ({ "--surface": h, "--surface-2": `color-mix(in srgb, ${h} 92%, var(--text))`, "--surface-3": `color-mix(in srgb, ${h} 85%, var(--text))`, "--raised": `color-mix(in srgb, ${h} 88%, var(--text))` }) },
  { token: "--text", label: t("Text"), tip: t("Main text. Fainter text is mixed from it"), reset: (base) => t("Use {theme}'s text", { theme: base }),
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

const editable = (th: CustomTheme) => themeText(th);

function ThemeEditor({ start, isNew, note, onClose }: { start: CustomTheme; isNew: boolean; note?: string[]; onClose: () => void }) {
  const game = useGame();
  const live = useTheme();
  const [draft, setDraft] = useState<CustomTheme>(start);
  const [problems, setProblems] = useState<string[]>([]);
  const [text, setText] = useState(() => editable(start));
  const [textErr, setTextErr] = useState<string | null>(null);
  const textId = useId();
  const typing = useRef(false);

  // the whole app shows the draft while editing; closing the editor puts the game's theme back
  useEffect(() => {
    const h = window.setTimeout(() => setProblems(applyCustomTheme(draft)), 100);
    if (!typing.current) setText(editable(draft));
    return () => window.clearTimeout(h);
  }, [draft]);
  useEffect(() => () => { applyCustomTheme(null); }, []);

  const patch = (p: Partial<CustomTheme>) => setDraft((x) => ({ ...x, ...p }));
  const setTokens = (add: Record<string, string>, drop: string[] = []) => setDraft((x) => {
    const tokens = { ...x.tokens, ...add };
    for (const k of drop) delete tokens[k];
    return { ...x, tokens };
  });
  const setLay = (k: keyof LayoutPrefs, v: string) => setDraft((x) => {
    const layout = { ...x.layout } as Record<string, string>;
    if (v) layout[k] = v; else delete layout[k];
    return { ...x, layout: layout as LayoutPrefs };
  });
  const onText = (v: string) => {
    setText(v);
    let raw: unknown;
    try { raw = JSON.parse(v); } catch { setTextErr(t("Not valid JSON yet")); return; }
    const r = validateCustomTheme(raw);
    if (!r.theme) { setTextErr(r.problems[0] ?? t("Not a theme")); return; }
    setTextErr(null);
    setDraft({ ...r.theme, id: draft.id });
  };
  const save = async () => {
    const { theme } = validateCustomTheme(draft);
    if (!theme) { toast(t("Give the theme a name"), true); return; }
    // a new theme's id comes from its name ("custom:green-night"); an edited one keeps its id
    const id = isNew ? (validateCustomTheme({ ...draft, id: undefined }).theme?.id ?? draft.id) : draft.id;
    try { await saveTheme({ ...theme, id }, isNew, game); onClose(); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), true); }
  };

  return (
    <div className="ctheme-ed" role="group" aria-label={isNew ? t("New theme") : t("Edit {theme}", { theme: start.name })}>
      <div className="ctheme-ed-top">
        <TextField label={t("Name")} value={draft.name} onChange={(v) => patch({ name: v })} autoFocus={isNew} />
        <Select label={t("Based on")} value={draft.base} onChange={(v) => patch({ base: v })} options={THEMES.map((b) => ({ value: b.id, label: b.name }))} />
      </div>
      <div className="ctheme-line">
        <span className="field-l">{t("Light or dark")}</span>
        <Segmented<SchemeChoice> value={draft.scheme} onChange={(v) => patch({ scheme: v })} label={t("Light or dark")} options={SCHEME_OPTIONS} size="sm" />
      </div>
      <div className="ctheme-line">
        <span className="field-l">{t("Colours")}</span>
        <div className="ctheme-colors">
          {COLORS.map((c) => {
            const set = !!draft.tokens[c.token];
            const val = /^#[0-9a-f]{6}$/i.test(draft.tokens[c.token] ?? "") ? draft.tokens[c.token]! : hexOf(c.token);
            return (
              <span key={c.token} className={`ctheme-color${set ? " set" : ""}`} title={c.tip}>
                <label><input type="color" value={val} onChange={(e) => setTokens(c.derive(e.target.value, live.scheme))} aria-label={c.label} /><span>{c.label}</span></label>
                {set && <IconButton icon="x" size="sm" label={c.reset(baseName(draft.base))} onClick={() => setTokens({}, Object.keys(c.derive("#000000", live.scheme)))} />}
              </span>
            );
          })}
        </div>
      </div>
      <div className="ctheme-layout">
        {LAYOUT_ROWS.map((r) => (
          <div key={r.key} className="ctheme-line">
            <span className="field-l" title={r.key === "density" ? t("Not set keeps what you picked under Layout, text size and animations") : undefined}>{r.label}</span>
            <Segmented value={draft.layout[r.key] ?? ""} onChange={(v) => setLay(r.key, v)} label={r.label} options={[NOT_SET, ...r.options]} size="sm" />
          </div>
        ))}
      </div>
      <details className="ctheme-adv">
        <summary>{t("Edit as text")}</summary>
        {/* the note under it sits outside the label, so the error is read as the field's description, not its name */}
        <div className="field mono">
          <label className="field-l" htmlFor={`${textId}-in`}>{t("Theme")}</label>
          <textarea id={`${textId}-in`} value={text} rows={12} spellCheck={false} onChange={(e) => onText(e.target.value)}
            aria-describedby={`${textId}-note`} aria-invalid={!!textErr || undefined}
            onFocus={() => { typing.current = true; }} onBlur={() => { typing.current = false; setText(editable(draft)); setTextErr(null); }} />
          {textErr ? <span id={`${textId}-note`} className="hint ctheme-err">{textErr}</span> : <span id={`${textId}-note`} className="hint">{t("\"tokens\" takes any name below, \"css\" holds the stylesheet")}</span>}
        </div>
        <label className="field mono">
          <span className="field-l">{t("Stylesheet")}</span>
          <textarea value={draft.css ?? ""} rows={14} spellCheck={false} onChange={(e) => patch({ css: e.target.value })} />
          <span className="hint">{t("Plain rules like .btn { } apply only while this theme is on and win over its base. :root is the window, for your own variables")}</span>
        </label>
        <details>
          <summary>{t("Tokens you can set")}</summary>
          <dl className="ctheme-tokens">
            {Object.entries(THEME_TOKENS).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v.meaning}</dd></div>)}
          </dl>
        </details>
        <details>
          <summary>{t("Parts you can style")}</summary>
          <pre className="ctheme-parts selectable">{anatomyText()}</pre>
        </details>
      </details>
      {(note?.length || problems.length) ? (
        <ul className="ctheme-probs">
          {[...(note ?? []), ...problems].slice(0, 8).map((p, i) => <li key={i}>{t("Left out: {problem}", { problem: p })}</li>)}
        </ul>
      ) : null}
      <div className="ctheme-ed-foot">
        <span className="hint">{t("You're seeing it now. Cancel puts your theme back.")}</span>
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        <Button variant="primary" icon="check" onClick={() => void save()} title={isNew && game ? t("Saves it and uses it for {game}", { game: gameName(game) }) : undefined}>{isNew ? t("Save and use") : t("Save")}</Button>
      </div>
    </div>
  );
}
