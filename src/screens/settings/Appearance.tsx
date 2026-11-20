// Settings > Appearance: Theme and colours (theme per game, accent, light or dark), Layout, text size and animations,
// and Custom themes. Settings > General: Language and startup, and Hardware acceleration and rendering log.
// Owner: SETTINGS/AI area. Applying themes is lib/theme.ts (THEMES area); saving custom ones is ./customThemes.ts.
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { currentGame, go, useGame, useGames } from "../../lib/store";
import { shareTheme } from "../../lib/extensions";
import { record } from "../../lib/history";
import { aiShown, askAi, useAiShow } from "../../lib/ai";
import {
  THEMES, THEME_TOKENS, accentPick, applyCustomTheme, contrastOf, isAccentHex, currentLayout, customThemesPref, onColor, ownSchemeChoice, readableOn, setAccentPick, setLayout, setMotion,
  setScheme, setSchemeMode, setThemePick, setThemePicks, subscribeTheme, themeAttrs, themePick, tokenHex, useTheme, validateCustomTheme,
  type CustomTheme, type LayoutPrefs, type Scheme, type SchemeChoice, type SchemeMode,
} from "../../lib/theme";
import { anatomyText } from "../../lib/theme-anatomy";
import { SIZES, ZOOMS, getTextSize, getZoom, setTextSize, setZoom, stepZoom, zoomLabel } from "../../lib/zoom";
import { Button, Card, IconButton, Panel, Segmented, Select, TextField, Toggle } from "../../ui/kit";
import { menuHandler, openMenu, type MenuEntry } from "../../ui/ContextMenu";
import { Icon } from "../../ui/Icon";
import { ColorPicker } from "../../ui/ColorPicker";
import { toast } from "../../ui/toast";
import { SetRow } from "./parts";
import { FormatPicker } from "./FormatPicker";
import { RenderLogRow } from "./Feedback";
import { hiddenThemePref } from "../../lib/fun";
import { addThemes, copyTheme, duplicateOf, readThemes, removeEntry, removeTheme, removeTip, saveTheme } from "./customThemes";
import { readThemeText, themeSettingsText } from "./themeSource";
import { hintsOnPref } from "../../shell/hints";
import { INTRO_LIST, introPick, replaySplash, setIntroPick, themeIntro } from "../../splash/splash";
import { about, errorText } from "../../lib/api";
import { pref } from "../../lib/prefs";
import { LANGS, lang, langChoice, setLangChoice, systemLang, t, type LangChoice } from "../../lib/i18n";
import { settings } from "../../lib/api";
import { gameName } from "../../lib/games";

const SCHEME_OPTIONS: Array<{ value: SchemeChoice; label: string; icon?: "moon" | "sun" }> = [
  { value: "dark", label: t("Dark"), icon: "moon" }, { value: "light", label: t("Light"), icon: "sun" }, { value: "system", label: t("System") },
];
const LIGHT_NATIVE = THEMES.filter((th) => th.native === "light" && !th.hidden).map((th) => th.name);
/** The light-native themes as a list in the user's language ("Wuthering Waves and Endfield"). */
const lightNative = () => new Intl.ListFormat(lang, { type: "conjunction" }).format(LIGHT_NATIVE);
const modeOptions = (): Array<{ value: SchemeMode; label: string; icon?: "moon" | "sun" | "controller"; title?: string }> => [
  { value: "game", label: t("Match the game"), icon: "controller", title: t("Light or dark like each game's menus: {themes} light, the rest dark", { themes: lightNative() }) },
  { value: "dark", label: t("Dark"), icon: "moon", title: t("Every theme dark") },
  { value: "light", label: t("Light"), icon: "sun", title: t("Every theme light, even the one set in space") },
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
  // the user's own themes sit with the built-in ones, so the theme in use always shows as picked here
  const saved = customThemesPref.use();
  const customs = saved.map((s) => validateCustomTheme(s).theme).filter((s): s is CustomTheme => !!s);
  const aiShow = useAiShow();
  const customMenu = (th: CustomTheme): MenuEntry[] => [
    !!game && { label: t("Use for {game}", { game: gameName(game) }), icon: "check", disabled: pick === th.id, onClick: () => choose(th.id) },
    aiShown("useful", aiShow) && { label: t("Edit with AI"), icon: "ai", title: th.pkg ? t("This theme comes from a package, so the changes go in a copy") : t("Describe what should change and your chatbot rewrites the theme"),
      onClick: () => askAi({ kind: "theme-edit", game: game?.id, theme: th.id }) },
    { label: th.pkg ? t("Edit a copy") : t("Edit"), icon: "edit", title: t("Opens it in Custom themes"), onClick: () => editTheme(th.id) },
  ];

  return (
    <Panel title={t("Theme and colours")} icon="palette" id="appearance">
      <div className="field-l">{game ? t("Theme for {game}", { game: gameName(game) }) : t("Theme")}</div>
      <div className="set-themes">
        <ThemeCard id={defaultFor.id} name={t("Match the game")} description={t("Uses {theme}", { theme: defaultFor.name })} on={pick === "auto"} onClick={() => choose("auto")} disabled={!game} />
        {THEMES.filter((th) => !th.hidden || found || pick === th.id).map((th) => <ThemeCard key={th.id} id={th.id} name={th.name} on={pick === th.id} onClick={() => choose(th.id)} disabled={!game} />)}
        {customs.map((th) => (
          <CustomCard key={th.id} th={th} on={pick === th.id} disabled={!game} description={t("Your theme, on {theme}", { theme: baseName(th.base) })}
            onClick={() => choose(th.id)} items={() => customMenu(th)} />
        ))}
      </div>
      <div className="set-rows">
        {accents.length > 1 && !theme.custom && (
          <SetRow id="set-accent" label={t("Accent")} hint={t("The colour {theme} uses for what is picked or on", { theme: themeName })}>
            <span className="set-accents" role="radiogroup" aria-label={t("Accent")}>
              {accents.map((a) => (
                <button key={a.id} type="button" role="radio" aria-checked={accent === a.id} className={`swatch${accent === a.id ? " on" : ""}`} title={a.name} aria-label={a.name}
                  style={{ "--c": a.color } as CSSProperties} onClick={() => { setAccentPick(theme.id, a.id, currentGame()); setAccent(a.id); }} />
              ))}
              <AccentPicker value={isAccentHex(accent) ? accent : null} fallback={accents.find((a) => a.id === accent)?.color ?? accents[0]!.color}
                onPick={(hex) => { setAccentPick(theme.id, hex, currentGame()); setAccent(hex); }} />
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
              <Segmented<SchemeMode> value={theme.mode} onChange={(v) => setSchemeMode(v, currentGame())} label={t("Light or dark")} options={modeOptions()} />
            </SetRow>
            {theme.mode === "game" && (
              <SetRow label={t("Just {theme}", { theme: themeName })} hint={themeInfo?.native === "light" ? t("The game's menus are light. A pick here counts only for {theme}", { theme: themeName }) : t("The game's menus are dark. A pick here counts only for {theme}", { theme: themeName })}>
                <Segmented<SchemeChoice> value={ownSchemeChoice(theme.id)} onChange={(v) => setScheme(v, currentGame())} label={t("Light or dark for {theme}", { theme: themeName })} options={SCHEME_OPTIONS} size="sm" />
              </SetRow>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

/** The last accent swatch: any colour, from the app's colour picker. `value` is the colour picked with it, if that
    is the accent in use; the picker opens on `fallback` otherwise. */
function AccentPicker({ value, fallback, onPick }: { value: string | null; fallback: string; onPick: (hex: string) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <span className="swatch-pick-w">
      <button ref={btn} type="button" role="radio" aria-checked={!!value} aria-expanded={open} className={`swatch swatch-pick${value ? " on" : ""}`}
        title={t("Pick any colour, black and white too")} aria-label={t("Pick any colour")}
        style={value ? { "--c": value, color: onColor(value) } as CSSProperties : undefined} onClick={() => setOpen((o) => !o)}>
        <Icon name="palette" />
      </button>
      {open && <ColorPicker anchor={btn.current} value={value ?? fallback} label={t("Accent colour")} onPick={onPick} onClose={() => setOpen(false)} />}
    </span>
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
        <SetRow id="set-intro" label={t("Opening screen")} hint={t("An intro with a one-line tip while gachamod starts. Match the theme plays the one that goes with the theme in use. A click or Escape skips it")}>
          <IntroPicker />
        </SetRow>
        <SetRow id="set-hints" label={t("First-start hints")} hint={t("Right after setup, Browse, Install and Downloads look faintly selected until you've used them once")}>
          <HintsSwitch />
        </SetRow>
      </div>
    </Panel>
  );
}

/** The Mods layout, spacing, the sidebar and buttons, then text size, zoom and animations. */
export function LayoutSection() {
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
        <span className="hint">{t("How Mods and each character's page are laid out. Every layout has the same features")}</span>
        <FormatPicker />
      </div>
      <div className="set-rows">
        <LayoutRows />
        <SetRow id="set-text-size" label={t("Text size")} hint={t("Changes only the text. Zoom makes pictures and spacing bigger too")}>
          <Select value={String(size)} onChange={(v) => { setTextSize(Number(v)); setSize(Number(v)); }}
            options={SIZES.map((s) => ({ value: String(s), label: t("{size} px", { size: s }) }))} />
        </SetRow>
        <SetRow id="set-zoom" label={t("Zoom")} hint={t("Makes the whole window bigger or smaller. Ctrl+= and Ctrl+- work anywhere, Ctrl+0 resets")}>
          <ZoomControl />
        </SetRow>
        <MotionRows />
      </div>
    </Panel>
  );
}

/** The app's language: Windows' language by default. Saved in the settings too, so it travels with a settings export. */
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
  useTheme(); // the "Match the theme" label follows the theme
  const [pick, setPick] = useState(introPick);
  const own = INTRO_LIST.find((i) => i.id === themeIntro())?.name ?? t("Default");
  const options = [
    { value: "theme", label: t("Match the theme ({intro})", { intro: own }) },
    ...INTRO_LIST.map((i) => ({ value: i.id, label: i.name })),
    { value: "off", label: t("Off") },
  ];
  return (
    <span className="set-btns">
      <Button size="sm" variant="ghost" icon="play" onClick={replaySplash} disabled={pick === "off"} title={t("Play the opening screen now")}>{t("Play it")}</Button>
      <Select value={pick} options={options} onChange={(v) => { setIntroPick(v); setPick(v); }} />
    </span>
  );
}

function HintsSwitch() {
  const on = hintsOnPref.use();
  return <Toggle checked={on} ariaLabel={t("First-start hints")} onChange={(v) => void hintsOnPref.set(v, v ? t("Turned first-start hints on") : t("Turned first-start hints off"))} />;
}

function ZoomControl() {
  const [zoom, setZoomShown] = useState(getZoom);
  useEffect(() => {
    const h = (e: Event) => setZoomShown((e as CustomEvent<number>).detail);
    window.addEventListener("gm-zoom", h);
    return () => window.removeEventListener("gm-zoom", h);
  }, []);
  return (
    <span className="set-btns">
      <IconButton icon="minus" size="sm" variant="secondary" label={t("Zoom out (Ctrl+-)")} disabled={zoom <= ZOOMS[0]} onClick={() => stepZoom(-1)} />
      <Button size="sm" variant="ghost" onClick={() => setZoom(1)} disabled={zoom === 1} title={t("Reset to 100% (Ctrl+0)")}>{zoomLabel(zoom)}</Button>
      <IconButton icon="plus" size="sm" variant="secondary" label={t("Zoom in (Ctrl+=)")} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => stepZoom(1)} />
    </span>
  );
}

// ── animations ──

/** Three switches instead of one, so smooth scrolling or a theme's moving background can stay with the rest off. */
function MotionRows() {
  const { motion } = useTheme();
  return (
    <>
      <SetRow id="set-motion" label={t("Interface animations")} hint={t("Pages, menus and windows slide and fade in. Off makes every change instant")}>
        <Toggle checked={motion.ui} onChange={(v) => setMotion("ui", v, currentGame())} />
      </SetRow>
      <SetRow id="set-motion-scroll" label={t("Smooth scrolling")} hint={t("Each notch of the mouse wheel glides instead of jumping")}>
        <Toggle checked={motion.scroll} onChange={(v) => setMotion("scroll", v, currentGame())} />
      </SetRow>
      <SetRow id="set-motion-bg" label={t("Theme background motion")}
        hint={t("Moving backgrounds in game themes, like the drifting words behind New Eridu, and seasonal touches from Fun")}>
        <span className="set-admin">
          <Button size="sm" variant="ghost" onClick={() => go({ view: "settings", section: "set-seasonal" })} title={t("Opens Seasonal touches in Fun")}>{t("Seasonal touches")}</Button>
          <Toggle checked={motion.bg} ariaLabel={t("Theme background motion")} onChange={(v) => setMotion("bg", v, currentGame())} />
        </span>
      </SetRow>
    </>
  );
}

// ── layout ──

const NOT_SET = { value: "", label: t("Not set") };
const LAYOUT_ROWS: Array<{ key: keyof LayoutPrefs; id?: string; label: string; hint?: string; options: Array<{ value: string; label: string }> }> = [
  { key: "density", id: "set-layout", label: t("Spacing"), hint: t("Compact fits more on screen"),
    options: [{ value: "compact", label: t("Compact") }, { value: "cozy", label: t("Cozy") }, { value: "roomy", label: t("Roomy") }] },
  { key: "sidebar", label: t("Sidebar side"), options: [{ value: "left", label: t("Left") }, { value: "right", label: t("Right") }] },
  { key: "nav", label: t("Views in the sidebar"), hint: t("Grid puts two on each row"), options: [{ value: "list", label: t("List") }, { value: "grid", label: t("Grid") }] },
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
  { id: string; name: string; description?: string; on: boolean; onClick: () => void; disabled?: boolean; scheme?: Scheme; tokens?: Record<string, string> }) {
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
      <span className="theme-card-t"><b>{name}</b>{description && <span className="hint">{description}</span>}</span>
    </Card>
  );
}

const schemeOf = (c: SchemeChoice): Scheme | undefined => (c === "system" ? undefined : c);

/** One of the user's themes as a card. A click uses it. The bin button, Delete or the menu's last entry deletes it
 *  (a package's theme removes the package), and right-click, R3 or the ... button opens the menu. `onRemove` runs
 *  first, to close an editor showing it. */
function CustomCard({ th, on, disabled, description, onClick, items, onRemove }:
  { th: CustomTheme; on: boolean; disabled: boolean; description: string; onClick: () => void; items: () => MenuEntry[]; onRemove?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // keyboard and controller focus moves to the card beside it instead of dropping to the top of the page
  const before = () => {
    const el = box.current;
    if (el?.contains(document.activeElement)) {
      const near = el.nextElementSibling ?? el.previousElementSibling;
      const card = near?.matches(".theme-card") ? near : near?.querySelector(".theme-card");
      if (card instanceof HTMLElement) card.focus();
    }
    onRemove?.();
  };
  const menu = () => [...items(), "-" as const, removeEntry(th, before)];
  const remove = () => { before(); void removeTheme(th); };
  return (
    <div ref={box} className="ctheme" onContextMenu={menuHandler(menu)}
      onKeyDown={(e) => {
        if (e.key !== "Delete" || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
        e.preventDefault();
        remove();
      }}>
      <ThemeCard id={th.base} name={th.name} scheme={schemeOf(th.scheme)} tokens={th.tokens} on={on} disabled={disabled} description={description} onClick={onClick} />
      <span className="ctheme-acts">
        <IconButton className="ctheme-del" icon="trash" label={removeTip(th)} size="sm" onClick={remove} />
        <IconButton icon="more" label={t("More (or right-click)")} size="sm" onClick={(e) => openMenu(e.currentTarget, menu())} />
      </span>
    </div>
  );
}

/** Opens a custom theme in the Custom themes editor, from anywhere in Settings. */
const EDIT_THEME = "gachamod:edit-theme";
function editTheme(id: string) {
  go({ view: "settings", section: "themes" });
  window.dispatchEvent(new CustomEvent(EDIT_THEME, { detail: id }));
}
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
    record({ label: t("Used the theme {theme} for every game", { theme: th.name }), brief: t("Used the theme for every game"), undo: async () => setThemePicks(before, currentGame()), redo: async () => setThemePicks(after, currentGame()) });
  };
  // a package's themes come back from the package each start, so editing one edits a copy and deleting removes the package
  const closeEditor = (th: CustomTheme) => { if (edit?.theme.id === th.id) setEdit(null); };
  const startNew = () => setEdit({ theme: { id: "custom:my-theme", name: t("My theme"), base: theme.id, scheme: theme.choice, tokens: {}, layout: {} }, isNew: true });
  // Edit on a card in Theme and colours opens the editor here
  useEffect(() => {
    const open = (e: Event) => {
      const th = list.find((x) => x.id === (e as CustomEvent<string>).detail);
      if (th) setEdit(th.pkg ? { theme: duplicateOf(th, list), isNew: true } : { theme: th, isNew: false });
    };
    window.addEventListener(EDIT_THEME, open);
    return () => window.removeEventListener(EDIT_THEME, open);
  });
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
    aiShown("useful", aiShow) && { label: t("Edit with AI"), icon: "ai", title: th.pkg ? t("This theme comes from a package, so the changes go in a copy") : t("Describe what should change and your chatbot rewrites the theme"),
      onClick: () => askAi({ kind: "theme-edit", game: game?.id, theme: th.id }) },
    !th.pkg && { label: t("Duplicate"), icon: "copy", onClick: () => setEdit({ theme: duplicateOf(th, list), isNew: true }) },
    { label: t("Copy as text"), icon: "share", title: t("To share it: whoever gets it imports it here"), onClick: () => copyTheme(th) },
    !th.pkg && { label: t("Share to the theme list"), icon: "upload", title: t("Saves it as a package and opens the page where you send it in, so anyone can install it from Extensions"), onClick: () => void shareTheme(th) },
    !!th.pkg && { label: t("View in Extensions"), icon: "puzzle", title: t("This theme came from a package"), onClick: () => go({ view: "extensions", tab: "installed" }) },
  ];
  const cardText = (th: CustomTheme) => !game ? t("On {theme}.", { theme: baseName(th.base) })
    : inUse === th.id ? t("On {theme}. In use for {game}", { theme: baseName(th.base), game: gameName(game) })
    : t("On {theme}. Click to use it for {game}", { theme: baseName(th.base), game: gameName(game) });

  return (
    <Panel title={t("Custom themes")} icon="wand" id="themes">
      {list.length > 0 && (
        <div className="set-themes">
          {list.map((th) => (
            <CustomCard key={th.id} th={th} on={inUse === th.id} disabled={!game} description={cardText(th)}
              onClick={() => use(th)} items={() => items(th)} onRemove={() => closeEditor(th)} />
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
            <Button variant="ghost" icon="puzzle" onClick={() => go({ view: "extensions", section: "themes" })} title={t("Install themes other people made")}>{t("Get more themes")}</Button>
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
    derive: (h, s) => {
      // text and focus rings in the accent use a shade that reads on the panels, so any accent works, black too
      const panel = tokenHex("--surface"), ink = readableOn(h, rgbOk(panel) ? panel : s === "light" ? "#f4f4f2" : "#1c1d22");
      return { "--accent": h, "--on-accent": onColor(h), "--accent-soft": `color-mix(in srgb, ${h} 18%, transparent)`, "--accent-ink": ink, "--ring": readableOn(h, panel, 3) };
    } },
  { token: "--bg", label: t("Background"), tip: t("The window behind everything"), reset: (base) => t("Use {theme}'s background", { theme: base }),
    derive: (h) => ({ "--bg": h, "--bg-2": `color-mix(in srgb, ${h} 86%, #000)` }) },
  { token: "--surface", label: t("Panels"), tip: t("Panels, cards and lists"), reset: (base) => t("Use {theme}'s panels", { theme: base }),
    derive: (h) => ({ "--surface": h, "--surface-2": `color-mix(in srgb, ${h} 92%, var(--text))`, "--surface-3": `color-mix(in srgb, ${h} 85%, var(--text))`, "--raised": `color-mix(in srgb, ${h} 88%, var(--text))` }) },
  { token: "--text", label: t("Text"), tip: t("Main text. Fainter text is mixed from it"), reset: (base) => t("Use {theme}'s text", { theme: base }),
    derive: (h) => ({ "--text": h, "--text-2": `color-mix(in srgb, ${h} 78%, var(--surface))`, "--text-3": `color-mix(in srgb, ${h} 62%, var(--surface))` }) },
];

/** tokenHex's answer when it couldn't read the colour. */
const rgbOk = (hex: string) => hex !== "#808080";

/** One of the editor's colours: a chip that opens the colour picker. */
function EditorColor({ value, label, onPick }: { value: string; label: string; onPick: (hex: string) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={btn} type="button" className="ctheme-chip" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={t("Pick the colour for {what}", { what: label })}>
        <span className="ctheme-dot" style={{ background: value }} /><span>{label}</span>
      </button>
      {open && <ColorPicker anchor={btn.current} value={value} label={label} onPick={onPick} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Text on the panels below this is hard to read (WCAG AA for normal text). */
const READABLE = 4.5;

/** The theme's settings for the Edit as text box. Its stylesheet has a box of its own under it. */
const editable = (th: CustomTheme) => themeSettingsText(th);

function ThemeEditor({ start, isNew, note, onClose }: { start: CustomTheme; isNew: boolean; note?: string[]; onClose: () => void }) {
  const game = useGame();
  const live = useTheme();
  const [draft, setDraft] = useState<CustomTheme>(start);
  const [problems, setProblems] = useState<string[]>([]);
  // how well the text reads on the panels with the draft applied
  const [textRead, setTextRead] = useState(21);
  // the text box keeps what's typed until it reads as a theme, so a mistake never loses an edit
  const [text, setText] = useState(() => editable(start));
  const [textErr, setTextErr] = useState<string | null>(null);
  const textId = useId();
  const typing = useRef(false);
  // the text read with nothing left out, so leaving the box can lay it out again
  const tidy = useRef(true);
  const textBox = useRef<HTMLTextAreaElement>(null);
  const advanced = useRef<HTMLDetailsElement>(null);

  // the whole app shows the draft while editing; closing the editor puts the game's theme back
  useEffect(() => {
    const h = window.setTimeout(() => { setProblems(applyCustomTheme(draft)); setTextRead(contrastOf(tokenHex("--text"), tokenHex("--surface"))); }, 100);
    if (!typing.current && !textErr) { setText(editable(draft)); tidy.current = true; }
    return () => window.clearTimeout(h);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
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
    const read = readThemeText(v);
    if (!read.ok) { setTextErr(read.error); tidy.current = false; return; }
    // the stylesheet goes to its own box as typed (it's checked as the theme applies, like that box); text without one
    // keeps the stylesheet there
    const css = "css" in read.value ? read.value.css : draft.css;
    const r = validateCustomTheme({ ...read.value, css: undefined });
    if (!r.theme) { setTextErr(r.problems[0] ?? t("Not a theme")); tidy.current = false; return; }
    setTextErr(null);
    tidy.current = !r.problems.length;
    setDraft({ ...r.theme, id: draft.id, ...(typeof css === "string" && css ? { css } : {}) });
  };
  const resetText = () => { setText(editable(draft)); setTextErr(null); tidy.current = true; };
  const save = async () => {
    if (textErr) {
      // saving now would drop what's in the text box
      if (advanced.current) advanced.current.open = true;
      textBox.current?.focus();
      toast(t("Fix the theme text first. {problem}", { problem: textErr }), true, { label: t("Reset the text"), run: resetText });
      return;
    }
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
            const val = /^#[0-9a-f]{6}$/i.test(draft.tokens[c.token] ?? "") ? draft.tokens[c.token]! : tokenHex(c.token);
            return (
              <span key={c.token} className={`ctheme-color${set ? " set" : ""}`} title={c.tip}>
                <EditorColor value={val} label={c.label} onPick={(h) => setTokens(c.derive(h, live.scheme))} />
                {set && <IconButton icon="x" size="sm" label={c.reset(baseName(draft.base))} onClick={() => setTokens({}, Object.keys(c.derive("#000000", live.scheme)))} />}
              </span>
            );
          })}
        </div>
      </div>
      {textRead < READABLE && (
        <p className="hint ctheme-read" role="status">
          {t("Text is hard to read on these panels ({ratio} to 1, 4.5 reads well).", { ratio: textRead.toFixed(1) })}{" "}
          <Button size="sm" variant="ghost" title={t("Moves the text colour just far enough from the panels to read well")}
            onClick={() => setTokens(COLORS.find((c) => c.token === "--text")!.derive(readableOn(tokenHex("--text"), tokenHex("--surface")), live.scheme))}>{t("Fix the text colour")}</Button>
        </p>
      )}
      <div className="ctheme-layout">
        {LAYOUT_ROWS.map((r) => (
          <div key={r.key} className="ctheme-line">
            <span className="field-l" title={r.key === "density" ? t("Not set keeps what you picked under Layout, text size and animations") : undefined}>{r.label}</span>
            <Segmented value={draft.layout[r.key] ?? ""} onChange={(v) => setLay(r.key, v)} label={r.label} options={[NOT_SET, ...r.options]} size="sm" />
          </div>
        ))}
      </div>
      <details className="ctheme-adv" ref={advanced}>
        <summary>{t("Edit as text")}</summary>
        {/* the note under it sits outside the label, so the error is read as the field's description, not its name */}
        <div className="field mono">
          <label className="field-l" htmlFor={`${textId}-in`}>{t("Theme")}</label>
          <textarea ref={textBox} id={`${textId}-in`} value={text} rows={12} spellCheck={false} onChange={(e) => onText(e.target.value)}
            aria-describedby={`${textId}-note`} aria-invalid={!!textErr || undefined}
            onFocus={() => { typing.current = true; }} onBlur={() => { typing.current = false; if (tidy.current && !textErr) setText(editable(draft)); }} />
          {textErr ? (
            <span className="ctheme-err-row">
              <span id={`${textId}-note`} className="hint ctheme-err">{textErr}</span>
              <Button size="sm" variant="ghost" onClick={resetText} title={t("Puts back the text for the theme as it is now, without what you typed here")}>{t("Reset the text")}</Button>
            </span>
          ) : <span id={`${textId}-note`} className="hint">{t("\"tokens\" takes any name from Tokens you can set, below. The stylesheet has its own box")}</span>}
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
