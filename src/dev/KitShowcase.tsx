// Dev only: every kit component and screen pattern in every state, inside a mock of the shell, with a switch between
// the themes. Open http://localhost:1420/#kit while `npm run dev` runs (main.tsx mounts this instead of the app).
import { StrictMode, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Avatar, Badge, Button, Card, Checkbox, Chip, Confirm, Dialog, Drawer, Empty, IconButton, Kbd, Menu, PageHeader, Panel, Progress, Row,
  SearchField, Segmented, Select, Skeleton, Spinner, Tabs, TextField, Toggle, Toolbar, type Tone } from "../ui/kit";
import { Icon, type IconName } from "../ui/Icon";
import { Popover } from "../ui/Popover";
import { Toasts, toast } from "../ui/toast";
import { GameBadge } from "../ui/GameBadge";
import { focusSearch } from "../lib/keys";
import { BRAND_ACCENT, darkShade, onColor } from "../lib/theme";

export function mount(el: HTMLElement) {
  createRoot(el).render(<StrictMode><KitShowcase /></StrictMode>);
}

type Look = "default-dark" | "default-light" | "zzz";
const GAMES = [
  { id: "gi", name: "Genshin Impact", short: "Genshin", accent: "#d3bc8e", gamebananaId: 8552 },
  { id: "hsr", name: "Honkai: Star Rail", short: "Star Rail", accent: "#a596f5", gamebananaId: 18366 },
  { id: "zzz", name: "Zenless Zone Zero", short: "ZZZ", accent: "#ff7a1c", gamebananaId: 19567 },
  { id: "ww", name: "Wuthering Waves", short: "WuWa", accent: "#e9d58a", gamebananaId: 20357 },
  { id: "hi3", name: "Honkai Impact 3rd", short: "HI3", accent: "#59c3f5", gamebananaId: 10349 },
  { id: "pgr", name: "Punishing: Gray Raven", short: "PGR", accent: "#e8433d", gamebananaId: 19942 },
];

// placeholder pictures drawn as SVG, so the showcase needs no network
const svg = (body: string, w = 320, h = 200) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;
const art = (hue: number) => svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 55%)"/><stop offset="1" stop-color="hsl(${hue + 50} 60% 22%)"/></linearGradient></defs>
  <rect width="320" height="200" fill="url(#g)"/><circle cx="230" cy="70" r="46" fill="hsl(${hue + 20} 90% 80% / .55)"/><path d="M0 200 L110 90 L190 160 L240 120 L320 190 V200Z" fill="hsl(${hue + 70} 40% 15% / .8)"/>`);
const person = (hue: number) => svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 62%)"/><stop offset="1" stop-color="hsl(${hue + 30} 50% 28%)"/></linearGradient></defs>
  <rect width="150" height="200" fill="url(#g)"/><circle cx="75" cy="78" r="34" fill="hsl(${hue} 30% 92%)"/><path d="M14 200 C18 140 46 120 75 120 S132 140 136 200Z" fill="hsl(${hue + 180} 30% 18%)"/>
  <path d="M41 70 C40 34 110 30 109 72 C100 52 54 50 41 70Z" fill="hsl(${hue + 200} 45% 25%)"/>`, 150, 200);
// ?look=zzz and ?open=dialog|confirm|drawer|menu|toast|lightbox set the starting state (for screenshots)
const param = (k: string) => new URLSearchParams(location.search).get(k);
const opens = (what: string) => param("open") === what;

const ARTS = [12, 48, 95, 160, 205, 260, 300, 330].map(art);
const PEOPLE = [340, 20, 200, 120, 270, 45, 180, 300].map(person);

const LOOKS: Array<{ value: Look; label: string }> = [
  { value: "default-dark", label: "Default dark" }, { value: "default-light", label: "Default light" }, { value: "zzz", label: "New Eridu" },
];

function applyLook(look: Look, gameAccent: string) {
  const r = document.documentElement;
  r.dataset.theme = look === "zzz" ? "zzz" : "default";
  r.dataset.scheme = look === "default-light" ? "light" : "dark";
  r.style.setProperty("--game-accent", gameAccent);
  r.style.setProperty("--game-on-accent", onColor(gameAccent));
  r.style.setProperty("--game-accent-dk", darkShade(gameAccent));
}

export function KitShowcase() {
  const [look, setLook] = useState<Look>(() => (param("look") as Look | null) ?? (localStorage.getItem("gm.kit.look") as Look | null) ?? "default-dark");
  const [game, setGame] = useState("hsr");
  const [motion, setMotion] = useState(true);
  const accent = GAMES.find((g) => g.id === game)?.accent ?? BRAND_ACCENT;
  useEffect(() => { applyLook(look, accent); localStorage.setItem("gm.kit.look", look); }, [look, accent]);
  useEffect(() => { document.documentElement.dataset.motion = motion ? "full" : "reduced"; }, [motion]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (e.key === "/" && !/INPUT|TEXTAREA/.test(t.tagName)) { if (focusSearch()) e.preventDefault(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const [view, setView] = useState("library");
  const [viewKey, setViewKey] = useState(0);
  const nav: Array<{ id: string; label: string; icon: IconName; badge?: { count?: number; tone: string } }> = [
    { id: "home", label: "Home", icon: "home" }, { id: "library", label: "Mods", icon: "mods", badge: { count: 3, tone: "accent" } },
    { id: "characters", label: "Characters", icon: "characters" }, { id: "browse", label: "Browse", icon: "browse" },
    { id: "downloads", label: "Downloads", icon: "downloads", badge: { tone: "run" } }, { id: "profiles", label: "Profiles", icon: "profiles" },
    { id: "tools", label: "Tools", icon: "tools", badge: { count: 2, tone: "bad" } },
  ];
  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand"><span className="brand-mark" aria-hidden="true" /><span className="brand-t">gachamod</span></span>
        <span className="crumb"><span className="crumb-game">{GAMES.find((g) => g.id === game)?.name}</span><span className="crumb-view">Kit</span></span>
        <span className="sp" />
        <Segmented size="sm" label="Theme" value={look} options={LOOKS} onChange={setLook} />
        <IconButton icon="keyboard" label="Shortcuts (?)" size="sm" />
        <span className="winkeys">
          <button type="button" className="wk" aria-label="Minimise"><Icon name="minus" /></button>
          <button type="button" className="wk" aria-label="Maximise"><Icon name="max" /></button>
          <button type="button" className="wk wk-x" aria-label="Close"><Icon name="x" /></button>
        </span>
      </header>
      <nav className="rail" aria-label="Games">
        <div className="rail-games">
          {GAMES.map((g, i) => (
            <button key={g.id} type="button" className={`rail-g${g.id === game ? " on" : ""}${i === 1 ? " running" : ""}`} title={g.name} onClick={() => setGame(g.id)} style={{ "--g-accent": g.accent } as CSSProperties}>
              <GameBadge game={g} size={44} />
            </button>
          ))}
          <button type="button" className="rail-add" title="Add a game"><Icon name="plus" /></button>
        </div>
        <div className="rail-foot"><button type="button" className="rail-k" title="Settings" aria-label="Settings"><Icon name="settings" /></button></div>
      </nav>
      <aside className="side" aria-label="Views">
        <div className="player"><Avatar name="Proxy Belle" size={40} ring src={PEOPLE[0]} /><span className="player-n">Proxy Belle</span></div>
        <div className="side-nav">
          {nav.map((n) => (
            <button key={n.id} type="button" className={`nv${view === n.id ? " on" : ""}`} onClick={() => { setView(n.id); setViewKey((k) => k + 1); }} title={n.label}>
              <Icon name={n.icon} /><span className="nv-t">{n.label}</span>
              {n.badge && <span className={`nv-b t-${n.badge.tone}`}>{n.badge.count ?? ""}</span>}
            </button>
          ))}
        </div>
        <div className="side-foot">
          <PlayDemo />
        </div>
      </aside>
      <main className="view" key={viewKey}>
        <div className="page">
          <Showcase motion={motion} setMotion={setMotion} />
        </div>
      </main>
      <Toasts />
    </div>
  );
}

// the same markup as screens/home/PlayButton.tsx, with its states
function PlayDemo({ state = "play", big }: { state?: "play" | "starting" | "running" | "setup" | "menu"; big?: boolean }) {
  const cls = `play${big ? " play-big" : ""}${state === "running" ? " running" : ""}${state === "starting" ? " starting" : ""}`;
  if (state === "setup") return <div className={cls}><Button className="play-btn play-setup" variant="secondary" size="lg" icon="settings">Set up</Button></div>;
  return (
    <div className={cls}>
      <Button className="play-btn" variant="primary" size="lg" icon={state === "running" ? "zap" : "play"} busy={state === "starting"} disabled={state === "running"}
        title="Play (Ctrl+Enter)">{state === "running" ? "Running 12:04" : state === "starting" ? "Starting" : "Play"}</Button>
      <span className="play-more-w"><IconButton className="play-more" icon="down" variant="primary" size="lg" label="More ways to start" on={state === "menu"} /></span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="stack" style={{ gap: ".9rem" }}><h2 className="sec-h">{title}</h2>{children}</section>;
}
const wrap: CSSProperties = { display: "flex", flexWrap: "wrap", gap: ".75rem", alignItems: "center" };
const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))", gap: "1rem", alignItems: "start" };

function Showcase({ motion, setMotion }: { motion: boolean; setMotion: (v: boolean) => void }) {
  const [q, setQ] = useState("");
  const [q2, setQ2] = useState("Ellen");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("new");
  const [tab, setTab] = useState("keys");
  const [t1, setT1] = useState(true);
  const [t2, setT2] = useState(false);
  const [c1, setC1] = useState(true);
  const [c2, setC2] = useState(false);
  const [chips, setChips] = useState<string[]>(["ellen"]);
  const [name, setName] = useState("Coca Cola skin");
  const [notes, setNotes] = useState("Swap the jacket with Ctrl+J.");
  const [sel, setSel] = useState("auto");
  const [dialog, setDialog] = useState(opens("dialog"));
  const [confirm, setConfirm] = useState(opens("confirm"));
  const [drawer, setDrawer] = useState(opens("drawer"));
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null);
  const [picked, setPicked] = useState(1);
  const [char, setChar] = useState(2);
  const [shot, setShot] = useState(0);
  const [lightbox, setLightbox] = useState(opens("lightbox"));
  const [row, setRow] = useState(1);
  const [swatch, setSwatch] = useState(2);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0.35);
  const ticker = useRef(0);
  useEffect(() => { ticker.current = window.setInterval(() => setProg((p) => (p >= 1 ? 0 : p + 0.05)), 400); return () => clearInterval(ticker.current); }, []);
  useEffect(() => {
    if (opens("menu")) setMenuAt(document.querySelector<HTMLElement>("[data-kit-menu]"));
    if (opens("toast")) { toast("Installed Coca Cola for Ellen Joe"); toast("Turned off 3 mods", false, { label: "Undo", run: () => {} }); toast("Close the game first, then try again", true); }
  }, []);
  const tog = (id: string) => setChips((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const tones: Tone[] = ["accent", "ok", "warn", "bad", "info", "muted"];
  const chars = ["Ellen Joe", "Miyabi", "Jane Doe", "Zhu Yuan", "Burnice", "Yanagi", "Astra Yao", "Evelyn"];

  return (<>
    <PageHeader title="Mods" icon="mods" sub="24 mods, 9 on. Turn one on and the others for that character turn off."
      actions={<><Button icon="refresh" variant="ghost">Rescan</Button><Button icon="import">Import</Button><Button variant="primary" icon="browse">Find mods</Button></>}>
      <SearchField value={q} onChange={setQ} placeholder="Search mods" />
      <Segmented value={filter} onChange={setFilter} label="Filter" options={[{ value: "all", label: "All" }, { value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "upd", label: "Updates" }]} />
      <Segmented value={sort} onChange={setSort} label="Layout" size="sm" options={[{ value: "new", label: "", icon: "grid", title: "Grid" }, { value: "list", label: "", icon: "list", title: "List" }]} />
      <span className="grow" />
      <Toggle checked={motion} onChange={setMotion} label="Motion" size="sm" />
    </PageHeader>

    <Section title="Buttons">
      {(["primary", "secondary", "ghost", "danger"] as const).map((v) => (
        <div key={v} style={wrap}>
          <Button variant={v} size="sm" icon="install">Small</Button>
          <Button variant={v} icon="install">Install</Button>
          <Button variant={v} size="lg" iconRight="chevron">Large</Button>
          <Button variant={v} busy>Working</Button>
          <Button variant={v} disabled icon="trash">Disabled</Button>
          <IconButton variant={v} icon="star" label={`${v} icon button`} size="sm" />
          <IconButton variant={v} icon="heart" label={`${v} icon button`} />
          <IconButton variant={v} icon="more" label={`${v} icon button`} size="lg" />
          <IconButton variant={v} icon="trash" label="Disabled" disabled />
        </div>
      ))}
      <div style={wrap}>
        <IconButton icon="star" label="Favourite (on)" on /><IconButton icon="eye" label="Show (on)" on size="sm" />
        <Button variant="primary" busy={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1600); }}>Press for busy</Button>
        <span className="hint">Tab here to see focus rings</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 212px)", gap: "1rem", alignItems: "center" }}>
        <PlayDemo /><PlayDemo state="menu" /><PlayDemo state="starting" /><PlayDemo state="running" /><PlayDemo state="setup" />
      </div>
      <div style={wrap}><PlayDemo big /></div>
    </Section>

    <Section title="Inputs">
      <div style={grid2}>
        <div className="stack">
          <Toggle checked={t1} onChange={setT1} label="One skin per character" hint="Turning a skin on turns the others off" />
          <Toggle checked={t2} onChange={setT2} label="Keep downloaded archives" />
          <Toggle checked={true} onChange={() => {}} size="sm" label="Small, on" />
          <Toggle checked={false} onChange={() => {}} disabled label="Disabled" />
          <Checkbox checked={c1} onChange={setC1} label="Include saved options" />
          <Checkbox checked={c2} onChange={setC2} label="Use its profile" />
          <Checkbox checked={true} onChange={() => {}} disabled label="Disabled, on" />
        </div>
        <div className="stack">
          <TextField label="Name" value={name} onChange={setName} hint="Shown on the card. The folder keeps its name." />
          <TextField label="Hash" value="" onChange={() => {}} placeholder="e.g. 7f3a91c2" mono />
          <Select label="Theme" value={sel} onChange={setSel} options={[{ value: "auto", label: "Game's own" }, { value: "default", label: "Default" }, { value: "zzz", label: "New Eridu" }]} />
          <TextField label="Disabled" value="Read only" onChange={() => {}} disabled />
        </div>
        <div className="stack">
          <TextField label="Notes" value={notes} onChange={setNotes} multiline />
          <SearchField value={q2} onChange={setQ2} placeholder="Search" />
          <Segmented value={filter} onChange={setFilter} label="Big" size="lg" options={[{ value: "all", label: "All", icon: "grid" }, { value: "on", label: "On", icon: "check" }, { value: "off", label: "Off", icon: "x" }]} />
        </div>
      </div>
      <div style={wrap}>
        <Chip on={chips.includes("all")} onClick={() => tog("all")}>All</Chip>
        <Chip on={chips.includes("fav")} onClick={() => tog("fav")} icon="star">Favourites</Chip>
        <Chip on={chips.includes("upd")} onClick={() => tog("upd")} icon="update" count={3}>Updates</Chip>
        {chars.slice(0, 4).map((c, i) => <Chip key={c} img={PEOPLE[i]} count={i + 1} on={chips.includes(c.split(" ")[0]!.toLowerCase())} onClick={() => tog(c.split(" ")[0]!.toLowerCase())}>{c}</Chip>)}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "keys", label: "Toggles", icon: "keyboard", count: 4 }, { value: "options", label: "Options", icon: "sliders" }, { value: "problems", label: "Problems", count: 1 }, { value: "readme", label: "Readme" }]} />
    </Section>

    <Section title="Panels, cards, rows">
      <div style={grid2}>
        <Panel title="Launch" icon="play" count={3} actions={<IconButton icon="refresh" label="Reload" size="sm" />}>
          <Row label="Importer">ZZMI 1.5.0 via XXMI</Row>
          <Row label="Mods folder" hint="Change it in Settings">%APPDATA%\XXMI Launcher\ZZMI\Mods</Row>
          <Row label="Arguments"><span className="mono">-popupwindow</span></Row>
        </Panel>
        <Panel title="Flush panel" icon="list" flush>
          <div className="list lined">
            {["Swap jacket", "Hair colour", "Weapon glow"].map((t, i) => (
              <div key={t} className="list-row"><Kbd>{["Ctrl+J", "H", "Num 1"][i]}</Kbd><span className="list-row-main">{t}</span><span className="list-row-end">{i + 2} options</span></div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="cards" style={{ "--card-min": "12rem" } as CSSProperties}>
        <Card onClick={() => setPicked(0)} selected={picked === 0}><div style={{ padding: "1rem" }}><b>Clickable card</b><p className="hint">Press to select</p></div></Card>
        <Card onClick={() => setPicked(1)} selected={picked === 1}><div style={{ padding: "1rem" }}><b>Selected card</b><p className="hint">.card.sel</p></div></Card>
        <Card><div style={{ padding: "1rem" }}><b>Static card</b><p className="hint">No hover</p></div></Card>
        <Card onClick={() => {}} disabled><div style={{ padding: "1rem" }}><b>Disabled card</b><p className="hint">Can't press</p></div></Card>
      </div>
      <Toolbar><Badge>Toolbar</Badge><Button size="sm" icon="check">Turn on</Button><Button size="sm" icon="x">Turn off</Button><Button size="sm" variant="danger" icon="trash">Remove</Button></Toolbar>
    </Section>

    <Section title="Status">
      <div style={wrap}>
        {tones.map((t) => <Badge key={t} tone={t} icon={t === "bad" ? "warn" : t === "ok" ? "check" : undefined}>{t}</Badge>)}
        <Badge tone="accent" icon="update">Update</Badge><Badge tone="bad">Conflict</Badge><Badge tone="info" icon="key">Toggles</Badge>
      </div>
      <div style={grid2}>
        <div className="stack">
          <Progress value={prog} label="Download" />
          <Progress value={0.72} tone="ok" />
          <Progress value={0.4} tone="bad" />
          <Progress value={null} label="Working" />
        </div>
        <div style={wrap}>
          <Spinner /><Spinner size={22} /><span style={{ color: "var(--accent-ink)" }}><Spinner size={28} /></span>
          <Skeleton w={120} h={14} /><Skeleton w={44} h={44} round /><Skeleton w={160} h={60} />
        </div>
        <div style={wrap}>
          <Avatar name="Ellen Joe" src={PEOPLE[1]} size={48} />
          <Avatar name="Jane Doe" src={PEOPLE[2]} size={48} ring />
          <Avatar name="Zhu Yuan" size={48} />
          <Avatar name="Burnice White" size={48} square src={PEOPLE[4]} />
          <Avatar name="Proxy" size={32} ring />
          <span>Press <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> to play, <Kbd>/</Kbd> to search</span>
        </div>
      </div>
      <Panel flush><Empty icon="mods" title="No mods yet" actions={<><Button variant="primary" icon="browse">Browse GameBanana</Button><Button icon="folder">Open Mods folder</Button></>}>
        Find mods in Browse, or drop an archive anywhere on this window.</Empty></Panel>
    </Section>

    <Section title="Layers">
      <div style={wrap}>
        <Button onClick={() => setDialog(true)} icon="export">Dialog</Button>
        <Button onClick={() => setConfirm(true)} variant="danger" icon="trash">Confirm</Button>
        <Button onClick={() => setDrawer(true)} icon="file">Drawer</Button>
        <Button data-kit-menu onClick={(e) => setMenuAt(e.currentTarget)} iconRight="down">Menu</Button>
        <Button onClick={() => toast("Installed Coca Cola for Ellen Joe")}>Toast</Button>
        <Button onClick={() => toast("Turned off 3 mods", false, { label: "Undo", run: () => { toast("Turned them back on"); } })}>Toast with Undo</Button>
        <Button onClick={() => toast("Close the game first, then try again", true)}>Error toast</Button>
        <Button title="Tips show the shortcut when there is one (Ctrl+R)" icon="info">Hover for a tip</Button>
      </div>
    </Section>

    <Section title="Screen patterns">
      <div className="hero">
        <div className="hero-bg"><img src={ARTS[4]} alt="" /></div>
        <div className="hero-body">
          <span className="hero-k">ZZMI 1.5.0 via XXMI</span>
          <h2 className="hero-t">Zenless Zone Zero</h2>
          <p className="hero-sub">9 of 24 mods on. 2 updates waiting.</p>
          <div className="hero-a"><Button variant="primary" icon="play" size="lg">Play</Button><Button icon="folder">Mods folder</Button></div>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><Icon name="mods" className="stat-i" /><span className="stat-v">9 / 24</span><span className="stat-l">Mods on</span></div>
        <div className="stat t-accent"><Icon name="update" className="stat-i" /><span className="stat-v">2</span><span className="stat-l">Updates waiting</span></div>
        <button type="button" className="stat t-bad"><Icon name="warn" className="stat-i" /><span className="stat-v">1</span><span className="stat-l">Conflicts</span></button>
        <div className="stat t-ok"><Icon name="downloads" className="stat-i" /><span className="stat-v">1.4 GB</span><span className="stat-l">On disk</span></div>
      </div>
      <div className="tiles">
        {ARTS.slice(0, 6).map((src, i) => (
          <button key={i} type="button" className={`tile${i === picked + 2 ? " sel" : ""}${i === 3 ? " off" : ""}${i === 5 ? " blur" : ""}`} onClick={() => setPicked(i - 2)}>
            <div className="tile-img"><img src={src} alt="" />
              <div className="tile-tl">{i === 0 && <Badge tone="accent" icon="update">Update</Badge>}{i === 1 && <Badge tone="bad">Conflict</Badge>}{i === 5 && <Badge>NSFW</Badge>}</div>
              <div className="tile-tr tile-hover"><IconButton icon="more" label="More" size="sm" variant="secondary" /></div>
            </div>
            <div className="tile-body">
              <span className="tile-t">{["Coca Cola", "Racer outfit", "Maid swap", "Off: Winter coat", "Shark hoodie", "Blurred preview"][i]}</span>
              <span className="tile-sub">{chars[i]}</span>
              <span className="tile-meta"><span><Icon name="thumb" />{120 * (i + 1)}</span><span><Icon name="eye" />{(3.2 * (i + 1)).toFixed(1)}K</span><span>2 days ago</span></span>
            </div>
          </button>
        ))}
      </div>
      <div style={grid2}>
        <div className="list">
          {chars.slice(0, 5).map((c, i) => (
            <button key={c} type="button" className={`list-row${row === i ? " sel" : ""}`} onClick={() => setRow(i)}>
              <span className="list-row-img"><img src={PEOPLE[i]} alt="" /></span>
              <span className="list-row-main"><span className="list-row-t">{c}</span><span className="list-row-sub">{i + 1} skins, {i % 2 ? "default outfit" : "Coca Cola on"}</span></span>
              <span className="list-row-end">{(i + 1) * 120} MB</span>
            </button>
          ))}
          <div className="list-row"><span className="list-row-main"><span className="list-row-t">A row with no picture</span><span className="list-row-sub">Static .list-row</span></span><Toggle checked onChange={() => {}} size="sm" /></div>
        </div>
        <div className="stack">
          <div className="pchips">
            {chars.map((c, i) => (
              <button key={c} type="button" className={`pchip${char === i ? " on" : ""}`} onClick={() => setChar(i)} title={c}>
                <span className="pchip-img"><img src={PEOPLE[i]} alt="" /></span><span className="pchip-t">{c.split(" ")[0]}</span>{i < 4 && <span className="pchip-n">{i + 1}</span>}
              </button>
            ))}
          </div>
          <div className="portraits" style={{ "--portrait-min": "6.5rem" } as CSSProperties}>
            {chars.slice(0, 6).map((c, i) => (
              <button key={c} type="button" className={`portrait${char === i ? " on" : ""}${i === 5 ? " dim" : ""}`} onClick={() => setChar(i)}>
                {i % 2 === 0 && <span className="portrait-bg"><img src={ARTS[i]} alt="" /></span>}
                <span className="portrait-img"><img src={PEOPLE[i]} alt="" /></span>
                {i < 5 && <span className="portrait-c">{i + 1}</span>}
                <span className="portrait-n">{c}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={grid2}>
        <div className="gallery">
          <button type="button" className="gallery-main" onClick={() => setLightbox(true)} title="Open (Enter)"><img src={ARTS[shot]} alt="" /></button>
          <div className="gallery-strip">{ARTS.map((src, i) => <button key={i} type="button" className={`gallery-th${shot === i ? " on" : ""}`} onClick={() => setShot(i)}><img src={src} alt="" /></button>)}</div>
        </div>
        <div className="stack">
          <div className="note"><Icon name="info" /><span>Mods load when the game starts. <strong>Reload in game</strong> with F10.</span></div>
          <div className="note t-warn"><Icon name="warn" /><span>XXMI Launcher is open. Close it so gachamod can save launch settings.</span></div>
          <div className="note t-bad"><Icon name="warn" /><span>2 mods change the same hash. Keep one of them on.</span></div>
          <div className="note t-ok"><Icon name="check" /><span>Everything is up to date.</span></div>
          <div style={wrap}>
            {["#ff5c7a", "#ffb84d", "#d6f900", "#4fd18b", "#59c3f5", "#8b7cff"].map((c, i) => <button key={c} type="button" className={`swatch${swatch === i ? " on" : ""}`} style={{ "--c": c } as CSSProperties} onClick={() => setSwatch(i)} title={c} />)}
            <span className="dot t-ok" /><span className="dot t-warn" /><span className="dot t-bad" /><span className="dot" />
          </div>
        </div>
      </div>
      <h3 className="sec-h">New on GameBanana</h3>
      <div className="strip" style={{ "--strip-w": "13rem" } as CSSProperties}>
        {ARTS.map((src, i) => (
          <button key={i} type="button" className="tile" style={{ "--tile-ratio": "4 / 3" } as CSSProperties}>
            <div className="tile-img"><img src={src} alt="" /></div>
            <div className="tile-body"><span className="tile-t">New mod {i + 1}</span><span className="tile-sub">by modder{i}</span></div>
          </button>
        ))}
      </div>
      <div style={grid2}>
        <div className="prose"><h3>Coca Cola outfit</h3><p>A red and white outfit for <b>Ellen Joe</b>. Press <code>Ctrl+J</code> to swap the jacket. <a href="#kit">Source on GameBanana</a>.</p>
          <ul><li>Two hair colours</li><li>Works with the 2.x update</li></ul><blockquote>Thanks to everyone who tested it.</blockquote></div>
        <pre className="codeblock">{`[KeySwap]\nkey = ctrl VK_J\ntype = cycle\n$swapvar = 0,1\n\n[TextureOverrideBody]\nhash = 7f3a91c2\nib = ResourceBodyIB`}</pre>
      </div>
      <div className="floatbar"><span className="floatbar-n">3 selected</span><Button size="sm" icon="check">Turn on</Button><Button size="sm" icon="x">Turn off</Button><Button size="sm" variant="danger" icon="trash">Remove</Button><IconButton icon="x" label="Clear selection" size="sm" /></div>
    </Section>

    <Section title="Nested themes (Settings previews)">
      <div style={grid2}>
        {([["default", "dark"], ["default", "light"], ["zzz", "dark"]] as const).map(([t, s]) => (
          <div key={t + s} data-theme={t} data-scheme={s} style={{ background: "var(--bg)", borderRadius: 16, padding: "1rem", display: "flex", flexDirection: "column", gap: ".7rem", boxShadow: "inset 0 0 0 1px var(--line)" }}>
            <b>{t === "zzz" ? "New Eridu" : `Default ${s}`}</b>
            <div style={wrap}><Button variant="primary" size="sm">Play</Button><Button size="sm">Cancel</Button><Chip on>On</Chip><Toggle checked onChange={() => {}} size="sm" /></div>
            <Progress value={0.6} />
          </div>
        ))}
      </div>
    </Section>

    {dialog && (
      <Dialog title="Export mods" icon="export" onClose={() => setDialog(false)} footer={<><Button variant="ghost" onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary" icon="export" onClick={() => setDialog(false)}>Save as .gachamod</Button></>}>
        <div className="stack">
          <TextField label="Title" value="Ellen skins" onChange={() => {}} />
          <Toggle checked onChange={() => {}} label="Include saved options" hint="Keys and swaps you set in game" />
          <Progress value={0.45} />
        </div>
      </Dialog>
    )}
    {confirm && <Confirm title="Remove for good?" danger yes="Remove" onYes={() => { toast("Removed"); }} onClose={() => setConfirm(false)}>This deletes 3 mods from the trash. It can't be undone.</Confirm>}
    {drawer && (
      <Drawer title="Coca Cola" onClose={() => setDrawer(false)} actions={<IconButton icon="external" label="Open on GameBanana" />} footer={<><Button variant="danger" icon="trash">Remove</Button><span className="grow" /><Button variant="primary" icon="check">Wear</Button></>}>
        <div className="stack">
          <div className="gallery"><div className="gallery-main"><img src={ARTS[1]} alt="" /></div></div>
          <Row label="Character">Ellen Joe</Row><Row label="Version">1.2</Row><Row label="Size">48 MB</Row>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: "keys", label: "Toggles" }, { value: "options", label: "Options" }]} />
          <p className="hint">The drawer scrolls on its own.</p>
        </div>
      </Drawer>
    )}
    {menuAt && (
      <Popover anchor={menuAt} onClose={() => setMenuAt(null)} width="15rem" label="Menu">
        <Menu items={[{ label: "Open folder", icon: "folder", onClick: () => setMenuAt(null) }, { label: "Move to character", icon: "characters", onClick: () => setMenuAt(null) },
          { label: "Export as .gachamod", icon: "export", onClick: () => setMenuAt(null) }, { label: "Disabled item", icon: "lock", onClick: () => {}, disabled: true }, "-",
          { label: "Remove", icon: "trash", danger: true, onClick: () => setMenuAt(null) }]} />
      </Popover>
    )}
    {lightbox && (
      <div className="lightbox" onClick={() => setLightbox(false)}>
        <img src={ARTS[shot]} alt="" />
        <button type="button" className="lightbox-prev" aria-label="Previous" onClick={(e) => { e.stopPropagation(); setShot((s) => (s + ARTS.length - 1) % ARTS.length); }}><Icon name="back" /></button>
        <button type="button" className="lightbox-next" aria-label="Next" onClick={(e) => { e.stopPropagation(); setShot((s) => (s + 1) % ARTS.length); }}><Icon name="chevron" /></button>
        <button type="button" className="lightbox-x" aria-label="Close"><Icon name="x" /></button>
        <span className="lightbox-n">{shot + 1} / {ARTS.length}</span>
      </div>
    )}
  </>);
}
