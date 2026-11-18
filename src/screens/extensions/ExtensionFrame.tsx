// An extension's page in a sandboxed frame, and the app's side of its API (lib/extension-bridge.js is the page's
// side). Each call is checked against the package's permissions here; files and web calls are checked again in
// Rust. The frame gets the app's colours, takes its page's height, and passes the app's shortcuts and the
// controller through (lib/gamepad.ts setFrameNav). Owner: EXTENSIONS area.
import { useEffect, useRef, useState } from "react";
import { characters as charsApi, errorText, extensions as api, library, owned as ownedApi, settings, shell, type AppStatus, type GameId, type GameState, type InstalledExt } from "../../lib/api";
import { setExtensionEnabled, usePageReloads } from "../../lib/extensions";
import { accountState } from "../../lib/account";
import { moveFocusFrom, setFrameNav } from "../../lib/gamepad";
import { go, VIEWS, type Route, type View } from "../../lib/store";
import { subscribeTheme, THEME_TOKENS } from "../../lib/theme";
import { Button, Empty, Waiting } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { t } from "../../lib/i18n";

export type ExtSlotName = "characterTab" | "page";

interface Props {
  ext: InstalledExt;
  slot: ExtSlotName;
  game: GameState;
  character?: { name: string; owned: boolean } | null;
}

/** The app's colours and fonts as the page should use them. */
function themeNow() {
  const cs = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const k of [...Object.keys(THEME_TOKENS), "--game-accent", "--game-on-accent"]) {
    const v = cs.getPropertyValue(k).trim();
    if (v) vars[k] = v;
  }
  return { scheme: document.documentElement.dataset.scheme === "light" ? "light" : "dark", vars };
}

/** How long a page has to say "ready" before it gets a way out. */
const READY_MS = 10_000;

// the controller moves into and out of extension frames through these
setFrameNav((frame, msg) => { frame.contentWindow?.postMessage({ gachamod: 1, type: "pad", ...msg }, "*"); });

export function ExtensionFrame({ ext, slot, game, character }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<{ url: string } | { html: string } | null>(null);
  const [height, setHeight] = useState(160);
  const [error, setError] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const m = ext.manifest!;
  const entry = (slot === "page" ? m.page : m.characterTab)?.entry ?? "";
  const ctx = { extension: { id: ext.id, name: m.name, version: m.version }, slot, game: { id: game.id, name: game.name, short: game.short }, character: character ?? null };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const ready = useRef(false);
  const reloads = usePageReloads();

  useEffect(() => {
    let live = true;
    setError(null);
    setSrc(null);
    setStuck(false);
    ready.current = false;
    api.pageSource(ext.id, entry).then((s) => { if (live) setSrc(s); }).catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [ext.id, entry, ext.manifest?.version, reloads, attempt]);

  // a page that never says "ready" gets a way out instead of a blank box
  useEffect(() => {
    if (!src) return;
    const t = window.setTimeout(() => { if (!ready.current) setStuck(true); }, READY_MS);
    return () => window.clearTimeout(t);
  }, [src]);

  const send = (msg: object) => ref.current?.contentWindow?.postMessage({ gachamod: 1, ...msg }, "*");

  // a new game or character goes to the page as a new context
  useEffect(() => { if (ready.current) send({ type: "context", context: ctx, theme: themeNow() }); }, [game.id, character?.name, character?.owned]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => subscribeTheme(() => { if (ready.current) requestAnimationFrame(() => send({ type: "theme", theme: themeNow() })); }), []);

  useEffect(() => {
    const frame = ref.current;
    const h = (e: MessageEvent) => {
      if (!frame || e.source !== frame.contentWindow) return;
      const msg = e.data as { gachamod?: number; type?: string; id?: number; method?: string; params?: unknown; height?: number } & Record<string, unknown>;
      if (!msg || msg.gachamod !== 1) return;
      if (msg.type === "ready") { ready.current = true; setStuck(false); send({ type: "context", context: ctxRef.current, theme: themeNow() }); }
      else if (msg.type === "size" && typeof msg.height === "number") setHeight(Math.max(80, Math.min(msg.height, 20000)));
      else if (msg.type === "call" && typeof msg.id === "number") {
        const id = msg.id;
        handle(ext, ctxRef.current.game.id, String(msg.method), msg.params)
          .then((result) => send({ type: "reply", id, result: result ?? null }))
          .catch((err) => send({ type: "reply", id, error: errorText(err) }));
      } else if (msg.type === "key") {
        frame.dispatchEvent(new KeyboardEvent("keydown", { key: String(msg.key), code: String(msg.code), ctrlKey: !!msg.ctrl, altKey: !!msg.alt, shiftKey: !!msg.shift, metaKey: !!msg.meta, bubbles: true, cancelable: true }));
      } else if (msg.type === "leave") {
        moveFocusFrom(frame, Number(msg.dx) || 0, Number(msg.dy) || 0);
      }
    };
    window.addEventListener("message", h);
    return () => { window.removeEventListener("message", h); };
  }, [ext, src]); // eslint-disable-line react-hooks/exhaustive-deps

  const way = (retry: string, retryTip: string) => (
    <>
      <Button icon="refresh" onClick={() => setAttempt((n) => n + 1)} title={retryTip}>{retry}</Button>
      <Button icon="power" onClick={() => void setExtensionEnabled(ext, false)} title={t("Turns {name} off. Undo turns it back on", { name: m.name })}>{t("Turn off")}</Button>
      {m.homepage && <Button icon="external" onClick={() => void shell.openUrl(m.homepage!)} title={m.homepage}>{t("Author's page")}</Button>}
    </>
  );
  if (error) {
    return (
      <Empty icon="puzzle" title={t("{name} couldn't load its page", { name: m.name })} actions={way(t("Try again"), t("Reads the page's files again"))}>
        {error}
      </Empty>
    );
  }
  if (!src) return <Waiting className="ext-frame-wait" what={t("Loading {name}", { name: m.name })} />;
  return (
    <>
      {stuck && (
        <Empty icon="puzzle" title={t("{name} isn't answering", { name: m.name })} actions={way(t("Reload page"), t("Starts the page again"))}>
          {t("The extension's page hasn't started after 10 seconds. It may be waiting on a site that's down, or it has a fault its author can fix.")}
        </Empty>
      )}
      <iframe ref={ref} className="ext-frame" data-ext={ext.id} title={`${m.name}: ${(slot === "page" ? m.page : m.characterTab)?.title ?? ""}`}
        sandbox="allow-scripts" referrerPolicy="no-referrer" allow=""
        style={{ height, display: stuck ? "none" : undefined }} {...("url" in src ? { src: src.url } : { srcDoc: src.html })} />
    </>
  );
}

/** What a page asked for, if its permissions allow it. */
async function handle(ext: InstalledExt, game: GameId, method: string, params: unknown): Promise<unknown> {
  const m = ext.manifest!;
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  const need = (ok: boolean, what: string) => { if (!ok) throw new Error(`${m.name} doesn't ask to ${what} in its permissions`); };
  switch (method) {
    case "game": return { id: game };
    case "characters": {
      need(m.permissions.library, "read your characters");
      const [list, own] = await Promise.all([charsApi.list(game), ownedApi.list(game).catch(() => [] as string[])]);
      const owned = new Set(own.map((n) => n.toLowerCase()));
      return list.map((c) => ({ name: c.name, icon: c.icon, mods: c.modCount, on: c.enabledCount, owned: owned.has(c.name.toLowerCase()) }));
    }
    case "mods": {
      need(m.permissions.library, "read your mods");
      const who = typeof p.character === "string" ? p.character.toLowerCase() : null;
      return (await library.list(game)).filter((x) => !who || x.character?.toLowerCase() === who).map((x) => ({
        id: x.id, name: x.name, character: x.character, enabled: x.enabled, tags: x.tags, version: x.version, favorite: x.favorite,
        nsfw: x.nsfw, installedAt: x.installedAt, gamebanana: x.source?.modId ?? null, url: x.source?.url ?? null,
      }));
    }
    case "player": {
      need(m.permissions.player, "read your GameBanana name");
      // the GameBanana name now that the player card is gone; older versions kept a name, title and UID
      const pl = await settings.getJson<{ name?: string; title?: string; uid?: string }>("player", {});
      return { name: accountState().user?.name ?? pl.name ?? "", title: pl.title ?? "", uid: pl.uid ?? "" };
    }
    case "fetch": return api.fetch(ext.id, { url: String(p.url ?? ""), method: typeof p.method === "string" ? p.method : undefined, headers: (p.headers ?? {}) as Record<string, string>, body: typeof p.body === "string" ? p.body : undefined });
    case "readFile": return api.readFile(ext.id, String(p.path ?? ""));
    case "listDir": return api.listDir(ext.id, String(p.path ?? ""));
    case "apps": return api.needs(ext.id);
    case "openApp": return api.openApp(ext.id, String(p.name ?? ""));
    case "openUrl": {
      const url = String(p.url ?? "");
      if (!/^https:\/\//i.test(url)) throw new Error("Only https links open in the browser");
      return shell.openUrl(url);
    }
    case "go": {
      const view = p.view as View;
      if (!VIEWS.includes(view)) throw new Error(`There's no "${String(p.view)}" page`);
      const r: Route = { view };
      if (typeof p.character === "string") r.character = p.character;
      if (typeof p.search === "string") r.search = p.search;
      if (typeof p.tab === "string") r.tab = p.tab;
      if (typeof p.modId === "string" || typeof p.modId === "number") r.modId = p.modId;
      go(r);
      return null;
    }
    case "toast": toast(`${m.name}: ${String(p.text ?? "").slice(0, 200)}`, !!p.bad); return null;
    case "storage.get": return (await api.storageGet(ext.id))[String(p.key ?? "")] ?? null;
    case "storage.all": return api.storageGet(ext.id);
    case "storage.set": return api.storageSet(ext.id, String(p.key ?? ""), p.value ?? null);
    default: throw new Error(`Unknown call "${method}"`);
  }
}

/** A note above an extension's page when an app it needs isn't on this PC, with where to get it. */
export function NeedsNote({ ext }: { ext: InstalledExt }) {
  const [apps, setApps] = useState<AppStatus[] | null>(null);
  useEffect(() => {
    let live = true;
    if (!ext.manifest?.needs.length) { setApps([]); return; }
    api.needs(ext.id).then((a) => { if (live) setApps(a); }).catch(() => { if (live) setApps([]); });
    return () => { live = false; };
  }, [ext.id, ext.manifest?.needs.length]);
  const missing = (apps ?? []).filter((a) => a.required && !a.installed);
  if (!missing.length) return null;
  return (
    <div className="ext-needs" role="note">
      {missing.map((a) => (
        <p key={a.name}>
          <span>{t("{name} works with {app}, which isn't on this PC yet. Install it, then come back to this page.", { name: ext.manifest!.name, app: a.name })}</span>
          {a.url && <Button size="sm" icon="external" onClick={() => void shell.openUrl(a.url!)} title={a.url}>{t("Get {app}", { app: a.name })}</Button>}
        </p>
      ))}
    </div>
  );
}
